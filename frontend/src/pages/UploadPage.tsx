import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, apiJson, logApi } from '../lib/api'
import {
  MAX_VIDEO_BYTES,
  gateSelectedFile,
  isIphoneSafari,
  mediaKindOf,
  userMessageForUploadError,
} from '../lib/mediaValidate'
import { blobToBase64, makeImagePreview, makeVideoPoster, SAFARI_POSTER_FAIL_MESSAGE } from '../lib/preview'
import { putResumableFile, queryResumableOffset } from '../lib/resumableUpload'
import { getGuestToken } from '../lib/session'

type EventPublic = {
  uploadsEnabled: boolean
  videoUploadsEnabled: boolean
  maxImageBytes: number
  maxVideoBytes: number
  maxVideoDurationSeconds?: number
  uploadsPausedReason: string | null
  reconnectRequired: boolean
}

/** Per-item client pipeline stages. */
export type UploadStage =
  | 'selected'
  | 'preparing'
  | 'ready'
  | 'uploading'
  | 'original_uploaded'
  | 'preparing_preview'
  | 'completing'
  | 'completed'
  | 'preview_failed'
  | 'failed'

type FileJob = {
  id: string
  file: File | null
  fileName: string
  fileSize: number
  fileType: string
  mediaKind?: 'image' | 'video'
  /** Resolved MIME sent to the API (may differ from File.type for MOV). */
  uploadMimeType?: string
  durationSeconds?: number | null
  headerBase64?: string | null
  progress: number
  status: UploadStage
  error?: string
  sessionId?: string
  mediaId?: string
  uploadUrl?: string | null
  fileId?: string | null
  originalVerified?: boolean
  hasPreview?: boolean
  posterStatus?: 'ok' | 'failed' | 'skipped'
}

type PersistedJob = {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  status: string
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
    case 'selected':
      return 'Selected'
    case 'preparing':
      return 'Preparing'
    case 'ready':
      return 'Ready'
    case 'uploading':
      return 'Uploading'
    case 'original_uploaded':
      return 'Original saved'
    case 'preparing_preview':
      return 'Preparing preview'
    case 'completing':
      return 'Finishing'
    case 'completed':
      return 'Completed'
    case 'preview_failed':
      return 'Preview failed'
    case 'failed':
      return 'Failed'
    default:
      return status
  }
}

function normalizeRestoredStatus(raw: string): UploadStage {
  switch (raw) {
    case 'queued':
      return 'ready'
    case 'uploading':
      return 'uploading'
    case 'preparing_preview':
    case 'uploading_preview':
      return 'preparing_preview'
    case 'failed':
      return 'failed'
    case 'selected':
    case 'preparing':
    case 'ready':
    case 'uploading':
    case 'original_uploaded':
    case 'preparing_preview':
    case 'completing':
    case 'completed':
    case 'preview_failed':
    case 'failed':
      return raw
    default:
      return 'failed'
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
    return userMessageForUploadError(err.code, err.message)
  }
  const msg = err instanceof Error ? err.message : String(err)
  if (/load failed/i.test(msg)) return 'Original upload interrupted'
  if (stage === 'preview' || stage.includes('preview')) return 'Preview generation failed'
  if (stage.includes('complete')) return 'Completion verification failed'
  if (stage.includes('upload')) return 'Original upload interrupted'
  return msg
}

