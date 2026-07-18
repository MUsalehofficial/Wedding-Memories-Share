import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Play } from 'lucide-react'
import { apiJson } from '../lib/api'
import { getGuestToken } from '../lib/session'

type GalleryItem = {
  id: string
  mediaKind: 'image' | 'video'
  guestName: string | null
  guestMessage: string | null
  previewUrl: string | null
  hasPreview: boolean
  createdAt: string
}

export function GalleryPage() {
  const navigate = useNavigate()
  const token = getGuestToken()
  const [items, setItems] = useState<GalleryItem[]>([])
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<GalleryItem | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson<{ items: GalleryItem[] }>(`gallery?sort=${sort}`, {
        guestToken: token,
      })
      setItems(data.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [token, sort])

  useEffect(() => {
    if (!token) {
      navigate('/access?next=gallery', { replace: true })
      return
    }
    void load()
  }, [token, navigate, load])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  return (
    <main className="invite-linen relative min-h-dvh px-6 py-12 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="relative z-[1] mx-auto max-w-5xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">Memories</p>
            <h1 className="mt-2 font-display text-3xl text-foreground sm:text-4xl">Our gallery</h1>
            <p className="mt-2 font-serif-italic text-mist">Moments shared by our guests.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-[11px] border border-lux-gold/35 bg-white/50 p-1" role="group" aria-label="Sort order">
              <button
                type="button"
                className={`rounded-[9px] px-3 py-1.5 font-label text-[10px] uppercase tracking-[0.2em] ${
                  sort === 'newest' ? 'bg-lux-gold-dark text-white' : 'text-lux-gold-dark'
                }`}
                onClick={() => setSort('newest')}
                aria-pressed={sort === 'newest'}
              >
                Newest
              </button>
              <button
                type="button"
                className={`rounded-[9px] px-3 py-1.5 font-label text-[10px] uppercase tracking-[0.2em] ${
                  sort === 'oldest' ? 'bg-lux-gold-dark text-white' : 'text-lux-gold-dark'
                }`}
                onClick={() => setSort('oldest')}
                aria-pressed={sort === 'oldest'}
              >
                Oldest
              </button>
            </div>
            <Link
              to="/upload"
              className="btn-luxury inline-flex min-h-11 items-center justify-center rounded-[11px] bg-lux-gold-dark px-8 font-label text-[11px] uppercase tracking-[0.34em] text-white"
            >
              Share a memory
            </Link>
          </div>
        </div>

        {loading ? <p className="mt-10 text-mist">Loading…</p> : null}
        {error ? (
          <p className="mt-10 text-sm text-red-800" role="alert">
            {error}
          </p>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <p className="mt-10 font-serif-italic text-mist">No memories yet — be the first to share.</p>
        ) : null}

        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActive(item)}
              className="group relative aspect-square overflow-hidden rounded-[12px] bg-white/50 text-left shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lux-gold-dark"
              aria-label={`Open memory from ${item.guestName || 'a guest'}`}
            >
              {item.previewUrl ? (
                <img
                  src={item.previewUrl}
                  alt=""
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-white/40 to-lux-gold/10 px-3 text-center">
                  {item.mediaKind === 'video' ? (
                    <>
                      <span
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-lux-gold/40 bg-white/70 text-lux-gold-dark"
                        aria-hidden
                      >
                        <Play className="h-4 w-4 fill-current" />
                      </span>
                      <span className="font-label text-[10px] tracking-[0.2em] text-lux-gold-dark">
                        Video
                      </span>
                    </>
                  ) : (
                    <span className="font-label text-[10px] tracking-[0.2em] text-lux-gold-dark">
                      Photo
                    </span>
                  )}
                </div>
              )}
              {item.mediaKind === 'video' && item.previewUrl ? (
                <span className="absolute bottom-2 left-2 rounded bg-black/45 px-2 py-0.5 font-label text-[9px] uppercase tracking-[0.2em] text-white">
                  Video
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="mt-10">
          <Link to="/" className="font-label text-[10px] tracking-[0.2em] text-muted-foreground">
            ← Home
          </Link>
        </div>
      </div>

      {active ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Memory viewer"
          onClick={() => setActive(null)}
        >
          <div
            className="max-h-[90dvh] w-full max-w-3xl overflow-auto rounded-[14px] bg-[#faf7f0] p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {active.previewUrl ? (
              <img src={active.previewUrl} alt="" className="mx-auto max-h-[70dvh] w-auto rounded-[10px]" />
            ) : active.mediaKind === 'video' ? (
              <div className="mx-auto flex aspect-video max-h-[40dvh] w-full max-w-md flex-col items-center justify-center gap-3 rounded-[10px] bg-white/70">
                <Play className="h-8 w-8 text-lux-gold-dark" aria-hidden />
                <p className="font-label text-[10px] uppercase tracking-[0.28em] text-lux-gold-dark">
                  Preview not available
                </p>
              </div>
            ) : null}
            <p className="mt-4 font-display text-xl text-lux-gold-dark">{active.guestName || 'Guest'}</p>
            {active.guestMessage ? (
              <p className="mt-1 font-serif-italic text-mist">{active.guestMessage}</p>
            ) : null}
            <button
              type="button"
              className="mt-6 min-h-11 font-label text-[10px] uppercase tracking-[0.28em] text-lux-gold-dark"
              onClick={() => setActive(null)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </main>
  )
}
