/** Browser-side image preview: max edge 1600, JPEG ~quality 0.72, canvas strips EXIF. */

export async function makeImagePreview(file: File): Promise<{ blob: Blob; contentType: string }> {
  const bitmap = await createImageBitmap(file)
  const max = 1600
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas_unavailable')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('preview_encode_failed'))), 'image/jpeg', 0.72)
  })
  return { blob, contentType: 'image/jpeg' }
}

export async function makeVideoPoster(file: File): Promise<{ blob: Blob; contentType: string } | null> {
  const url = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.src = url
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('video_load_failed'))
    })
    video.currentTime = Math.min(0.1, (video.duration || 1) / 10)
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve()
    })
    const max = 1600
    const scale = Math.min(1, max / Math.max(video.videoWidth || 1, video.videoHeight || 1))
    const w = Math.max(1, Math.round((video.videoWidth || 640) * scale))
    const h = Math.max(1, Math.round((video.videoHeight || 360) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.75))
    if (!blob) return null
    return { blob, contentType: 'image/jpeg' }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result || '')
      const i = s.indexOf(',')
      resolve(i >= 0 ? s.slice(i + 1) : s)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
