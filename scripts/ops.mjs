#!/usr/bin/env node
/**
 * Operator CLI (no extra deps — fetch + PostgREST).
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Destructive: OPS_CONFIRM=YES
 *
 * node scripts/ops.mjs <command> [args]
 *
 * Access codes: never pass the raw code as a CLI argument (shell history / ps).
 * Use interactive prompts or stdin: printf 'code\\ncode\\n' | node scripts/ops.mjs rotate-access-code
 */
import { createHash, randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { stdin as input, stdout as output, stderr } from 'node:process'

const URL = (process.env.SUPABASE_URL || 'https://vszfgqylajnvdbjqadjr.supabase.co').replace(/\/$/, '')
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const API = `${URL}/functions/v1/wedding-api`
const SLUG = 'muhammad-basmala'
const BUCKET = 'wedding-previews'
const REST = `${URL}/rest/v1`

if (!KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const cmd = process.argv[2] || 'help'
const args = process.argv.slice(3)

function hashAccessCode(salt, code) {
  return createHash('sha256').update(`${salt}:${code.trim()}`, 'utf8').digest('hex')
}

/** Read a line; when TTY, try to mute echo for secrets. */
async function readSecretLine(promptText) {
  if (!input.isTTY) {
    // Non-interactive: read one line from stdin (e.g. piped). Never use argv for codes.
    const rl = createInterface({ input, output: stderr, terminal: false })
    return await new Promise((resolve) => {
      stderr.write(promptText)
      rl.once('line', (line) => {
        rl.close()
        resolve(line)
      })
    })
  }
  stderr.write(promptText)
  const stdin = input
  stdin.setRawMode?.(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  let buf = ''
  return await new Promise((resolve) => {
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        stdin.setRawMode?.(false)
        stdin.off('data', onData)
        stderr.write('\n')
        resolve(buf)
        return
      }
      if (ch === '\u0003') {
        stdin.setRawMode?.(false)
        process.exit(130)
      }
      if (ch === '\u007f' || ch === '\b') {
        buf = buf.slice(0, -1)
        return
      }
      buf += ch
    }
    stdin.on('data', onData)
  })
}
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

async function rest(path, init = {}) {
  const res = await fetch(`${REST}/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) throw new Error(`${res.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  return body
}

async function eventRow() {
  const rows = await rest(`events?slug=eq.${encodeURIComponent(SLUG)}&select=*`)
  if (!rows?.[0]) throw new Error('event_missing')
  return rows[0]
}

async function setFlag(col, val) {
  await rest(`events?slug=eq.${encodeURIComponent(SLUG)}`, {
    method: 'PATCH',
    body: JSON.stringify({ [col]: val, updated_at: new Date().toISOString() }),
  })
  console.log(`ok ${col}=${val}`)
}

function confirmDestructive() {
  if (process.env.OPS_CONFIRM !== 'YES') {
    console.error('Refusing destructive action. Re-run with OPS_CONFIRM=YES')
    process.exit(2)
  }
}

const commands = {
  async help() {
    console.log(`Commands:
  status | enable-uploads | disable-uploads
  enable-videos | disable-videos | enable-gallery | disable-gallery
  revoke-guest-sessions | list-media [limit]
  hide-media <id> | delete-media <id>
  quota | clean-abandoned | reconcile [--apply]
  rotate-access-code   # prompt/stdin twice; never pass code as argv
  create-qr-invite     # prints guest URL once; stores hash only
  revoke-qr-invites    # revoke all active QR invites (OPS_CONFIRM=YES)
  list-qr-invites      # metadata only — never raw tokens
  generate-qr          # stdin: invite URL → PNG+SVG under /tmp (not committed)
`)
  },

  async 'rotate-access-code'() {
    // Reject argv form — codes must not appear in shell history or process listings.
    if (args.length > 0) {
      console.error(
        'Refusing: do not pass the access code as a command-line argument.\n' +
          'Use: node scripts/ops.mjs rotate-access-code\n' +
          '  (interactive prompts), or pipe two matching lines on stdin.',
      )
      process.exit(2)
    }
    const a = (await readSecretLine('New wedding access code: ')).trim()
    const b = (await readSecretLine('Confirm access code: ')).trim()
    if (!a || a !== b) {
      console.error('Codes do not match (or empty). No changes made.')
      process.exit(2)
    }
    const salt = randomBytes(16).toString('hex')
    const hash = hashAccessCode(salt, a)
    // Drop raw code from local bindings as soon as hash is computed.
    const e = await eventRow()
    const nextVersion = Number(e.guest_token_version || 1) + 1
    await rest(`events?slug=eq.${encodeURIComponent(SLUG)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        access_code_salt: salt,
        access_code_hash: hash,
        guest_token_version: nextVersion,
        updated_at: new Date().toISOString(),
      }),
    })
    // Sanitized operational result only — never log salt/hash/raw code.
    console.log(
      JSON.stringify({
        ok: true,
        operation: 'rotate-access-code',
        guest_token_version: nextVersion,
        hash_stored: true,
        salt_stored: true,
        raw_code_logged: false,
      }),
    )
  },

  async 'create-qr-invite'() {
    if (args.length > 0) {
      console.error(
        'Refusing: do not pass the invite token or URL as a command-line argument.\n' +
          'Use: node scripts/ops.mjs create-qr-invite',
      )
      process.exit(2)
    }
    const e = await eventRow()
    const raw = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(raw, 'utf8').digest('hex')
    // Default: 180 days (override with QR_INVITE_EXPIRES_AT=ISO-8601)
    const expiresAt = process.env.QR_INVITE_EXPIRES_AT
      ? new Date(process.env.QR_INVITE_EXPIRES_AT)
      : new Date(Date.now() + 180 * 24 * 3600 * 1000)
    if (Number.isNaN(expiresAt.getTime())) {
      console.error('Invalid QR_INVITE_EXPIRES_AT')
      process.exit(2)
    }
    const rows = await rest('qr_invite_tokens', {
      method: 'POST',
      body: JSON.stringify({
        event_id: e.id,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
        enabled: true,
      }),
    })
    const id = rows?.[0]?.id
    const origin = (process.env.GUEST_APP_ORIGIN || 'https://share-memories-with-us.musalehofficial.com').replace(
      /\/$/,
      '',
    )
    const guestUrl = `${origin}/#/join/${raw}`
    console.log(guestUrl)
    console.error(
      JSON.stringify({
        ok: true,
        operation: 'create-qr-invite',
        invite_id: id,
        expires_at: expiresAt.toISOString(),
        raw_token_logged: false,
        url_printed_once: true,
      }),
    )
  },

  async 'revoke-qr-invites'() {
    confirmDestructive()
    const e = await eventRow()
    const now = new Date().toISOString()
    const rows = await rest(
      `qr_invite_tokens?event_id=eq.${e.id}&enabled=eq.true&revoked_at=is.null`,
      {
        method: 'PATCH',
        body: JSON.stringify({ enabled: false, revoked_at: now }),
      },
    )
    console.log(
      JSON.stringify({
        ok: true,
        operation: 'revoke-qr-invites',
        revoked_count: Array.isArray(rows) ? rows.length : 0,
      }),
    )
  },

  async 'list-qr-invites'() {
    const e = await eventRow()
    const rows = await rest(
      `qr_invite_tokens?event_id=eq.${e.id}&select=id,created_at,expires_at,revoked_at,use_count,enabled&order=created_at.desc`,
    )
    console.log(
      JSON.stringify(
        (rows || []).map((r) => ({
          id: r.id,
          created_at: r.created_at,
          expires_at: r.expires_at,
          revoked_at: r.revoked_at,
          use_count: r.use_count,
          enabled: r.enabled,
          status: !r.enabled || r.revoked_at
            ? 'revoked'
            : new Date(r.expires_at) <= new Date()
              ? 'expired'
              : 'active',
        })),
        null,
        2,
      ),
    )
  },

  async 'generate-qr'() {
    if (args.length > 0) {
      console.error('Refusing: pass the invite URL on stdin, not as an argument.')
      process.exit(2)
    }
    const rl = createInterface({ input, output: stderr, terminal: false })
    const url = await new Promise((resolve) => {
      stderr.write('Invite URL (paste once): ')
      rl.once('line', (line) => {
        rl.close()
        resolve(String(line || '').trim())
      })
    })
    if (!url || !url.includes('#/join/')) {
      console.error('Expected a guest invite URL containing #/join/<token>')
      process.exit(2)
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
    const png = `/tmp/wedding-qr-${stamp}.png`
    const svg = `/tmp/wedding-qr-${stamp}.svg`
    const { spawnSync } = await import('node:child_process')
    // ponytail: npx qrcode — no repo dependency; do not commit outputs
    const pngRun = spawnSync('npx', ['--yes', 'qrcode', '-o', png, '-w', '1024', url], {
      encoding: 'utf8',
    })
    if (pngRun.status !== 0) {
      console.error(pngRun.stderr || pngRun.stdout || 'qrcode png failed')
      process.exit(1)
    }
    const svgRun = spawnSync('npx', ['--yes', 'qrcode', '-t', 'svg', '-o', svg, url], {
      encoding: 'utf8',
    })
    if (svgRun.status !== 0) {
      console.error(svgRun.stderr || svgRun.stdout || 'qrcode svg failed')
      process.exit(1)
    }
    console.log(
      JSON.stringify({
        ok: true,
        operation: 'generate-qr',
        png,
        svg,
        note: 'Do not commit these files — the QR grants guest access.',
      }),
    )
  },

  async status() {
    const e = await eventRow()
    const integ = await rest(
      `google_drive_integrations?event_id=eq.${e.id}&select=status,last_error,last_quota_limit_bytes,last_quota_usage_bytes`,
    )
    console.log(
      JSON.stringify(
        {
          couple: e.couple_names,
          uploads_enabled: e.uploads_enabled,
          video_uploads_enabled: e.video_uploads_enabled,
          gallery_enabled: e.gallery_enabled,
          moderation_enabled: e.moderation_enabled,
          guest_token_version: e.guest_token_version,
          drive: integ?.[0] ?? null,
        },
        null,
        2,
      ),
    )
  },

  'enable-uploads': () => setFlag('uploads_enabled', true),
  'disable-uploads': () => setFlag('uploads_enabled', false),
  'enable-videos': () => setFlag('video_uploads_enabled', true),
  'disable-videos': () => setFlag('video_uploads_enabled', false),
  'enable-gallery': () => setFlag('gallery_enabled', true),
  'disable-gallery': () => setFlag('gallery_enabled', false),

  async 'revoke-guest-sessions'() {
    const e = await eventRow()
    await setFlag('guest_token_version', Number(e.guest_token_version || 1) + 1)
    console.log('All existing guest tokens are now invalid.')
  },

  async 'list-media'() {
    const e = await eventRow()
    const limit = Number(args[0] || 20)
    const rows = await rest(
      `media?event_id=eq.${e.id}&select=id,media_kind,upload_status,moderation_status,status,size_bytes,google_original_file_id,preview_object_key,created_at,guest_name&order=created_at.desc&limit=${limit}`,
    )
    console.log(JSON.stringify(rows, null, 2))
  },

  async 'hide-media'() {
    const id = args[0]
    if (!id) throw new Error('usage: hide-media <mediaId>')
    await rest(`media?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'hidden',
        moderation_status: 'hidden',
        updated_at: new Date().toISOString(),
      }),
    })
    console.log('ok hidden', id)
  },

  async 'delete-media'() {
    confirmDestructive()
    const id = args[0]
    if (!id) throw new Error('usage: delete-media <mediaId>')
    const rows = await rest(
      `media?id=eq.${id}&select=id,google_original_file_id,preview_object_key,video_poster_object_key`,
    )
    const media = rows?.[0]
    if (!media) throw new Error('media_not_found')
    if (media.google_original_file_id) {
      const res = await fetch(`${API}/gdrive-spike-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: media.google_original_file_id, mediaId: id }),
      })
      console.log('drive_delete', await res.json())
    } else {
      const paths = [media.preview_object_key, media.video_poster_object_key].filter(Boolean)
      if (paths.length) {
        await fetch(`${URL}/storage/v1/object/${BUCKET}`, {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ prefixes: paths }),
        })
      }
      await rest(`media?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ upload_status: 'deleted', updated_at: new Date().toISOString() }),
      })
      console.log('ok db marked deleted')
    }
  },

  async quota() {
    const res = await fetch(`${API}/gdrive-quota`)
    console.log(JSON.stringify(await res.json(), null, 2))
  },

  async 'clean-abandoned'() {
    confirmDestructive()
    const e = await eventRow()
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const sessions = await rest(
      `upload_sessions?event_id=eq.${e.id}&status=in.(created,uploading)&created_at=lt.${cutoff}&select=id`,
    )
    for (const s of sessions || []) {
      await rest(`upload_sessions?id=eq.${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'cancelled',
          graph_upload_url: null,
          updated_at: new Date().toISOString(),
        }),
      })
      await rest(`media?upload_session_id=eq.${s.id}&upload_status=in.(created,processing)`, {
        method: 'PATCH',
        body: JSON.stringify({ upload_status: 'abandoned', updated_at: new Date().toISOString() }),
      })
    }
    console.log('cleaned sessions', (sessions || []).length)
  },

  async reconcile() {
    const apply = args.includes('--apply')
    if (apply) confirmDestructive()
    const e = await eventRow()
    const rows = await rest(
      `media?event_id=eq.${e.id}&select=id,upload_status,moderation_status,status,google_original_file_id,preview_object_key,video_poster_object_key,media_kind`,
    )
    const report = {
      missingDriveOriginal: [],
      missingPreviewObject: [],
      approvedMissingPreview: [],
      abandonedProcessing: [],
      orphanPreviewNote: 'List Storage in Studio to find orphan objects; not enumerated here.',
    }
    for (const m of rows || []) {
      if (['created', 'processing'].includes(m.upload_status)) report.abandonedProcessing.push(m.id)
      if (m.upload_status === 'uploaded' && m.google_original_file_id) {
        const v = await fetch(`${API}/gdrive-verify-file?fileId=${encodeURIComponent(m.google_original_file_id)}`)
        if (!v.ok) report.missingDriveOriginal.push(m.id)
      }
      const path =
        m.media_kind === 'video' ? m.video_poster_object_key || m.preview_object_key : m.preview_object_key
      if (m.upload_status === 'uploaded' && path) {
        const signed = await fetch(
          `${URL}/storage/v1/object/sign/${BUCKET}/${path}`,
          { method: 'POST', headers, body: JSON.stringify({ expiresIn: 10 }) },
        )
        if (!signed.ok) report.missingPreviewObject.push(m.id)
      }
      if (m.moderation_status === 'approved' && m.upload_status === 'uploaded' && !path) {
        report.approvedMissingPreview.push(m.id)
      }
    }
    console.log(JSON.stringify(report, null, 2))
    if (apply) {
      for (const id of report.missingDriveOriginal) {
        await rest(`media?id=eq.${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'failed',
            upload_status: 'failed',
            updated_at: new Date().toISOString(),
          }),
        })
      }
      console.log('apply: marked missingDriveOriginal as failed')
    } else {
      console.log('report-only')
    }
  },
}

const fn = commands[cmd] || commands.help
fn().catch((err) => {
  console.error(err)
  process.exit(1)
})
