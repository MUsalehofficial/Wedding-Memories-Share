/**
 * Playback token + gallery stream wiring checks (no network).
 * Run: node supabase/functions/_shared/media_stream.node-test.mjs
 */
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const root = join(dir, '../../..')
const PLAYBACK_TOKEN_VERSION = 1

function b64url(buf) {
  return Buffer.from(buf).toString('base64url')
}

function mintPlaybackToken(signingKey, claims) {
  const ttl = claims.ttlSeconds ?? 180
  const payload = {
    mediaId: claims.mediaId,
    eventId: claims.eventId,
    purpose: claims.purpose,
    exp: Math.floor(Date.now() / 1000) + ttl,
    v: claims.version ?? PLAYBACK_TOKEN_VERSION,
  }
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', signingKey).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verifyPlaybackToken(signingKey, token, expected) {
  if (!token?.includes('.')) return { ok: false, code: 'playback_token_missing' }
  const [body, sig] = token.split('.')
  const expect = createHmac('sha256', signingKey).update(body).digest('base64url')
  if (sig !== expect) return { ok: false, code: 'playback_token_invalid' }
  const json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  const version = typeof json.v === 'number' ? json.v : 0
  if (version !== (expected.version ?? PLAYBACK_TOKEN_VERSION)) {
    return { ok: false, code: 'playback_token_revoked' }
  }
  if (json.exp < Math.floor(Date.now() / 1000)) return { ok: false, code: 'playback_token_expired' }
  if (json.mediaId !== expected.mediaId || json.purpose !== expected.purpose) {
    return { ok: false, code: 'playback_token_mismatch' }
  }
  if (expected.eventId && json.eventId !== expected.eventId) {
    return { ok: false, code: 'playback_token_mismatch' }
  }
  return { ok: true, claims: json }
}

const signingKey = 'unit-test-signing-key'
const mediaId = 'bbc7f216-2361-44a6-bb3e-0051fe073877'
const otherId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const tok = mintPlaybackToken(signingKey, {
  mediaId,
  eventId: 'evt',
  purpose: 'stream',
  ttlSeconds: 60,
})
assert.equal(verifyPlaybackToken(signingKey, tok, { mediaId, purpose: 'stream' }).ok, true)
assert.equal(verifyPlaybackToken(signingKey, tok, { mediaId, purpose: 'download' }).ok, false)
assert.equal(verifyPlaybackToken(signingKey, tok, { mediaId: otherId, purpose: 'stream' }).ok, false)
assert.equal(verifyPlaybackToken(signingKey, null, { mediaId, purpose: 'stream' }).ok, false)
assert.equal(verifyPlaybackToken(signingKey, 'nope', { mediaId, purpose: 'stream' }).ok, false)

const expired = mintPlaybackToken(signingKey, {
  mediaId,
  eventId: 'evt',
  purpose: 'stream',
  ttlSeconds: -10,
})
assert.equal(verifyPlaybackToken(signingKey, expired, { mediaId, purpose: 'stream' }).code, 'playback_token_expired')

const wrongVersion = mintPlaybackToken(signingKey, {
  mediaId,
  eventId: 'evt',
  purpose: 'stream',
  version: 99,
})
assert.equal(verifyPlaybackToken(signingKey, wrongVersion, { mediaId, purpose: 'stream' }).code, 'playback_token_revoked')

