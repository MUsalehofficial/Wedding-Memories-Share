/**
 * Cloudflare R2 via S3-compatible API (presigned PUT/GET + server Head/Delete).
 * Never log access keys or full signed URLs.
 */

import { AwsClient } from 'npm:aws4fetch@1.0.20'
import { buildObjectKey, sanitizeFilename, type ObjectKind } from './r2_keys.ts'

export { buildObjectKey, sanitizeFilename, type ObjectKind }

const PUT_EXPIRY_SECONDS = 300
const GET_EXPIRY_SECONDS = 300

export type R2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  endpoint: string
}

export function r2SecretPresence(): Record<string, boolean> {
  return {
    R2_ACCOUNT_ID: Boolean(Deno.env.get('R2_ACCOUNT_ID')),
    R2_ACCESS_KEY_ID: Boolean(Deno.env.get('R2_ACCESS_KEY_ID')),
    R2_SECRET_ACCESS_KEY: Boolean(Deno.env.get('R2_SECRET_ACCESS_KEY')),
    R2_BUCKET_NAME: Boolean(Deno.env.get('R2_BUCKET_NAME')),
    R2_S3_ENDPOINT: Boolean(Deno.env.get('R2_S3_ENDPOINT')),
  }
}

export function r2Config(): R2Config {
  const accountId = Deno.env.get('R2_ACCOUNT_ID')
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')
  const bucket = Deno.env.get('R2_BUCKET_NAME') ?? 'wedding-memories'
  const endpoint = Deno.env.get('R2_S3_ENDPOINT')
  if (!accountId || !accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error('R2 secrets are not configured')
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint: endpoint.replace(/\/$/, '') }
}

function client(cfg: R2Config): AwsClient {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    region: 'auto',
  })
}

function objectUrl(cfg: R2Config, key: string): URL {
  // Path-style: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
  return new URL(`${cfg.endpoint}/${cfg.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`)
}

export async function presignPut(
  key: string,
  contentType: string,
  expiresIn = PUT_EXPIRY_SECONDS,
): Promise<{ url: string; expiresIn: number }> {
  const cfg = r2Config()
  const aws = client(cfg)
  const url = objectUrl(cfg, key)
  url.searchParams.set('X-Amz-Expires', String(expiresIn))
  const signed = await aws.sign(
    new Request(url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
    }),
    { aws: { signQuery: true } },
  )
  return { url: signed.url, expiresIn }
}

export async function presignGet(
  key: string,
  expiresIn = GET_EXPIRY_SECONDS,
): Promise<{ url: string; expiresIn: number }> {
  const cfg = r2Config()
  const aws = client(cfg)
  const url = objectUrl(cfg, key)
  url.searchParams.set('X-Amz-Expires', String(expiresIn))
  const signed = await aws.sign(new Request(url, { method: 'GET' }), {
    aws: { signQuery: true },
  })
  return { url: signed.url, expiresIn }
}

export type HeadResult = {
  ok: boolean
  status: number
  contentLength: number | null
  contentType: string | null
  etag: string | null
}

export async function headObject(key: string): Promise<HeadResult> {
  const cfg = r2Config()
  const aws = client(cfg)
  const signed = await aws.sign(new Request(objectUrl(cfg, key), { method: 'HEAD' }))
  const res = await fetch(signed)
  const len = res.headers.get('content-length')
  return {
    ok: res.ok,
    status: res.status,
    contentLength: len ? Number(len) : null,
    contentType: res.headers.get('content-type'),
    etag: res.headers.get('etag'),
  }
}

export async function deleteObject(key: string): Promise<{ ok: boolean; status: number }> {
  const cfg = r2Config()
  const aws = client(cfg)
  const signed = await aws.sign(new Request(objectUrl(cfg, key), { method: 'DELETE' }))
  const res = await fetch(signed)
  // S3/R2: 204 success; 404 already gone is fine for cleanup
  return { ok: res.ok || res.status === 404, status: res.status }
}

export { PUT_EXPIRY_SECONDS, GET_EXPIRY_SECONDS }
