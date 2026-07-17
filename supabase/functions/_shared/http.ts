/** Shared CORS + JSON helpers for wedding-api */

export const PROD_ORIGIN = 'https://share-memories-with-us.musalehofficial.com'

export function allowedOrigins(): string[] {
  const extra = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [PROD_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173', ...extra]
}

export function corsHeaders(origin: string | null): HeadersInit {
  const allow = origin && allowedOrigins().includes(origin) ? origin : allowedOrigins()[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-request-id, x-guest-token, x-admin-secret, x-idempotency-key',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    Vary: 'Origin',
  }
}

export function json(
  body: unknown,
  status = 200,
  origin: string | null = null,
  requestId?: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      ...(requestId ? { 'x-request-id': requestId } : {}),
    },
  })
}

export function newRequestId(): string {
  return crypto.randomUUID()
}

/** Never log tokens / secrets. */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.replace(/Bearer\s+\S+/gi, '[redacted]')
  return 'Unexpected error'
}
