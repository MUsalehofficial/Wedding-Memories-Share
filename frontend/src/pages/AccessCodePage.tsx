import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiJson } from '../lib/api'
import { saveGuestSession } from '../lib/session'

export function AccessCodePage() {
  const [params] = useSearchParams()
  const next = params.get('next') === 'gallery' ? 'gallery' : 'upload'
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const subtitle = useMemo(
    () =>
      next === 'gallery'
        ? 'Enter the wedding code to view shared memories.'
        : 'Enter the wedding code to share a photo or video.',
    [next],
  )

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const data = await apiJson<{ guestToken: string; expiresInSec: number }>('verify-access-code', {
        method: 'POST',
        body: JSON.stringify({ code }),
      })
      saveGuestSession(data.guestToken, data.expiresInSec)
      navigate(next === 'gallery' ? '/gallery' : '/upload')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify code')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="invite-linen relative flex min-h-dvh flex-col items-center justify-center px-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="relative z-[1] w-full max-w-md text-center">
        <p className="font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">Wedding Access</p>
        <h1 className="mt-3 font-display text-3xl text-foreground sm:text-4xl">Enter the code</h1>
        <p className="mt-3 font-serif-italic text-mist">{subtitle}</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4 text-left">
          <label className="block">
            <span className="font-label text-[10px] uppercase tracking-[0.28em] text-lux-gold-dark">
              Access code
            </span>
            <input
              autoComplete="one-time-code"
              inputMode="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-2 w-full rounded-[11px] border border-border bg-white/80 px-4 py-3 font-body text-lg text-foreground outline-none ring-lux-gold-dark focus:ring-2"
              required
            />
          </label>
          {error ? <p className="text-sm text-red-800">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="btn-luxury inline-flex min-h-11 w-full items-center justify-center rounded-[11px] bg-lux-gold-dark px-10 font-label text-[11px] uppercase tracking-[0.34em] text-white disabled:opacity-60"
          >
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </form>

        <Link to="/" className="mt-8 inline-block font-label text-[10px] tracking-[0.2em] text-muted-foreground">
          ← Back home
        </Link>
      </div>
    </main>
  )
}
