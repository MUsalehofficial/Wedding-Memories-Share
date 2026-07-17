const CHUNK = 1024 * 1024

export type ChunkProgress = { uploaded: number; total: number }

/** Direct browser PUT to Google resumable upload URL (1 MiB chunks). Supports resumeFrom. */
export async function putResumableFile(
  uploadUrl: string,
  file: File,
  onProgress?: (p: ChunkProgress) => void,
  resumeFrom = 0,
): Promise<{ fileId: string }> {
  let offset = resumeFrom
  let fileId: string | null = null
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK, file.size) - 1
    const chunk = file.slice(offset, end + 1)
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunk.size),
        'Content-Type': file.type || 'application/octet-stream',
        'Content-Range': `bytes ${offset}-${end}/${file.size}`,
      },
      body: chunk,
    })
    if (res.status === 308) {
      offset = end + 1
      onProgress?.({ uploaded: offset, total: file.size })
      continue
    }
    if (res.status === 200 || res.status === 201) {
      const meta = (await res.json()) as { id?: string }
      if (!meta.id) throw new Error('upload_missing_file_id')
      fileId = meta.id
      onProgress?.({ uploaded: file.size, total: file.size })
      break
    }
    throw new Error(`upload_chunk_failed_${res.status}`)
  }
  if (!fileId) throw new Error('upload_incomplete')
  return { fileId }
}

/** Query Google resumable session for next offset (empty PUT). */
export async function queryResumableOffset(uploadUrl: string, total: number): Promise<number> {
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
}
