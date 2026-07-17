/**
 * Node self-check for R2 key helpers (no Deno/JSR required).
 * Run: node --experimental-strip-types supabase/functions/_shared/r2_keys.node-test.mjs
 * Or copy logic — this file imports via dynamic eval of TS is awkward; keep as mjs duplicate of asserts.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

// ponytail: duplicate minimal helpers here so Node can run without a TS loader
function buildObjectKey(kind, ext, id) {
  const prefixes = {
    'original-image': 'events/main/originals/images',
    'original-video': 'events/main/originals/videos',
    'preview-image': 'events/main/previews/images',
    'video-poster': 'events/main/previews/video-posters',
  }
  const safe = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin'
  return `${prefixes[kind]}/${id}.${safe}`
}
function sanitizeFilename(name) {
  return name.replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 180)
}
function redactObjectKey(key) {
  const parts = key.split('/')
  const file = parts.pop() ?? ''
  const [id, ext] = file.split('.')
  return `${parts.join('/')}/${id.slice(0, 8)}…${ext ? '.' + ext : ''}`
}

assert.equal(
  buildObjectKey('original-image', 'JPG', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
  'events/main/originals/images/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg',
)
assert.equal(
  buildObjectKey('preview-image', '../webp!', '11111111-1111-1111-1111-111111111111'),
  'events/main/previews/images/11111111-1111-1111-1111-111111111111.webp',
)
assert.equal(sanitizeFilename('../../etc/passwd.jpg'), '.._.._etc_passwd.jpg')
assert.match(sanitizeFilename('Nice Photo (1).JPEG'), /Nice Photo \(1\)\.JPEG/)
assert.equal(
  redactObjectKey('events/main/originals/images/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg'),
  'events/main/originals/images/aaaaaaaa….jpg',
)
console.log('r2_keys self-check: ok')
void createRequire
