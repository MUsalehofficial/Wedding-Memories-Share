/**
 * Unit self-checks for Drive hardening helpers (Node, no Deno).
 * Run: node supabase/functions/_shared/hardening.node-test.mjs
 */
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'

const CHUNK_ALIGNMENT = 256 * 1024
const DEFAULT_CHUNK_BYTES = 1024 * 1024

function isAlignedChunk(byteCount) {
  return byteCount > 0 && byteCount % CHUNK_ALIGNMENT === 0
}

function validateChunkLength(chunkBytes, isFinal, remainingBytes) {
  if (!Number.isFinite(chunkBytes) || chunkBytes <= 0) return { ok: false, code: 'invalid_chunk_size' }
  if (isFinal) return chunkBytes === remainingBytes ? { ok: true } : { ok: false, code: 'final_chunk_mismatch' }
  if (chunkBytes > remainingBytes) return { ok: false, code: 'chunk_exceeds_remaining' }
  if (!isAlignedChunk(chunkBytes)) return { ok: false, code: 'chunk_not_256kib_aligned' }
  return { ok: true }
}

function nextOffsetFromRange(rangeHeader) {
  if (!rangeHeader) return 0
  const m = /bytes=(\d+)-(\d+)/i.exec(rangeHeader.trim())
  if (!m) return null
  return Number(m[2]) + 1
}

function extensionOf(filename) {
  const base = filename.split(/[/\\]/).pop() ?? ''
  const i = base.lastIndexOf('.')
  return i < 0 ? '' : base.slice(i + 1).toLowerCase()
}

const IMAGE_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const VIDEO_EXT = { mp4: 'video/mp4' }

function validateUploadMeta(input) {
  if (input.parentFolderId != null && String(input.parentFolderId).length > 0) {
    return { ok: false, code: 'parent_folder_forbidden' }
  }
  if (input.parents != null) return { ok: false, code: 'parent_folder_forbidden' }
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) return { ok: false, code: 'invalid_size' }
  const ext = extensionOf(input.filename)
  const allowedMap = input.mediaKind === 'video' ? VIDEO_EXT : IMAGE_EXT
  const expectedMime = allowedMap[ext]
  if (!expectedMime) return { ok: false, code: 'disallowed_extension' }
  const mime = (input.mimeType || '').toLowerCase().trim()
  if (!new Set(Object.values(allowedMap)).has(mime)) return { ok: false, code: 'unsupported_mime' }
  if (mime !== expectedMime) return { ok: false, code: 'mime_extension_mismatch' }
  const max = input.mediaKind === 'video' ? input.maxVideoBytes : input.maxImageBytes
  if (input.byteSize > max) return { ok: false, code: 'exceeds_configured_max' }
  return { ok: true, ext: ext === 'jpeg' ? 'jpg' : ext, mimeType: mime }
}

function previewObjectPath(eventId, mediaId, kind) {
  const suffix = kind === 'poster' ? 'poster.jpg' : 'preview.webp'
  return `${eventId}/${mediaId}/x_${suffix}`
}

function availableBytes(quota) {
  if (quota.limit == null) return null
  return Math.max(0, quota.limit - quota.usage)
}

function canCreateOriginalUpload(quota, settings, fileBytes, mediaKind) {
  if (settings.uploadsEnabled === false) return { ok: false, code: 'uploads_disabled' }
  if (mediaKind === 'video' && !settings.videoUploadsEnabled) return { ok: false, code: 'video_uploads_disabled' }
  if (!Number.isFinite(fileBytes) || fileBytes <= 0) return { ok: false, code: 'invalid_size' }
  const available = availableBytes(quota)
  if (available == null) return { ok: false, code: 'quota_unknown' }
  if (fileBytes + settings.safetyReserveBytes > available) return { ok: false, code: 'storage_full' }
  return { ok: true }
}

function capacityLevel(quota, settings) {
  const available = availableBytes(quota)
  if (quota.limit == null || available == null) return 'unknown'
  if (available <= 0) return 'full'
  const ratio = available / quota.limit
  if (ratio < settings.criticalRatio) return 'critical'
  if (ratio < settings.warnRatio) return 'warn'
  return 'ok'
}

