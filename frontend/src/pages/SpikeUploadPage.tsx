import { useState } from 'react'
import { Link } from 'react-router-dom'

const API_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '')
const API = API_BASE ? `${API_BASE}/functions/v1/wedding-api` : ''

/** Google Drive spike UI — evidence in docs/gdrive-upload-spike.md */
export function SpikeUploadPage() {
  const [log, setLog] = useState<string[]>(['Google Drive spike idle.'])
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [fileId, setFileId] = useState<string | null>(null)
  const [mediaId, setMediaId] = useState<string | null>(null)

  function append(line: string) {
    setLog((prev) => [...prev, `${new Date().toISOString()}  ${line}`])
  }

  async function api(path: string, init?: RequestInit) {
    if (!API) throw new Error('VITE_SUPABASE_URL is not set')
    const res = await fetch(`${API}/${path}`, init)
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`)
      return data
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res
  }

  async function connectGoogle() {
    try {
      const health = await api('gdrive-health')
      append(`gdrive-health ready=${health.ready}`)
      if (!health.ready) {
        append('Set GOOGLE_* Edge secrets first. See docs/environment.md')
        return
      }
      const { authorizeUrl } = await api('google-connect')
      append('Opening Google consent…')
      window.open(authorizeUrl, '_blank', 'noopener,noreferrer')
    } catch (err) {
      append(`FAIL ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function refreshQuota() {
    try {
      const q = await api('gdrive-quota')
      append(
        `quota limit=${q.bytes.limit ?? 'unknown'} usage=${q.bytes.usage} available=${q.bytes.available ?? 'unknown'} level=${q.level} (GB: ${JSON.stringify(q.gb)})`,
      )
    } catch (err) {
      append(`quota FAIL ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function runUpload() {
    if (!file || !API) {
      append('Choose a small JPEG and set VITE_SUPABASE_URL.')
      return
    }
    try {
      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const base64 = btoa(binary)
      const data = await api('gdrive-spike-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64,
          contentType: file.type || 'image/jpeg',
          filename: file.name,
        }),
      })
      setFileId(data.fileId)
      setMediaId(data.mediaId)
      append(`upload ok file=${data.fileIdRedacted} size=${data.size} level=${data.capacity?.level}`)
      const display = `${API}/gdrive-spike-display?fileId=${encodeURIComponent(data.fileId)}`
      setPreviewUrl(display)
      append('display URL set (Edge-mediated, short-lived session)')
    } catch (err) {
      append(`upload FAIL ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function runCleanup() {
    if (!fileId) {
      append('No fileId')
      return
    }
    try {
      const data = await api('gdrive-spike-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, mediaId }),
      })
      append(`delete cleanupVerified=${data.cleanupVerified}`)
      setPreviewUrl(null)
      setFileId(null)
    } catch (err) {
      append(`delete FAIL ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <main className="invite-linen relative min-h-dvh px-6 py-12">
      <div className="relative z-[1] mx-auto max-w-xl">
        <p className="font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">Technical spike</p>
        <h1 className="mt-2 font-display text-3xl text-foreground">Google Drive upload proof</h1>
        <p className="mt-3 text-mist">
          OAuth → about.get quota → capacity gate → upload → display → delete. Record sanitized
          quota in <code>docs/gdrive-upload-spike.md</code>. Capacity is never hardcoded.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={() => void connectGoogle()} className="btn-luxury inline-flex min-h-11 items-center rounded-[11px] bg-lux-gold-dark px-6 font-label text-[11px] uppercase tracking-[0.28em] text-white">
            Connect Google
          </button>
          <button type="button" onClick={() => void refreshQuota()} className="inline-flex min-h-11 items-center rounded-[11px] border border-lux-gold/40 px-6 font-label text-[11px] uppercase tracking-[0.28em] text-lux-gold-dark">
            Refresh quota
          </button>
        </div>

        <label className="mt-8 block text-left font-label text-[11px] uppercase tracking-[0.24em] text-lux-gold-dark">
          Test JPEG
          <input type="file" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>

        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={() => void runUpload()} className="btn-luxury inline-flex min-h-11 items-center rounded-[11px] bg-lux-gold-dark px-8 font-label text-[11px] uppercase tracking-[0.34em] text-white">
            Upload spike
          </button>
          <button type="button" onClick={() => void runCleanup()} className="inline-flex min-h-11 items-center rounded-[11px] border border-lux-gold/40 px-6 font-label text-[11px] uppercase tracking-[0.28em] text-lux-gold-dark">
            Delete file
          </button>
        </div>

        {previewUrl ? <img src={previewUrl} alt="Spike" className="mt-6 max-h-64 w-full object-contain" /> : null}

        <pre className="mt-8 max-h-80 overflow-auto rounded-[11px] border border-border bg-card/90 p-4 text-left text-xs text-mist whitespace-pre-wrap">
          {log.join('\n')}
        </pre>

        <Link to="/admin/capacity" className="mt-6 mr-4 inline-block font-label text-[10px] tracking-[0.2em] text-lux-gold-dark">
          Capacity panel →
        </Link>
        <Link to="/admin" className="mt-6 inline-block font-label text-[10px] tracking-[0.2em] text-muted-foreground">
          ← Admin
        </Link>
      </div>
    </main>
  )
}
