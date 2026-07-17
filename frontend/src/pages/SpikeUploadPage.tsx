import { useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * Technical spike UI.
 * Does not claim OneDrive works until docs/onedrive-upload-spike.md evidence is filled.
 */
export function SpikeUploadPage() {
  const [log, setLog] = useState<string[]>([
    'Spike idle. Connect OneDrive via Edge Functions after secrets are configured.',
  ])
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl] = useState<string | null>(null)

  function append(line: string) {
    setLog((prev) => [...prev, `${new Date().toISOString()}  ${line}`])
  }

  async function runSpikeUpload() {
    if (!file) {
      append('Choose a small JPEG first.')
      return
    }
    append(`Selected ${file.name} (${file.size} bytes).`)
    append(
      'Blocked: Supabase project + Microsoft secrets not configured yet. See docs/onedrive-upload-spike.md.',
    )
    // When live: create session → PUT/chunk → complete → display URL → setPreviewUrl
  }

  return (
    <main className="invite-linen relative min-h-dvh px-6 py-12">
      <div className="relative z-[1] mx-auto max-w-xl">
        <p className="font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">Technical spike</p>
        <h1 className="mt-2 font-display text-3xl text-foreground">OneDrive upload proof</h1>
        <p className="mt-3 text-mist">
          Proves admin connect → token refresh → upload session → bytes → verify → temporary display
          URL. No mock uploads in the final product.
        </p>

        <label className="mt-8 block text-left font-label text-[11px] uppercase tracking-[0.24em] text-lux-gold-dark">
          Test image
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="mt-2 block w-full text-sm text-foreground"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <button
          type="button"
          onClick={() => void runSpikeUpload()}
          className="btn-luxury mt-6 inline-flex min-h-11 items-center rounded-[11px] bg-lux-gold-dark px-10 font-label text-[11px] uppercase tracking-[0.34em] text-white"
        >
          Run spike upload
        </button>

        {previewUrl ? (
          <img src={previewUrl} alt="Uploaded spike preview" className="mt-6 max-h-64 w-full object-contain" />
        ) : null}

        <pre className="mt-8 max-h-64 overflow-auto rounded-[11px] border border-border bg-card/90 p-4 text-left text-xs text-mist whitespace-pre-wrap">
          {log.join('\n')}
        </pre>

        <Link to="/admin" className="mt-8 inline-block font-label text-[10px] tracking-[0.2em] text-muted-foreground">
          ← Admin
        </Link>
      </div>
    </main>
  )
}
