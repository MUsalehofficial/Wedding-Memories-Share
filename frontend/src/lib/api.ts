const API_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '')
export const API = API_BASE ? `${API_BASE}/functions/v1/wedding-api` : ''

const DEFAULT_TIMEOUT_MS = 90_000

export class ApiError extends Error {
  status: number
  code: string
  requestId: string | null
  stage: string
  constructor(
    message: string,
    opts: { status: number; code: string; requestId: string | null; stage?: string },
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = opts.status
    this.code = opts.code
    this.requestId = opts.requestId
    this.stage = opts.stage || 'api'
  }
}

/** Log stage + requestId only — never tokens, upload URLs, or signed URLs. */
export function logApi(stage: string, detail: Record<string, unknown> = {}) {
  const safe: Record<string, unknown> = { ...detail }
  for (const k of Object.keys(safe)) {
    const v = safe[k]
    if (typeof v === 'string' && (/token|secret|signed|uploadUrl|Bearer/i.test(k) || v.length > 180)) {
      safe[k] = '[redacted]'
    }
  }
  console.info('[wedding-upload]', stage, safe)
}

function looksLikeCorsOrLoadFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /load failed|failed to fetch|networkerror|network request failed|cors/i.test(msg)
}

export async function apiJson<T = Record<string, unknown>>(
  path: string,
  init: RequestInit & {
    guestToken?: string
    adminSecret?: string
    /** Override Edge Function slug (default wedding-api). */
    functionSlug?: string
    stage?: string
    timeoutMs?: number
  } = {},
): Promise<T> {
  if (!API_BASE) throw new Error('VITE_SUPABASE_URL is not set')
  const slug = init.functionSlug || 'wedding-api'
  const stage = init.stage || path || slug
  const base = `${API_BASE}/functions/v1/${slug}`
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
  if (init.guestToken) headers.set('x-guest-token', init.guestToken)
  if (init.adminSecret) headers.set('x-admin-secret', init.adminSecret)
  const requestIdOut = crypto.randomUUID()
  headers.set('x-request-id', requestIdOut)
  const { guestToken: _g, adminSecret: _a, functionSlug: _f, stage: _s, timeoutMs, ...rest } = init
  const url = path ? `${base}/${path}` : base
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  if (rest.signal) {
    rest.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  let res: Response
  try {
    res = await fetch(url, { ...rest, headers, signal: ctrl.signal })
  } catch (err) {
    clearTimeout(timer)
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    const code = aborted ? 'timeout' : looksLikeCorsOrLoadFailure(err) ? 'network_or_cors' : 'fetch_failed'
    const message = aborted
      ? `${stage} timed out after ${timeout}ms`
      : `${stage} failed: ${err instanceof Error ? err.message : String(err)}`
    logApi('api_fetch_error', { path, slug, stage, code, requestId: requestIdOut })
    throw new ApiError(message, { status: 0, code, requestId: requestIdOut, stage })
  }
  clearTimeout(timer)

  let data: T & { error?: string; message?: string; requestId?: string }
  const rawText = await res.text()
  try {
    data = rawText ? (JSON.parse(rawText) as typeof data) : ({} as typeof data)
  } catch {
    logApi('api_bad_json', {
      path,
      slug,
      stage,
      status: res.status,
      requestId: requestIdOut,
      bodyPrefix: rawText.slice(0, 120),
    })
    throw new ApiError(`${stage}: invalid JSON response (HTTP ${res.status})`, {
      status: res.status,
      code: 'invalid_json',
      requestId: requestIdOut,
      stage,
    })
  }
  const requestId = data.requestId || res.headers.get('x-request-id') || requestIdOut
  if (!res.ok) {
    const code = data.error || `http_${res.status}`
    logApi('api_error', { path, slug, stage, status: res.status, code, requestId })
    throw new ApiError(data.message || data.error || `${stage} HTTP ${res.status}`, {
      status: res.status,
      code,
      requestId,
      stage,
    })
  }
  logApi('api_ok', { path, slug, stage, status: res.status, requestId })
  return data
}
