import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json, newRequestId, safeErrorMessage } from '../_shared/http.ts'
import {
  adminCapacityView,
  canCreateOriginalUpload,
  type CapacitySettings,
} from '../_shared/capacity.ts'
import { DEFAULT_CHUNK_BYTES } from '../_shared/chunks.ts'
import { mintGuestToken, verifyGuestToken } from '../_shared/guest_token.ts'
import { previewObjectPath, validateUploadMeta } from '../_shared/upload_validation.ts'
import {
  assertPrivatePermissions,
  buildGoogleAuthorizeUrl,
  collisionResistantDriveName,
  createResumableUpload,
  deleteDriveFile,
  downloadDriveFile,
  ensureWeddingFolderTree,
  exchangeGoogleCode,
  fetchDriveQuota,
  getFileMetadata,
  googleConfig,
  googleSecretPresence,
  listFilePermissions,
  queryResumableOffset,
  redactId,
  redactUploadUrl,
  refreshGoogleAccessToken,
  uploadFileMultipart,
} from '../_shared/google_drive.ts'

/**
 * Wedding API — Google Drive hardening spike (not full guest/admin product).
 */

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_SPIKE_BYTES = 5 * 1024 * 1024
const PREVIEW_BUCKET = 'wedding-previews'
const SIGNED_TTL_SEC = 120

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

