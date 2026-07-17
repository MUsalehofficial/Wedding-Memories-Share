import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, apiJson, logApi } from '../lib/api'
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

/** Client pipeline stages (requirement matrix). */
export type UploadStage =
  | 'queued'
  | 'uploading_original'
  | 'original_uploaded'
  | 'generating_preview'
  | 'uploading_preview'
  | 'completing'
  | 'completed'
  | 'preview_failed'
  | 'original_failed'

type FileJob = {
  id: string
  file: File | null
  fileName: string
  fileSize: number
  fileType: string
  progress: number
  status: UploadStage
  error?: string
  sessionId?: string
  mediaId?: string
  uploadUrl?: string | null
  fileId?: string | null
  originalVerified?: boolean
  hasPreview?: boolean
}

type PersistedJob = {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  status: UploadStage
  sessionId?: string
  mediaId?: string
  originalVerified?: boolean
  hasPreview?: boolean
  error?: string
}

const JOBS_KEY = 'wedding_upload_jobs_v1'

type JobStatus = {
  sessionId: string
  mediaId: string | null
  sessionStatus: string
  uploadStatus: string | null
  originalVerified: boolean
  hasPreview: boolean
  hasOpenUploadUrl: boolean
  fileIdRedacted: string | null
  requestId?: string
}

function persistJobs(jobs: FileJob[]) {
  const rows: PersistedJob[] = jobs.map((j) => ({
    id: j.id,
    fileName: j.fileName,
    fileSize: j.fileSize,
    fileType: j.fileType,
    status: j.status,
    sessionId: j.sessionId,
    mediaId: j.mediaId,
    originalVerified: j.originalVerified,
    hasPreview: j.hasPreview,
    error: j.error,
  }))
  sessionStorage.setItem(JOBS_KEY, JSON.stringify(rows))
}

