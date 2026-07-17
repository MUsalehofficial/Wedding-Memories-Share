import { Link } from 'react-router-dom'

/** Admin login shell — wired to Supabase Auth after project provisioning. */
export function AdminLoginPage() {
  return (
    <main className="invite-linen relative flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="relative z-[1] w-full max-w-md text-center">
        <p className="font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">Administration</p>
        <h1 className="mt-3 font-display text-3xl text-foreground">Sign in</h1>
        <p className="mt-3 text-mist">
          Only the configured administrator email may access moderation and storage settings.
        </p>
        <p className="mt-6 rounded-[11px] border border-border bg-card/80 px-4 py-3 text-sm text-muted-foreground">
          Supabase Auth login will activate once the project and <code>ADMIN_EMAIL</code> secret are
          configured. See <code>docs/r2-upload-spike.md</code>.
        </p>
        <Link
          to="/admin/spike-upload"
          className="mt-6 inline-block font-label text-[11px] uppercase tracking-[0.28em] text-lux-gold-dark underline-offset-4 hover:underline"
        >
          Spike upload page →
        </Link>
        <div className="mt-8">
          <Link to="/" className="font-label text-[10px] tracking-[0.2em] text-muted-foreground">
            ← Guest home
          </Link>
        </div>
      </div>
    </main>
  )
}
