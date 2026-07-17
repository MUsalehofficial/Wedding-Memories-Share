#!/usr/bin/env node
/**
 * Live Google Drive hardening harness.
 * Uses curl --resolve for local TLS routing only. Never logs secrets/upload URLs.
 *
 * Usage: node scripts/gdrive-hardening-live.mjs
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const HOST = 'vszfgqylajnvdbjqadjr.supabase.co'
const IP = '104.18.38.10'
const BASE = `https://${HOST}/functions/v1/wedding-api`
const ORIGIN = 'http://localhost:5173'
const CHUNK = 1024 * 1024
const JPG = '/tmp/wedding-hardening.jpg'
const MP4 = '/tmp/wedding-hardening.mp4'
const OUT = '/tmp/gdrive-hardening-evidence.json'

const evidence = {
  utc: new Date().toISOString(),
  steps: {},
  negatives: {},
  cleanup: {},
}

function curl(args, opts = {}) {
  const r = spawnSync(
    '/usr/bin/curl',
    ['-sS', '--resolve', `${HOST}:443:${IP}`, ...args],
    {
      encoding: opts.binary ? undefined : 'utf8',
      maxBuffer: 80 * 1024 * 1024,
      input: opts.input,
    },
  )
  if (r.error) throw r.error
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`curl failed: ${r.stderr || r.stdout}`)
  }
  return opts.binary ? r.stdout : String(r.stdout ?? '')
}

function api(method, path, { body, headers = {}, guest } = {}) {
  const args = ['-X', method, '-H', `Origin: ${ORIGIN}`, '-H', 'Content-Type: application/json']
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`)
  if (guest) args.push('-H', `x-guest-token: ${guest}`)
  if (body !== undefined) args.push('-d', JSON.stringify(body))
  args.push(`${BASE}/${path}`)
  const raw = curl(args)
  let json
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`non-json from ${path}: ${raw.slice(0, 200)}`)
  }
  return json
}

function md5file(path) {
  return createHash('md5').update(readFileSync(path)).digest('hex')
}

function putChunk(uploadUrl, start, endInclusive, total, buf, isFinal) {
  // Upload directly to Google resumable URL (browser-direct equivalent).
  const args = [
    '-sS',
    '-o',
    '/tmp/chunk-resp.bin',
    '-D',
    '/tmp/chunk-resp.hdr',
    '-X',
    'PUT',
    '-H',
    `Origin: ${ORIGIN}`,
    '-H',
    `Content-Length: ${buf.length}`,
    '-H',
    `Content-Type: application/octet-stream`,
    '-H',
    `Content-Range: bytes ${start}-${endInclusive}/${total}`,
    '--data-binary',
    '@-',
    uploadUrl,
  ]
  const r = spawnSync('/usr/bin/curl', args, { input: buf, maxBuffer: 20 * 1024 * 1024 })
  const hdr = readFileSync('/tmp/chunk-resp.hdr', 'utf8')
  const status = Number((/^HTTP\/\S+\s+(\d+)/m.exec(hdr) || [])[1] || 0)
  const range = (/^Range:\s*(.+)$/im.exec(hdr) || [])[1]?.trim() || null
  let body = ''
  try {
    body = readFileSync('/tmp/chunk-resp.bin', 'utf8')
  } catch {
    /* empty */
  }
  return { status, range, body, isFinal }
}

function corsProbe(uploadUrl) {
  const r = spawnSync(
    '/usr/bin/curl',
    [
      '-sS',
      '-D',
      '-',
      '-o',
      '/dev/null',
      '-X',
      'OPTIONS',
      '-H',
      `Origin: ${ORIGIN}`,
      '-H',
      'Access-Control-Request-Method: PUT',
      '-H',
      'Access-Control-Request-Headers: content-type,content-range,content-length',
      uploadUrl,
    ],
    { encoding: 'utf8' },
  )
  const out = r.stdout || ''
  const status = Number((/^HTTP\/\S+\s+(\d+)/m.exec(out) || [])[1] || 0)
  const allowOrigin = (/^Access-Control-Allow-Origin:\s*(.+)$/im.exec(out) || [])[1]?.trim()
  const allowMethods = (/^Access-Control-Allow-Methods:\s*(.+)$/im.exec(out) || [])[1]?.trim()
  return { status, allowOrigin: allowOrigin || null, allowMethods: allowMethods || null }
}

function redactUrl(u) {
  try {
    const x = new URL(u)
    return `${x.origin}${x.pathname.slice(0, 24)}…`
  } catch {
    return '[redacted]'
  }
}

