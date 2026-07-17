import { corsHeaders, json, newRequestId, safeErrorMessage } from '../_shared/http.ts'
import {
  buildAuthorizeUrl,
  collisionResistantName,
  exchangeCodeForTokens,
  graphFetch,
  microsoftConfig,
  refreshAccessToken,
} from '../_shared/microsoft.ts'

/**
 * Routed wedding API — spike routes first.
 * Full guest/admin surface lands after upload proof succeeds.
 *
 * IMPORTANT: Do not claim OneDrive works until docs/onedrive-upload-spike.md has evidence.
 */

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const requestId = req.headers.get('x-request-id') ?? newRequestId()

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  const url = new URL(req.url)
  // Path after /functions/v1/wedding-api
  const route = url.pathname.replace(/^\/functions\/v1\/wedding-api\/?/, '').replace(/^\//, '')

  try {
    if (route === 'health' && req.method === 'GET') {
      return json({ ok: true, service: 'wedding-api', requestId }, 200, origin, requestId)
    }

    if (route === 'microsoft-connect' && req.method === 'GET') {
      // Spike: PKCE verifier should be stored server-side (e.g. short-lived row) keyed by state.
      // Placeholder returns authorize URL shape for wiring tests.
      microsoftConfig()
      const state = crypto.randomUUID()
      const verifier = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
      const challenge = await pkceChallenge(verifier)
      const authorizeUrl = buildAuthorizeUrl(state, challenge)
      return json(
        {
          authorizeUrl,
          state,
          // ponytail: returning verifier to client is only for local spike bootstrap — replace with server-stored verifier before production
          codeVerifierSpikeOnly: verifier,
          requestId,
          note: 'Store verifier server-side before production; see docs/onedrive-upload-spike.md',
        },
        200,
        origin,
        requestId,
      )
    }

    if (route === 'microsoft-callback' && req.method === 'GET') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (!code || !state) {
        return json({ error: 'missing_code_or_state', requestId }, 400, origin, requestId)
      }
      return json(
        {
          received: true,
          state,
          requestId,
          next: 'Exchange code with stored PKCE verifier, vault the refresh token, create folder tree',
        },
        200,
        origin,
        requestId,
      )
    }

    if (route === 'create-onedrive-upload-session' && req.method === 'POST') {
      return json(
        {
          error: 'not_configured',
          message:
            'Requires connected OneDrive + Vault refresh token. Complete microsoft-connect first.',
          exampleFileName: collisionResistantName('jpg'),
          requestId,
        },
        503,
        origin,
        requestId,
      )
    }

    // Keep imports referenced for deploy typecheck / future wiring
    void exchangeCodeForTokens
    void refreshAccessToken
    void graphFetch

    return json({ error: 'not_found', route, requestId }, 404, origin, requestId)
  } catch (err) {
    return json(
      { error: 'internal', message: safeErrorMessage(err), requestId },
      500,
      origin,
      requestId,
    )
  }
})

async function pkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(digest)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
