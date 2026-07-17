/** Access-code hashing for guest verify (salt:code → sha256 hex). */

export async function hashAccessCode(salt: string, code: string): Promise<string> {
  const raw = new TextEncoder().encode(`${salt}:${code.trim()}`)
  const dig = await crypto.subtle.digest('SHA-256', raw)
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let x = 0
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return x === 0
}
