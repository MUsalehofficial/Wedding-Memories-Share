/** Browser-side image preview — JPEG only; Safari-safe fallbacks. */

const MAX_EDGE = 1600
const JPEG_QUALITY = 0.72
/** If canvas encoding fails, originals under this size may be sent as the preview. */
const RAW_PREVIEW_MAX_BYTES = 1_500_000

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Prefer toBlob; fall back to dataURL→Blob when Safari returns null.
    canvas.toBlob(
      (b) => {
        if (b && b.size > 0) {
          resolve(b)
          return
        }
        try {
          const dataUrl = canvas.toDataURL('image/jpeg', quality)
          const i = dataUrl.indexOf(',')
          const bin = atob(i >= 0 ? dataUrl.slice(i + 1) : '')
          const bytes = new Uint8Array(bin.length)
          for (let n = 0; n < bin.length; n++) bytes[n] = bin.charCodeAt(n)
          if (!bytes.length) {
            reject(new Error('preview_encode_failed'))
            return
          }
          resolve(new Blob([bytes], { type: 'image/jpeg' }))
        } catch (err) {
          reject(err instanceof Error ? err : new Error('preview_encode_failed'))
        }
      },
      'image/jpeg',
      quality,
    )
  })
}

function drawToCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const max = MAX_EDGE
  const scale = Math.min(1, max / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas_unavailable')
  ctx.drawImage(source, 0, 0, w, h)
  return canvas
}

async function bitmapPreview(file: File): Promise<{ blob: Blob; contentType: string }> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = drawToCanvas(bitmap, bitmap.width, bitmap.height)
    const blob = await canvasToJpegBlob(canvas, JPEG_QUALITY)
    return { blob, contentType: 'image/jpeg' }
  } finally {
    bitmap.close()
  }
}

async function imageElementPreview(file: File): Promise<{ blob: Blob; contentType: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image_element_load_failed'))
      el.decoding = 'async'
      el.src = url
    })
    const canvas = drawToCanvas(img, img.naturalWidth || img.width, img.naturalHeight || img.height)
    const blob = await canvasToJpegBlob(canvas, JPEG_QUALITY)
    return { blob, contentType: 'image/jpeg' }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Safari-friendly preview: bitmap → <img> → raw JPEG under size cap. Never WebP. */
export async function makeImagePreview(file: File): Promise<{ blob: Blob; contentType: string }> {
  try {
    return await bitmapPreview(file)
  } catch (err) {
    console.info('[wedding-upload]', 'preview_bitmap_failed', {
      message: err instanceof Error ? err.message : String(err),
    })
  }
  try {
    return await imageElementPreview(file)
  } catch (err) {
    console.info('[wedding-upload]', 'preview_img_failed', {
      message: err instanceof Error ? err.message : String(err),
    })
  }
  // Last resort: use the original bytes if small enough (still image/jpeg).
  if (file.type.startsWith('image/') && file.size > 0 && file.size <= RAW_PREVIEW_MAX_BYTES) {
    return { blob: file.slice(0, file.size, 'image/jpeg'), contentType: 'image/jpeg' }
  }
  throw new Error('preview_generation_failed')
}

export async function makeVideoPoster(file: File): Promise<{ blob: Blob; contentType: string } | null> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  try {
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = url
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('video_load_failed'))
    })
    video.currentTime = Math.min(0.1, (video.duration || 1) / 10)
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve()
    })
    const canvas = drawToCanvas(video, video.videoWidth || 640, video.videoHeight || 360)
    try {
      const blob = await canvasToJpegBlob(canvas, 0.75)
      canvas.width = 0
      canvas.height = 0
      return { blob, contentType: 'image/jpeg' }
    } catch {
      return null
    }
  } catch {
    return null
  } finally {
    video.removeAttribute('src')
    video.load()
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
    reader.onerror = () => reject(reader.error ?? new Error('filereader_failed'))
    reader.readAsDataURL(blob)
  })
}
