import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiJson } from '../lib/api'
import { saveGuestSession } from '../lib/session'

// ponytail: module latch survives remount; never written to Web Storage
let pendingInviteToken: string | null = null

/** QR join — exchange opaque invite once; never persist the invite token in storage. */
export function JoinPage() {
  const { token: paramToken } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const started = useRef(false)

  useEffect(() => {
    const fromRoute = (paramToken ?? '').trim()
    if (fromRoute.length >= 32) pendingInviteToken = fromRoute
    const token = pendingInviteToken
    if (!token) {
      // Router may not have params on the first paint — wait for :token.
      if (!paramToken && window.location.hash.includes('/join/')) return
      setBusy(false)
      setError('This invite link is invalid.')
      return
    }
    if (started.current) return
    started.current = true

    if (window.location.hash.includes('/join/')) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/join`)
    }

    void (async () => {
      try {
        const data = await apiJson<{ guestToken: string; expiresInSec: number }>('exchange-invite-token', {
          method: 'POST',
          body: JSON.stringify({ token }),
        })
        pendingInviteToken = null
        saveGuestSession(data.guestToken, data.expiresInSec)
        navigate('/upload', { replace: true })
      } catch (err) {
        pendingInviteToken = null
        setBusy(false)
        const msg = err instanceof Error ? err.message : String(err)
        if (/expired/i.test(msg) || msg === 'invite_expired') {
          setError('This invite link has expired.')
        } else if (/revoked/i.test(msg) || msg === 'invite_revoked') {
          setError('This invite link is no longer active.')
        } else if (/disabled/i.test(msg) || msg === 'invite_disabled') {
          setError('This invite link is no longer active.')
        } else if (/rate_limited/i.test(msg)) {
          setError('Too many attempts. Please wait a moment and try again.')
        } else {
          setError('This invite link is invalid or no longer works.')
        }
      }
    })()
  }, [paramToken, navigate])

  if (error) {
    return (
      <main className="invite-linen relative flex min-h-dvh flex-col items-center justify-center px-6">
        <div className="relative z-[1] w-full max-w-md text-center">
          <p className="font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">Wedding Invite</p>
          <h1 className="mt-3 font-display text-3xl text-foreground">Unable to join</h1>
          <p className="mt-4 text-sm text-mist">{error}</p>
          <Link
            to="/access?next=upload"
            className="btn-luxury mt-8 inline-flex min-h-11 items-center justify-center rounded-[11px] bg-lux-gold-dark px-8 font-label text-[11px] uppercase tracking-[0.34em] text-white"
          >
            Enter wedding code
          </Link>
          <Link to="/" className="mt-6 block font-label text-[10px] tracking-[0.2em] text-muted-foreground">
            ← Home
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="invite-linen relative flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="relative z-[1] w-full max-w-md text-center">
        <img src="/wax.png" alt="" aria-hidden className="mx-auto mb-6 h-14 w-auto object-contain opacity-90" />
        <p className="font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">Share Memories With Us</p>
        <h1 className="mt-3 font-display text-3xl text-lux-gold-dark">Muhammad &amp; Basmala</h1>
        <p className="mt-4 font-serif-italic text-mist">
          {busy ? 'Opening your wedding guest session…' : 'One moment…'}
        </p>
      </div>
    </main>
  )
}
