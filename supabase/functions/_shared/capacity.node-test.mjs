import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

const MAX_VIDEO_BYTES = 2_000_000_000
const DEFAULT_SAFETY_RESERVE_BYTES = 100 * 1024 * 1024
const VIDEO_TOO_LARGE_MESSAGE = 'Videos must be 2 GB or smaller.'
const VIDEO_STORAGE_FULL_MESSAGE = 'There is not enough storage available for this video.'

function availableBytes(quota) {
  if (quota.limit == null) return null
  return Math.max(0, quota.limit - quota.usage)
}

function effectiveMaxVideoBytes(quota, safetyReserveBytes = DEFAULT_SAFETY_RESERVE_BYTES) {
  const available = availableBytes(quota)
  if (available == null) return null
  const afterReserve = Math.max(0, available - safetyReserveBytes)
  const driveCap = quota.maxUploadSize != null ? quota.maxUploadSize : Number.POSITIVE_INFINITY
  return Math.min(MAX_VIDEO_BYTES, driveCap, afterReserve)
}

function canCreateOriginalUpload(quota, settings, fileBytes, mediaKind) {
  if (settings.uploadsEnabled === false) return { ok: false, code: 'uploads_disabled' }
  if (mediaKind === 'video' && !settings.videoUploadsEnabled) {
    return { ok: false, code: 'video_uploads_disabled' }
  }
  if (!Number.isFinite(fileBytes) || fileBytes <= 0) return { ok: false, code: 'invalid_size' }
  if (mediaKind === 'video' && fileBytes > MAX_VIDEO_BYTES) {
    return { ok: false, code: 'exceeds_configured_max', message: VIDEO_TOO_LARGE_MESSAGE }
  }
  if (quota.maxUploadSize != null && fileBytes > quota.maxUploadSize) {
    return { ok: false, code: 'exceeds_max_upload_size', message: VIDEO_TOO_LARGE_MESSAGE }
  }
  const available = availableBytes(quota)
  if (available == null) return { ok: false, code: 'quota_unknown' }
  const reserve = settings.safetyReserveBytes ?? DEFAULT_SAFETY_RESERVE_BYTES
  if (fileBytes + reserve > available) {
    return {
      ok: false,
      code: 'storage_full',
      message: mediaKind === 'video' ? VIDEO_STORAGE_FULL_MESSAGE : 'storage full',
    }
  }
  return { ok: true }
}

function validateVideoSize(byteSize, maxVideoBytes = MAX_VIDEO_BYTES) {
  const cap = Math.min(MAX_VIDEO_BYTES, maxVideoBytes)
  if (byteSize > cap) return { ok: false, code: 'exceeds_configured_max', message: VIDEO_TOO_LARGE_MESSAGE }
  return { ok: true }
}

// --- product ceiling ---
assert.equal(MAX_VIDEO_BYTES, 2_000_000_000)
assert.equal(validateVideoSize(MAX_VIDEO_BYTES - 1).ok, true)
assert.equal(validateVideoSize(MAX_VIDEO_BYTES).ok, true)
assert.equal(validateVideoSize(MAX_VIDEO_BYTES + 1).code, 'exceeds_configured_max')
assert.equal(validateVideoSize(MAX_VIDEO_BYTES + 1).message, VIDEO_TOO_LARGE_MESSAGE)

// MOV / MP4 just below 2 GB (metadata only)
assert.equal(validateVideoSize(1_999_999_999).ok, true)
assert.equal(validateVideoSize(1_999_999_999).ok, true)

// Exactly 2 GB accepted when capacity permits
const roomy = { limit: 20 * 1024 ** 3, usage: 0, maxUploadSize: 5 * 1024 ** 3 }
assert.equal(canCreateOriginalUpload(roomy, { safetyReserveBytes: DEFAULT_SAFETY_RESERVE_BYTES, videoUploadsEnabled: true, uploadsEnabled: true }, MAX_VIDEO_BYTES, 'video').ok, true)

