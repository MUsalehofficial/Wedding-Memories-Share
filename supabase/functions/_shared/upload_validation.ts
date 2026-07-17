/** MIME / extension / size validation before Drive session creation. */

const IMAGE_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const VIDEO_EXT: Record<string, string> = {
  mp4: 'video/mp4',
}

export type UploadMetaInput = {
  mimeType: string
  filename: string
  byteSize: number
  mediaKind: 'image' | 'video'
  maxImageBytes: number
  maxVideoBytes: number
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
  const allowedMap = input.mediaKind === 'video' ? VIDEO_EXT : IMAGE_EXT
  const expectedMime = allowedMap[ext]
  if (!expectedMime) {
    return {
      ok: false,
      code: 'disallowed_extension',
      message: `Extension .${ext || '(none)'} is not allowed.`,
    }
  }

  const mime = (input.mimeType || '').toLowerCase().trim()
  const allowedMimes = new Set(Object.values(allowedMap))
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

  const max = input.mediaKind === 'video' ? input.maxVideoBytes : input.maxImageBytes
  if (input.byteSize > max) {
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
