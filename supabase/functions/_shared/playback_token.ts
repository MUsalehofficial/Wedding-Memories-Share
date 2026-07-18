/** Short-lived HMAC playback tokens for <video src> / download (query param). */

export const PLAYBACK_TOKEN_VERSION = 1

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)))
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export type PlaybackPurpose = 'stream' | 'download'

export type PlaybackClaims = {
  mediaId: string
  eventId: string
  purpose: PlaybackPurpose
  exp: number
  v: number
}

export async function mintPlaybackToken(
  secret: string,
  claims: Omit<PlaybackClaims, 'exp' | 'v'> & { ttlSeconds?: number; version?: number },
): Promise<{ token: string; expiresInSec: number }> {
  const ttlSeconds = claims.ttlSeconds ?? 180
  const payload: PlaybackClaims = {
    mediaId: claims.mediaId,
    eventId: claims.eventId,
    purpose: claims.purpose,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    v: claims.version ?? PLAYBACK_TOKEN_VERSION,
  }
  const body = b64urlJson(payload)
  const key = await hmacKey(secret)
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
  return { token: `${body}.${b64url(sig)}`, expiresInSec: ttlSeconds }
}

export async function verifyPlaybackToken(
  secret: string,
  token: string | null | undefined,
  expected: { mediaId: string; purpose: PlaybackPurpose; eventId?: string; version?: number },
): Promise<{ ok: true; claims: PlaybackClaims } | { ok: false; code: string }> {
  if (!token || !token.includes('.')) return { ok: false, code: 'playback_token_missing' }
  const [body, sigB64] = token.split('.')
  if (!body || !sigB64) return { ok: false, code: 'playback_token_invalid' }
  try {
    const key = await hmacKey(secret)
    let sig: Uint8Array
    try {
      sig = Uint8Array.from(
        atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')),
        (c) => c.charCodeAt(0),
      )
    } catch {
      return { ok: false, code: 'playback_token_invalid' }
    }
    const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(body))
    if (!valid) return { ok: false, code: 'playback_token_invalid' }
    const json = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(body.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
      ),
    ) as PlaybackClaims
    if (!json.mediaId || !json.eventId || !json.purpose || typeof json.exp !== 'number') {
      return { ok: false, code: 'playback_token_invalid' }
    }
    const version = typeof json.v === 'number' ? json.v : 0
    const expectedVersion = expected.version ?? PLAYBACK_TOKEN_VERSION
    if (version !== expectedVersion) return { ok: false, code: 'playback_token_revoked' }
    if (json.exp < Math.floor(Date.now() / 1000)) return { ok: false, code: 'playback_token_expired' }
    if (json.mediaId !== expected.mediaId) return { ok: false, code: 'playback_token_mismatch' }
    if (json.purpose !== expected.purpose) return { ok: false, code: 'playback_token_mismatch' }
    if (expected.eventId && json.eventId !== expected.eventId) {
      return { ok: false, code: 'playback_token_mismatch' }
    }
    return { ok: true, claims: { ...json, v: version } }
  } catch {
    return { ok: false, code: 'playback_token_invalid' }
  }
}
