import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Play } from 'lucide-react'
import { ApiError, apiJson } from '../lib/api'
import { getGuestToken } from '../lib/session'

type GalleryItem = {
  id: string
  mediaKind: 'image' | 'video'
  guestName: string | null
  guestMessage: string | null
  previewUrl: string | null
  hasPreview: boolean
  mimeType?: string | null
  canPlay?: boolean
  createdAt: string
}

type PlaybackUrls = {
  streamUrl: string
  downloadUrl: string
  mimeType?: string | null
  expiresInSec: number
}

const UNSUPPORTED_CODEC_MESSAGE =
  'This video was saved successfully, but this browser cannot play its format.'

function mediaErrorMessage(err: MediaError | null): string {
  if (!err) return UNSUPPORTED_CODEC_MESSAGE
  // 4 = MEDIA_ERR_SRC_NOT_SUPPORTED
  if (err.code === 4) return UNSUPPORTED_CODEC_MESSAGE
  return `Playback failed (MediaError ${err.code}). Try Download Original.`
}

export function GalleryPage() {
  const navigate = useNavigate()
  const token = getGuestToken()
  const [items, setItems] = useState<GalleryItem[]>([])
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<GalleryItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [playback, setPlayback] = useState<PlaybackUrls | null>(null)
  const [playbackLoading, setPlaybackLoading] = useState(false)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [downloadBusy, setDownloadBusy] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRetryUsedRef = useRef(false)

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

  const mintPlayback = useCallback(
    async (mediaId: string, previewUrl: string | null): Promise<PlaybackUrls> => {
      if (!token) throw new Error('Guest session required')
      const data = await apiJson<PlaybackUrls>(`media/${mediaId}/playback`, {
        guestToken: token,
        stage: 'media_playback',
      })
      // Never use preview/poster URL as video src.
      if (!data.streamUrl || data.streamUrl === previewUrl) {
        throw new Error('Invalid playback URL')
      }
      if (!data.streamUrl.includes('/stream') || !data.downloadUrl?.includes('/download')) {
        throw new Error('Playback URL is not purpose-bound')
      }
      return data
    },
    [token],
  )

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

  useEffect(() => {
    if (!active || active.mediaKind !== 'video' || !token) {
      setPlayback(null)
      setPlaybackError(null)
      setPlaybackLoading(false)
      streamRetryUsedRef.current = false
      return
    }
    let cancelled = false
    setPlayback(null)
    setPlaybackError(null)
    setPlaybackLoading(true)
    streamRetryUsedRef.current = false
    void (async () => {
      try {
        const data = await mintPlayback(active.id, active.previewUrl)
        if (cancelled) return
        setPlayback(data)
      } catch (err) {
        if (cancelled) return
        setPlaybackError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setPlaybackLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active, token, mintPlayback])

  function closeViewer() {
    setActive(null)
    setPlayback(null)
    setPlaybackError(null)
    streamRetryUsedRef.current = false
  }

  async function onVideoError() {
    if (!active || active.mediaKind !== 'video') return
    // One refresh if the short-lived stream URL likely expired; do not loop.
    if (!streamRetryUsedRef.current && token) {
      streamRetryUsedRef.current = true
      setPlaybackLoading(true)
      setPlaybackError(null)
      try {
        const data = await mintPlayback(active.id, active.previewUrl)
        setPlayback(data)
        return
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setPlaybackError('Playback session expired. Close and open the video again.')
          return
        }
        setPlaybackError(err instanceof Error ? err.message : String(err))
        return
      } finally {
        setPlaybackLoading(false)
      }
    }
    const mediaErr = videoRef.current?.error ?? null
    setPlaybackError(mediaErrorMessage(mediaErr))
  }

  async function onDownloadOriginal() {
    if (!active || active.mediaKind !== 'video' || !token) return
    setDownloadBusy(true)
    setPlaybackError(null)
    try {
      // Fresh purpose-bound download URL — do not reuse a stale stream mint.
      const data = await mintPlayback(active.id, active.previewUrl)
      window.location.assign(data.downloadUrl)
    } catch (err) {
      setPlaybackError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloadBusy(false)
    }
  }

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
              aria-label={
                item.mediaKind === 'video'
                  ? `Play video from ${item.guestName || 'a guest'}`
                  : `Open photo from ${item.guestName || 'a guest'}`
              }
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
              {item.mediaKind === 'video' ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-90 transition group-hover:bg-black/30">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/50 bg-black/45 text-white">
                    <Play className="h-5 w-5 fill-current" aria-hidden />
                  </span>
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
          aria-label={active.mediaKind === 'video' ? 'Video player' : 'Memory viewer'}
          onClick={closeViewer}
        >
          <div
            className="max-h-[90dvh] w-full max-w-3xl overflow-auto rounded-[14px] bg-[#faf7f0] p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {active.mediaKind === 'video' ? (
              <div className="space-y-3">
                {playbackLoading ? (
                  <p className="py-16 text-center font-body text-sm text-mist" role="status">
                    Loading video…
                  </p>
                ) : null}
                {playbackError ? (
                  <p className="py-8 text-center font-body text-sm text-red-800" role="alert">
                    {playbackError}
                  </p>
                ) : null}
                {playback?.streamUrl ? (
                  <video
                    ref={videoRef}
                    key={playback.streamUrl}
                    src={playback.streamUrl}
                    controls
                    playsInline
                    preload="metadata"
                    poster={active.previewUrl ?? undefined}
                    className="mx-auto max-h-[70dvh] w-full rounded-[10px] bg-black"
                    onError={() => {
                      void onVideoError()
                    }}
                  />
                ) : null}
                {!playbackLoading && !playback?.streamUrl && !playbackError ? (
                  <div className="mx-auto flex aspect-video max-h-[40dvh] w-full max-w-md flex-col items-center justify-center gap-3 rounded-[10px] bg-white/70">
                    <Play className="h-8 w-8 text-lux-gold-dark" aria-hidden />
                    <p className="font-label text-[10px] uppercase tracking-[0.28em] text-lux-gold-dark">
                      Preview not available
                    </p>
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={downloadBusy || !token}
                  onClick={() => void onDownloadOriginal()}
                  className="inline-flex min-h-11 items-center font-label text-[10px] uppercase tracking-[0.28em] text-lux-gold-dark underline-offset-4 hover:underline disabled:opacity-50"
                >
                  {downloadBusy ? 'Preparing download…' : 'Download Original'}
                </button>
              </div>
            ) : active.previewUrl ? (
              <img src={active.previewUrl} alt="" className="mx-auto max-h-[70dvh] w-auto rounded-[10px]" />
            ) : null}
            <p className="mt-4 font-display text-xl text-lux-gold-dark">{active.guestName || 'Guest'}</p>
            {active.guestMessage ? (
              <p className="mt-1 font-serif-italic text-mist">{active.guestMessage}</p>
            ) : null}
            <button
              type="button"
              className="mt-6 min-h-11 font-label text-[10px] uppercase tracking-[0.28em] text-lux-gold-dark"
              onClick={closeViewer}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </main>
  )
}
