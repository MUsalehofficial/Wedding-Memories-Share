import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json, newRequestId, safeErrorMessage } from '../_shared/http.ts'
import {
  adminCapacityView,
  canCreateOriginalUpload,
  type CapacitySettings,
} from '../_shared/capacity.ts'
import {
  buildGoogleAuthorizeUrl,
  collisionResistantDriveName,
  deleteDriveFile,
  downloadDriveFile,
  exchangeGoogleCode,
  fetchDriveQuota,
  getFileMetadata,
  googleConfig,
  googleSecretPresence,
  refreshGoogleAccessToken,
  uploadFileMultipart,
} from '../_shared/google_drive.ts'

/**
 * Wedding API — Google Drive spike + live capacity checks.
 * Full guest/admin product waits until docs/gdrive-upload-spike.md passes.
 */

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_SPIKE_BYTES = 5 * 1024 * 1024

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Supabase service role not available')
  return createClient(url, key, { auth: { persistSession: false } })
}

function routeOf(pathname: string): string {
  return pathname
    .replace(/^\/functions\/v1\/wedding-api\/?/, '')
    .replace(/^\/wedding-api\/?/, '')
    .replace(/^\//, '')
}

async function loadEventSettings(sb: ReturnType<typeof adminClient>) {
  const { data } = await sb
    .from('events')
    .select(
      'id, video_uploads_enabled, upload_safety_reserve_bytes, capacity_warn_ratio, capacity_critical_ratio',
    )
    .eq('slug', 'muhammad-basmala')
    .maybeSingle()
  if (!data) throw new Error('event_missing')
  const settings: CapacitySettings = {
    safetyReserveBytes: Number(data.upload_safety_reserve_bytes ?? 104857600),
    videoUploadsEnabled: data.video_uploads_enabled !== false,
    warnRatio: Number(data.capacity_warn_ratio ?? 0.2),
    criticalRatio: Number(data.capacity_critical_ratio ?? 0.1),
  }
  return { eventId: data.id as string, settings }
}

async function loadRefreshToken(sb: ReturnType<typeof adminClient>, eventId: string) {
  const { data: integ } = await sb
    .from('google_drive_integrations')
    .select('id, status, refresh_token_vault_secret_id')
    .eq('event_id', eventId)
    .maybeSingle()
  if (!integ || integ.status !== 'connected' || !integ.refresh_token_vault_secret_id) {
    throw new Error('google_drive_disconnected')
  }
  const { data: token, error } = await sb.rpc('wedding_vault_get', {
    secret_id: integ.refresh_token_vault_secret_id,
  })
  if (error || !token) throw new Error('refresh_token_missing')
  return { integId: integ.id as string, refreshToken: token as string }
}

async function accessTokenForEvent(sb: ReturnType<typeof adminClient>, eventId: string) {
  const { integId, refreshToken } = await loadRefreshToken(sb, eventId)
  const tokens = await refreshGoogleAccessToken(refreshToken)
  if (tokens.refresh_token) {
    const { data: integ } = await sb
      .from('google_drive_integrations')
      .select('refresh_token_vault_secret_id')
      .eq('id', integId)
      .single()
    if (integ?.refresh_token_vault_secret_id) {
      await sb.rpc('wedding_vault_update', {
        secret_id: integ.refresh_token_vault_secret_id,
        secret_value: tokens.refresh_token,
      })
    }
  }
  await sb
    .from('google_drive_integrations')
    .update({ last_token_refresh_at: new Date().toISOString() })
    .eq('id', integId)
  return tokens.access_token
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const requestId = req.headers.get('x-request-id') ?? newRequestId()

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  const url = new URL(req.url)
  const route = routeOf(url.pathname)

  try {
    if ((route === 'health' || route === '') && req.method === 'GET') {
      return json(
        { ok: true, service: 'wedding-api', storage: 'google_drive', requestId },
        200,
        origin,
        requestId,
      )
    }

    if (route === 'gdrive-health' && req.method === 'GET') {
      const presence = googleSecretPresence()
      const ready = Object.values(presence).every(Boolean)
      return json(
        { ready, secrets: presence, requestId },
        ready ? 200 : 503,
        origin,
        requestId,
      )
    }

    if (route === 'google-connect' && req.method === 'GET') {
      googleConfig()
      const state = crypto.randomUUID()
      const sb = adminClient()
      await sb.from('oauth_states').insert({ state, provider: 'google' })
      const authorizeUrl = buildGoogleAuthorizeUrl(state)
      return json({ authorizeUrl, state, requestId }, 200, origin, requestId)
    }

    if (route === 'google-callback' && req.method === 'GET') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (!code || !state) {
        return json({ error: 'missing_code_or_state', requestId }, 400, origin, requestId)
      }
      const sb = adminClient()
      const { data: st } = await sb.from('oauth_states').select('state, expires_at').eq('state', state).maybeSingle()
      await sb.from('oauth_states').delete().eq('state', state)
      if (!st || new Date(st.expires_at) < new Date()) {
        return json({ error: 'invalid_state', requestId }, 400, origin, requestId)
      }

      const tokens = await exchangeGoogleCode(code)
      if (!tokens.refresh_token) {
        return json(
          { error: 'no_refresh_token', message: 'Re-consent with prompt=consent', requestId },
          400,
          origin,
          requestId,
        )
      }

      const { eventId } = await loadEventSettings(sb)
      const { data: secretId, error: vaultErr } = await sb.rpc('wedding_vault_put', {
        secret_name: `google_refresh_${eventId}`,
        secret_value: tokens.refresh_token,
      })
      if (vaultErr || !secretId) throw vaultErr ?? new Error('vault_put_failed')

      const access = tokens.access_token
      const quota = await fetchDriveQuota(access)

      await sb.from('google_drive_integrations').upsert(
        {
          event_id: eventId,
          status: 'connected',
          refresh_token_vault_secret_id: secretId,
          connected_at: new Date().toISOString(),
          last_token_refresh_at: new Date().toISOString(),
          last_quota_check_at: new Date().toISOString(),
          last_quota_limit_bytes: quota.limit,
          last_quota_usage_bytes: quota.usage,
          last_successful_api_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'event_id' },
      )

      // HTML for browser redirect UX
      return new Response(
        `<!doctype html><html><body style="font-family:serif;padding:2rem">
         <p>Google Drive connected. You can close this window.</p>
         <p>Quota limit bytes: ${quota.limit ?? 'unknown'}</p>
         </body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      )
    }

    if (route === 'gdrive-quota' && req.method === 'GET') {
      const sb = adminClient()
      const { eventId, settings } = await loadEventSettings(sb)
      const access = await accessTokenForEvent(sb, eventId)
      const quota = await fetchDriveQuota(access)
      await sb
        .from('google_drive_integrations')
        .update({
          last_quota_check_at: new Date().toISOString(),
          last_quota_limit_bytes: quota.limit,
          last_quota_usage_bytes: quota.usage,
          last_successful_api_at: new Date().toISOString(),
        })
        .eq('event_id', eventId)
      return json({ ...adminCapacityView(quota, settings), requestId }, 200, origin, requestId)
    }

    if (route === 'gdrive-spike-upload' && req.method === 'POST') {
      const contentType = req.headers.get('content-type') ?? ''
      if (!contentType.includes('multipart/form-data') && !contentType.includes('application/json')) {
        // Accept raw body as JPEG for simple spike
      }

      let bytes: Uint8Array
      let mime = 'image/jpeg'
      let filename = 'spike.jpg'

      if (contentType.includes('application/json')) {
        const body = await req.json() as { base64?: string; contentType?: string; filename?: string }
        if (!body.base64) return json({ error: 'missing_base64', requestId }, 400, origin, requestId)
        const bin = atob(body.base64)
        bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        mime = body.contentType ?? 'image/jpeg'
        filename = body.filename ?? 'spike.jpg'
      } else {
        const buf = new Uint8Array(await req.arrayBuffer())
        bytes = buf
        mime = req.headers.get('x-content-type') ?? 'image/jpeg'
      }

      if (!ALLOWED_IMAGE_TYPES.has(mime)) {
        return json({ error: 'invalid_content_type', requestId }, 400, origin, requestId)
      }
      if (bytes.byteLength <= 0 || bytes.byteLength > MAX_SPIKE_BYTES) {
        return json({ error: 'invalid_size', requestId }, 400, origin, requestId)
      }

      const sb = adminClient()
      const { eventId, settings } = await loadEventSettings(sb)
      const access = await accessTokenForEvent(sb, eventId)
      const quota = await fetchDriveQuota(access)
      const gate = canCreateOriginalUpload(quota, settings, bytes.byteLength, 'image')
      if (!gate.ok) {
        return json(
          { error: gate.code, message: gate.message, capacity: adminCapacityView(quota, settings), requestId },
          507,
          origin,
          requestId,
        )
      }

      const name = collisionResistantDriveName(mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg')
      const file = await uploadFileMultipart(access, { name, mimeType: mime, bytes })

      const { data: media, error } = await sb
        .from('media')
        .insert({
          event_id: eventId,
          status: 'pending',
          media_kind: 'image',
          storage_provider: 'google_drive',
          google_original_file_id: file.id,
          size_bytes: Number(file.size ?? bytes.byteLength),
          mime_type: file.mimeType ?? mime,
          upload_status: 'uploaded',
          moderation_status: 'pending',
          guest_name: filename.slice(0, 180),
        })
        .select('id')
        .single()
      if (error) throw error

      return json(
        {
          mediaId: media.id,
          fileIdRedacted: `${file.id.slice(0, 8)}…`,
          fileId: file.id,
          size: file.size,
          mimeType: file.mimeType,
          capacity: adminCapacityView(quota, settings),
          requestId,
        },
        200,
        origin,
        requestId,
      )
    }

    if (route === 'gdrive-spike-display' && req.method === 'GET') {
      const fileId = url.searchParams.get('fileId')
      if (!fileId) return json({ error: 'missing_file_id', requestId }, 400, origin, requestId)
      const sb = adminClient()
      const { eventId } = await loadEventSettings(sb)
      const access = await accessTokenForEvent(sb, eventId)
      const meta = await getFileMetadata(access, fileId)
      const mediaRes = await downloadDriveFile(access, fileId)
      if (!mediaRes.ok) {
        return json({ error: 'download_failed', status: mediaRes.status, requestId }, 502, origin, requestId)
      }
      return new Response(mediaRes.body, {
        status: 200,
        headers: {
          ...corsHeaders(origin),
          'Content-Type': meta.mimeType ?? 'application/octet-stream',
          'Cache-Control': 'private, max-age=60',
          'x-request-id': requestId,
        },
      })
    }

    if (route === 'gdrive-spike-delete' && req.method === 'POST') {
      const body = await req.json() as { fileId?: string; mediaId?: string }
      if (!body.fileId) return json({ error: 'missing_file_id', requestId }, 400, origin, requestId)
      const sb = adminClient()
      const { eventId } = await loadEventSettings(sb)
      const access = await accessTokenForEvent(sb, eventId)
      const del = await deleteDriveFile(access, body.fileId)
      let gone = false
      try {
        await getFileMetadata(access, body.fileId)
      } catch {
        gone = true
      }
      if (body.mediaId) {
        await sb
          .from('media')
          .update({ upload_status: 'deleted', updated_at: new Date().toISOString() })
          .eq('id', body.mediaId)
      }
      return json({ deleted: del.ok, cleanupVerified: gone || del.status === 404, requestId }, 200, origin, requestId)
    }

    if (route.startsWith('r2-') || route.startsWith('microsoft-') || route === 'create-onedrive-upload-session') {
      return json(
        {
          error: 'gone',
          message: 'Storage is Google Drive. See docs/gdrive-upload-spike.md',
          requestId,
        },
        410,
        origin,
        requestId,
      )
    }

    return json({ error: 'not_found', route, requestId }, 404, origin, requestId)
  } catch (err) {
    const message = safeErrorMessage(err)
    const status =
      message.includes('google_drive_disconnected') || message.includes('refresh_token')
        ? 503
        : message.includes('invalid_grant')
        ? 401
        : 500
    if (message.includes('invalid_grant')) {
      try {
        const sb = adminClient()
        const { eventId } = await loadEventSettings(sb)
        await sb
          .from('google_drive_integrations')
          .update({ status: 'disconnected', last_error: 'invalid_grant', updated_at: new Date().toISOString() })
          .eq('event_id', eventId)
      } catch {
        /* ignore */
      }
    }
    return json({ error: 'internal', message, requestId }, status, origin, requestId)
  }
})