const drive = readFileSync(join(dir, 'google_drive.ts'), 'utf8')
assert.match(drive, /opts\.range/)
assert.match(drive, /headers\.set\('Range'/)
assert.match(drive, /signal: opts\.signal/)
assert.doesNotMatch(drive, /arrayBuffer\(\)/)

const api = readFileSync(join(dir, '../wedding-api/index.ts'), 'utf8')
assert.match(api, /parseMediaRoute/)
assert.match(api, /PLAYBACK_TOKEN_SECRET/)
assert.match(api, /playbackSecret\(/)
assert.doesNotMatch(api, /mintPlaybackToken\(guestSecret/)
assert.doesNotMatch(api, /verifyPlaybackToken\(guestSecret/)
assert.match(api, /private, no-store/)
assert.match(api, /media\/\$\{row\.id\}\/stream/)
assert.match(api, /Accept-Ranges/)
assert.match(api, /Content-Range/)
assert.match(api, /req\.method === 'HEAD'/)
assert.match(api, /signal: req\.signal/)
assert.match(api, /downloadDriveFile\(access, driveId, \{[\s\S]*range/)
assert.match(api, /new Response\(driveRes\.body/)
assert.doesNotMatch(api, /driveRes\.arrayBuffer|driveRes\.blob\(|driveRes\.text\(/)
assert.match(api, /verifyPlaybackToken/)
assert.match(api, /error: playback\.code/)
assert.match(api, /media_not_playable/)
assert.match(api, /media_kind !== 'video'/)
assert.match(api, /Content-Disposition/)
assert.match(api, /PLAYBACK_TOKEN_SECRET: Boolean/)
const streamBlock = api.slice(api.indexOf("mediaRoute?.action === 'playback'"), api.indexOf("route === 'gdrive-status'"))
assert.doesNotMatch(streamBlock, /console\.(log|info|warn|error).*Authorization|console\.(log|info).*alt=media/)
assert.doesNotMatch(streamBlock, /GUEST_TOKEN_SIGNING_SECRET|SUPABASE_SERVICE_ROLE_KEY|GOOGLE_CLIENT_SECRET/)

const playbackTok = readFileSync(join(dir, 'playback_token.ts'), 'utf8')
assert.match(playbackTok, /PLAYBACK_TOKEN_VERSION/)
assert.match(playbackTok, /playback_token_missing/)
assert.match(playbackTok, /playback_token_invalid/)
assert.match(playbackTok, /playback_token_expired/)
assert.match(playbackTok, /playback_token_revoked/)

const http = readFileSync(join(dir, 'http.ts'), 'utf8')
assert.match(http, /Access-Control-Expose-Headers/)
assert.match(http, /Content-Range/)
assert.match(http, /Content-Disposition/)
assert.match(http, /\brange\b/)

const gallery = readFileSync(join(root, 'frontend/src/pages/GalleryPage.tsx'), 'utf8')
assert.match(gallery, /<video/)
assert.match(gallery, /playsInline/)
assert.match(gallery, /preload="metadata"/)
assert.match(gallery, /controls/)
assert.match(gallery, /media\/\$\{mediaId\}\/playback|media\/\$\{active\.id\}\/playback/)
assert.match(gallery, /streamUrl/)
assert.match(gallery, /Download Original/)
assert.match(gallery, /onDownloadOriginal/)
assert.match(gallery, /downloadUrl/)
assert.match(gallery, /code === 4/)
assert.match(gallery, /Never use preview\/poster URL as video src/)
assert.match(gallery, /streamRetryUsedRef/)
assert.match(gallery, /Play video from/)
assert.match(gallery, /src=\{playback\.streamUrl\}/)
const videoOpen = gallery.indexOf('<video')
const videoClose = gallery.indexOf('/>', videoOpen)
const videoTag = gallery.slice(videoOpen, videoClose + 2)
assert.match(videoTag, /src=\{playback\.streamUrl\}/)
assert.match(videoTag, /poster=\{active\.previewUrl/)
assert.doesNotMatch(videoTag, /src=\{active\.previewUrl\}/)
assert.doesNotMatch(videoTag, /src=\{.*previewUrl/)
// Posterless videos still get Play overlay (mediaKind === 'video' overlay, not gated on previewUrl)
assert.match(gallery, /item\.mediaKind === 'video' \? \([\s\S]*Play className="h-5/)

console.log('media_stream.node-test: ok')