function loadPersistedJobs(): PersistedJob[] {
  try {
    const raw = sessionStorage.getItem(JOBS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PersistedJob[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function stageLabel(status: UploadStage): string {
  switch (status) {
    case 'uploading_original':
      return 'Uploading original'
    case 'original_uploaded':
      return 'Original saved'
    case 'generating_preview':
      return 'Generating preview'
    case 'uploading_preview':
      return 'Uploading preview'
    case 'completing':
      return 'Finishing'
    case 'completed':
      return 'Completed'
    case 'preview_failed':
      return 'Preview failed'
    case 'original_failed':
      return 'Upload failed'
    default:
      return status
  }
}

async function completeOriginal(
  token: string,
  sessionId: string,
  fileId: string | null | undefined,
): Promise<{ fileId: string | null; mediaId?: string; requestId?: string }> {
  let resolved = fileId ?? null
  // Browser often cannot read Drive's final 200 (missing ACAO). Resolve id server-side.
  if (!resolved) {
    const probe = await apiJson<{ fileId?: string; requestId?: string }>('', {
      method: 'POST',
      guestToken: token,
      functionSlug: 'wedding-resolve-upload',
      stage: 'resolve_drive_file',
      body: JSON.stringify({ sessionId }),
    })
    resolved = probe.fileId ?? null
    logApi('resolve_upload', { requestId: probe.requestId ?? null, hasFileId: Boolean(resolved) })
    if (!resolved) {
      throw new ApiError('resolve_drive_file: missing file id', {
        status: 502,
        code: 'missing_file_id',
        requestId: probe.requestId ?? null,
        stage: 'resolve_drive_file',
      })
    }
  }
  const data = await apiJson<{
    fileId?: string
    mediaId?: string
    requestId?: string
  }>('gdrive-complete-resumable', {
    method: 'POST',
    guestToken: token,
    stage: 'complete_upload',
    body: JSON.stringify({ sessionId, fileId: resolved || undefined }),
  })
  return { fileId: data.fileId ?? resolved, mediaId: data.mediaId, requestId: data.requestId }
}

function formatStageError(stage: string, err: unknown): string {
  if (err instanceof ApiError) {
    const rid = err.requestId ? ` (request ${err.requestId.slice(0, 8)})` : ''
    return `${stage}: ${err.code}${rid}`
  }
  const msg = err instanceof Error ? err.message : String(err)
  return `${stage}: ${msg}`
}

async function uploadPreviewFor(
  token: string,
  job: FileJob,
  onUpdate: (patch: Partial<FileJob>) => void,
): Promise<void> {
  if (!job.file) throw new Error('Re-select this file to retry the preview.')
  if (!job.mediaId) throw new Error('missing_media_id')
  const mediaKind = job.fileType.startsWith('video/') ? 'video' : 'image'
  onUpdate({ status: 'generating_preview', error: undefined })
  if (mediaKind === 'image') {
    let preview: { blob: Blob; contentType: string }
    try {
      preview = await makeImagePreview(job.file)
    } catch (err) {
      throw new Error(formatStageError('generating_preview', err))
    }
    onUpdate({ status: 'uploading_preview' })
    const base64 = await blobToBase64(preview.blob)
    await apiJson('gdrive-upload-preview', {
      method: 'POST',
      guestToken: token,
      stage: 'uploading_preview',
      body: JSON.stringify({
        mediaId: job.mediaId,
        base64,
        contentType: preview.contentType,
        kind: 'image',
      }),
    })
  } else {
    const poster = await makeVideoPoster(job.file)
    if (poster) {
      onUpdate({ status: 'uploading_preview' })
      const base64 = await blobToBase64(poster.blob)
      await apiJson('gdrive-upload-preview', {
        method: 'POST',
        guestToken: token,
        stage: 'uploading_preview',
        body: JSON.stringify({
          mediaId: job.mediaId,
          base64,
          contentType: poster.contentType,
          kind: 'poster',
        }),
      })
    }
  }
  onUpdate({ status: 'completed', progress: 100, hasPreview: true, error: undefined })
}

async function uploadOne(
  token: string,
  info: EventPublic,
  job: FileJob,
  name: string,
  message: string,
  onUpdate: (patch: Partial<FileJob>) => void,
  mode: 'full' | 'preview' | 'complete' = 'full',
): Promise<void> {
  if (mode === 'preview') {
    try {
      await uploadPreviewFor(token, job, onUpdate)
    } catch (err) {
      logApi('preview_failed', {
        mediaId: job.mediaId,
        requestId: err instanceof ApiError ? err.requestId : null,
      })
      onUpdate({
        status: 'preview_failed',
        error: 'Original saved; preview failed. ' + formatStageError('preview', err),
      })
    }
    return
  }

  if (mode === 'complete') {
    if (!job.sessionId) throw new Error('missing_session_id')
    onUpdate({ status: 'completing', error: undefined })
    try {
      await completeOriginal(token, job.sessionId, job.fileId)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'upload_incomplete') {
        logApi('complete_incomplete_resume', { requestId: err.requestId })
        // Only resume bytes if Drive session is incomplete — never create a new session.
        return uploadOne(token, info, { ...job, uploadUrl: job.uploadUrl ?? null }, name, message, onUpdate, 'full')
      }
      onUpdate({
        status: 'original_failed',
        error: formatStageError('complete_upload', err),
        sessionId: job.sessionId,
        mediaId: job.mediaId,
      })
      throw err
    }
    onUpdate({
      status: 'original_uploaded',
      originalVerified: true,
      progress: 100,
      uploadUrl: null,
    })
    try {
      await uploadPreviewFor(token, { ...job, originalVerified: true }, onUpdate)
    } catch (err) {
      onUpdate({
        status: 'preview_failed',
        error: 'Original saved; preview failed. ' + formatStageError('preview', err),
        originalVerified: true,
        progress: 100,
      })
    }
    return
  }

  const file = job.file
  if (!file) throw new Error('Re-select this file to upload.')
  const mediaKind = file.type.startsWith('video/') ? 'video' : 'image'
  if (mediaKind === 'video' && !info.videoUploadsEnabled) {
    throw new Error('Video uploads are temporarily disabled.')
  }
  if (!info.uploadsEnabled) {
    throw new Error(info.uploadsPausedReason || 'Uploads are paused.')
  }

  // Reconcile server state before any Drive work (reload / retry safety)
  let sessionId = job.sessionId
  let mediaId = job.mediaId
  let uploadUrl = job.uploadUrl
  let fileId = job.fileId
  let originalVerified = Boolean(job.originalVerified)

  if (sessionId || job.id) {
    try {
      const q = sessionId
        ? `gdrive-upload-job-status?sessionId=${encodeURIComponent(sessionId)}`
        : `gdrive-upload-job-status?idempotencyKey=${encodeURIComponent(job.id)}`
      const st = await apiJson<JobStatus>(q, { method: 'GET', guestToken: token })
      sessionId = st.sessionId
      mediaId = st.mediaId ?? mediaId
      originalVerified = st.originalVerified
      onUpdate({
        sessionId,
        mediaId: mediaId ?? undefined,
        originalVerified,
        hasPreview: st.hasPreview,
        fileId: originalVerified ? fileId : undefined,
      })
      if (st.originalVerified && st.hasPreview) {
        onUpdate({ status: 'completed', progress: 100, error: undefined })
        return
      }
      if (st.originalVerified && !st.hasPreview) {
        onUpdate({
          status: 'preview_failed',
          progress: 100,
          error: 'Original saved; preview failed',
        })
        await uploadPreviewFor(
          token,
          { ...job, sessionId, mediaId: mediaId ?? undefined, originalVerified: true },
          onUpdate,
        )
        return
      }
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        logApi('job_status_probe', {
          requestId: err instanceof ApiError ? err.requestId : null,
          code: err instanceof ApiError ? err.code : 'error',
        })
      }
    }
  }

  if (originalVerified) {
    await uploadPreviewFor(
      token,
      { ...job, sessionId, mediaId, originalVerified: true },
      onUpdate,
    )
    return
  }

  onUpdate({ status: 'uploading_original', progress: 0, error: undefined })

  if (!sessionId || !uploadUrl) {
    const session = await apiJson<{
      sessionId: string
      mediaId: string
      uploadUrl: string | null
      originalVerified?: boolean
      hasPreview?: boolean
      fileId?: string | null
      status?: string
      requestId?: string
    }>('gdrive-create-resumable-session', {
      method: 'POST',
      guestToken: token,
      stage: 'create_upload_session',
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
    if (session.originalVerified) {
      originalVerified = true
      fileId = session.fileId ?? fileId
      onUpdate({
        status: session.hasPreview ? 'completed' : 'original_uploaded',
        originalVerified: true,
        hasPreview: session.hasPreview,
        fileId,
        progress: 100,
        uploadUrl: null,
      })
      if (session.hasPreview) return
      await uploadPreviewFor(
        token,
        { ...job, sessionId, mediaId, originalVerified: true, file },
        onUpdate,
      )
      return
    }
  }

  if (!uploadUrl) {
    // Session exists but URL withheld (or cleared) — resolve + complete only (no new Drive original)
    onUpdate({ status: 'completing' })
    try {
      const done = await completeOriginal(token, sessionId!, fileId)
      onUpdate({
        status: 'original_uploaded',
        originalVerified: true,
        fileId: done.fileId,
        mediaId: done.mediaId ?? mediaId,
        progress: 100,
        uploadUrl: null,
      })
      await uploadPreviewFor(
        token,
        {
          ...job,
          sessionId: sessionId!,
          mediaId: done.mediaId ?? mediaId,
          originalVerified: true,
          file,
        },
        onUpdate,
      )
      return
    } catch (err) {
      onUpdate({
        status: 'original_failed',
        error: formatStageError('complete_upload', err),
        sessionId,
        mediaId,
      })
      throw err
    }
  }

  let resumeFrom = 0
  try {
    resumeFrom = await queryResumableOffset(uploadUrl, file.size)
  } catch {
    resumeFrom = 0
  }

  // If a prior attempt already finished the resumable session, skip PUT and resolve/complete only.
  if (resumeFrom >= file.size && file.size > 0) {
    onUpdate({ status: 'completing', progress: 100, sessionId, mediaId })
    try {
      const done = await completeOriginal(token, sessionId!, null)
      onUpdate({
        status: 'original_uploaded',
        originalVerified: true,
        fileId: done.fileId,
        mediaId: done.mediaId ?? mediaId,
        progress: 100,
        uploadUrl: null,
      })
      await uploadPreviewFor(
        token,
        {
          ...job,
          sessionId: sessionId!,
          mediaId: done.mediaId ?? mediaId,
          originalVerified: true,
          file,
        },
        onUpdate,
      )
      return
    } catch (err) {
      onUpdate({
        status: 'original_failed',
        error: formatStageError('complete_upload', err),
        sessionId,
        mediaId,
      })
      throw err
    }
  }

  try {
    const put = await putResumableFile(
      uploadUrl,
      file,
      (p) => onUpdate({ progress: Math.round((p.uploaded / p.total) * 100) }),
      resumeFrom,
    )
    fileId = put.fileId
    onUpdate({ fileId, status: 'completing', progress: 100, sessionId, mediaId })
  } catch (err) {
    onUpdate({
      status: 'original_failed',
      error: formatStageError('uploading_original', err),
      sessionId,
      mediaId,
    })
    throw err
  }

  try {
    const done = await completeOriginal(token, sessionId!, fileId)
    onUpdate({
      status: 'original_uploaded',
      originalVerified: true,
      fileId: done.fileId,
      mediaId: done.mediaId ?? mediaId,
      progress: 100,
      uploadUrl: null,
    })
  } catch (err) {
    // Original may exist on Drive; keep session/media ids for idempotent complete-only retry
    onUpdate({
      status: 'original_failed',
      error: formatStageError('complete_upload', err),
      sessionId,
      mediaId,
      fileId,
    })
    throw err
  }

  try {
    await uploadPreviewFor(
      token,
      {
        ...job,
        sessionId: sessionId!,
        mediaId: mediaId!,
        originalVerified: true,
        file,
      },
      onUpdate,
    )
  } catch (err) {
    onUpdate({
      status: 'preview_failed',
      error: 'Original saved; preview failed. ' + formatStageError('preview', err),
      sessionId,
      mediaId,
      originalVerified: true,
      progress: 100,
    })
  }
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

  // On load: restore meta + query server before any upload restart
  useEffect(() => {
    if (!token) return
    const saved = loadPersistedJobs()
    if (!saved.length) return
    let cancelled = false
    void (async () => {
      const restored: FileJob[] = []
      for (const row of saved) {
        let status = row.status
        let originalVerified = row.originalVerified
        let hasPreview = row.hasPreview
        let sessionId = row.sessionId
        let mediaId = row.mediaId
        let errorMsg = row.error
        if (row.sessionId || row.id) {
          try {
            const q = row.sessionId
              ? `gdrive-upload-job-status?sessionId=${encodeURIComponent(row.sessionId)}`
              : `gdrive-upload-job-status?idempotencyKey=${encodeURIComponent(row.id)}`
            const st = await apiJson<JobStatus>(q, { method: 'GET', guestToken: token })
            sessionId = st.sessionId
            mediaId = st.mediaId ?? mediaId
            originalVerified = st.originalVerified
            hasPreview = st.hasPreview
            if (st.originalVerified && st.hasPreview) status = 'completed'
            else if (st.originalVerified) {
              status = 'preview_failed'
              errorMsg = 'Original saved; preview failed'
            } else if (status === 'uploading_original' || status === 'completing') {
              status = 'original_failed'
              errorMsg = errorMsg || 'Upload interrupted — retry to finish without duplicating.'
            }
            logApi('reconcile_job', {
              requestId: st.requestId ?? null,
              originalVerified: st.originalVerified,
              hasPreview: st.hasPreview,
            })
          } catch {
            /* keep persisted status */
          }
        }
        if (cancelled) return
        restored.push({
          id: row.id,
          file: null,
          fileName: row.fileName,
          fileSize: row.fileSize,
          fileType: row.fileType,
          progress: status === 'completed' || originalVerified ? 100 : 0,
          status,
          sessionId,
          mediaId,
          originalVerified,
          hasPreview,
          error: errorMsg,
          uploadUrl: null,
        })
      }
      if (!cancelled) setJobs(restored)
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    if (jobs.length) persistJobs(jobs)
  }, [jobs])

  function patchJob(id: string, patch: Partial<FileJob>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))
  }

  function onPick(files: FileList | null) {
    if (!files?.length) return
    setJobs((prev) => {
      const next = [...prev]
      for (const file of files) {
        // Re-attach file to a matching preview_failed / original_failed job without file
        const orphan = next.find(
          (j) =>
            !j.file &&
            j.fileName === file.name &&
            j.fileSize === file.size &&
            (j.status === 'preview_failed' || j.status === 'original_failed'),
        )
        if (orphan) {
          orphan.file = file
          orphan.error = orphan.status === 'preview_failed' ? 'Original saved; preview failed' : orphan.error
          continue
        }
        next.push({
          id: crypto.randomUUID(),
          file,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          progress: 0,
          status: 'queued',
        })
      }
      return [...next]
    })
  }

  async function runAll() {
    if (!token || !info || jobs.length === 0) return
    setBusy(true)
    setError(null)
    for (const job of jobs) {
      if (job.status === 'completed') continue
      const mode =
        job.status === 'preview_failed' || job.originalVerified
          ? 'preview'
          : job.status === 'original_failed' && job.sessionId
            ? 'complete'
            : 'full'
      try {
        await uploadOne(token, info, job, name, message, (patch) => patchJob(job.id, patch), mode)
      } catch (err) {
        patchJob(job.id, {
          status: job.originalVerified ? 'preview_failed' : 'original_failed',
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
    const mode: 'full' | 'preview' | 'complete' =
      job.status === 'preview_failed' || (job.originalVerified && !job.hasPreview)
        ? 'preview'
        : job.sessionId && job.status === 'original_failed'
          ? 'complete'
          : job.sessionId && !job.originalVerified && job.progress >= 100
            ? 'complete'
            : 'full'
    try {
      await uploadOne(token, info, job, name, message, (patch) => patchJob(job.id, patch), mode)
    } catch (err) {
      patchJob(id, {
        status: mode === 'preview' ? 'preview_failed' : 'original_failed',
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  const allDone = jobs.length > 0 && jobs.every((j) => j.status === 'completed')

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
                  <p className="truncate font-body text-sm text-foreground">{job.fileName}</p>
                  <span className="shrink-0 font-label text-[9px] uppercase tracking-[0.2em] text-lux-gold-dark">
                    {stageLabel(job.status)}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/80">
                  <div className="h-full bg-lux-gold-dark transition-all" style={{ width: `${job.progress}%` }} />
                </div>
                {job.error ? <p className="mt-2 text-xs text-red-800">{job.error}</p> : null}
                {!job.file && (job.status === 'preview_failed' || job.status === 'original_failed') ? (
                  <p className="mt-2 text-xs text-mist">Re-select the same file to retry.</p>
                ) : null}
                {job.status === 'preview_failed' ? (
                  <button
                    type="button"
                    className="mt-2 font-label text-[10px] uppercase tracking-[0.24em] text-lux-gold-dark underline-offset-2 hover:underline"
                    onClick={() => void retryOne(job.id)}
                    disabled={busy || !job.file}
                  >
                    Retry preview
                  </button>
                ) : null}
                {job.status === 'original_failed' ? (
                  <button
                    type="button"
                    className="mt-2 font-label text-[10px] uppercase tracking-[0.24em] text-lux-gold-dark underline-offset-2 hover:underline"
                    onClick={() => void retryOne(job.id)}
                    disabled={busy || !job.file}
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
