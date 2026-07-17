import { Link } from 'react-router-dom'

export function PrivacyPage() {
  return (
    <main className="invite-linen relative min-h-dvh px-6 py-16">
      <div className="relative z-[1] mx-auto max-w-lg">
        <p className="font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">Privacy</p>
        <h1 className="mt-3 font-display text-3xl text-foreground">Your memories, kept private</h1>
        <div className="mt-6 space-y-4 text-lg leading-relaxed text-mist">
          <p>
            This site is for Muhammad and Basmala&apos;s wedding guests only. Photos and short videos
            you share are stored in the couple&apos;s private OneDrive, not on a public album.
          </p>
          <p>
            You may optionally leave your name and a short message. Guests do not create accounts.
            Access requires the wedding code shared with invited guests.
          </p>
          <p>
            The couple may moderate, hide, or remove media. Original files are not offered for
            guest download from the gallery.
          </p>
        </div>
        <Link to="/" className="mt-10 inline-block font-label text-[11px] uppercase tracking-[0.3em] text-lux-gold-dark">
          ← Home
        </Link>
      </div>
    </main>
  )
}
