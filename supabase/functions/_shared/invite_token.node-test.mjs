/**
 * QR invite token unit tests.
 * Run: node supabase/functions/_shared/invite_token.node-test.mjs
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes, timingSafeEqual as nodeTse } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join as pathJoin } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function hashInviteToken(raw) {
  return createHash('sha256').update(String(raw).trim(), 'utf8').digest('hex')
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  return nodeTse(Buffer.from(a), Buffer.from(b))
}

function inviteTokenValid(row, now = new Date()) {
  if (row.revoked_at) return { ok: false, code: 'invite_revoked' }
  if (!row.enabled) return { ok: false, code: 'invite_disabled' }
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, code: 'invite_expired' }
  return { ok: true }
}

const rateBuckets = new Map()
function checkInviteRateLimit(key, limit = 3, windowMs = 60_000, now = Date.now()) {
  const bucket = rateBuckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }
  if (bucket.count >= limit) return { ok: false, code: 'rate_limited' }
  bucket.count += 1
  return { ok: true }
}

// Valid token → hash is 64 hex, not equal to raw
const raw = randomBytes(32).toString('base64url')
const hash = hashInviteToken(raw)
assert.equal(hash.length, 64)
assert.notEqual(hash, raw)
assert.ok(!hash.includes(raw.slice(0, 8)))

// Invalid / expired / revoked
assert.deepEqual(
  inviteTokenValid({
    enabled: true,
    revoked_at: null,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }),
  { ok: true },
)
assert.equal(
  inviteTokenValid({
    enabled: false,
    revoked_at: null,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }).code,
  'invite_disabled',
)
assert.equal(
  inviteTokenValid({
    enabled: true,
    revoked_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }).code,
  'invite_revoked',
)
assert.equal(
  inviteTokenValid({
    enabled: true,
    revoked_at: null,
    expires_at: new Date(Date.now() - 1000).toISOString(),
  }).code,
  'invite_expired',
)

// Hash match uses constant-time equal
assert.equal(timingSafeEqual(hash, hashInviteToken(raw)), true)
assert.equal(timingSafeEqual(hash, hashInviteToken('wrong')), false)

// Rate limiting
rateBuckets.clear()
assert.equal(checkInviteRateLimit('ip', 3).ok, true)
assert.equal(checkInviteRateLimit('ip', 3).ok, true)
assert.equal(checkInviteRateLimit('ip', 3).ok, true)
assert.equal(checkInviteRateLimit('ip', 3).ok, false)
assert.equal(checkInviteRateLimit('ip', 3).code, 'rate_limited')

// Edge source contracts
const edge = readFileSync(pathJoin(__dirname, '../wedding-api/index.ts'), 'utf8')
assert.match(edge, /exchange-invite-token/)
assert.match(edge, /hashInviteToken/)
assert.match(edge, /checkInviteRateLimit/)
assert.doesNotMatch(edge, /console\.log\([^)]*token/)

const ops = readFileSync(pathJoin(__dirname, '../../../scripts/ops.mjs'), 'utf8')
assert.match(ops, /create-qr-invite/)
assert.match(ops, /revoke-qr-invites/)
assert.match(ops, /list-qr-invites/)
assert.match(ops, /generate-qr/)
assert.match(ops, /Refusing: do not pass the invite token/)

const joinPage = readFileSync(pathJoin(__dirname, '../../../frontend/src/pages/JoinPage.tsx'), 'utf8')
assert.match(joinPage, /exchange-invite-token/)
assert.match(joinPage, /history\.replaceState/)
assert.doesNotMatch(joinPage, /localStorage/)
assert.doesNotMatch(joinPage, /sessionStorage\.setItem\([^)]*invite/)
assert.doesNotMatch(joinPage, /sessionStorage\.setItem\([^)]*pendingInvite/)

console.log('invite_token.node-test.mjs: ok')
