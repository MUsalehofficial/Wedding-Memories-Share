/** Pure R2 key helpers (unit-testable without AWS). */

export type ObjectKind = 'original-image' | 'original-video' | 'preview-image' | 'video-poster'

const KIND_PREFIX: Record<ObjectKind, string> = {
  'original-image': 'events/main/originals/images',
  'original-video': 'events/main/originals/videos',
  'preview-image': 'events/main/previews/images',
  'video-poster': 'events/main/previews/video-posters',
}

/** Randomized object key — never use guest filenames. */
export function buildObjectKey(kind: ObjectKind, ext: string, id = crypto.randomUUID()): string {
  const safe = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin'
  return `${KIND_PREFIX[kind]}/${id}.${safe}`
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 180)
}

export function redactObjectKey(key: string): string {
  const parts = key.split('/')
  const file = parts.pop() ?? ''
  const [id, ext] = file.split('.')
  return `${parts.join('/')}/${id.slice(0, 8)}…${ext ? '.' + ext : ''}`
}
