/**
 * MOV/MP4 validation + ISO BMFF ftyp probe.
 * Run: node supabase/functions/_shared/upload_validation_mov.node-test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

function readU32BE(bytes, offset) {
  return (
    ((bytes[offset] << 24) >>> 0) +
    ((bytes[offset + 1] << 16) >>> 0) +
    ((bytes[offset + 2] << 8) >>> 0) +
    (bytes[offset + 3] >>> 0)
  )
}
function readFourCC(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}
const ACCEPTABLE = new Set(['qt  ', 'isom', 'mp41', 'mp42', 'avc1', 'iso2'])
function isIsoBmffContainer(bytes) {
  if (bytes.length < 12) return false
  let offset = 0
  const limit = Math.min(bytes.length, 65536)
  while (offset + 8 <= limit) {
    const size = readU32BE(bytes, offset)
    const type = readFourCC(bytes, offset + 4)
    if (type === 'ftyp') {
      const major = readFourCC(bytes, offset + 8)
      if (ACCEPTABLE.has(major)) return true
      for (let i = offset + 16; i + 4 <= Math.min(offset + size, bytes.length); i += 4) {
        if (ACCEPTABLE.has(readFourCC(bytes, i))) return true
      }
      return false
    }
    if (size < 8) break
    offset += size
  }
  return false
}

function buildFtyp(major, compat = []) {
  const brands = [major, ...compat]
  const size = 8 + 4 + 4 + brands.length * 4
  const buf = Buffer.alloc(size)
  buf.writeUInt32BE(size, 0)
  buf.write('ftyp', 4)
  buf.write(major, 8)
  buf.writeUInt32BE(0, 12)
  let o = 16
  for (const b of brands) {
    buf.write(b.padEnd(4, ' ').slice(0, 4), o)
    o += 4
  }
  return new Uint8Array(buf)
}

function resolveVideoMimeType(ext, browserMime) {
  const mime = (browserMime || '').toLowerCase().trim()
  if (ext === 'mov') {
    if (mime === 'video/quicktime' || mime === 'video/mp4') return mime
    return 'video/quicktime'
  }
  if (ext === 'mp4') return 'video/mp4'
  return mime || 'application/octet-stream'
}

function validateVideo(input) {
  const ext = (input.filename.split('.').pop() || '').toLowerCase()
  const allowed =
    ext === 'mp4' ? new Set(['video/mp4']) : ext === 'mov' ? new Set(['video/quicktime', 'video/mp4', '']) : null
  if (!allowed) return { ok: false, code: 'disallowed_extension' }
  const mime = (input.mimeType || '').toLowerCase().trim()
  if (!allowed.has(mime)) return { ok: false, code: 'unsupported_mime' }
  if (input.byteSize > input.maxVideoBytes) {
    return { ok: false, code: 'exceeds_configured_max', message: 'Videos must be 2 GB or smaller.' }
  }
  if (
    input.maxVideoDurationSeconds > 0 &&
    input.durationSeconds != null &&
    input.durationSeconds > input.maxVideoDurationSeconds
  ) {
    return { ok: false, code: 'exceeds_duration_max' }
  }
  if (!input.headerBytes || !isIsoBmffContainer(input.headerBytes)) {
    return { ok: false, code: 'invalid_video_container' }
  }
  return { ok: true, mimeType: resolveVideoMimeType(ext, mime), ext }
}

const qt = buildFtyp('qt  ')
const mp4 = buildFtyp('isom', ['mp41'])

assert.equal(isIsoBmffContainer(qt), true)
assert.equal(isIsoBmffContainer(mp4), true)
assert.equal(isIsoBmffContainer(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), false)
assert.equal(isIsoBmffContainer(new TextEncoder().encode('hello world!!!!')), false)

// Real MOV: quicktime MIME
assert.equal(
  validateVideo({
    filename: 'IMG_1234.mov',
    mimeType: 'video/quicktime',
    byteSize: 1_000_000,
    maxVideoBytes: 100_000_000,
    maxVideoDurationSeconds: 60,
    durationSeconds: 12,
    headerBytes: qt,
  }).ok,
  true,
)
assert.equal(
  validateVideo({
    filename: 'IMG_1234.mov',
    mimeType: 'video/quicktime',
    byteSize: 1_000_000,
    maxVideoBytes: 100_000_000,
    maxVideoDurationSeconds: 60,
    durationSeconds: 12,
    headerBytes: qt,
  }).mimeType,
  'video/quicktime',
)

// iPhone/browser reports video/mp4 for .mov
assert.equal(
  validateVideo({
    filename: 'IMG_1234.mov',
    mimeType: 'video/mp4',
    byteSize: 1_000_000,
    maxVideoBytes: 100_000_000,
    maxVideoDurationSeconds: 60,
    durationSeconds: 8,
    headerBytes: qt,
  }).mimeType,
  'video/mp4',
)

// Normal mp4
assert.equal(
  validateVideo({
    filename: 'clip.mp4',
    mimeType: 'video/mp4',
    byteSize: 500_000,
    maxVideoBytes: 100_000_000,
    maxVideoDurationSeconds: 60,
    durationSeconds: 5,
    headerBytes: mp4,
  }).ok,
  true,
)

// Renamed non-video .mov
assert.equal(
  validateVideo({
    filename: 'fake.mov',
    mimeType: 'video/quicktime',
    byteSize: 100,
    maxVideoBytes: 100_000_000,
    maxVideoDurationSeconds: 60,
    durationSeconds: 1,
    headerBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]),
  }).code,
  'invalid_video_container',
)

assert.equal(
  validateVideo({
    filename: 'big.mov',
    mimeType: 'video/quicktime',
    byteSize: 2_000_000_001,
    maxVideoBytes: 2_000_000_000,
    maxVideoDurationSeconds: 60,
    durationSeconds: 10,
    headerBytes: qt,
  }).code,
  'exceeds_configured_max',
)

// Exactly 2 GB ok; just under ok
assert.equal(
  validateVideo({
    filename: 'edge.mov',
    mimeType: 'video/quicktime',
    byteSize: 2_000_000_000,
    maxVideoBytes: 2_000_000_000,
    maxVideoDurationSeconds: 60,
    durationSeconds: 10,
    headerBytes: qt,
  }).ok,
  true,
)
assert.equal(
  validateVideo({
    filename: 'edge.mp4',
    mimeType: 'video/mp4',
    byteSize: 1_999_999_999,
    maxVideoBytes: 2_000_000_000,
    maxVideoDurationSeconds: 60,
    durationSeconds: 10,
    headerBytes: mp4,
  }).ok,
  true,
)

// Too long
assert.equal(
  validateVideo({
    filename: 'long.mov',
    mimeType: 'video/quicktime',
    byteSize: 1_000_000,
    maxVideoBytes: 2_000_000_000,
    maxVideoDurationSeconds: 60,
    durationSeconds: 120,
    headerBytes: qt,
  }).code,
  'exceeds_duration_max',
)

const src = readFileSync(join(dir, 'upload_validation.ts'), 'utf8')
assert.match(src, /video\/quicktime/)
assert.match(src, /invalid_video_container/)
assert.match(src, /VIDEO_TOO_LARGE_MESSAGE/)
assert.match(src, /This video is too long/)
assert.match(src, /MAX_VIDEO_BYTES/)

const limits = readFileSync(join(dir, 'upload_limits.ts'), 'utf8')
assert.match(limits, /MAX_VIDEO_BYTES = 2_000_000_000/)

const fe = readFileSync(join(dir, '../../../frontend/src/lib/mediaValidate.ts'), 'utf8')
assert.match(fe, /ext === 'mov'/)
assert.match(fe, /video\/quicktime/)
assert.match(fe, /MAX_VIDEO_BYTES/)
assert.match(fe, /VIDEO_HEADER_BYTES/)

const upload = readFileSync(join(dir, '../../../frontend/src/pages/UploadPage.tsx'), 'utf8')
assert.match(upload, /\.mov/)
assert.match(upload, /SAFARI_POSTER_FAIL_MESSAGE/)
assert.match(upload, /headerBase64/)
assert.match(upload, /Preparing from Photos or iCloud/)
assert.match(upload, /status: 'selected'/)
assert.match(upload, /retryModeFor/)
assert.match(upload, /isIphoneSafari/)

const previewSrc = readFileSync(join(dir, '../../../frontend/src/lib/preview.ts'), 'utf8')
assert.match(previewSrc, /The video was saved, but Safari could not generate a preview/)
assert.match(previewSrc, /loadedmetadata/)
assert.match(previewSrc, /seeked/)

console.log('upload_validation_mov.node-test: ok')
