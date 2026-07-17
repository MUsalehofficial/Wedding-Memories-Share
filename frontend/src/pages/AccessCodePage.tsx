import { Link } from 'react-router-dom'

/** Placeholder until guest-code Edge Function is live after the R2 spike. */
export function AccessCodePage() {
  return (
    <main className="invite-linen relative flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="relative z-[1] w-full max-w-md text-center">
        <p className="font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">Wedding Access</p>
        <h1 className="mt-3 font-display text-3xl text-foreground sm:text-4xl">Enter the code</h1>
        <p className="mt-3 font-serif-italic text-mist">
          Guest access unlocks after the R2 upload path is proven. The wedding code is never stored
          in this app bundle.
        </p>
        <Link
          to="/"
          className="btn-luxury mt-8 inline-flex min-h-11 items-center justify-center rounded-[11px] bg-lux-gold-dark px-10 font-label text-[11px] uppercase tracking-[0.34em] text-white"
        >
          Back home
        </Link>
      </div>
    </main>
  )
}
