/** Browser-side image preview — JPEG only; Safari-safe fallbacks. */

const MAX_EDGE = 1600
const JPEG_QUALITY = 0.72
/** If canvas encoding fails, originals under this size may be sent as the preview. */
const RAW_PREVIEW_MAX_BYTES = 1_500_000

const POSTER_METADATA_TIMEOUT_MS = 15_000
const POSTER_SEEK_TIMEOUT_MS = 15_000

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

export type VideoPosterOk = { ok: true; blob: Blob; contentType: string }
export type VideoPosterFail = {
  ok: false
  stage: string
  code: string
  message: string
  mediaError?: { code: number; message: string } | null
  domException?: { name: string; message: string } | null
}

export const SAFARI_POSTER_FAIL_MESSAGE =
  'The video was saved, but Safari could not generate a preview.'

function logPoster(stage: string, detail: Record<string, unknown> = {}) {
  console.info('[wedding-upload]', 'poster', stage, detail)
}

/** Safe seek target for poster frames. */
export function posterSeekSeconds(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(0.5, Math.max(0, duration / 10))
}

function mediaErrorInfo(video: HTMLVideoElement): { code: number; message: string } | null {
  const e = video.error
  if (!e) return null
  return { code: e.code, message: e.message || `MediaError code ${e.code}` }
}

function domExceptionInfo(err: unknown): { name: string; message: string } | null {
  if (err instanceof DOMException) return { name: err.name, message: err.message }
  if (err instanceof Error) return { name: err.name, message: err.message }
  return null
}

function waitVideoEvent(
  video: HTMLVideoElement,
  event: keyof HTMLMediaElementEventMap,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error(`${event}_timeout`))
    }, timeoutMs)
    const onOk = () => {
      cleanup()
      resolve()
    }
    const onErr = () => {
      cleanup()
      const me = mediaErrorInfo(video)
      reject(new Error(me?.message || `${event}_error`))
    }
    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener(event, onOk)
      video.removeEventListener('error', onErr)
    }
    video.addEventListener(event, onOk, { once: true })
    video.addEventListener('error', onErr, { once: true })
  })
}

/**
 * Generate a JPEG poster from a local video File.
 * Fresh video element + object URL per attempt; revoke only in finally after draw/toBlob.
 */
export async function makeVideoPoster(file: File): Promise<VideoPosterOk | VideoPosterFail> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  logPoster('video_element_created', {
    name: file.name,
    size: file.size,
    type: file.type || '(empty)',
  })

  const fail = (stage: string, code: string, err?: unknown): VideoPosterFail => {
    const result: VideoPosterFail = {
      ok: false,
      stage,
      code,
      message: SAFARI_POSTER_FAIL_MESSAGE,
      mediaError: mediaErrorInfo(video),
      domException: domExceptionInfo(err),
    }
    logPoster('failed', {
      stage,
      code,
      mediaError: result.mediaError,
      domException: result.domException,
      err: err instanceof Error ? err.message : String(err ?? ''),
    })
    return result
  }

  try {
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.setAttribute('playsinline', 'true')
    video.setAttribute('webkit-playsinline', 'true')
    video.src = url

    try {
      await waitVideoEvent(video, 'loadedmetadata', POSTER_METADATA_TIMEOUT_MS)
      logPoster('loadedmetadata', {
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
      })
    } catch (err) {
      return fail('loadedmetadata', 'metadata_failed', err)
    }

    // Best-effort decode readiness — do not fail the poster if only metadata is available.
    try {
      await Promise.race([
        waitVideoEvent(video, 'loadeddata', POSTER_METADATA_TIMEOUT_MS),
        waitVideoEvent(video, 'canplay', POSTER_METADATA_TIMEOUT_MS),
      ])
      logPoster('loadeddata_or_canplay', {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
      })
    } catch (err) {
      logPoster('loadeddata_or_canplay_soft_fail', {
        message: err instanceof Error ? err.message : String(err),
        readyState: video.readyState,
      })
    }

    const seekTo = posterSeekSeconds(video.duration)
    logPoster('seeking', { seekTo, duration: video.duration })
    try {
      const seeked = waitVideoEvent(video, 'seeked', POSTER_SEEK_TIMEOUT_MS)
      video.currentTime = seekTo
      await seeked
      logPoster('seeked', {
        currentTime: video.currentTime,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      })
    } catch (err) {
      return fail('seeked', 'seek_failed', err)
    }

    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) {
      return fail('dimensions', 'zero_frame', new Error(`zero_dimensions ${w}x${h}`))
    }

    let canvas: HTMLCanvasElement
    try {
      canvas = drawToCanvas(video, w, h)
      logPoster('canvas_drawImage', { canvasWidth: canvas.width, canvasHeight: canvas.height })
    } catch (err) {
      return fail('canvas_drawImage', 'draw_failed', err)
    }

    try {
      const blob = await canvasToJpegBlob(canvas, 0.75)
      logPoster('canvas_toBlob', { bytes: blob.size, type: blob.type })
      canvas.width = 0
      canvas.height = 0
      return { ok: true, blob, contentType: 'image/jpeg' }
    } catch (err) {
      return fail('canvas_toBlob', 'encode_failed', err)
    }
  } finally {
    try {
      video.removeAttribute('src')
      video.load()
    } catch {
      /* ignore */
    }
    URL.revokeObjectURL(url)
    logPoster('cleanup', { revoked: true })
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
