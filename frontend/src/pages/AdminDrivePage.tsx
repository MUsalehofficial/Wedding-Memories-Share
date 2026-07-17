import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiJson, API } from '../lib/api'
import { clearAdminSecret, getAdminSecret, saveAdminSecret } from '../lib/session'

type DriveStatus = {
  status: string
  reconnectRequired: boolean
  uploadsEnabled: boolean
  lastError: string | null
}

/** Minimal admin reconnect page — password never bundled; sessionStorage only. */
export function AdminDrivePage() {
  const [adminConfigured, setAdminConfigured] = useState<boolean | null>(null)
  const [secret, setSecret] = useState('')
  const [unlocked, setUnlocked] = useState(Boolean(getAdminSecret()))
  const [status, setStatus] = useState<DriveStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<string | null>(null)

  useEffect(() => {
    if (!API) {
      setAdminConfigured(false)
      return
    }
    void fetch(`${API}/gdrive-health`)
      .then((r) => r.json())
      .then((d: { adminConfigured?: boolean; secrets?: { ADMIN_PANEL_SECRET?: boolean } }) => {
        setAdminConfigured(Boolean(d.adminConfigured ?? d.secrets?.ADMIN_PANEL_SECRET))
      })
      .catch(() => setAdminConfigured(false))
  }, [])

  async function refresh(adminSecret: string) {
    setError(null)
    const st = await apiJson<DriveStatus>('gdrive-status', { adminSecret })
    setStatus(st)
  }

  useEffect(() => {
    if (!unlocked || adminConfigured === false) return
    const s = getAdminSecret()
    if (!s) return
    void refresh(s).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [unlocked, adminConfigured])

  function onUnlock(e: FormEvent) {
    e.preventDefault()
    saveAdminSecret(secret)
    setSecret('') // clear controlled field after save to sessionStorage
    setUnlocked(true)
  }

  function signOut() {
    clearAdminSecret()
    setUnlocked(false)
    setStatus(null)
    setLog(null)
    setError(null)
  }

  async function reconnect() {
    const adminSecret = getAdminSecret()
    if (!adminSecret) return
    setLog(null)
    setError(null)
    try {
      const data = await apiJson<{ authorizeUrl: string }>('google-connect', { adminSecret })
      setLog('Opening Google consent for the wedding Drive account…')
      window.open(data.authorizeUrl, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (adminConfigured === null) {
    return (
      <main className="invite-linen relative flex min-h-dvh items-center justify-center px-6">
        <p className="relative z-[1] text-mist">Checking configuration…</p>
      </main>
    )
  }

  if (!adminConfigured) {
    return (
      <main className="invite-linen relative flex min-h-dvh items-center justify-center px-6">
        <div className="relative z-[1] w-full max-w-md text-center">
          <p className="font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">Administration</p>
          <h1 className="mt-3 font-display text-3xl text-foreground">Administrator access is not configured.</h1>
          <p className="mt-4 text-sm text-mist">
            Set the <code>ADMIN_PANEL_SECRET</code> Edge secret, then reload this page. The administrator
            email is never used as a passphrase.
          </p>
          <Link to="/" className="mt-8 inline-block font-label text-[10px] tracking-[0.2em] text-muted-foreground">
            ← Guest home
          </Link>
        </div>
      </main>
    )
  }

  if (!unlocked) {
    return (
      <main className="invite-linen relative flex min-h-dvh items-center justify-center px-6">
        <form onSubmit={onUnlock} className="relative z-[1] w-full max-w-md text-center">
          <p className="font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">Administration</p>
          <h1 className="mt-3 font-display text-3xl text-foreground">Admin access</h1>
          <p className="mt-3 text-sm text-mist">
            Enter the admin panel secret to reconnect Google Drive. Guests never authenticate with
            Google.
          </p>
          <input
            type="password"
            autoComplete="current-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="mt-6 w-full rounded-[11px] border border-border bg-white/80 px-4 py-3 outline-none focus:ring-2 focus:ring-lux-gold-dark"
            required
          />
          <button
            type="submit"
            className="btn-luxury mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-[11px] bg-lux-gold-dark font-label text-[11px] uppercase tracking-[0.34em] text-white"
          >
            Continue
          </button>
          <Link to="/" className="mt-8 inline-block font-label text-[10px] tracking-[0.2em] text-muted-foreground">
            ← Guest home
          </Link>
        </form>
      </main>
    )
  }

  return (
    <main className="invite-linen relative min-h-dvh px-6 py-12">
      <div className="relative z-[1] mx-auto max-w-lg">
        <p className="font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">Administration</p>
        <h1 className="mt-2 font-display text-3xl text-foreground">Google Drive</h1>
        <p className="mt-3 text-mist">
          If authorization expires, reconnect here. Existing gallery previews stay available; uploads
          pause until reconnect succeeds. Media is never deleted for an expired token.
        </p>

        {error ? <p className="mt-6 text-sm text-red-800">{error}</p> : null}
        {log ? <p className="mt-6 text-sm text-mist">{log}</p> : null}

        {status ? (
          <div className="mt-8 space-y-2 text-foreground">
            <p>
              Status: <strong>{status.status}</strong>
            </p>
            <p>Uploads enabled: {status.uploadsEnabled ? 'yes' : 'no'}</p>
            {status.lastError ? <p>Last error code recorded (details withheld).</p> : null}
            {status.reconnectRequired ? (
              <p className="rounded-[11px] border border-lux-gold/50 bg-white/70 px-4 py-3 text-sm">
                Reconnect required. Guests can still view the gallery; new uploads are paused.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void reconnect()}
            className="btn-luxury inline-flex min-h-11 items-center rounded-[11px] bg-lux-gold-dark px-8 font-label text-[11px] uppercase tracking-[0.34em] text-white"
          >
            Reconnect Google Drive
          </button>
          <button
            type="button"
            onClick={() => {
              const s = getAdminSecret()
              if (s) void refresh(s).catch((err) => setError(err instanceof Error ? err.message : String(err)))
            }}
            className="inline-flex min-h-11 items-center rounded-[11px] border border-lux-gold/40 px-8 font-label text-[11px] uppercase tracking-[0.34em] text-lux-gold-dark"
          >
            Refresh status
          </button>
          <button
            type="button"
            onClick={signOut}
            className="inline-flex min-h-11 items-center rounded-[11px] border border-border px-8 font-label text-[11px] uppercase tracking-[0.34em] text-muted-foreground"
          >
            Sign out
          </button>
        </div>

        <div className="mt-10">
          <Link to="/" className="font-label text-[10px] tracking-[0.2em] text-muted-foreground">
            ← Guest home
          </Link>
        </div>
      </div>
    </main>
  )
}
