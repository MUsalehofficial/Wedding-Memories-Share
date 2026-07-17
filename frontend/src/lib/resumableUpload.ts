const CHUNK = 1024 * 1024

export type ChunkProgress = { uploaded: number; total: number }

/**
 * Direct browser PUT to Google resumable upload URL (1 MiB chunks).
 *
 * Google returns ACAO on 308 intermediate responses but often omits ACAO on the
 * final 200/201. The browser then throws after Drive already has the bytes.
 * In that case we return fileId: null and let Edge complete-resumable resolve
 * the id server-side via the upload URL (no duplicate original).
 */
export async function putResumableFile(
  uploadUrl: string,
  file: File,
  onProgress?: (p: ChunkProgress) => void,
  resumeFrom = 0,
): Promise<{ fileId: string | null }> {
  let offset = resumeFrom
  let fileId: string | null = null
  if (offset >= file.size && file.size > 0) {
    // Already fully sent (e.g. prior attempt); Edge must resolve file id.
    onProgress?.({ uploaded: file.size, total: file.size })
    return { fileId: null }
  }
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK, file.size) - 1
    const chunk = file.slice(offset, end + 1)
    const isFinal = end + 1 >= file.size
    let res: Response
    try {
      res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunk.size),
          'Content-Type': file.type || 'application/octet-stream',
          'Content-Range': `bytes ${offset}-${end}/${file.size}`,
        },
        body: chunk,
      })
    } catch (err) {
      // ponytail: final-chunk CORS blind spot — Drive may already have the object
      // Safari often surfaces this as "Load failed"
      const msg = err instanceof Error ? err.message : String(err)
      if (isFinal || /load failed|failed to fetch|networkerror|cors/i.test(msg)) {
        if (isFinal) {
          onProgress?.({ uploaded: file.size, total: file.size })
          return { fileId: null }
        }
      }
      throw new Error(`upload_network_error:${msg}`)
    }
    if (res.status === 308) {
      offset = end + 1
      onProgress?.({ uploaded: offset, total: file.size })
      continue
    }
    if (res.status === 200 || res.status === 201) {
      try {
        const meta = (await res.json()) as { id?: string }
        fileId = meta.id ?? null
      } catch {
        fileId = null
      }
      onProgress?.({ uploaded: file.size, total: file.size })
      return { fileId }
    }
    throw new Error(`upload_chunk_failed_${res.status}`)
  }
  return { fileId }
}

/** Query Google resumable session for next offset (empty PUT). */
export async function queryResumableOffset(uploadUrl: string, total: number): Promise<number> {
  try {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': '0',
        'Content-Range': `bytes */${total}`,
      },
    })
    if (res.status === 200 || res.status === 201) return total
    const range = res.headers.get('Range')
    const m = range ? /bytes=\d+-(\d+)/i.exec(range) : null
    return m ? Number(m[1]) + 1 : 0
  } catch {
    // Final-complete query also lacks ACAO sometimes; treat as unknown → resume 0
    return 0
  }
}
