import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json, newRequestId, safeErrorMessage } from '../_shared/http.ts'
import {
  buildObjectKey,
  deleteObject,
  GET_EXPIRY_SECONDS,
  headObject,
  presignGet,
  presignPut,
  PUT_EXPIRY_SECONDS,
  r2Config,
  r2SecretPresence,
  sanitizeFilename,
} from '../_shared/r2.ts'

/**
 * Wedding API — R2 spike routes.
 * Full guest/admin product waits until docs/r2-upload-spike.md evidence passes.
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

function redactKey(key: string): string {
  const parts = key.split('/')
  const file = parts.pop() ?? ''
  const [id, ext] = file.split('.')
  const short = id.slice(0, 8)
  return `${parts.join('/')}/${short}…${ext ? '.' + ext : ''}`
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
        { ok: true, service: 'wedding-api', storage: 'r2', requestId },
        200,
        origin,
        requestId,
      )
    }

    if (route === 'r2-health' && req.method === 'GET') {
      const presence = r2SecretPresence()
      const ready = Object.values(presence).every(Boolean)
      let bucket: string | null = null
      try {
        bucket = r2Config().bucket
      } catch {
        bucket = null
      }
      return json(
        { ready, secrets: presence, bucket, putExpirySeconds: PUT_EXPIRY_SECONDS, requestId },
        ready ? 200 : 503,
        origin,
        requestId,
      )
    }

    if (route === 'r2-spike-create' && req.method === 'POST') {
      const body = await req.json() as {
        contentType?: string
        byteSize?: number
        originalFilename?: string
        idempotencyKey?: string
      }
      const contentType = body.contentType ?? ''
      const byteSize = Number(body.byteSize ?? 0)
      const idempotencyKey = body.idempotencyKey || crypto.randomUUID()

      if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
        return json({ error: 'invalid_content_type', requestId }, 400, origin, requestId)
      }
      if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > MAX_SPIKE_BYTES) {
        return json({ error: 'invalid_size', maxBytes: MAX_SPIKE_BYTES, requestId }, 400, origin, requestId)
      }

      const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
      const objectKey = buildObjectKey('original-image', ext)
      const { url: uploadUrl, expiresIn } = await presignPut(objectKey, contentType)

      const sb = adminClient()
      const { data: event } = await sb.from('events').select('id').eq('slug', 'muhammad-basmala').maybeSingle()

      let mediaId: string | null = null
      if (event?.id) {
        const { data: media, error } = await sb
          .from('media')
          .insert({
            event_id: event.id,
            status: 'pending',
            media_kind: 'image',
            storage_provider: 'r2',
            original_object_key: objectKey,
            size_bytes: byteSize,
            mime_type: contentType,
            upload_status: 'processing',
            moderation_status: 'pending',
            guest_name: sanitizeFilename(body.originalFilename ?? 'spike.jpg'),
          })
          .select('id')
          .single()
        if (error) throw error
        mediaId = media.id
      }

      return json(
        {
          mediaId,
          objectKeyRedacted: redactKey(objectKey),
          objectKey, // needed by browser complete/delete in spike; product will keep keys server-side
          uploadUrl,
          expiresIn,
          requiredHeaders: { 'Content-Type': contentType },
          idempotencyKey,
          requestId,
        },
        200,
        origin,
        requestId,
      )
    }

    if (route === 'r2-spike-complete' && req.method === 'POST') {
      const body = await req.json() as {
        objectKey?: string
        mediaId?: string
        expectedBytes?: number
        expectedContentType?: string
        etag?: string
      }
      if (!body.objectKey) {
        return json({ error: 'missing_object_key', requestId }, 400, origin, requestId)
      }

      const head = await headObject(body.objectKey)
      if (!head.ok) {
        return json({ error: 'object_missing', head, requestId }, 400, origin, requestId)
      }
      if (
        body.expectedBytes != null &&
        head.contentLength != null &&
        head.contentLength !== body.expectedBytes
      ) {
        return json(
          { error: 'size_mismatch', expected: body.expectedBytes, actual: head.contentLength, requestId },
          400,
          origin,
          requestId,
        )
      }
      if (
        body.expectedContentType &&
        head.contentType &&
        !head.contentType.toLowerCase().startsWith(body.expectedContentType.toLowerCase())
      ) {
        return json(
          {
            error: 'type_mismatch',
            expected: body.expectedContentType,
            actual: head.contentType,
            requestId,
          },
          400,
          origin,
          requestId,
        )
      }

      if (body.mediaId) {
        const sb = adminClient()
        await sb
          .from('media')
          .update({
            upload_status: 'uploaded',
            moderation_status: 'pending',
            original_etag: head.etag ?? body.etag ?? null,
            size_bytes: head.contentLength,
            mime_type: head.contentType,
            updated_at: new Date().toISOString(),
          })
          .eq('id', body.mediaId)
      }

      return json(
        {
          verified: true,
          contentLength: head.contentLength,
          contentType: head.contentType,
          etagRedacted: head.etag ? `${head.etag.slice(0, 6)}…` : null,
          requestId,
        },
        200,
        origin,
        requestId,
      )
    }

    if (route === 'r2-spike-display' && req.method === 'POST') {
      const body = await req.json() as { objectKey?: string }
      if (!body.objectKey) {
        return json({ error: 'missing_object_key', requestId }, 400, origin, requestId)
      }
      const head = await headObject(body.objectKey)
      if (!head.ok) {
        return json({ error: 'object_missing', requestId }, 404, origin, requestId)
      }
      const { url: displayUrl, expiresIn } = await presignGet(body.objectKey, GET_EXPIRY_SECONDS)
      return json({ displayUrl, expiresIn, requestId }, 200, origin, requestId)
    }

    if (route === 'r2-spike-delete' && req.method === 'POST') {
      const body = await req.json() as { objectKey?: string; mediaId?: string }
      if (!body.objectKey) {
        return json({ error: 'missing_object_key', requestId }, 400, origin, requestId)
      }
      const del = await deleteObject(body.objectKey)
      const after = await headObject(body.objectKey)
      if (body.mediaId) {
        const sb = adminClient()
        await sb
          .from('media')
          .update({ upload_status: 'deleted', updated_at: new Date().toISOString() })
          .eq('id', body.mediaId)
      }
      return json(
        {
          deleted: del.ok,
          deleteStatus: del.status,
          cleanupVerified: !after.ok,
          requestId,
        },
        200,
        origin,
        requestId,
      )
    }

    // Obsolete Microsoft routes — explicit 410
    if (
      route.startsWith('microsoft-') ||
      route === 'create-onedrive-upload-session'
    ) {
      return json(
        {
          error: 'gone',
          message: 'OneDrive integration superseded by Cloudflare R2. See docs/r2-upload-spike.md',
          requestId,
        },
        410,
        origin,
        requestId,
      )
    }

    return json({ error: 'not_found', route, requestId }, 404, origin, requestId)
  } catch (err) {
    return json(
      { error: 'internal', message: safeErrorMessage(err), requestId },
      500,
      origin,
      requestId,
    )
  }
})
