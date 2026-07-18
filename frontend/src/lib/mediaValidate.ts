/** Client-side media gate before starting a Drive upload session. */

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp'])
const VIDEO_COMPAT: Record<string, ReadonlySet<string>> = {
  mp4: new Set(['video/mp4']),
  mov: new Set(['video/quicktime', 'video/mp4', '']),
}

const ACCEPTABLE_BRANDS = new Set([
  'qt  ',
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'M4A ',
  'dash',
  'msdh',
  'mmp4',
  'mp71',
])

export type PublicUploadLimits = {
  uploadsEnabled: boolean
  videoUploadsEnabled: boolean
  maxImageBytes: number
  maxVideoBytes: number
  maxVideoDurationSeconds: number
  uploadsPausedReason: string | null
}

export function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? ''
  const i = base.lastIndexOf('.')
  if (i < 0) return ''
  return base.slice(i + 1).toLowerCase()
}

export function isVideoFile(file: File): boolean {
  const ext = extensionOf(file.name)
  if (ext === 'mp4' || ext === 'mov') return true
  return file.type.startsWith('video/')
}

export function mediaKindOf(file: File): 'image' | 'video' {
  return isVideoFile(file) ? 'video' : 'image'
}

export function resolveVideoMimeType(ext: string, browserMime: string): string {
  const mime = (browserMime || '').toLowerCase().trim()
  if (ext === 'mov') {
    if (mime === 'video/quicktime' || mime === 'video/mp4') return mime
    return 'video/quicktime'
  }
  if (ext === 'mp4') return 'video/mp4'
  return mime || 'application/octet-stream'
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) >>> 0) +
    ((bytes[offset + 1]! << 16) >>> 0) +
    ((bytes[offset + 2]! << 8) >>> 0) +
    (bytes[offset + 3]! >>> 0)
  )
}

function readFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  )
}

/** Shared with server: ISO BMFF / QuickTime ftyp probe. */
export function isIsoBmffContainer(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false
  const limit = Math.min(bytes.byteLength, 64 * 1024)
  let offset = 0
  while (offset + 8 <= limit) {
    let size = readU32BE(bytes, offset)
    const type = readFourCC(bytes, offset + 4)
    if (size === 1) {
      if (offset + 16 > limit) break
      size = Number(
        (BigInt(readU32BE(bytes, offset + 8)) << 32n) + BigInt(readU32BE(bytes, offset + 12)),
      )
      if (!Number.isFinite(size) || size < 16) break
    } else if (size === 0) {
      break
    }
    if (type === 'ftyp') {
      if (offset + 12 > bytes.byteLength) return false
      const major = readFourCC(bytes, offset + 8)
      if (ACCEPTABLE_BRANDS.has(major)) return true
      const end = Math.min(offset + (size >= 8 ? size : 32), bytes.byteLength)
      for (let i = offset + 16; i + 4 <= end; i += 4) {
        if (ACCEPTABLE_BRANDS.has(readFourCC(bytes, i))) return true
      }
      return false
    }
    if (type === 'free' || type === 'skip' || type === 'wide') {
      if (size < 8) break
      offset += size
      continue
    }
    if (size < 8 || offset + size > limit) break
    offset += size
  }
  return false
}

export async function readFileHeader(file: File, maxBytes = 64 * 1024): Promise<Uint8Array> {
  const slice = file.slice(0, Math.min(maxBytes, Math.max(file.size, 0)))
  return new Uint8Array(await slice.arrayBuffer())
}

export function probeVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    let settled = false
    const done = (value: number | null) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      resolve(value)
    }
    video.onloadedmetadata = () => {
      const d = video.duration
      done(Number.isFinite(d) && d > 0 ? d : null)
    }
    video.onerror = () => done(null)
    window.setTimeout(() => done(null), 8000)
    video.src = url
  })
}

export type GateOk = {
  ok: true
  mediaKind: 'image' | 'video'
  mimeType: string
  ext: string
  durationSeconds: number | null
  headerBase64: string | null
}

export type GateFail = { ok: false; message: string; code: string }

export function userMessageForUploadError(code: string, fallback?: string): string {
  switch (code) {
    case 'disallowed_extension':
    case 'unsupported_mime':
    case 'mime_extension_mismatch':
    case 'invalid_video_container':
      return 'This video format is not supported.'
    case 'exceeds_configured_max':
      return 'This video is too large.'
    case 'exceeds_duration_max':
      return 'This video is too long.'
    case 'video_uploads_disabled':
      return 'Video uploads are currently disabled.'
    default:
      return fallback || code
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s)
}

export async function gateSelectedFile(
  file: File,
  limits: PublicUploadLimits,
): Promise<GateOk | GateFail> {
  if (!limits.uploadsEnabled) {
    return {
      ok: false,
      code: 'uploads_disabled',
      message: limits.uploadsPausedReason || 'Uploads are paused.',
    }
  }

  const mediaKind = mediaKindOf(file)
  if (mediaKind === 'video' && !limits.videoUploadsEnabled) {
    return {
      ok: false,
      code: 'video_uploads_disabled',
      message: 'Video uploads are currently disabled.',
    }
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, code: 'invalid_size', message: 'This file type is not supported.' }
  }

  if (mediaKind === 'image') {
    const ext = extensionOf(file.name)
    if (!IMAGE_EXT.has(ext)) {
      return { ok: false, code: 'disallowed_extension', message: 'This file type is not supported.' }
    }
    if (file.size > limits.maxImageBytes) {
      return { ok: false, code: 'exceeds_configured_max', message: 'This photo is too large.' }
    }
    return {
      ok: true,
      mediaKind,
      mimeType: file.type || 'image/jpeg',
      ext: ext === 'jpeg' ? 'jpg' : ext,
      durationSeconds: null,
      headerBase64: null,
    }
  }

  const ext = extensionOf(file.name)
  const allowed = VIDEO_COMPAT[ext]
  if (!allowed) {
    return {
      ok: false,
      code: 'disallowed_extension',
      message: 'This video format is not supported.',
    }
  }
  const browserMime = (file.type || '').toLowerCase().trim()
  if (!allowed.has(browserMime)) {
    return {
      ok: false,
      code: 'unsupported_mime',
      message: 'This video format is not supported.',
    }
  }
  if (file.size > limits.maxVideoBytes) {
    return { ok: false, code: 'exceeds_configured_max', message: 'This video is too large.' }
  }

  const header = await readFileHeader(file)
  if (!isIsoBmffContainer(header)) {
    return {
      ok: false,
      code: 'invalid_video_container',
      message: 'This video format is not supported.',
    }
  }

  const durationSeconds = await probeVideoDuration(file)
  if (
    durationSeconds != null &&
    limits.maxVideoDurationSeconds > 0 &&
    durationSeconds > limits.maxVideoDurationSeconds
  ) {
    return { ok: false, code: 'exceeds_duration_max', message: 'This video is too long.' }
  }

  const mimeType = resolveVideoMimeType(ext, browserMime)
  return {
    ok: true,
    mediaKind: 'video',
    mimeType,
    ext,
    durationSeconds,
    headerBase64: bytesToBase64(header.slice(0, Math.min(header.byteLength, 64 * 1024))),
  }
}
