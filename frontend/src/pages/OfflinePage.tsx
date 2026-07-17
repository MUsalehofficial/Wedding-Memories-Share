import { Link } from 'react-router-dom'

export function OfflinePage() {
  return (
    <main className="invite-linen relative flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="relative z-[1] max-w-md">
        <h1 className="font-display text-3xl text-foreground">Connection needed</h1>
        <p className="mt-3 font-serif-italic text-mist">
          We couldn&apos;t reach the memories service. Check your network and try again.
        </p>
        <Link
          to="/"
          className="btn-luxury mt-8 inline-flex min-h-11 items-center rounded-[11px] bg-lux-gold-dark px-10 font-label text-[11px] uppercase tracking-[0.34em] text-white"
        >
          Try again
        </Link>
      </div>
    </main>
  )
}
