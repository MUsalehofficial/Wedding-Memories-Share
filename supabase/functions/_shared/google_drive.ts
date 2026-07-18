/**
 * Google Drive OAuth + API helpers.
 * Never log access/refresh tokens.
 */

import { parseQuota, type DriveQuota } from './capacity.ts'
import { nextOffsetFromRange } from './chunks.ts'

const AUTH = 'https://oauth2.googleapis.com'
const DRIVE = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

export type GoogleConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string
}

export function googleSecretPresence(): Record<string, boolean> {
  return {
    GOOGLE_CLIENT_ID: Boolean(Deno.env.get('GOOGLE_CLIENT_ID')),
    GOOGLE_CLIENT_SECRET: Boolean(Deno.env.get('GOOGLE_CLIENT_SECRET')),
    GOOGLE_REDIRECT_URI: Boolean(Deno.env.get('GOOGLE_REDIRECT_URI')),
    GOOGLE_SCOPES: Boolean(Deno.env.get('GOOGLE_SCOPES')),
  }
}

export function googleConfig(): GoogleConfig {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const redirectUri = Deno.env.get('GOOGLE_REDIRECT_URI')
  const configured =
    Deno.env.get('GOOGLE_SCOPES') ??
    'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly'
  // about.get requires metadata.readonly (or broader drive); ensure it is always present
  const required = 'https://www.googleapis.com/auth/drive.metadata.readonly'
  const scopes = configured.includes('drive.metadata.readonly') ||
      configured.includes('googleapis.com/auth/drive ') ||
      configured.endsWith('/auth/drive') ||
      configured.includes('/auth/drive.readonly')
    ? configured
    : `${configured} ${required}`.trim()
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth secrets are not configured')
  }
  return { clientId, clientSecret, redirectUri, scopes }
}

