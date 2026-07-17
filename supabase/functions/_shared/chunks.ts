/** Chunk sizing for Google Drive resumable uploads (256 KiB alignment). */

export const CHUNK_ALIGNMENT = 256 * 1024
export const DEFAULT_CHUNK_BYTES = 1024 * 1024 // 1 MiB

export function isAlignedChunk(byteCount: number): boolean {
  return byteCount > 0 && byteCount % CHUNK_ALIGNMENT === 0
}

/** Non-final chunk must be a multiple of 256 KiB; final may be any remaining size. */
export function validateChunkLength(
  chunkBytes: number,
  isFinal: boolean,
  remainingBytes: number,
): { ok: true } | { ok: false; code: string } {
  if (!Number.isFinite(chunkBytes) || chunkBytes <= 0) {
    return { ok: false, code: 'invalid_chunk_size' }
  }
  if (isFinal) {
    return chunkBytes === remainingBytes ? { ok: true } : { ok: false, code: 'final_chunk_mismatch' }
  }
  if (chunkBytes > remainingBytes) return { ok: false, code: 'chunk_exceeds_remaining' }
  if (!isAlignedChunk(chunkBytes)) return { ok: false, code: 'chunk_not_256kib_aligned' }
  return { ok: true }
}

/** Parse Drive resumable Range header `bytes=0-N` → next offset N+1. */
export function nextOffsetFromRange(rangeHeader: string | null | undefined): number | null {
  if (!rangeHeader) return 0
  const m = /bytes=(\d+)-(\d+)/i.exec(rangeHeader.trim())
  if (!m) return null
  return Number(m[2]) + 1
}

export function contentRangeHeader(start: number, endInclusive: number, total: number): string {
  return `bytes ${start}-${endInclusive}/${total}`
}
