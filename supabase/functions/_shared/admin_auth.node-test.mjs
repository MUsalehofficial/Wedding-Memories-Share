/**
 * Admin auth unit tests — ADMIN_PANEL_SECRET only (never ADMIN_EMAIL).
 * Run: node supabase/functions/_shared/admin_auth.node-test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(__dirname, 'admin_auth.ts'), 'utf8')

// Mirror the TS implementation (no Deno/build step).
function resolveAdminAuth(panelSecret, providedHeader) {
  if (!panelSecret || panelSecret.length === 0) {
    return { ok: false, code: 'admin_not_configured' }
  }
  if (!providedHeader || providedHeader !== panelSecret) {
    return { ok: false, code: 'admin_unauthorized' }
  }
  return { ok: true }
}

function adminSecretConfigured(panelSecret) {
  return Boolean(panelSecret && panelSecret.length > 0)
}

assert.match(src, /ADMIN_PANEL_SECRET/)
assert.doesNotMatch(src, /Deno\.env\.get\(['"]ADMIN_EMAIL['"]\)/)
assert.doesNotMatch(src, /\?\?\s*.*ADMIN_EMAIL/)

// Missing admin secret → fail closed
assert.deepEqual(resolveAdminAuth(undefined, 'anything'), {
  ok: false,
  code: 'admin_not_configured',
})
assert.deepEqual(resolveAdminAuth('', 'anything'), {
  ok: false,
  code: 'admin_not_configured',
})
assert.equal(adminSecretConfigured(null), false)
assert.equal(adminSecretConfigured(''), false)

// Wrong secret → unauthorized (401/403 class)
assert.deepEqual(resolveAdminAuth('correct-secret', 'wrong'), {
  ok: false,
  code: 'admin_unauthorized',
})
assert.deepEqual(resolveAdminAuth('correct-secret', null), {
  ok: false,
  code: 'admin_unauthorized',
})

// Correct secret → allow
assert.deepEqual(resolveAdminAuth('correct-secret', 'correct-secret'), { ok: true })
assert.equal(adminSecretConfigured('correct-secret'), true)

// ADMIN_EMAIL must never work as a passphrase when panel secret is unset
const ADMIN_EMAIL = 'couple@example.com'
assert.deepEqual(resolveAdminAuth(undefined, ADMIN_EMAIL), {
  ok: false,
  code: 'admin_not_configured',
})
assert.deepEqual(resolveAdminAuth('', ADMIN_EMAIL), {
  ok: false,
  code: 'admin_not_configured',
})
// Using email while a different panel secret is configured → unauthorized
assert.deepEqual(resolveAdminAuth('correct-secret', ADMIN_EMAIL), {
  ok: false,
  code: 'admin_unauthorized',
})

// Health must only expose boolean configuration (contract check against Edge source)
const edge = readFileSync(join(__dirname, '../wedding-api/index.ts'), 'utf8')
assert.match(edge, /ADMIN_PANEL_SECRET: adminConfigured/)
assert.match(edge, /adminSecretConfigured\(Deno\.env\.get\('ADMIN_PANEL_SECRET'\)\)/)
assert.match(edge, /resolveAdminAuth\(Deno\.env\.get\('ADMIN_PANEL_SECRET'\)/)
assert.doesNotMatch(edge, /ADMIN_PANEL_SECRET\)\s*\?\?\s*Deno\.env\.get\('ADMIN_EMAIL'\)/)
assert.doesNotMatch(edge, /Deno\.env\.get\('ADMIN_EMAIL'\)/)

console.log('admin_auth.node-test.mjs: ok')