function guestSecret(): string {
  // Prefer dedicated secret; service role is temporary fallback for hardening only.
  // ponytail: set GUEST_TOKEN_SIGNING_SECRET before wedding; do not rely on service role long-term
  const s = Deno.env.get('GUEST_TOKEN_SIGNING_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!s) throw new Error('GUEST_TOKEN_SIGNING_SECRET missing')
  return s
}

async function loadEventSettings(sb: ReturnType<typeof adminClient>) {
  const { data } = await sb
    .from('events')
    .select(
      'id, video_uploads_enabled, upload_safety_reserve_bytes, capacity_warn_ratio, capacity_critical_ratio, uploads_enabled, max_image_bytes, max_video_bytes',
    )
    .eq('slug', 'muhammad-basmala')
    .maybeSingle()
  if (!data) throw new Error('event_missing')
  const settings: CapacitySettings = {
    safetyReserveBytes: Number(data.upload_safety_reserve_bytes ?? 104857600),
    videoUploadsEnabled: data.video_uploads_enabled !== false,
    warnRatio: Number(data.capacity_warn_ratio ?? 0.2),
    criticalRatio: Number(data.capacity_critical_ratio ?? 0.1),
    uploadsEnabled: data.uploads_enabled !== false,
    maxImageBytes: Number(data.max_image_bytes ?? 20 * 1024 * 1024),
    maxVideoBytes: Number(data.max_video_bytes ?? 100 * 1024 * 1024),
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

type FolderRow = {
  root_folder_id: string | null
  originals_folder_id: string | null
  originals_images_folder_id: string | null
  originals_videos_folder_id: string | null
  exports_folder_id: string | null
}

async function loadOrEnsureFolders(
  sb: ReturnType<typeof adminClient>,
  eventId: string,
  access: string,
  force = false,
) {
  const { data: integ } = await sb
    .from('google_drive_integrations')
    .select(
      'root_folder_id, originals_folder_id, originals_images_folder_id, originals_videos_folder_id, exports_folder_id',
    )
    .eq('event_id', eventId)
    .maybeSingle()
  const row = integ as FolderRow | null
  const complete =
    row?.root_folder_id &&
    row.originals_folder_id &&
    row.originals_images_folder_id &&
    row.originals_videos_folder_id &&
    row.exports_folder_id
  if (complete && !force) {
    return {
      rootFolderId: row.root_folder_id!,
      originalsFolderId: row.originals_folder_id!,
      originalsImagesFolderId: row.originals_images_folder_id!,
      originalsVideosFolderId: row.originals_videos_folder_id!,
      exportsFolderId: row.exports_folder_id!,
      created: false,
    }
  }
  // Bootstrap once via name search; thereafter IDs are stored and reused.
  const tree = await ensureWeddingFolderTree(access)
  await sb
    .from('google_drive_integrations')
    .update({
      root_folder_id: tree.rootFolderId,
      originals_folder_id: tree.originalsFolderId,
      originals_images_folder_id: tree.originalsImagesFolderId,
      originals_videos_folder_id: tree.originalsVideosFolderId,
      exports_folder_id: tree.exportsFolderId,
      updated_at: new Date().toISOString(),
    })
    .eq('event_id', eventId)
  return { ...tree, created: true }
}

async function requireGuest(
  req: Request,
  eventId: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const origin = req.headers.get('Origin')
  const requestId = req.headers.get('x-request-id') ?? newRequestId()
  const verified = await verifyGuestToken(guestSecret(), req.headers.get('x-guest-token'))
  if (!verified.ok) {
    return {
      ok: false,
      response: json({ error: verified.code, requestId }, 401, origin, requestId),
    }
  }
  if (verified.eventId !== eventId) {
    return {
      ok: false,
      response: json({ error: 'guest_token_event_mismatch', requestId }, 401, origin, requestId),
    }
  }
  return { ok: true }
}

async function finishGoogleOAuth(
  code: string | null,
  state: string | null,
  origin: string | null,
  requestId: string,
  htmlOk: boolean,
): Promise<Response> {
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

  const quota = await fetchDriveQuota(tokens.access_token)
  const tree = await ensureWeddingFolderTree(tokens.access_token)

  await sb.from('google_drive_integrations').upsert(
    {
      event_id: eventId,
      status: 'connected',
      refresh_token_vault_secret_id: secretId,
      root_folder_id: tree.rootFolderId,
      originals_folder_id: tree.originalsFolderId,
      originals_images_folder_id: tree.originalsImagesFolderId,
      originals_videos_folder_id: tree.originalsVideosFolderId,
      exports_folder_id: tree.exportsFolderId,
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

  const view = {
    connected: true,
    foldersRedacted: {
      root: redactId(tree.rootFolderId),
      originals: redactId(tree.originalsFolderId),
      images: redactId(tree.originalsImagesFolderId),
      videos: redactId(tree.originalsVideosFolderId),
      exports: redactId(tree.exportsFolderId),
    },
    quotaBytes: {
      limit: quota.limit,
      usage: quota.usage,
      usageInDrive: quota.usageInDrive,
      usageInDriveTrash: quota.usageInDriveTrash,
      maxUploadSize: quota.maxUploadSize,
    },
    requestId,
  }

  if (htmlOk) {
    return new Response(
      `<!doctype html><html><body style="font-family:serif;padding:2rem">
       <p>Google Drive connected. You can close this window.</p>
       <p>Quota limit bytes: ${quota.limit ?? 'unknown'}</p>
       </body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
  return json(view, 200, origin, requestId)
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
        {
          ready,
          secrets: {
            ...presence,
            GUEST_TOKEN_SIGNING_SECRET: Boolean(Deno.env.get('GUEST_TOKEN_SIGNING_SECRET')),
          },
          scopesConfigured: googleConfig().scopes.split(/\s+/).filter(Boolean),
          requestId,
        },
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
      return await finishGoogleOAuth(
        url.searchParams.get('code'),
        url.searchParams.get('state'),
        origin,
        requestId,
        true,
      )
    }

    if (route === 'google-callback-exchange' && req.method === 'POST') {
      const body = await req.json() as { code?: string; state?: string }
      return await finishGoogleOAuth(body.code ?? null, body.state ?? null, origin, requestId, false)
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

    if (route === 'gdrive-mint-guest' && req.method === 'POST') {
      // Hardening harness only — mint short-lived guest token for spike tests.
      const sb = adminClient()
      const { eventId } = await loadEventSettings(sb)
      const token = await mintGuestToken(guestSecret(), eventId, 3600)
      // ponytail: return token for harness; never log it
      return json({ ok: true, guestToken: token, expiresInSec: 3600, requestId }, 200, origin, requestId)
    }

    if (route === 'gdrive-ensure-folders' && req.method === 'POST') {
      const sb = adminClient()
      const { eventId } = await loadEventSettings(sb)
      const access = await accessTokenForEvent(sb, eventId)
      const folders = await loadOrEnsureFolders(sb, eventId, access, false)
      return json(
        {
          ok: true,
          created: folders.created,
          foldersRedacted: {
            root: redactId(folders.rootFolderId),
            originals: redactId(folders.originalsFolderId),
            images: redactId(folders.originalsImagesFolderId),
            videos: redactId(folders.originalsVideosFolderId),
            exports: redactId(folders.exportsFolderId),
          },
          requestId,
        },
        200,
        origin,
        requestId,
      )
    }

    if (route === 'gdrive-create-resumable-session' && req.method === 'POST') {
      const body = await req.json() as {
        mimeType?: string
        filename?: string
        byteSize?: number
        mediaKind?: 'image' | 'video'
        idempotencyKey?: string
        parentFolderId?: string
        parents?: unknown
      }
      const sb = adminClient()
      const { eventId, settings } = await loadEventSettings(sb)
      const guest = await requireGuest(req, eventId)
      if (!guest.ok) return guest.response

      const mediaKind = body.mediaKind === 'video' ? 'video' : 'image'
      const meta = validateUploadMeta({
        mimeType: body.mimeType ?? '',
        filename: body.filename ?? '',
        byteSize: Number(body.byteSize),
        mediaKind,
        maxImageBytes: settings.maxImageBytes ?? 20 * 1024 * 1024,
        maxVideoBytes: settings.maxVideoBytes ?? 100 * 1024 * 1024,
        parentFolderId: body.parentFolderId,
        parents: body.parents,
      })
      if (!meta.ok) {
        return json({ error: meta.code, message: meta.message, requestId }, 400, origin, requestId)
      }

      const idempotencyKey = (body.idempotencyKey ?? '').trim()
      if (!idempotencyKey) {
        return json({ error: 'missing_idempotency_key', requestId }, 400, origin, requestId)
      }

      const { data: existing } = await sb
        .from('upload_sessions')
        .select('id, status, graph_upload_url, byte_size, media_kind, content_type')
        .eq('event_id', eventId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()

      if (existing) {
        const { data: media } = await sb
          .from('media')
          .select('id')
          .eq('upload_session_id', existing.id)
          .maybeSingle()
        return json(
          {
            reused: true,
            sessionId: existing.id,
            mediaId: media?.id ?? null,
            uploadUrlRedacted: existing.graph_upload_url
              ? redactUploadUrl(existing.graph_upload_url)
              : null,
            // Browser needs full URL once; returned only on create/reuse of open session
            uploadUrl: existing.status === 'completed' ? null : existing.graph_upload_url,
            chunkSize: DEFAULT_CHUNK_BYTES,
            byteSize: existing.byte_size,
            status: existing.status,
            requestId,
          },
          200,
          origin,
          requestId,
        )
      }

      const access = await accessTokenForEvent(sb, eventId)
      const quota = await fetchDriveQuota(access)
      await sb
        .from('google_drive_integrations')
        .update({
          last_quota_check_at: new Date().toISOString(),
          last_quota_limit_bytes: quota.limit,
          last_quota_usage_bytes: quota.usage,
        })
        .eq('event_id', eventId)

      const gate = canCreateOriginalUpload(quota, settings, Number(body.byteSize), mediaKind)
      if (!gate.ok) {
        const status = gate.code === 'storage_full' || gate.code === 'quota_unknown' ? 507 : 403
        return json(
          { error: gate.code, message: gate.message, capacity: adminCapacityView(quota, settings), requestId },
          status,
          origin,
          requestId,
        )
      }

      const folders = await loadOrEnsureFolders(sb, eventId, access, false)
      const parentId =
        mediaKind === 'video' ? folders.originalsVideosFolderId : folders.originalsImagesFolderId
      const name = collisionResistantDriveName(meta.ext)
      const session = await createResumableUpload(access, {
        name,
        mimeType: meta.mimeType,
        parents: [parentId],
        byteSize: Number(body.byteSize),
      })

      const { data: sess, error: sessErr } = await sb
        .from('upload_sessions')
        .insert({
          event_id: eventId,
          idempotency_key: idempotencyKey,
          status: 'created',
          media_kind: mediaKind,
          original_filename_sanitized: (body.filename ?? 'file').slice(0, 180),
          content_type: meta.mimeType,
          byte_size: Number(body.byteSize),
          bytes_uploaded: 0,
          graph_upload_url: session.uploadUrl,
        })
        .select('id')
        .single()
      if (sessErr) throw sessErr

      const { data: media, error: mediaErr } = await sb
        .from('media')
        .insert({
          event_id: eventId,
          upload_session_id: sess.id,
          status: 'pending',
          media_kind: mediaKind,
          storage_provider: 'google_drive',
          size_bytes: Number(body.byteSize),
          mime_type: meta.mimeType,
          upload_status: 'created',
          moderation_status: 'pending',
          guest_name: (body.filename ?? 'file').slice(0, 180),
        })
        .select('id')
        .single()
      if (mediaErr) throw mediaErr

      return json(
        {
          reused: false,
          sessionId: sess.id,
          mediaId: media.id,
          driveFileName: name,
          parentFolderRedacted: redactId(parentId),
          uploadUrlRedacted: redactUploadUrl(session.uploadUrl),
          uploadUrl: session.uploadUrl,
          chunkSize: DEFAULT_CHUNK_BYTES,
          byteSize: Number(body.byteSize),
          capacity: adminCapacityView(quota, settings),
          requestId,
        },
        200,
        origin,
        requestId,
      )
    }

    if (route === 'gdrive-resumable-status' && req.method === 'GET') {
      const sessionId = url.searchParams.get('sessionId')
      if (!sessionId) return json({ error: 'missing_session_id', requestId }, 400, origin, requestId)
      const sb = adminClient()
      const { eventId } = await loadEventSettings(sb)
      const guest = await requireGuest(req, eventId)
      if (!guest.ok) return guest.response
      const { data: sess } = await sb
        .from('upload_sessions')
        .select('id, byte_size, graph_upload_url, status, bytes_uploaded')
        .eq('id', sessionId)
        .eq('event_id', eventId)
        .maybeSingle()
      if (!sess?.graph_upload_url) {
        return json({ error: 'session_not_found', requestId }, 404, origin, requestId)
      }
      const progress = await queryResumableOffset(sess.graph_upload_url, Number(sess.byte_size))
      await sb
        .from('upload_sessions')
        .update({
          bytes_uploaded: progress.nextOffset,
          status: progress.nextOffset >= Number(sess.byte_size) ? 'completed' : 'uploading',
          updated_at: new Date().toISOString(),
        })
        .eq('id', sess.id)
      return json(
        {
          sessionId: sess.id,
          status: progress.status,
          range: progress.range,
          nextOffset: progress.nextOffset,
          byteSize: Number(sess.byte_size),
          requestId,
        },
        200,
        origin,
        requestId,
      )
    }

    if (route === 'gdrive-complete-resumable' && req.method === 'POST') {
      const body = await req.json() as { sessionId?: string; fileId?: string }
      if (!body.sessionId) return json({ error: 'missing_session_id', requestId }, 400, origin, requestId)
      const sb = adminClient()
      const { eventId } = await loadEventSettings(sb)
      const guest = await requireGuest(req, eventId)
      if (!guest.ok) return guest.response

      const { data: sess } = await sb
        .from('upload_sessions')
        .select('id, byte_size, status, drive_item_id, graph_upload_url, content_type, media_kind')
        .eq('id', body.sessionId)
        .eq('event_id', eventId)
        .maybeSingle()
      if (!sess) return json({ error: 'session_not_found', requestId }, 404, origin, requestId)

      const { data: media } = await sb
        .from('media')
        .select('id, google_original_file_id, upload_status, size_bytes, mime_type')
        .eq('upload_session_id', sess.id)
        .maybeSingle()

      // Idempotent complete
      if (sess.status === 'completed' && (sess.drive_item_id || media?.google_original_file_id)) {
        const fileId = sess.drive_item_id ?? media?.google_original_file_id
        return json(
          {
            reused: true,
            sessionId: sess.id,
            mediaId: media?.id,
            fileIdRedacted: fileId ? redactId(fileId) : null,
            fileId,
            size: media?.size_bytes,
            mimeType: media?.mime_type,
            requestId,
          },
          200,
          origin,
          requestId,
        )
      }

      const access = await accessTokenForEvent(sb, eventId)
      let fileId = body.fileId ?? sess.drive_item_id
      if (!fileId && sess.graph_upload_url) {
        const progress = await queryResumableOffset(sess.graph_upload_url, Number(sess.byte_size))
        if (progress.nextOffset < Number(sess.byte_size)) {
          return json(
            {
              error: 'upload_incomplete',
              nextOffset: progress.nextOffset,
              byteSize: Number(sess.byte_size),
              requestId,
            },
            409,
            origin,
            requestId,
          )
        }
      }
      if (!fileId) {
        return json({ error: 'missing_file_id_after_upload', requestId }, 400, origin, requestId)
      }

      const meta = await getFileMetadata(access, fileId)
      const perms = await listFilePermissions(access, fileId)
      const privacy = assertPrivatePermissions(perms)
      const folders = await loadOrEnsureFolders(sb, eventId, access, false)
      const expectedParent =
        sess.media_kind === 'video' ? folders.originalsVideosFolderId : folders.originalsImagesFolderId
      const parentOk = (meta.parents ?? []).includes(expectedParent)

      await sb
        .from('upload_sessions')
        .update({
          status: 'completed',
          drive_item_id: fileId,
          bytes_uploaded: Number(meta.size ?? sess.byte_size),
          graph_upload_url: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sess.id)

      if (media) {
        await sb
          .from('media')
          .update({
            google_original_file_id: fileId,
            original_drive_item_id: fileId,
            size_bytes: Number(meta.size ?? sess.byte_size),
            mime_type: meta.mimeType ?? sess.content_type,
            upload_status: 'uploaded',
            updated_at: new Date().toISOString(),
          })
          .eq('id', media.id)
      }

      return json(
        {
          reused: false,
          sessionId: sess.id,
          mediaId: media?.id,
          fileIdRedacted: redactId(fileId),
          fileId,
          size: meta.size,
          mimeType: meta.mimeType,
          md5Checksum: meta.md5Checksum ?? null,
          parentOk,
          parentFolderRedacted: redactId(expectedParent),
          private: privacy.private,
          privacyReason: privacy.private ? null : privacy.reason,
          ownersRedacted: (meta.owners ?? []).map((o) =>
            o.emailAddress ? `${o.emailAddress.slice(0, 2)}…` : '…'
          ),
          requestId,
        },
        200,
        origin,
        requestId,
      )
    }

    if (route === 'gdrive-verify-file' && req.method === 'GET') {
      const fileId = url.searchParams.get('fileId')
      if (!fileId) return json({ error: 'missing_file_id', requestId }, 400, origin, requestId)
      const sb = adminClient()
      const { eventId } = await loadEventSettings(sb)
      const access = await accessTokenForEvent(sb, eventId)
      const meta = await getFileMetadata(access, fileId)
      const perms = await listFilePermissions(access, fileId)
      const privacy = assertPrivatePermissions(perms)
      const folders = await loadOrEnsureFolders(sb, eventId, access, false)
      return json(
        {
          fileIdRedacted: redactId(fileId),
          name: meta.name,
          size: meta.size,
          mimeType: meta.mimeType,
          md5Checksum: meta.md5Checksum ?? null,
          trashed: meta.trashed ?? false,
          parentsRedacted: (meta.parents ?? []).map(redactId),
          inImages: (meta.parents ?? []).includes(folders.originalsImagesFolderId),
          inVideos: (meta.parents ?? []).includes(folders.originalsVideosFolderId),
          private: privacy.private,
          permissionTypes: perms.map((p) => p.type),
          hasAnyone: perms.some((p) => p.type === 'anyone'),
          requestId,
        },
        200,
        origin,
        requestId,
      )
    }

    if (route === 'gdrive-upload-preview' && req.method === 'POST') {
      const body = await req.json() as {
        mediaId?: string
        base64?: string
        contentType?: string
        kind?: 'image' | 'poster'
      }
      if (!body.mediaId || !body.base64) {
        return json({ error: 'missing_media_or_bytes', requestId }, 400, origin, requestId)
      }
      const sb = adminClient()
      const { eventId } = await loadEventSettings(sb)
      const guest = await requireGuest(req, eventId)
      if (!guest.ok) return guest.response

      const { data: media } = await sb
        .from('media')
        .select('id, preview_object_key, video_poster_object_key')
        .eq('id', body.mediaId)
        .eq('event_id', eventId)
        .maybeSingle()
      if (!media) return json({ error: 'media_not_found', requestId }, 404, origin, requestId)

      const bin = atob(body.base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const kind = body.kind === 'poster' ? 'poster' : 'image'
      const ct = body.contentType ?? (kind === 'poster' ? 'image/jpeg' : 'image/webp')
      const path = previewObjectPath(eventId, body.mediaId, kind)

      const { error: upErr } = await sb.storage.from(PREVIEW_BUCKET).upload(path, bytes, {
        contentType: ct,
        upsert: true,
      })
      if (upErr) throw upErr

      const patch =
        kind === 'poster'
          ? { video_poster_object_key: path, updated_at: new Date().toISOString() }
          : { preview_object_key: path, updated_at: new Date().toISOString() }
      await sb.from('media').update(patch).eq('id', body.mediaId)

      return json(
        {
          mediaId: body.mediaId,
          bucket: PREVIEW_BUCKET,
          objectPath: path,
          size: bytes.byteLength,
          contentType: ct,
          requestId,
        },
        200,
        origin,
        requestId,
      )
    }

    if (route === 'gdrive-preview-signed' && req.method === 'GET') {
      const mediaId = url.searchParams.get('mediaId')
      const kind = url.searchParams.get('kind') === 'poster' ? 'poster' : 'image'
      if (!mediaId) return json({ error: 'missing_media_id', requestId }, 400, origin, requestId)
      const sb = adminClient()
      const { eventId } = await loadEventSettings(sb)
      const guest = await requireGuest(req, eventId)
      if (!guest.ok) return guest.response
      const { data: media } = await sb
        .from('media')
        .select('preview_object_key, video_poster_object_key')
        .eq('id', mediaId)
        .eq('event_id', eventId)
        .maybeSingle()
      const path = kind === 'poster' ? media?.video_poster_object_key : media?.preview_object_key
      if (!path) return json({ error: 'preview_missing', requestId }, 404, origin, requestId)
      const { data, error } = await sb.storage.from(PREVIEW_BUCKET).createSignedUrl(path, SIGNED_TTL_SEC)
      if (error || !data?.signedUrl) throw error ?? new Error('signed_url_failed')
      // Confirm DB does not store signed URL — only path columns exist
      return json(
        {
          mediaId,
          bucket: PREVIEW_BUCKET,
          objectPath: path,
          expiresInSec: SIGNED_TTL_SEC,
          signedUrlRedacted: data.signedUrl.split('?')[0] + '?…',
          signedUrl: data.signedUrl,
          requestId,
        },
        200,
        origin,
        requestId,
      )
    }

    if (route === 'gdrive-preview-unsigned-probe' && req.method === 'GET') {
      const path = url.searchParams.get('path')
      if (!path) return json({ error: 'missing_path', requestId }, 400, origin, requestId)
      const base = Deno.env.get('SUPABASE_URL')
      const anon = Deno.env.get('SUPABASE_ANON_KEY')
      if (!base || !anon) throw new Error('anon_key_missing')
      const probe = await fetch(
        `${base}/storage/v1/object/public/${PREVIEW_BUCKET}/${path}`,
        { headers: { apikey: anon } },
      )
      const direct = await fetch(
        `${base}/storage/v1/object/authenticated/${PREVIEW_BUCKET}/${path}`,
        { headers: { apikey: anon, Authorization: `Bearer ${anon}` } },
      )
      return json(
        {
          publicStatus: probe.status,
          authenticatedAnonStatus: direct.status,
          rejected: probe.status >= 400 && direct.status >= 400,
          requestId,
        },
        200,
        origin,
        requestId,
      )
    }

    // Legacy small multipart spike (kept; not wedding-scale evidence)
    if (route === 'gdrive-spike-upload' && req.method === 'POST') {
      const contentType = req.headers.get('content-type') ?? ''
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
        bytes = new Uint8Array(await req.arrayBuffer())
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

      const folders = await loadOrEnsureFolders(sb, eventId, access, false)
      const name = collisionResistantDriveName(
        mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg',
      )
      const file = await uploadFileMultipart(access, {
        name,
        mimeType: mime,
        bytes,
        parents: [folders.originalsImagesFolderId],
      })

      const { data: media, error } = await sb
        .from('media')
        .insert({
          event_id: eventId,
          status: 'pending',
          media_kind: 'image',
          storage_provider: 'google_drive',
          google_original_file_id: file.id,
          original_drive_item_id: file.id,
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
          fileIdRedacted: redactId(file.id),
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
      const body = await req.json() as { fileId?: string; mediaId?: string; previewPath?: string }
      if (!body.fileId && !body.mediaId) {
        return json({ error: 'missing_file_or_media', requestId }, 400, origin, requestId)
      }
      const sb = adminClient()
      const { eventId } = await loadEventSettings(sb)
      const access = body.fileId ? await accessTokenForEvent(sb, eventId) : null
      let deleted = true
      let cleanupVerified = true
      if (body.fileId && access) {
        const del = await deleteDriveFile(access, body.fileId)
        deleted = del.ok
        try {
          await getFileMetadata(access, body.fileId)
          cleanupVerified = false
        } catch {
          cleanupVerified = true
        }
      }
      if (body.mediaId) {
        const { data: media } = await sb
          .from('media')
          .select('preview_object_key, video_poster_object_key')
          .eq('id', body.mediaId)
          .maybeSingle()
        const paths = [media?.preview_object_key, media?.video_poster_object_key, body.previewPath]
          .filter(Boolean) as string[]
        if (paths.length) await sb.storage.from(PREVIEW_BUCKET).remove(paths)
        await sb
          .from('media')
          .update({ upload_status: 'deleted', updated_at: new Date().toISOString() })
          .eq('id', body.mediaId)
      }
      return json({ deleted, cleanupVerified, requestId }, 200, origin, requestId)
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
        : message.includes('GUEST_TOKEN_SIGNING_SECRET')
        ? 503
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