export function buildGoogleAuthorizeUrl(state: string): string {
  const cfg = googleConfig()
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', cfg.clientId)
  url.searchParams.set('redirect_uri', cfg.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', cfg.scopes)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)
  return url.toString()
}

export type TokenSet = {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

export async function exchangeGoogleCode(code: string): Promise<TokenSet> {
  const cfg = googleConfig()
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
  })
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`)
  return (await res.json()) as TokenSet
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<TokenSet> {
  const cfg = googleConfig()
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    if (text.includes('invalid_grant')) {
      const err = new Error('invalid_grant')
      err.name = 'GoogleInvalidGrant'
      throw err
    }
    throw new Error(`Google token refresh failed (${res.status})`)
  }
  return (await res.json()) as TokenSet
}

async function driveFetch(accessToken: string, url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)
  return await fetch(url, { ...init, headers })
}

export async function fetchDriveQuota(accessToken: string): Promise<DriveQuota> {
  const res = await driveFetch(
    accessToken,
    `${DRIVE}/about?fields=storageQuota(limit,usage,usageInDrive,usageInDriveTrash),maxUploadSize`,
  )
  if (!res.ok) throw new Error(`about.get failed (${res.status})`)
  return parseQuota(await res.json())
}

export function collisionResistantDriveName(ext: string, kind: 'original' | 'preview' = 'original') {
  const safe = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin'
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `${stamp}_${crypto.randomUUID().slice(0, 8)}_${kind}.${safe}`
}

/** Create empty file metadata then return resumable upload URL for media. */
export async function createResumableUpload(
  accessToken: string,
  opts: {
    name: string
    mimeType: string
    parents?: string[]
    byteSize: number
  },
): Promise<{ uploadUrl: string }> {
  const meta: Record<string, unknown> = {
    name: opts.name,
    mimeType: opts.mimeType,
  }
  if (opts.parents?.length) meta.parents = opts.parents

  const res = await driveFetch(
    accessToken,
    `${UPLOAD}/files?uploadType=resumable`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': opts.mimeType,
        'X-Upload-Content-Length': String(opts.byteSize),
      },
      body: JSON.stringify(meta),
    },
  )
  if (!res.ok) throw new Error(`resumable session failed (${res.status})`)
  const uploadUrl = res.headers.get('Location')
  if (!uploadUrl) throw new Error('resumable session missing Location')
  return { uploadUrl }
}

/** Spike helper: multipart upload entirely server-side (avoids browser CORS unknowns). */
export async function uploadFileMultipart(
  accessToken: string,
  opts: { name: string; mimeType: string; bytes: Uint8Array; parents?: string[] },
): Promise<{ id: string; size: string; mimeType: string }> {
  const meta: Record<string, unknown> = { name: opts.name, mimeType: opts.mimeType }
  if (opts.parents?.length) meta.parents = opts.parents
  const boundary = 'wedding_' + crypto.randomUUID().replace(/-/g, '')
  const encoder = new TextEncoder()
  const metaPart = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
  )
  const mediaHead = encoder.encode(
    `--${boundary}\r\nContent-Type: ${opts.mimeType}\r\n\r\n`,
  )
  const end = encoder.encode(`\r\n--${boundary}--`)
  const body = new Uint8Array(metaPart.length + mediaHead.length + opts.bytes.length + end.length)
  body.set(metaPart, 0)
  body.set(mediaHead, metaPart.length)
  body.set(opts.bytes, metaPart.length + mediaHead.length)
  body.set(end, metaPart.length + mediaHead.length + opts.bytes.length)

  const res = await driveFetch(
    accessToken,
    `${UPLOAD}/files?uploadType=multipart&fields=id,size,mimeType`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  )
  if (!res.ok) throw new Error(`multipart upload failed (${res.status})`)
  return await res.json()
}

export async function getFileMetadata(accessToken: string, fileId: string) {
  const res = await driveFetch(
    accessToken,
    `${DRIVE}/files/${fileId}?fields=id,name,size,mimeType,trashed,md5Checksum,parents,owners(emailAddress)`,
  )
  if (!res.ok) throw new Error(`files.get failed (${res.status})`)
  return await res.json() as {
    id: string
    name: string
    size?: string
    mimeType?: string
    trashed?: boolean
    md5Checksum?: string
    parents?: string[]
    owners?: { emailAddress?: string }[]
  }
}

export async function listFilePermissions(accessToken: string, fileId: string) {
  const res = await driveFetch(
    accessToken,
    `${DRIVE}/files/${fileId}/permissions?fields=permissions(id,type,role,allowFileDiscovery)`,
  )
  if (!res.ok) throw new Error(`permissions.list failed (${res.status})`)
  const data = await res.json() as {
    permissions?: { id: string; type: string; role: string; allowFileDiscovery?: boolean }[]
  }
  return data.permissions ?? []
}

export function assertPrivatePermissions(
  permissions: { type: string; role: string }[],
): { private: true } | { private: false; reason: string } {
  for (const p of permissions) {
    if (p.type === 'anyone' || p.type === 'domain') {
      return { private: false, reason: `shared_${p.type}` }
    }
  }
  return { private: true }
}

export async function deleteDriveFile(accessToken: string, fileId: string) {
  const res = await driveFetch(accessToken, `${DRIVE}/files/${fileId}`, { method: 'DELETE' })
  return { ok: res.ok || res.status === 404, status: res.status }
}

/** Stream Drive media bytes. Forward Range; never buffer the body. */
export async function downloadDriveFile(
  accessToken: string,
  fileId: string,
  opts: { range?: string | null; signal?: AbortSignal } = {},
): Promise<Response> {
  const headers = new Headers()
  if (opts.range) headers.set('Range', opts.range)
  return await driveFetch(accessToken, `${DRIVE}/files/${fileId}?alt=media`, {
    headers,
    signal: opts.signal,
  })
}

/** Query resumable upload progress. Returns next byte offset (0 if empty). */
export async function queryResumableOffset(
  uploadUrl: string,
  totalBytes: number,
): Promise<{ status: number; range: string | null; nextOffset: number; fileId: string | null }> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': '0',
      'Content-Range': `bytes */${totalBytes}`,
    },
  })
  const range = res.headers.get('Range')
  if (res.status === 200 || res.status === 201) {
    // ponytail: browser may be blocked from reading this 200 (missing ACAO); Edge must parse id
    let fileId: string | null = null
    try {
      const meta = (await res.json()) as { id?: string }
      fileId = meta.id ?? null
    } catch {
      fileId = null
    }
    return { status: res.status, range, nextOffset: totalBytes, fileId }
  }
  // 308 Resume Incomplete — partial or empty
  return {
    status: res.status,
    range,
    nextOffset: nextOffsetFromRange(range) ?? 0,
    fileId: null,
  }
}

export async function ensureFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const q = [
    `name='${name.replace(/'/g, "\\'")}'`,
    `mimeType='application/vnd.google-apps.folder'`,
    'trashed=false',
    parentId ? `'${parentId}' in parents` : `'root' in parents`,
  ].join(' and ')
  const search = await driveFetch(
    accessToken,
    `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
  )
  if (!search.ok) throw new Error(`folder search failed (${search.status})`)
  const data = await search.json() as { files?: { id: string }[] }
  if (data.files?.[0]?.id) return data.files[0].id

  const created = await driveFetch(accessToken, `${DRIVE}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    }),
  })
  if (!created.ok) throw new Error(`folder create failed (${created.status})`)
  const folder = await created.json() as { id: string }
  return folder.id
}

export type WeddingFolderIds = {
  rootFolderId: string
  originalsFolderId: string
  originalsImagesFolderId: string
  originalsVideosFolderId: string
  exportsFolderId: string
}

/** Bootstrap once; callers must persist IDs and reuse them (no per-upload name search). */
export async function ensureWeddingFolderTree(accessToken: string): Promise<WeddingFolderIds> {
  const rootFolderId = await ensureFolder(accessToken, 'Wedding Memories')
  const originalsFolderId = await ensureFolder(accessToken, 'Originals', rootFolderId)
  const originalsImagesFolderId = await ensureFolder(accessToken, 'Images', originalsFolderId)
  const originalsVideosFolderId = await ensureFolder(accessToken, 'Videos', originalsFolderId)
  const exportsFolderId = await ensureFolder(accessToken, 'Exports', rootFolderId)
  return {
    rootFolderId,
    originalsFolderId,
    originalsImagesFolderId,
    originalsVideosFolderId,
    exportsFolderId,
  }
}

export function redactId(id: string): string {
  if (id.length <= 12) return '…'
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}

export function redactUploadUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname.slice(0, 24)}…`
  } catch {
    return '[redacted-upload-url]'
  }
}
