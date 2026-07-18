/** MIME / extension / size validation before Drive session creation. */

import { isIsoBmffContainer } from './iso_bmff.ts'

const IMAGE_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** Primary MIME per extension; MOV also accepts video/mp4 from some browsers. */
const VIDEO_COMPATIBLE_MIMES: Record<string, ReadonlySet<string>> = {
  mp4: new Set(['video/mp4']),
  mov: new Set(['video/quicktime', 'video/mp4']),
}

export type UploadMetaInput = {
  mimeType: string
  filename: string
  byteSize: number
  mediaKind: 'image' | 'video'
  maxImageBytes: number
  maxVideoBytes: number
  /** Optional client-reported duration (seconds). */
  durationSeconds?: number | null
  maxVideoDurationSeconds?: number | null
  /** First bytes of the file for container verification (videos). */
  headerBytes?: Uint8Array | null
  /** Guests must never supply this — reject if present. */
  parentFolderId?: string | null
  parents?: unknown
}

export type ValidationOk = { ok: true; ext: string; mimeType: string }
export type ValidationFail = { ok: false; code: string; message: string }

export function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? ''
  const i = base.lastIndexOf('.')
  if (i < 0) return ''
  return base.slice(i + 1).toLowerCase()
}

/** Resolve Drive/content MIME for a validated video extension + browser type. */
export function resolveVideoMimeType(ext: string, browserMime: string): string {
  const mime = (browserMime || '').toLowerCase().trim()
  if (ext === 'mov') {
    if (mime === 'video/quicktime' || mime === 'video/mp4') return mime
    return 'video/quicktime'
  }
  if (ext === 'mp4') return 'video/mp4'
  return mime || 'application/octet-stream'
}

export function validateUploadMeta(input: UploadMetaInput): ValidationOk | ValidationFail {
  if (input.parentFolderId != null && String(input.parentFolderId).length > 0) {
    return {
      ok: false,
      code: 'parent_folder_forbidden',
      message: 'Clients cannot choose the Google Drive parent folder.',
    }
  }
  if (input.parents != null) {
    return {
      ok: false,
      code: 'parent_folder_forbidden',
      message: 'Clients cannot choose the Google Drive parent folder.',
    }
  }

  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    return { ok: false, code: 'invalid_size', message: 'Zero-byte or invalid file size.' }
  }

  const ext = extensionOf(input.filename)
  const mime = (input.mimeType || '').toLowerCase().trim()

  if (input.mediaKind === 'video') {
    const allowed = VIDEO_COMPATIBLE_MIMES[ext]
    if (!allowed) {
      return {
        ok: false,
        code: 'disallowed_extension',
        message: 'This video format is not supported.',
      }
    }
    // Empty MIME from some pickers: allow when extension is a known video type.
    if (mime !== '' && !allowed.has(mime)) {
      return {
        ok: false,
        code: 'unsupported_mime',
        message: 'This video format is not supported.',
      }
    }
    if (mime === '' && ext !== 'mov' && ext !== 'mp4') {
      return {
        ok: false,
        code: 'unsupported_mime',
        message: 'This video format is not supported.',
      }
    }

    const resolved = resolveVideoMimeType(ext, mime || (ext === 'mov' ? 'video/quicktime' : 'video/mp4'))

    if (input.byteSize > input.maxVideoBytes) {
      return {
        ok: false,
        code: 'exceeds_configured_max',
        message: 'This video is too large.',
      }
    }

    const maxDur = input.maxVideoDurationSeconds
    if (
      maxDur != null &&
      Number.isFinite(maxDur) &&
      maxDur > 0 &&
      input.durationSeconds != null &&
      Number.isFinite(input.durationSeconds) &&
      input.durationSeconds > maxDur
    ) {
      return {
        ok: false,
        code: 'exceeds_duration_max',
        message: 'This video is too long.',
      }
    }

    if (!input.headerBytes || input.headerBytes.byteLength < 12) {
      return {
        ok: false,
        code: 'invalid_video_container',
        message: 'This video format is not supported.',
      }
    }
    if (!isIsoBmffContainer(input.headerBytes)) {
      return {
        ok: false,
        code: 'invalid_video_container',
        message: 'This video format is not supported.',
      }
    }

    return { ok: true, ext, mimeType: resolved }
  }

  const expectedMime = IMAGE_EXT[ext]
  if (!expectedMime) {
    return {
      ok: false,
      code: 'disallowed_extension',
      message: `Extension .${ext || '(none)'} is not allowed.`,
    }
  }

  const allowedMimes = new Set(Object.values(IMAGE_EXT))
  if (!allowedMimes.has(mime)) {
    return { ok: false, code: 'unsupported_mime', message: `MIME type ${mime} is not supported.` }
  }

  if (mime !== expectedMime) {
    return {
      ok: false,
      code: 'mime_extension_mismatch',
      message: 'Declared MIME type does not match file extension.',
    }
  }

  if (input.byteSize > input.maxImageBytes) {
    return {
      ok: false,
      code: 'exceeds_configured_max',
      message: 'File exceeds the configured maximum size.',
    }
  }

  return { ok: true, ext: ext === 'jpeg' ? 'jpg' : ext, mimeType: mime }
}

export function previewObjectPath(eventId: string, mediaId: string, kind: 'image' | 'poster'): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const suffix = kind === 'poster' ? 'poster.jpg' : 'preview.webp'
  return `${eventId}/${mediaId}/${stamp}_${suffix}`
}

export { isIsoBmffContainer } from './iso_bmff.ts'
