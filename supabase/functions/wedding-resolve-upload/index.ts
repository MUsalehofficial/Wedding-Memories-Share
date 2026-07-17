/**
 * Tiny helper: resolve Google Drive file id for an open resumable session.
 * Works around browser CORS blind spot on Drive's final 200 (missing ACAO).
 * Auth: same guest token as wedding-api.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

const PROD_ORIGIN = 'https://share-memories-with-us.musalehofficial.com'

function cors(origin: string | null): HeadersInit {
  const allow =
    origin &&
    [
      PROD_ORIGIN,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
    ].includes(origin)
      ? origin
      : PROD_ORIGIN
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-request-id, x-guest-token',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json',
  }
}

function b64urlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function verifyGuest(secret: string, token: string | null): Promise<{ ok: true; eventId: string; version: number } | { ok: false }> {
  if (!token || !token.includes('.')) return { ok: false }
  const [body, sigB64] = token.split('.')
  if (!body || !sigB64) return { ok: false }
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const sig = b64urlDecode(sigB64)
    const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(body))
    if (!valid) return { ok: false }
    const json = JSON.parse(new TextDecoder().decode(b64urlDecode(body)))
    if (!json.eventId || typeof json.exp !== 'number') return { ok: false }
    if (json.exp < Math.floor(Date.now() / 1000)) return { ok: false }
    return { ok: true, eventId: json.eventId, version: typeof json.v === 'number' ? json.v : 1 }
  } catch {
    return { ok: false }
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method_not_allowed', requestId }), {
        status: 405,
        headers: cors(origin),
      })
    }
    const body = (await req.json()) as { sessionId?: string }
    if (!body.sessionId) {
      return new Response(JSON.stringify({ error: 'missing_session_id', requestId }), {
        status: 400,
        headers: cors(origin),
      })
    }
    const secret = Deno.env.get('GUEST_TOKEN_SIGNING_SECRET')
    if (!secret) {
      return new Response(JSON.stringify({ error: 'misconfigured', requestId }), {
        status: 500,
        headers: cors(origin),
      })
    }
    const guest = await verifyGuest(secret, req.headers.get('x-guest-token'))
    if (!guest.ok) {
      return new Response(JSON.stringify({ error: 'guest_unauthorized', requestId }), {
        status: 401,
        headers: cors(origin),
      })
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: event } = await sb
      .from('events')
      .select('id, guest_token_version')
      .eq('id', guest.eventId)
      .maybeSingle()
    if (!event || Number(event.guest_token_version) !== guest.version) {
      return new Response(JSON.stringify({ error: 'guest_token_revoked', requestId }), {
        status: 401,
        headers: cors(origin),
      })
    }

    const { data: sess } = await sb
      .from('upload_sessions')
      .select('id, event_id, byte_size, graph_upload_url, drive_item_id, status')
      .eq('id', body.sessionId)
      .eq('event_id', guest.eventId)
      .maybeSingle()
    if (!sess) {
      return new Response(JSON.stringify({ error: 'session_not_found', requestId }), {
        status: 404,
        headers: cors(origin),
      })
    }
    if (sess.drive_item_id) {
      return new Response(
        JSON.stringify({
          ok: true,
          fileId: sess.drive_item_id,
          reused: true,
          requestId,
        }),
        { status: 200, headers: cors(origin) },
      )
    }
    if (!sess.graph_upload_url) {
      return new Response(JSON.stringify({ error: 'upload_url_missing', requestId }), {
        status: 409,
        headers: cors(origin),
      })
    }

    const total = Number(sess.byte_size)
    const res = await fetch(sess.graph_upload_url, {
      method: 'PUT',
      headers: { 'Content-Length': '0', 'Content-Range': `bytes */${total}` },
    })
    if (res.status === 200 || res.status === 201) {
      let fileId: string | null = null
      try {
        const meta = (await res.json()) as { id?: string }
        fileId = meta.id ?? null
      } catch {
        fileId = null
      }
      if (!fileId) {
        return new Response(JSON.stringify({ error: 'missing_file_id', requestId }), {
          status: 502,
          headers: cors(origin),
        })
      }
      return new Response(
        JSON.stringify({ ok: true, fileId, reused: false, requestId }),
        { status: 200, headers: cors(origin) },
      )
    }
    const range = res.headers.get('Range')
    return new Response(
      JSON.stringify({
        error: 'upload_incomplete',
        status: res.status,
        range,
        requestId,
      }),
      { status: 409, headers: cors(origin) },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'error'
    return new Response(JSON.stringify({ error: 'resolve_failed', message, requestId }), {
      status: 500,
      headers: cors(origin),
    })
  }
})
