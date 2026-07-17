import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiJson } from '../lib/api'
import { blobToBase64, makeImagePreview, makeVideoPoster } from '../lib/preview'
import { putResumableFile, queryResumableOffset } from '../lib/resumableUpload'
import { getGuestToken } from '../lib/session'

type EventPublic = {
  uploadsEnabled: boolean
  videoUploadsEnabled: boolean
  maxImageBytes: number
  maxVideoBytes: number
  uploadsPausedReason: string | null
  reconnectRequired: boolean
}

type FileJob = {
  id: string
  file: File
  progress: number
  status: 'queued' | 'uploading' | 'finalizing' | 'done' | 'error'
  error?: string
  sessionId?: string
  mediaId?: string
  uploadUrl?: string
  fileId?: string
}

async function uploadOne(
  token: string,
  info: EventPublic,
  job: FileJob,
  name: string,
  message: string,
  onUpdate: (patch: Partial<FileJob>) => void,
): Promise<void> {
  const file = job.file
  const mediaKind = file.type.startsWith('video/') ? 'video' : 'image'
  if (mediaKind === 'video' && !info.videoUploadsEnabled) {
    throw new Error('Video uploads are temporarily disabled.')
  }
  if (!info.uploadsEnabled) {
    throw new Error(info.uploadsPausedReason || 'Uploads are paused.')
  }

  onUpdate({ status: 'uploading', progress: 0, error: undefined })

  let sessionId = job.sessionId
  let mediaId = job.mediaId
  let uploadUrl = job.uploadUrl

  if (!sessionId || !uploadUrl) {
    const session = await apiJson<{
      sessionId: string
      mediaId: string
      uploadUrl: string
    }>('gdrive-create-resumable-session', {
      method: 'POST',
      guestToken: token,
      body: JSON.stringify({
        mimeType: file.type,
        filename: file.name,
        byteSize: file.size,
        mediaKind,
        idempotencyKey: job.id,
        guestName: name || undefined,
        guestMessage: message || undefined,
      }),
    })
    sessionId = session.sessionId
    mediaId = session.mediaId
    uploadUrl = session.uploadUrl
    onUpdate({ sessionId, mediaId, uploadUrl })
  }

  let resumeFrom = 0
  try {
    resumeFrom = await queryResumableOffset(uploadUrl!, file.size)
  } catch {
    resumeFrom = 0
  }

  const { fileId } = await putResumableFile(
    uploadUrl!,
    file,
    (p) => onUpdate({ progress: Math.round((p.uploaded / p.total) * 100) }),
    resumeFrom,
  )
  onUpdate({ fileId, status: 'finalizing', progress: 100 })

  await apiJson('gdrive-complete-resumable', {
    method: 'POST',
    guestToken: token,
    body: JSON.stringify({ sessionId, fileId }),
  })

  if (mediaKind === 'image') {
    const preview = await makeImagePreview(file)
    const base64 = await blobToBase64(preview.blob)
    await apiJson('gdrive-upload-preview', {
      method: 'POST',
      guestToken: token,
      body: JSON.stringify({
        mediaId,
        base64,
        contentType: preview.contentType,
        kind: 'image',
      }),
    })
  } else {
    const poster = await makeVideoPoster(file)
    if (poster) {
      const base64 = await blobToBase64(poster.blob)
      await apiJson('gdrive-upload-preview', {
        method: 'POST',
        guestToken: token,
        body: JSON.stringify({
          mediaId,
          base64,
          contentType: poster.contentType,
          kind: 'poster',
        }),
      })
    }
  }

  onUpdate({ status: 'done', progress: 100 })
}