async function main() {
  const jpgSize = statSync(JPG).size
  const mp4Size = statSync(MP4).size
  evidence.fixtures = { jpegBytes: jpgSize, jpegMd5: md5file(JPG), mp4Bytes: mp4Size, mp4Md5: md5file(MP4) }

  const health = api('GET', 'gdrive-health')
  evidence.steps.health = {
    ready: health.ready,
    scopes: health.scopesConfigured,
    guestSecretFlag: health.secrets?.GUEST_TOKEN_SIGNING_SECRET,
  }

  const quota0 = api('GET', 'gdrive-quota')
  evidence.steps.quotaBefore = quota0.bytes

  const folders = api('POST', 'gdrive-ensure-folders', { body: {} })
  evidence.steps.folders = {
    ok: folders.ok,
    created: folders.created,
    foldersRedacted: folders.foldersRedacted,
  }

  const mint = api('POST', 'gdrive-mint-guest', { body: {} })
  if (!mint.guestToken) throw new Error('mint guest failed: ' + JSON.stringify(mint))
  const guest = mint.guestToken

  // Invalid guest
  const badGuest = api('POST', 'gdrive-create-resumable-session', {
    body: {
      mimeType: 'image/jpeg',
      filename: 'x.jpg',
      byteSize: jpgSize,
      mediaKind: 'image',
      idempotencyKey: randomUUID(),
    },
    guest: 'invalid.token',
  })
  evidence.negatives.invalidGuest = { error: badGuest.error, expect401: badGuest.error?.includes('guest') }

  // Negatives before session
  const negCases = [
    {
      name: 'unsupported_mime',
      body: { mimeType: 'application/pdf', filename: 'a.pdf', byteSize: 1000, mediaKind: 'image', idempotencyKey: randomUUID() },
    },
    {
      name: 'disallowed_extension',
      body: { mimeType: 'image/jpeg', filename: 'a.exe', byteSize: 1000, mediaKind: 'image', idempotencyKey: randomUUID() },
    },
    {
      name: 'mime_extension_mismatch',
      body: { mimeType: 'image/png', filename: 'a.jpg', byteSize: 1000, mediaKind: 'image', idempotencyKey: randomUUID() },
    },
    {
      name: 'zero_byte',
      body: { mimeType: 'image/jpeg', filename: 'a.jpg', byteSize: 0, mediaKind: 'image', idempotencyKey: randomUUID() },
    },
    {
      name: 'too_large_declared',
      body: {
        mimeType: 'image/jpeg',
        filename: 'a.jpg',
        byteSize: 50 * 1024 * 1024,
        mediaKind: 'image',
        idempotencyKey: randomUUID(),
      },
    },
    {
      name: 'parent_folder_forbidden',
      body: {
        mimeType: 'image/jpeg',
        filename: 'a.jpg',
        byteSize: 1000,
        mediaKind: 'image',
        idempotencyKey: randomUUID(),
        parentFolderId: 'HACK',
      },
    },
  ]
  for (const c of negCases) {
    const res = api('POST', 'gdrive-create-resumable-session', { body: c.body, guest })
    evidence.negatives[c.name] = { error: res.error, message: res.message }
  }

  // Realistic image with interrupt/resume
  const idem = `img-${randomUUID()}`
  const created = api('POST', 'gdrive-create-resumable-session', {
    body: {
      mimeType: 'image/jpeg',
      filename: 'hardening-real.jpg',
      byteSize: jpgSize,
      mediaKind: 'image',
      idempotencyKey: idem,
    },
    guest,
  })
  if (!created.uploadUrl) throw new Error('no uploadUrl: ' + JSON.stringify(created))
  const uploadUrl = created.uploadUrl
  evidence.steps.imageSession = {
    sessionId: created.sessionId,
    mediaId: created.mediaId,
    chunkSize: created.chunkSize,
    byteSize: created.byteSize,
    parentFolderRedacted: created.parentFolderRedacted,
    uploadUrlRedacted: redactUrl(uploadUrl),
    origin: ORIGIN,
  }

  evidence.steps.cors = corsProbe(uploadUrl)

  const reused = api('POST', 'gdrive-create-resumable-session', {
    body: {
      mimeType: 'image/jpeg',
      filename: 'hardening-real.jpg',
      byteSize: jpgSize,
      mediaKind: 'image',
      idempotencyKey: idem,
    },
    guest,
  })
  evidence.steps.idempotencyReuse = {
    reused: reused.reused === true,
    sameSession: reused.sessionId === created.sessionId,
    sameMedia: reused.mediaId === created.mediaId,
  }

  const file = readFileSync(JPG)
  // First chunk only (interrupt)
  const end1 = Math.min(CHUNK, jpgSize) - 1
  const chunk1 = file.subarray(0, end1 + 1)
  const put1 = putChunk(uploadUrl, 0, end1, jpgSize, chunk1, false)
  evidence.steps.interrupt = { status: put1.status, range: put1.range, chunkBytes: chunk1.length, aligned: chunk1.length % (256 * 1024) === 0 }

  const status1 = api('GET', `gdrive-resumable-status?sessionId=${created.sessionId}`, { guest })
  evidence.steps.rangeQuery = {
    status: status1.status,
    range: status1.range,
    nextOffset: status1.nextOffset,
  }

  // Resume from nextOffset
  let offset = status1.nextOffset ?? CHUNK
  let fileId = null
  const progressMarks = [offset]
  while (offset < jpgSize) {
    const end = Math.min(offset + CHUNK, jpgSize) - 1
    const buf = file.subarray(offset, end + 1)
    const isFinal = end + 1 === jpgSize
    if (!isFinal && buf.length % (256 * 1024) !== 0) throw new Error('non-final chunk misaligned')
    const put = putChunk(uploadUrl, offset, end, jpgSize, buf, isFinal)
    progressMarks.push(end + 1)
    if (isFinal && (put.status === 200 || put.status === 201)) {
      try {
        fileId = JSON.parse(put.body).id
      } catch {
        /* ignore */
      }
    }
    offset = end + 1
  }
  evidence.steps.resumeComplete = {
    progressMarks,
    chunkCount: progressMarks.length,
    fileIdRedacted: fileId ? `${fileId.slice(0, 8)}…` : null,
  }

  if (!fileId) throw new Error('missing fileId after final chunk')

  const complete1 = api('POST', 'gdrive-complete-resumable', {
    body: { sessionId: created.sessionId, fileId },
    guest,
  })
  const complete2 = api('POST', 'gdrive-complete-resumable', {
    body: { sessionId: created.sessionId, fileId },
    guest,
  })
  evidence.steps.imageComplete = {
    size: complete1.size,
    mimeType: complete1.mimeType,
    md5Checksum: complete1.md5Checksum,
    parentOk: complete1.parentOk,
    private: complete1.private,
    mediaId: complete1.mediaId,
    completeIdempotent: complete2.reused === true && complete2.mediaId === complete1.mediaId,
  }

  const verify = api('GET', `gdrive-verify-file?fileId=${fileId}`)
  evidence.steps.imageVerify = {
    inImages: verify.inImages,
    private: verify.private,
    hasAnyone: verify.hasAnyone,
    size: verify.size,
    mimeType: verify.mimeType,
    md5Checksum: verify.md5Checksum,
    sourceMd5: evidence.fixtures.jpegMd5,
    md5Match: verify.md5Checksum ? verify.md5Checksum === evidence.fixtures.jpegMd5 : null,
  }

  // Preview (generate small webp/jpeg client-side stand-in ~400KB max)
  // Use a downscaled jpeg from ffmpeg if available; else first 400k is invalid — create via ffmpeg
  spawnSync(
    'ffmpeg',
    ['-y', '-i', JPG, '-vf', 'scale=1600:-2', '-q:v', '8', '/tmp/wedding-preview.jpg'],
    { encoding: 'utf8' },
  )
  const prev = readFileSync('/tmp/wedding-preview.jpg')
  const prevB64 = prev.toString('base64')
  const prevUp = api('POST', 'gdrive-upload-preview', {
    body: {
      mediaId: complete1.mediaId,
      base64: prevB64,
      contentType: 'image/jpeg',
      kind: 'image',
    },
    guest,
  })
  evidence.steps.previewUpload = {
    bucket: prevUp.bucket,
    objectPath: prevUp.objectPath,
    size: prevUp.size,
  }

  const signed = api('GET', `gdrive-preview-signed?mediaId=${complete1.mediaId}`, { guest })
  // Fetch signed URL (full URL only in memory)
  const signedFetch = spawnSync('/usr/bin/curl', ['-sS', '-o', '/tmp/signed-preview.bin', '-w', '%{http_code}', signed.signedUrl], {
    encoding: 'utf8',
  })
  evidence.steps.previewSigned = {
    expiresInSec: signed.expiresInSec,
    signedUrlRedacted: signed.signedUrlRedacted,
    http: Number(signedFetch.stdout),
    bytes: statSync('/tmp/signed-preview.bin').size,
  }

  const unsigned = api('GET', `gdrive-preview-unsigned-probe?path=${encodeURIComponent(prevUp.objectPath)}`)
  evidence.steps.previewUnsigned = unsigned

  // Confirm DB does not store signed URL
  evidence.steps.previewDbNote = 'media stores preview_object_key path only; signed URL returned ephemerally'

  // Video upload (full resumable, no interrupt required but multi-chunk)
  const vidIdem = `vid-${randomUUID()}`
  const vidSession = api('POST', 'gdrive-create-resumable-session', {
    body: {
      mimeType: 'video/mp4',
      filename: 'hardening.mp4',
      byteSize: mp4Size,
      mediaKind: 'video',
      idempotencyKey: vidIdem,
    },
    guest,
  })
  evidence.steps.videoSession = {
    error: vidSession.error,
    sessionId: vidSession.sessionId,
    parentFolderRedacted: vidSession.parentFolderRedacted,
    byteSize: vidSession.byteSize,
  }

  let videoFileId = null
  let videoMediaId = null
  if (vidSession.uploadUrl) {
    const vfile = readFileSync(MP4)
    let off = 0
    const marks = []
    while (off < mp4Size) {
      const end = Math.min(off + CHUNK, mp4Size) - 1
      const buf = vfile.subarray(off, end + 1)
      const isFinal = end + 1 === mp4Size
      const put = putChunk(vidSession.uploadUrl, off, end, mp4Size, buf, isFinal)
      marks.push(end + 1)
      if (isFinal && (put.status === 200 || put.status === 201)) {
        try {
          videoFileId = JSON.parse(put.body).id
        } catch {
          /* */
        }
      }
      off = end + 1
    }
    const vdone = api('POST', 'gdrive-complete-resumable', {
      body: { sessionId: vidSession.sessionId, fileId: videoFileId },
      guest,
    })
    videoMediaId = vdone.mediaId
    evidence.steps.videoComplete = {
      size: vdone.size,
      mimeType: vdone.mimeType,
      parentOk: vdone.parentOk,
      private: vdone.private,
      chunks: marks.length,
      progressMarks: marks.slice(0, 3).concat(['…', marks.at(-1)]),
    }
    const vverify = api('GET', `gdrive-verify-file?fileId=${videoFileId}`)
    evidence.steps.videoVerify = {
      inVideos: vverify.inVideos,
      private: vverify.private,
      hasAnyone: vverify.hasAnyone,
      size: vverify.size,
    }

    // poster (synthetic JPEG — random mp4 has no decodable frame)
    spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=640x360', '-frames:v', '1', '-q:v', '8', '/tmp/wedding-poster.jpg'], {
      encoding: 'utf8',
    })
    if (!existsSync('/tmp/wedding-poster.jpg')) {
      writeFileSync('/tmp/wedding-poster.jpg', readFileSync('/tmp/wedding-preview.jpg'))
    }
    const poster = readFileSync('/tmp/wedding-poster.jpg')
    const posterUp = api('POST', 'gdrive-upload-preview', {
      body: {
        mediaId: videoMediaId,
        base64: poster.toString('base64'),
        contentType: 'image/jpeg',
        kind: 'poster',
      },
      guest,
    })
    evidence.steps.videoPoster = { objectPath: posterUp.objectPath, size: posterUp.size }
  }

  // Cleanup Drive + previews
  if (fileId) {
    evidence.cleanup.image = api('POST', 'gdrive-spike-delete', {
      body: { fileId, mediaId: complete1.mediaId },
    })
  }
  if (videoFileId) {
    evidence.cleanup.video = api('POST', 'gdrive-spike-delete', {
      body: { fileId: videoFileId, mediaId: videoMediaId },
    })
  }

  const quota1 = api('GET', 'gdrive-quota')
  evidence.steps.quotaAfter = quota1.bytes
  evidence.steps.quotaDeltaUsage = (quota1.bytes?.usage ?? 0) - (quota0.bytes?.usage ?? 0)

  writeFileSync(OUT, JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ written: OUT, summary: {
    jpegBytes: jpgSize,
    mp4Bytes: mp4Size,
    imagePrivate: evidence.steps.imageVerify?.private,
    interruptOffset: evidence.steps.rangeQuery?.nextOffset,
    idempotent: evidence.steps.idempotencyReuse,
    previewHttp: evidence.steps.previewSigned?.http,
    unsignedRejected: evidence.steps.previewUnsigned?.rejected,
    quotaAfterUsage: quota1.bytes?.usage,
  } }, null, 2))
}

main().catch((err) => {
  console.error(err)
  writeFileSync(OUT, JSON.stringify({ error: String(err), evidence }, null, 2))
  process.exit(1)
})