async function uploadPreviewFor(
  token: string,
  job: FileJob,
  onUpdate: (patch: Partial<FileJob>) => void,
): Promise<void> {
  if (!job.mediaId) throw new Error('missing_media_id')

  // Recovery: without a local File we cannot regenerate a poster from Drive.
  if (!job.file) {
    onUpdate({
      status: 'completed',
      progress: 100,
      hasPreview: false,
      posterStatus: 'failed',
      error:
        'The original video is saved, but this device no longer has the local file needed to regenerate a preview.',
    })
    logApi('poster_local_file_missing', { mediaId: job.mediaId })
    return
  }

  const mediaKind = mediaKindOf(job.file)
  onUpdate({ status: 'preparing_preview', error: undefined })
  if (mediaKind === 'image') {
    let preview: { blob: Blob; contentType: string }
    try {
      preview = await makeImagePreview(job.file)
    } catch {
      throw new Error('Preview generation failed')
    }
    onUpdate({ status: 'preparing_preview' })
    const base64 = await blobToBase64(preview.blob)
    logApi('preview_upload_start', { mediaId: job.mediaId, kind: 'image', bytes: preview.blob.size })
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
    logApi('preview_upload_ok', { mediaId: job.mediaId, kind: 'image' })
    onUpdate({ status: 'completed', progress: 100, hasPreview: true, error: undefined })
    return
  }

  // Video: poster is best-effort — original success must not depend on it.
  // Keep job.file alive; do not revoke anything owned by the File itself.
  onUpdate({ status: 'preparing_preview' })
  const poster = await makeVideoPoster(job.file)
  if (!poster.ok) {
    logApi('poster_generation_failed', {
      mediaId: job.mediaId,
      stage: poster.stage,
      code: poster.code,
      mediaError: poster.mediaError ?? null,
      domException: poster.domException ?? null,
    })
    onUpdate({
      status: 'completed',
      progress: 100,
      hasPreview: false,
      posterStatus: 'failed',
      error: SAFARI_POSTER_FAIL_MESSAGE,
    })
    return
  }
  try {
    const base64 = await blobToBase64(poster.blob)
    logApi('preview_upload_start', { mediaId: job.mediaId, kind: 'poster', bytes: poster.blob.size })
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
    logApi('preview_upload_ok', { mediaId: job.mediaId, kind: 'poster' })
    onUpdate({
      status: 'completed',
      progress: 100,
      hasPreview: true,
      posterStatus: 'ok',
      error: undefined,
    })
  } catch (err) {
    logApi('preview_upload_failed', {
      mediaId: job.mediaId,
      kind: 'poster',
      code: err instanceof ApiError ? err.code : 'upload_failed',
      requestId: err instanceof ApiError ? err.requestId : null,
    })
    onUpdate({
      status: 'completed',
      progress: 100,
      hasPreview: false,
      posterStatus: 'failed',
      error: SAFARI_POSTER_FAIL_MESSAGE,
    })
  }
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
    // Preview-only: never create a Drive resumable session / never re-upload original.
    if (!job.mediaId) {
      onUpdate({
        status: 'preview_failed',
        error: 'Preview generation failed — missing media id.',
      })
      return
    }
    try {
      await uploadPreviewFor(token, job, onUpdate)
    } catch (err) {
      logApi('preview_failed', {
        mediaId: job.mediaId,
        requestId: err instanceof ApiError ? err.requestId : null,
      })
      onUpdate({
        status: job.originalVerified ? 'completed' : 'preview_failed',
        originalVerified: job.originalVerified,
        posterStatus: 'failed',
        hasPreview: false,
        error: job.file ? SAFARI_POSTER_FAIL_MESSAGE : 'Preview generation failed',
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
        status: 'failed',
        error:
          err instanceof ApiError
            ? userMessageForUploadError(err.code, 'Completion verification failed')
            : 'Completion verification failed',
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
        error: 'Preview generation failed',
        originalVerified: true,
        progress: 100,
      })
    }
    return
  }

  const file = job.file
  if (!file) throw new Error('Re-select this file to upload.')
  const mediaKind = mediaKindOf(file)
  if (mediaKind === 'video' && !info.videoUploadsEnabled) {
    throw new Error('Video uploads are currently disabled.')
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

  onUpdate({ status: 'uploading', progress: 0, error: undefined })

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
        mimeType: job.uploadMimeType || file.type,
        filename: file.name,
        byteSize: file.size,
        mediaKind,
        idempotencyKey: job.id,
        guestName: name || undefined,
        guestMessage: message || undefined,
        durationSeconds: job.durationSeconds ?? undefined,
        headerBase64: job.headerBase64 ?? undefined,
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
        status: 'failed',
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
        status: 'failed',
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
      status: 'failed',
      error: formatStageError('uploading', err),
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
      status: 'failed',
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
      error: 'Preview generation failed',
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
            } else if (status === 'uploading' || status === 'completing') {
              status = 'failed'
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
          status: normalizeRestoredStatus(String(status)),
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

  const jobsRef = useRef(jobs)
  jobsRef.current = jobs
  const previewRetryInputRef = useRef<HTMLInputElement | null>(null)
  const previewRetryJobIdRef = useRef<string | null>(null)

  function patchJob(id: string, patch: Partial<FileJob>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))
  }

  function beginPreviewRetryPick(jobId: string) {
    const job = jobsRef.current.find((j) => j.id === jobId)
    if (!job?.mediaId) return
    // Already have local File — regenerate preview only (never create-session).
    if (job.file) {
      void retryPreviewOnly(jobId)
      return
    }
    previewRetryJobIdRef.current = jobId
    const input = previewRetryInputRef.current
    if (input) {
      input.value = ''
      input.click()
    }
  }

  async function retryPreviewOnly(jobId: string, fileOverride?: File) {
    if (!token || !info) return
    const job = jobsRef.current.find((j) => j.id === jobId)
    if (!job?.mediaId) return
    const effective: FileJob = fileOverride ? { ...job, file: fileOverride } : job
    if (!effective.file) {
      beginPreviewRetryPick(jobId)
      return
    }
    setBusy(true)
    patchJob(jobId, {
      file: effective.file,
      error: 'Regenerating preview only for the existing video. The original will not be uploaded again.',
      status: job.status === 'completed' || job.originalVerified ? 'completed' : job.status,
      posterStatus: job.posterStatus ?? 'failed',
    })
    try {
      // Hard-force preview mode — never full/complete / never create-session.
      await uploadOne(token, info, effective, name, message, (patch) => patchJob(jobId, patch), 'preview')
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? userMessageForUploadError(err.code, err.message)
          : err instanceof Error
            ? err.message
            : String(err)
      patchJob(jobId, {
        status: 'completed',
        originalVerified: true,
        posterStatus: 'failed',
        hasPreview: false,
        error: /load failed/i.test(msg) ? SAFARI_POSTER_FAIL_MESSAGE : msg,
      })
    } finally {
      setBusy(false)
    }
  }

  function onPreviewRetryFile(files: FileList | null) {
    const jobId = previewRetryJobIdRef.current
    previewRetryJobIdRef.current = null
    if (!jobId || !files?.length) return
    const file = files[0]
    if (!file) return
    const job = jobsRef.current.find((j) => j.id === jobId)
    if (!job?.mediaId) return

    // Attach only to this existing media item — never seed a new upload job.
    patchJob(jobId, {
      file,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || job.fileType,
      mediaKind: 'video',
      error: 'Regenerating preview only for the existing video. The original will not be uploaded again.',
    })
    void retryPreviewOnly(jobId, file)
  }

  function onPick(files: FileList | null) {
    if (!files?.length) return
    const list = Array.from(files)
    const limits = {
      uploadsEnabled: info?.uploadsEnabled !== false,
      videoUploadsEnabled: info?.videoUploadsEnabled !== false,
      maxImageBytes: info?.maxImageBytes ?? 20 * 1024 * 1024,
      maxVideoBytes: info?.maxVideoBytes ?? MAX_VIDEO_BYTES,
      maxVideoDurationSeconds: info?.maxVideoDurationSeconds ?? 60,
      uploadsPausedReason: info?.uploadsPausedReason ?? null,
    }

    const seeded: FileJob[] = []
    for (const file of list) {
      const orphanMatch = jobsRef.current.find(
        (j) =>
          !j.file &&
          j.fileName === file.name &&
          j.fileSize === file.size &&
          (j.status === 'preview_failed' || j.status === 'failed' || j.posterStatus === 'failed'),
      )
      if (orphanMatch) {
        const previewOnly =
          orphanMatch.posterStatus === 'failed' ||
          orphanMatch.status === 'preview_failed' ||
          (orphanMatch.originalVerified && !orphanMatch.hasPreview)
        setJobs((prev) =>
          prev.map((j) =>
            j.id === orphanMatch.id
              ? {
                  ...j,
                  file,
                  error: previewOnly
                    ? 'Regenerating preview only for the existing video. The original will not be uploaded again.'
                    : j.status === 'failed'
                      ? j.error
                      : j.error,
                }
              : j,
          ),
        )
        if (previewOnly && orphanMatch.mediaId) {
          void retryPreviewOnly(orphanMatch.id, file)
        }
        continue
      }
      seeded.push({
        id: crypto.randomUUID(),
        file,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'application/octet-stream',
        mediaKind: mediaKindOf(file),
        progress: 0,
        status: 'selected',
      })
    }
    if (seeded.length) setJobs((prev) => [...prev, ...seeded])

    void (async () => {
      const iphone = isIphoneSafari()
      const videos = seeded.filter((j) => j.mediaKind === 'video')
      const photos = seeded.filter((j) => j.mediaKind !== 'video')

      async function prepareOne(job: FileJob) {
        if (!job.file) return
        patchJob(job.id, {
          status: 'preparing',
          error: 'Preparing from Photos or iCloud…',
        })
        try {
          const gate = await gateSelectedFile(job.file, limits)
          if (!gate.ok) {
            patchJob(job.id, { status: 'failed', error: gate.message, progress: 0 })
            return
          }
          patchJob(job.id, {
            status: 'ready',
            error: undefined,
            fileType: gate.mimeType,
            uploadMimeType: gate.mimeType,
            durationSeconds: gate.durationSeconds,
            headerBase64: gate.headerBase64,
            mediaKind: gate.mediaKind,
          })
        } catch {
          patchJob(job.id, { status: 'failed', error: 'Unable to prepare file' })
        }
      }

      const photoWorkers = Math.min(iphone ? 2 : 4, Math.max(1, photos.length || 1))
      let photoIdx = 0
      await Promise.all(
        Array.from({ length: photos.length ? photoWorkers : 0 }, async () => {
          while (photoIdx < photos.length) {
            const j = photos[photoIdx++]
            if (j) await prepareOne(j)
          }
        }),
      )

      // Sequential video prep — never decode all selected videos at once.
      for (const j of videos) await prepareOne(j)
    })()
  }

  function retryModeFor(job: FileJob): 'full' | 'preview' | 'complete' {
    if (
      job.posterStatus === 'failed' ||
      job.status === 'preview_failed' ||
      (job.originalVerified && !job.hasPreview)
    ) {
      return 'preview'
    }
    if (job.sessionId && !job.originalVerified && (job.progress >= 100 || job.status === 'failed')) {
      return 'complete'
    }
    return 'full'
  }

  async function runAll() {
    if (!token || !info || jobs.length === 0) return
    setBusy(true)
    setError(null)

    const iphone = isIphoneSafari()
    const maxVideos = 1
    const maxPhotos = iphone ? 2 : 3
    let activeVideos = 0
    let activePhotos = 0

    const snapshot = () => jobsRef.current

    async function runJob(job: FileJob) {
      const kind = job.mediaKind ?? (job.file ? mediaKindOf(job.file) : 'image')
      if (kind === 'video') activeVideos++
      else activePhotos++
      const mode = retryModeFor(job)
      try {
        const latest = snapshot().find((j) => j.id === job.id) ?? job
        await uploadOne(token!, info!, latest, name, message, (patch) => patchJob(job.id, patch), mode)
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? userMessageForUploadError(err.code, err.message)
            : err instanceof Error
              ? err.message
              : String(err)
        const latest = snapshot().find((j) => j.id === job.id)
        patchJob(job.id, {
          status: latest?.originalVerified ? 'preview_failed' : 'failed',
          error: /load failed/i.test(msg) ? 'Original upload interrupted' : msg,
        })
      } finally {
        if (kind === 'video') activeVideos--
        else activePhotos--
      }
    }

    await new Promise<void>((resolve) => {
      const inFlight = new Set<string>()
      const tick = () => {
        const current = snapshot()
        const stillPreparing = current.some((j) => j.status === 'preparing' || j.status === 'selected')
        const actionable = current.filter((j) => {
          if (inFlight.has(j.id)) return false
          if (j.status === 'ready') return true
          if (j.status === 'preview_failed') return true
          if (j.status === 'completed' && j.posterStatus === 'failed') return true
          if (j.status === 'failed' && j.file) return true
          return false
        })

        for (const job of actionable) {
          const kind = job.mediaKind ?? (job.file ? mediaKindOf(job.file) : 'image')
          if (kind === 'video' && activeVideos >= maxVideos) continue
          if (kind !== 'video' && activePhotos >= maxPhotos) continue
          inFlight.add(job.id)
          void runJob(job).then(() => {
            inFlight.delete(job.id)
            tick()
          })
        }

        const workLeft =
          stillPreparing ||
          inFlight.size > 0 ||
          activeVideos > 0 ||
          activePhotos > 0 ||
          current.some(
            (j) =>
              j.status === 'ready' ||
              j.status === 'uploading' ||
              j.status === 'completing' ||
              j.status === 'preparing_preview' ||
              j.status === 'preview_failed' ||
              (j.status === 'completed' && j.posterStatus === 'failed'),
          )

        if (!workLeft) {
          resolve()
          return
        }
        if (stillPreparing || actionable.length === 0) {
          window.setTimeout(tick, 150)
        }
      }
      tick()
    })

    setBusy(false)
  }

  async function retryOne(id: string) {
    if (!token || !info) return
    const job = jobsRef.current.find((j) => j.id === id)
    if (!job) return
    setBusy(true)
    const mode = retryModeFor(job)
    try {
      await uploadOne(token, info, job, name, message, (patch) => patchJob(job.id, patch), mode)
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? userMessageForUploadError(err.code, err.message)
          : err instanceof Error
            ? err.message
            : String(err)
      patchJob(id, {
        status: mode === 'preview' ? 'preview_failed' : 'failed',
        error: /load failed/i.test(msg) ? 'Original upload interrupted' : msg,
      })
    } finally {
      setBusy(false)
    }
  }

  const allDone =
    jobs.length > 0 &&
    jobs.every((j) => j.status === 'completed') &&
    !jobs.some((j) => j.posterStatus === 'failed')

  const canUpload =
    !busy &&
    info?.uploadsEnabled !== false &&
    jobs.some(
      (j) =>
        j.status === 'ready' ||
        j.status === 'preview_failed' ||
        j.posterStatus === 'failed' ||
        (j.status === 'failed' && Boolean(j.file)),
    )

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
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,.mp4,.mov"
              onChange={(e) => onPick(e.target.files)}
              className="mt-2 block w-full text-sm text-mist file:mr-4 file:rounded-[11px] file:border-0 file:bg-lux-gold-dark file:px-4 file:py-2 file:font-label file:text-[10px] file:uppercase file:tracking-[0.28em] file:text-white"
            />
            {/* Dedicated picker for Retry Preview — never seeds a new upload job. */}
            <input
              ref={previewRetryInputRef}
              type="file"
              accept="video/mp4,video/quicktime,.mp4,.mov"
              className="sr-only"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => onPreviewRetryFile(e.target.files)}
            />
            <p className="mt-2 font-body text-xs text-mist">
              Photos and videos stored in iCloud may take a moment to prepare. Keep this page open.
            </p>
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
                {job.error ? (
                  <p
                    className={`mt-2 text-xs ${
                      job.status === 'preparing' ||
                      (job.posterStatus === 'failed' && job.status === 'completed')
                        ? 'text-mist'
                        : 'text-red-800'
                    }`}
                  >
                    {job.error}
                  </p>
                ) : null}
                {!job.file &&
                (job.status === 'preview_failed' ||
                  job.status === 'failed' ||
                  job.posterStatus === 'failed') ? (
                  <p className="mt-2 text-xs text-mist">
                    {job.posterStatus === 'failed' || job.status === 'preview_failed'
                      ? 'Use Retry preview and re-select the same video. Preview only — the original will not be uploaded again.'
                      : 'Re-select the same file to retry.'}
                  </p>
                ) : null}
                {job.status === 'preview_failed' ||
                (job.status === 'completed' && job.posterStatus === 'failed') ? (
                  <button
                    type="button"
                    className="mt-2 font-label text-[10px] uppercase tracking-[0.24em] text-lux-gold-dark underline-offset-2 hover:underline"
                    onClick={() => beginPreviewRetryPick(job.id)}
                    disabled={busy}
                  >
                    Retry preview
                  </button>
                ) : null}
                {job.status === 'failed' ? (
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
          disabled={!canUpload}
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
