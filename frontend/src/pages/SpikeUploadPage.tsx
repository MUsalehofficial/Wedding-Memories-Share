import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'

const API_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '')
const API = API_BASE ? `${API_BASE}/functions/v1/wedding-api` : ''

/**
 * R2 technical spike UI. Evidence goes in docs/r2-upload-spike.md — never paste secrets/URLs there.
 */
export function SpikeUploadPage() {
  const [log, setLog] = useState<string[]>(['R2 spike idle.'])
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const objectKeyRef = useRef<string | null>(null)
  const mediaIdRef = useRef<string | null>(null)

  function append(line: string) {
    setLog((prev) => [...prev, `${new Date().toISOString()}  ${line}`])
  }

  async function api(path: string, init?: RequestInit) {
    if (!API) throw new Error('VITE_SUPABASE_URL is not set')
    const res = await fetch(`${API}/${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`)
    return data
  }

  async function runSpike() {
    if (!file) {
      append('Choose a small JPEG first.')
      return
    }
    setPreviewUrl(null)
    try {
      const health = await api('r2-health')
      append(`r2-health ready=${health.ready} bucket=${health.bucket ?? 'n/a'}`)
      if (!health.ready) {
        append('Set R2_* Edge secrets, then retry. See docs/environment.md')
        return
      }

      const created = await api('r2-spike-create', {
        method: 'POST',
        body: JSON.stringify({
          contentType: file.type || 'image/jpeg',
          byteSize: file.size,
          originalFilename: file.name,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
      objectKeyRef.current = created.objectKey
      mediaIdRef.current = created.mediaId
      append(`presign PUT ok expiresIn=${created.expiresIn}s key=${created.objectKeyRedacted}`)

      // CORS preflight happens automatically on cross-origin PUT
      const put = await fetch(created.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'image/jpeg' },
        body: file,
      })
      const etag = put.headers.get('ETag')
      append(`browser PUT status=${put.status} etag=${etag ? etag.slice(0, 8) + '…' : 'n/a'}`)
      if (!put.ok) throw new Error(`PUT failed ${put.status}`)

      const done = await api('r2-spike-complete', {
        method: 'POST',
        body: JSON.stringify({
          objectKey: created.objectKey,
          mediaId: created.mediaId,
          expectedBytes: file.size,
          expectedContentType: file.type || 'image/jpeg',
          etag,
        }),
      })
      append(`HEAD verify ok etag=${done.etagRedacted} type=${done.contentType}`)

      const display = await api('r2-spike-display', {
        method: 'POST',
        body: JSON.stringify({ objectKey: created.objectKey }),
      })
      setPreviewUrl(display.displayUrl)
      append(`presign GET ok expiresIn=${display.expiresIn}s — image should render below`)
    } catch (err) {
      append(`FAIL ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function runWrongContentType() {
    if (!file) return
    try {
      const created = await api('r2-spike-create', {
        method: 'POST',
        body: JSON.stringify({
          contentType: 'image/jpeg',
          byteSize: file.size,
          originalFilename: file.name,
        }),
      })
      const put = await fetch(created.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: file,
      })
      append(`wrong Content-Type PUT status=${put.status} (expect fail/403)`)
      if (created.objectKey) {
        await api('r2-spike-delete', {
          method: 'POST',
          body: JSON.stringify({ objectKey: created.objectKey, mediaId: created.mediaId }),
        })
      }
    } catch (err) {
      append(`wrong-type path: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function runCleanup() {
    const key = objectKeyRef.current
    if (!key) {
      append('No object key from this session.')
      return
    }
    try {
      const res = await api('r2-spike-delete', {
        method: 'POST',
        body: JSON.stringify({ objectKey: key, mediaId: mediaIdRef.current }),
      })
      append(`delete status=${res.deleteStatus} cleanupVerified=${res.cleanupVerified}`)
      setPreviewUrl(null)
      objectKeyRef.current = null
    } catch (err) {
      append(`cleanup FAIL ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <main className="invite-linen relative min-h-dvh px-6 py-12">
      <div className="relative z-[1] mx-auto max-w-xl">
        <p className="font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">Technical spike</p>
        <h1 className="mt-2 font-display text-3xl text-foreground">R2 upload proof</h1>
        <p className="mt-3 text-mist">
          Presigned PUT → browser upload → HeadObject → presigned GET → delete. Record sanitized
          results in <code>docs/r2-upload-spike.md</code>.
        </p>

        <label className="mt-8 block text-left font-label text-[11px] uppercase tracking-[0.24em] text-lux-gold-dark">
          Test JPEG
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="mt-2 block w-full text-sm text-foreground"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void runSpike()}
            className="btn-luxury inline-flex min-h-11 items-center rounded-[11px] bg-lux-gold-dark px-8 font-label text-[11px] uppercase tracking-[0.34em] text-white"
          >
            Run spike
          </button>
          <button
            type="button"
            onClick={() => void runWrongContentType()}
            className="inline-flex min-h-11 items-center rounded-[11px] border border-lux-gold/40 px-6 font-label text-[11px] uppercase tracking-[0.28em] text-lux-gold-dark"
          >
            Wrong type test
          </button>
          <button
            type="button"
            onClick={() => void runCleanup()}
            className="inline-flex min-h-11 items-center rounded-[11px] border border-lux-gold/40 px-6 font-label text-[11px] uppercase tracking-[0.28em] text-lux-gold-dark"
          >
            Delete object
          </button>
        </div>

        {previewUrl ? (
          <img src={previewUrl} alt="Spike upload" className="mt-6 max-h-64 w-full object-contain" />
        ) : null}

        <pre className="mt-8 max-h-80 overflow-auto rounded-[11px] border border-border bg-card/90 p-4 text-left text-xs text-mist whitespace-pre-wrap">
          {log.join('\n')}
        </pre>

        <Link to="/admin" className="mt-8 inline-block font-label text-[10px] tracking-[0.2em] text-muted-foreground">
          ← Admin
        </Link>
      </div>
    </main>
  )
}