function mintGuestToken(signingKey, eventId, ttlSeconds = 3600) {
  const payload = Buffer.from(JSON.stringify({ eventId, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString(
    'base64url',
  )
  const sig = createHmac('sha256', signingKey).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function verifyGuestToken(signingKey, token) {
  if (!token?.includes('.')) return { ok: false, code: 'guest_token_missing' }
  const [body, sig] = token.split('.')
  const expected = createHmac('sha256', signingKey).update(body).digest('base64url')
  if (sig !== expected) return { ok: false, code: 'guest_token_invalid' }
  const json = JSON.parse(Buffer.from(body, 'base64url').toString())
  if (json.exp < Math.floor(Date.now() / 1000)) return { ok: false, code: 'guest_token_expired' }
  return { ok: true, eventId: json.eventId }
}

// --- assertions ---
assert.equal(DEFAULT_CHUNK_BYTES % CHUNK_ALIGNMENT, 0)
assert.equal(isAlignedChunk(DEFAULT_CHUNK_BYTES), true)
assert.equal(isAlignedChunk(DEFAULT_CHUNK_BYTES - 1), false)
assert.equal(validateChunkLength(DEFAULT_CHUNK_BYTES, false, 5_000_000).ok, true)
assert.equal(validateChunkLength(100, false, 5_000_000).code, 'chunk_not_256kib_aligned')
assert.equal(validateChunkLength(500, true, 500).ok, true)
assert.equal(nextOffsetFromRange('bytes=0-1048575'), 1048576)
assert.equal(nextOffsetFromRange(null), 0)

assert.equal(
  validateUploadMeta({
    mimeType: 'image/jpeg',
    filename: 'a.jpg',
    byteSize: 100,
    mediaKind: 'image',
    maxImageBytes: 1e7,
    maxVideoBytes: 1e8,
  }).ok,
  true,
)
assert.equal(
  validateUploadMeta({
    mimeType: 'application/pdf',
    filename: 'a.pdf',
    byteSize: 100,
    mediaKind: 'image',
    maxImageBytes: 1e7,
    maxVideoBytes: 1e8,
  }).code,
  'disallowed_extension',
)
assert.equal(
  validateUploadMeta({
    mimeType: 'image/png',
    filename: 'a.jpg',
    byteSize: 100,
    mediaKind: 'image',
    maxImageBytes: 1e7,
    maxVideoBytes: 1e8,
  }).code,
  'mime_extension_mismatch',
)
assert.equal(
  validateUploadMeta({
    mimeType: 'image/jpeg',
    filename: 'a.jpg',
    byteSize: 0,
    mediaKind: 'image',
    maxImageBytes: 1e7,
    maxVideoBytes: 1e8,
  }).code,
  'invalid_size',
)
assert.equal(
  validateUploadMeta({
    mimeType: 'image/jpeg',
    filename: 'a.jpg',
    byteSize: 9e9,
    mediaKind: 'image',
    maxImageBytes: 1e7,
    maxVideoBytes: 1e8,
  }).code,
  'exceeds_configured_max',
)
assert.equal(
  validateUploadMeta({
    mimeType: 'image/jpeg',
    filename: 'a.jpg',
    byteSize: 100,
    mediaKind: 'image',
    maxImageBytes: 1e7,
    maxVideoBytes: 1e8,
    parentFolderId: 'x',
  }).code,
  'parent_folder_forbidden',
)

const eventId = randomUUID()
const mediaId = randomUUID()
const path = previewObjectPath(eventId, mediaId, 'image')
assert.match(path, new RegExp(`^${eventId}/${mediaId}/`))
assert.ok(!path.includes('http'))

const quota = { limit: 10_000, usage: 9_200, usageInDrive: 8_000, usageInDriveTrash: 0, maxUploadSize: null }
assert.equal(availableBytes(quota), 800)
assert.equal(capacityLevel(quota, { warnRatio: 0.2, criticalRatio: 0.1 }), 'critical')
assert.equal(
  canCreateOriginalUpload(quota, { safetyReserveBytes: 100, videoUploadsEnabled: true, uploadsEnabled: true }, 750, 'image')
    .code,
  'storage_full',
)
assert.equal(
  canCreateOriginalUpload(quota, { safetyReserveBytes: 0, videoUploadsEnabled: false, uploadsEnabled: true }, 100, 'video')
    .code,
  'video_uploads_disabled',
)
assert.equal(
  canCreateOriginalUpload(quota, { safetyReserveBytes: 0, videoUploadsEnabled: true, uploadsEnabled: false }, 100, 'image')
    .code,
  'uploads_disabled',
)

const signingKey = 'unit-test-signing-key'
const tok = mintGuestToken(signingKey, eventId)
assert.equal(verifyGuestToken(signingKey, tok).ok, true)
assert.equal(verifyGuestToken(signingKey, 'nope').ok, false)
assert.equal(verifyGuestToken(signingKey, null).code, 'guest_token_missing')

const sessions = new Map()
function createSession(key) {
  if (sessions.has(key)) return { reused: true, id: sessions.get(key) }
  const id = randomUUID()
  sessions.set(key, id)
  return { reused: false, id }
}
const a = createSession('k1')
const b = createSession('k1')
assert.equal(a.reused, false)
assert.equal(b.reused, true)
assert.equal(a.id, b.id)

console.log('hardening.node-test.mjs: ok')
