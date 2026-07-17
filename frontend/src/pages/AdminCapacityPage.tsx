import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

const API_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '')
const API = API_BASE ? `${API_BASE}/functions/v1/wedding-api` : ''

type CapacityPayload = {
  level: string
  gb: { limit: number | null; usage: number | null; available: number | null }
  bytes: { limit: number | null; usage: number; available: number | null; safetyReserve: number }
  videoUploadsEnabled: boolean
  warnRatio: number
  criticalRatio: number
}

/** Minimal admin capacity view — live Google about.get via Edge. */
export function AdminCapacityPage() {
  const [data, setData] = useState<CapacityPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setError(null)
    try {
      if (!API) throw new Error('VITE_SUPABASE_URL missing')
      const res = await fetch(`${API}/gdrive-quota`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`)
      setData(json)
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const warn =
    data?.level === 'warn' || data?.level === 'critical' || data?.level === 'full'

  return (
    <main className="invite-linen relative min-h-dvh px-6 py-12">
      <div className="relative z-[1] mx-auto max-w-lg">
        <p className="font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">Administration</p>
        <h1 className="mt-2 font-display text-3xl text-foreground">Storage capacity</h1>
        <p className="mt-3 text-mist">
          Totals come from Google Drive <code>about.get</code> on each refresh — not a hardcoded GB
          plan.
        </p>

        {error ? <p className="mt-6 text-sm text-red-800">{error}</p> : null}

        {data ? (
          <div className="mt-8 space-y-3 text-left text-foreground">
            <p>
              <span className="font-label text-[10px] uppercase tracking-[0.24em] text-lux-gold-dark">Total</span>
              <br />
              {data.gb.limit == null ? 'Unknown' : `${data.gb.limit} GB`}
            </p>
            <p>
              <span className="font-label text-[10px] uppercase tracking-[0.24em] text-lux-gold-dark">Used</span>
              <br />
              {data.gb.usage == null ? '—' : `${data.gb.usage} GB`}
            </p>
            <p>
              <span className="font-label text-[10px] uppercase tracking-[0.24em] text-lux-gold-dark">Available</span>
              <br />
              {data.gb.available == null ? 'Unknown' : `${data.gb.available} GB`}
            </p>
            <p>
              Level: <strong>{data.level}</strong>
              {data.level === 'warn' ? ' — below 20% remaining' : null}
              {data.level === 'critical' ? ' — below 10% remaining' : null}
              {data.level === 'full' ? ' — uploads should stop' : null}
            </p>
            <p>Video uploads: {data.videoUploadsEnabled ? 'enabled' : 'disabled'}</p>
            {warn ? (
              <p className="rounded-[11px] border border-lux-gold/50 bg-white/70 px-4 py-3 text-sm">
                Storage pressure detected. Free space or upgrade Google storage — no code change
                required after a plan upgrade.
              </p>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void load()}
          className="btn-luxury mt-8 inline-flex min-h-11 items-center rounded-[11px] bg-lux-gold-dark px-8 font-label text-[11px] uppercase tracking-[0.34em] text-white"
        >
          Refresh
        </button>

        <div className="mt-8">
          <Link to="/admin/spike-upload" className="font-label text-[10px] tracking-[0.2em] text-lux-gold-dark">
            Spike upload →
          </Link>
        </div>
      </div>
    </main>
  )
}