// 2_000_000_001 rejected before capacity
assert.equal(
  canCreateOriginalUpload(roomy, { safetyReserveBytes: DEFAULT_SAFETY_RESERVE_BYTES, videoUploadsEnabled: true, uploadsEnabled: true }, MAX_VIDEO_BYTES + 1, 'video').code,
  'exceeds_configured_max',
)

// Below 2 GB but above available Drive capacity → 507-class storage_full
const tight = { limit: 500_000_000, usage: 0, maxUploadSize: 5 * 1024 ** 3 }
const below2gb = 450_000_000 // + 100 MiB reserve exceeds 500 MiB available
const gateTight = canCreateOriginalUpload(
  tight,
  { safetyReserveBytes: DEFAULT_SAFETY_RESERVE_BYTES, videoUploadsEnabled: true, uploadsEnabled: true },
  below2gb,
  'video',
)
assert.equal(gateTight.code, 'storage_full')
assert.equal(gateTight.message, VIDEO_STORAGE_FULL_MESSAGE)

// Safety reserve enforced: available 150MB, file 60MB, reserve 100MB → fail
const reserveCase = { limit: 150_000_000, usage: 0, maxUploadSize: null }
assert.equal(
  canCreateOriginalUpload(
    reserveCase,
    { safetyReserveBytes: DEFAULT_SAFETY_RESERVE_BYTES, videoUploadsEnabled: true, uploadsEnabled: true },
    60_000_000,
    'video',
  ).code,
  'storage_full',
)
assert.equal(
  canCreateOriginalUpload(
    reserveCase,
    { safetyReserveBytes: DEFAULT_SAFETY_RESERVE_BYTES, videoUploadsEnabled: true, uploadsEnabled: true },
    40_000_000,
    'video',
  ).ok,
  true,
)

// Increased Google storage detected without code change (limit rises)
const smallPlan = { limit: 5 * 1024 ** 3, usage: 4.5 * 1024 ** 3, maxUploadSize: 5 * 1024 ** 3 }
const biggerPlan = { limit: 100 * 1024 ** 3, usage: 4.5 * 1024 ** 3, maxUploadSize: 5 * 1024 ** 3 }
const need = 1_500_000_000
assert.equal(
  canCreateOriginalUpload(
    smallPlan,
    { safetyReserveBytes: DEFAULT_SAFETY_RESERVE_BYTES, videoUploadsEnabled: true, uploadsEnabled: true },
    need,
    'video',
  ).code,
  'storage_full',
)
assert.equal(
  canCreateOriginalUpload(
    biggerPlan,
    { safetyReserveBytes: DEFAULT_SAFETY_RESERVE_BYTES, videoUploadsEnabled: true, uploadsEnabled: true },
    need,
    'video',
  ).ok,
  true,
)

// effective max tracks Drive available
assert.equal(effectiveMaxVideoBytes({ limit: 10 * 1024 ** 3, usage: 0, maxUploadSize: null }), MAX_VIDEO_BYTES)
assert.ok(effectiveMaxVideoBytes({ limit: 500_000_000, usage: 0, maxUploadSize: null }) < MAX_VIDEO_BYTES)
assert.equal(
  effectiveMaxVideoBytes({ limit: 500_000_000, usage: 0, maxUploadSize: null }),
  500_000_000 - DEFAULT_SAFETY_RESERVE_BYTES,
)

// Source files export the constant once
const limitsSrc = readFileSync(join(dir, 'upload_limits.ts'), 'utf8')
assert.match(limitsSrc, /MAX_VIDEO_BYTES = 2_000_000_000/)
assert.match(limitsSrc, /Videos must be 2 GB or smaller/)
assert.match(limitsSrc, /There is not enough storage available for this video/)

const capSrc = readFileSync(join(dir, 'capacity.ts'), 'utf8')
assert.match(capSrc, /effectiveMaxVideoBytes/)
assert.match(capSrc, /MAX_VIDEO_BYTES/)
assert.doesNotMatch(capSrc, /15 \* 1024 \*\* 3/)
assert.doesNotMatch(capSrc, /15 \* 1024\*\*3/)

console.log('capacity 2gb self-check: ok')
