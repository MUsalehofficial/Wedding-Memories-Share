/** Opaque QR invite tokens — hash only (never store/log raw token). */

import { timingSafeEqual } from './access_code.ts'

export async function hashInviteToken(rawToken: string): Promise<string> {
  const dig = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken.trim()))
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function inviteTokenValid(row: {
  enabled: boolean
  revoked_at: string | null
  expires_at: string
  now?: Date
}): { ok: true } | { ok: false; code: 'invite_disabled' | 'invite_revoked' | 'invite_expired' } {
  if (row.revoked_at) return { ok: false, code: 'invite_revoked' }
  if (!row.enabled) return { ok: false, code: 'invite_disabled' }
  const now = row.now ?? new Date()
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, code: 'invite_expired' }
  return { ok: true }
}

/** Confirm DB hash matches provided hash (defense in depth after indexed lookup). */
export function inviteHashMatches(storedHash: string, computedHash: string): boolean {
  return timingSafeEqual(storedHash, computedHash)
}

// ponytail: per-isolate sliding window; use DB/KV if abuse spans isolates
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

export function checkInviteRateLimit(
  key: string,
  limit = 20,
  windowMs = 60_000,
  now = Date.now(),
): { ok: true } | { ok: false; code: 'rate_limited' } {
  const bucket = rateBuckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }
  if (bucket.count >= limit) return { ok: false, code: 'rate_limited' }
  bucket.count += 1
  return { ok: true }
}

/** Test helper — clear rate-limit state between unit checks. */
export function resetInviteRateLimitForTests() {
  rateBuckets.clear()
}
