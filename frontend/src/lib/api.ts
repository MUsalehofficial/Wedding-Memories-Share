const API_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '')
export const API = API_BASE ? `${API_BASE}/functions/v1/wedding-api` : ''

export class ApiError extends Error {
  status: number
  code: string
  requestId: string | null
  constructor(message: string, opts: { status: number; code: string; requestId: string | null }) {
    super(message)
    this.name = 'ApiError'
    this.status = opts.status
    this.code = opts.code
    this.requestId = opts.requestId
  }
}

/** Log stage + requestId only — never tokens, upload URLs, or signed URLs. */
export function logApi(stage: string, detail: Record<string, unknown> = {}) {
  const safe = { ...detail }
  for (const k of Object.keys(safe)) {
    const v = safe[k]
    if (typeof v === 'string' && (/token|secret|signed|uploadUrl|Bearer/i.test(k) || v.length > 180)) {
      safe[k] = '[redacted]'
    }
  }
  console.info('[wedding-upload]', stage, safe)
}

export async function apiJson<T = Record<string, unknown>>(
  path: string,
  init: RequestInit & {
    guestToken?: string
    adminSecret?: string
    /** Override Edge Function slug (default wedding-api). */
    functionSlug?: string
  } = {},
): Promise<T> {
  if (!API_BASE) throw new Error('VITE_SUPABASE_URL is not set')
  const slug = init.functionSlug || 'wedding-api'
  const base = `${API_BASE}/functions/v1/${slug}`
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
  if (init.guestToken) headers.set('x-guest-token', init.guestToken)
  if (init.adminSecret) headers.set('x-admin-secret', init.adminSecret)
  const requestIdOut = crypto.randomUUID()
  headers.set('x-request-id', requestIdOut)
  const { guestToken: _g, adminSecret: _a, functionSlug: _f, ...rest } = init
  const url = path ? `${base}/${path}` : base
  const res = await fetch(url, { ...rest, headers })
  const data = (await res.json()) as T & { error?: string; message?: string; requestId?: string }
  const requestId = data.requestId || res.headers.get('x-request-id') || requestIdOut
  if (!res.ok) {
    const code = data.error || `http_${res.status}`
    logApi('api_error', { path, slug, status: res.status, code, requestId })
    throw new ApiError(data.message || data.error || `HTTP ${res.status}`, {
      status: res.status,
      code,
      requestId,
    })
  }
  logApi('api_ok', { path, slug, status: res.status, requestId })
  return data
}
