/**
 * Microsoft Graph helpers for the OneDrive spike.
 * Tokens must never be logged.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0'

export type TokenSet = {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

export function microsoftConfig() {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID')
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET')
  const authority = Deno.env.get('MICROSOFT_AUTHORITY') ?? 'https://login.microsoftonline.com/common'
  const redirectUri = Deno.env.get('MICROSOFT_REDIRECT_URI')
  const scopes =
    Deno.env.get('MICROSOFT_SCOPES') ?? 'Files.ReadWrite offline_access openid profile'
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Microsoft OAuth secrets are not configured')
  }
  return { clientId, clientSecret, authority, redirectUri, scopes }
}

export function buildAuthorizeUrl(state: string, codeChallenge: string): string {
  const cfg = microsoftConfig()
  const url = new URL(`${cfg.authority}/oauth2/v2.0/authorize`)
  url.searchParams.set('client_id', cfg.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', cfg.redirectUri)
  url.searchParams.set('response_mode', 'query')
  url.searchParams.set('scope', cfg.scopes)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<TokenSet> {
  const cfg = microsoftConfig()
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
    scope: cfg.scopes,
  })
  const res = await fetch(`${cfg.authority}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    // Do not include response body in logs if it might contain tokens; surface status only upstream
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 200)}`)
  }
  return (await res.json()) as TokenSet
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const cfg = microsoftConfig()
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: cfg.scopes,
  })
  const res = await fetch(`${cfg.authority}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    if (text.includes('invalid_grant')) {
      const err = new Error('invalid_grant')
      err.name = 'MicrosoftInvalidGrant'
      throw err
    }
    throw new Error(`Token refresh failed (${res.status})`)
  }
  return (await res.json()) as TokenSet
}

export async function graphFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  return await fetch(`${GRAPH}${path}`, { ...init, headers })
}

export function collisionResistantName(ext: string, kind: 'original' | 'preview' = 'original'): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin'
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const id = crypto.randomUUID().slice(0, 8)
  return `${stamp}_${id}_${kind}.${safeExt}`
}
