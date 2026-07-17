/** Minimal HMAC guest session tokens for upload authorization. */

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

export async function mintGuestToken(
  secret: string,
  eventId: string,
  ttlSeconds = 3600,
): Promise<string> {
  const payload = {
    eventId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }
  const body = b64urlJson(payload)
  const key = await hmacKey(secret)
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
  return `${body}.${b64url(sig)}`
}

export async function verifyGuestToken(
  secret: string,
  token: string | null | undefined,
): Promise<{ ok: true; eventId: string } | { ok: false; code: string }> {
  if (!token || !token.includes('.')) return { ok: false, code: 'guest_token_missing' }
  const [body, sigB64] = token.split('.')
  if (!body || !sigB64) return { ok: false, code: 'guest_token_invalid' }
  try {
    const key = await hmacKey(secret)
    let sig: Uint8Array
    try {
      sig = Uint8Array.from(
        atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')),
        (c) => c.charCodeAt(0),
      )
    } catch {
      return { ok: false, code: 'guest_token_invalid' }
    }
    const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(body))
    if (!valid) return { ok: false, code: 'guest_token_invalid' }
    const json = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(body.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
      ),
    )
    if (!json.eventId || typeof json.exp !== 'number') return { ok: false, code: 'guest_token_invalid' }
    if (json.exp < Math.floor(Date.now() / 1000)) return { ok: false, code: 'guest_token_expired' }
    return { ok: true, eventId: json.eventId as string }
  } catch {
    return { ok: false, code: 'guest_token_invalid' }
  }
}
