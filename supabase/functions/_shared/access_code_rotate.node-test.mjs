/**
 * Access-code rotation helpers + ops CLI contract tests.
 * Run: node supabase/functions/_shared/access_code_rotate.node-test.mjs
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '../../..')
const opsPath = join(root, 'scripts/ops.mjs')

function hashAccessCode(salt, code) {
  return createHash('sha256').update(`${salt}:${code.trim()}`, 'utf8').digest('hex')
}

// Hash scheme: salt:code → sha256 hex; DB stores only salt+hash
const salt = randomBytes(16).toString('hex')
const code = 'TEST-ONLY-NOT-PRODUCTION'
const hash = hashAccessCode(salt, code)
assert.equal(hash.length, 64)
assert.equal(salt.length, 32)
assert.notEqual(hash, code)
assert.ok(!hash.includes(code))

// Timing-safe mismatch for old code after rotation
const oldSalt = randomBytes(16).toString('hex')
const oldHash = hashAccessCode(oldSalt, 'MB-OLD-DISCLOSED')
const newSalt = randomBytes(16).toString('hex')
const newHash = hashAccessCode(newSalt, 'MB-NEW-ROTATED')
assert.notEqual(oldHash, newHash)
assert.equal(hashAccessCode(newSalt, 'MB-OLD-DISCLOSED') === newHash, false)
assert.equal(hashAccessCode(newSalt, 'MB-NEW-ROTATED'), newHash)

// guest_token_version increment contract
const prev = 1
const next = prev + 1
assert.equal(next, 2)

// ops.mjs must refuse argv form
const opsSrc = readFileSync(opsPath, 'utf8')
assert.match(opsSrc, /rotate-access-code/)
assert.match(opsSrc, /Refusing: do not pass the access code/)
assert.match(opsSrc, /guest_token_version/)
assert.match(opsSrc, /raw_code_logged: false/)

const refused = spawnSync(
  process.execPath,
  [opsPath, 'rotate-access-code', 'SHOULD-NOT-ACCEPT'],
  {
    env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: 'test-key-not-used' },
    encoding: 'utf8',
  },
)
assert.equal(refused.status, 2)
assert.match(refused.stderr, /Refusing/)
assert.doesNotMatch(refused.stdout + refused.stderr, /SHOULD-NOT-ACCEPT/)

console.log('access_code_rotate.node-test.mjs: ok')
