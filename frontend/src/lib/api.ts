const API_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '')
export const API = API_BASE ? `${API_BASE}/functions/v1/wedding-api` : ''

export async function apiJson<T = Record<string, unknown>>(
  path: string,
  init: RequestInit & { guestToken?: string; adminSecret?: string } = {},
): Promise<T> {
  if (!API) throw new Error('VITE_SUPABASE_URL is not set')
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
  if (init.guestToken) headers.set('x-guest-token', init.guestToken)
  if (init.adminSecret) headers.set('x-admin-secret', init.adminSecret)
  const { guestToken: _g, adminSecret: _a, ...rest } = init
  const res = await fetch(`${API}/${path}`, { ...rest, headers })
  const data = (await res.json()) as T & { error?: string; message?: string }
  if (!res.ok) {
    throw new Error(data.message || data.error || `HTTP ${res.status}`)
  }
  return data
}