export function UploadPage() {
  const navigate = useNavigate()
  const token = getGuestToken()
  const [info, setInfo] = useState<EventPublic | null>(null)
  const [jobs, setJobs] = useState<FileJob[]>([])
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      navigate('/access?next=upload', { replace: true })
      return
    }
    void apiJson<EventPublic>('event-public')
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [token, navigate])

  function patchJob(id: string, patch: Partial<FileJob>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))
  }

  function onPick(files: FileList | null) {
    if (!files?.length) return
    const next: FileJob[] = [...files].map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: 'queued',
    }))
    setJobs((prev) => [...prev, ...next])
  }

  async function runAll() {
    if (!token || !info || jobs.length === 0) return
    setBusy(true)
    setError(null)
    for (const job of jobs) {
      if (job.status === 'done') continue
      try {
        await uploadOne(token, info, job, name, message, (patch) => patchJob(job.id, patch))
      } catch (err) {
        patchJob(job.id, {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    setBusy(false)
  }

  async function retryOne(id: string) {
    if (!token || !info) return
    const job = jobs.find((j) => j.id === id)
    if (!job) return
    setBusy(true)
    try {
      await uploadOne(token, info, job, name, message, (patch) => patchJob(job.id, patch))
    } catch (err) {
      patchJob(id, { status: 'error', error: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const allDone = jobs.length > 0 && jobs.every((j) => j.status === 'done')

  return (
    <main className="invite-linen relative min-h-dvh px-6 py-12 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="relative z-[1] mx-auto w-full max-w-md">
        <p className="font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">Share</p>
        <h1 className="mt-2 font-display text-3xl text-foreground">Share memories</h1>
        <p className="mt-3 font-serif-italic text-mist">
          Add one or more photos and videos. Uploads resume if the connection drops.
        </p>

        {info?.uploadsPausedReason ? (
          <p className="mt-6 rounded-[11px] border border-lux-gold/40 bg-white/70 px-4 py-3 text-sm" role="status">
            {info.uploadsPausedReason}
          </p>
        ) : null}

        <div className="mt-8 space-y-4">
          <label className="block">
            <span className="font-label text-[10px] uppercase tracking-[0.28em] text-lux-gold-dark">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 w-full rounded-[11px] border border-border bg-white/80 px-4 py-3 font-body text-foreground outline-none focus:ring-2 focus:ring-lux-gold-dark"
            />
          </label>
          <label className="block">
            <span className="font-label text-[10px] uppercase tracking-[0.28em] text-lux-gold-dark">
              Note (optional)
            </span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              className="mt-2 w-full rounded-[11px] border border-border bg-white/80 px-4 py-3 font-body text-foreground outline-none focus:ring-2 focus:ring-lux-gold-dark"
            />
          </label>
          <label className="block">
            <span className="font-label text-[10px] uppercase tracking-[0.28em] text-lux-gold-dark">
              Photos or videos
            </span>
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,video/mp4"
              onChange={(e) => onPick(e.target.files)}
              className="mt-2 block w-full text-sm text-mist file:mr-4 file:rounded-[11px] file:border-0 file:bg-lux-gold-dark file:px-4 file:py-2 file:font-label file:text-[10px] file:uppercase file:tracking-[0.28em] file:text-white"
            />
          </label>
        </div>

        {jobs.length > 0 ? (
          <ul className="mt-6 space-y-3" aria-live="polite">
            {jobs.map((job) => (
              <li key={job.id} className="rounded-[11px] border border-border/80 bg-white/60 px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-body text-sm text-foreground">{job.file.name}</p>
                  <span className="shrink-0 font-label text-[9px] uppercase tracking-[0.2em] text-lux-gold-dark">
                    {job.status}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/80">
                  <div className="h-full bg-lux-gold-dark transition-all" style={{ width: `${job.progress}%` }} />
                </div>
                {job.error ? <p className="mt-2 text-xs text-red-800">{job.error}</p> : null}
                {job.status === 'error' ? (
                  <button
                    type="button"
                    className="mt-2 font-label text-[10px] uppercase tracking-[0.24em] text-lux-gold-dark underline-offset-2 hover:underline"
                    onClick={() => void retryOne(job.id)}
                    disabled={busy}
                  >
                    Retry
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {error ? <p className="mt-4 text-sm text-red-800" role="alert">{error}</p> : null}

        <button
          type="button"
          disabled={busy || jobs.length === 0 || info?.uploadsEnabled === false}
          onClick={() => void runAll()}
          className="btn-luxury mt-8 inline-flex min-h-11 w-full items-center justify-center rounded-[11px] bg-lux-gold-dark px-10 font-label text-[11px] uppercase tracking-[0.34em] text-white disabled:opacity-50"
        >
          {busy ? 'Uploading…' : allDone ? 'Upload more' : 'Upload all'}
        </button>

        {allDone ? (
          <Link
            to="/gallery"
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-[11px] border border-lux-gold/40 font-label text-[11px] uppercase tracking-[0.34em] text-lux-gold-dark"
          >
            View gallery
          </Link>
        ) : null}

        <div className="mt-8 flex justify-between">
          <Link to="/gallery" className="font-label text-[10px] tracking-[0.2em] text-lux-gold-dark">
            Gallery →
          </Link>
          <Link to="/" className="font-label text-[10px] tracking-[0.2em] text-muted-foreground">
            Home
          </Link>
        </div>
      </div>
    </main>
  )
}
