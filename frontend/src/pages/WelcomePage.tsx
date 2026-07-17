import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'

export function WelcomePage() {
  const reduceMotion = useReducedMotion()

  return (
    <main className="invite-linen relative flex min-h-dvh flex-col items-center justify-center px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="relative z-[1] flex w-full max-w-lg flex-col items-center text-center">
        <motion.img
          src="/wax.png"
          alt=""
          aria-hidden
          className="mb-6 h-14 w-auto object-contain drop-shadow-[0_22px_36px_rgba(0,0,0,0.42)] sm:h-16"
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />

        <p className="animate-editorial-rise font-label text-[10px] tracking-[0.32em] text-lux-gold-dark">
          Share Memories With Us
        </p>

        <h1 className="animate-editorial-rise relative z-[1] mt-4 font-display leading-[1.06] text-lux-gold-dark">
          <span className="block text-[2.2rem] sm:text-[4.05rem]">Muhammad</span>
          <span className="font-serif-italic my-1 block text-[1.6rem] text-lux-gold sm:text-[2.85rem]">
            &amp;
          </span>
          <span className="block text-[2.2rem] sm:text-[4.05rem]">Basmala</span>
        </h1>

        <p className="animate-editorial-rise mt-5 max-w-sm font-serif-italic text-lg text-mist sm:text-xl">
          Love is in the air — help us keep every moment of our forever.
        </p>

        <div className="animate-editorial-rise mt-8 flex w-full flex-col items-center gap-3 sm:mt-10">
          <Link
            to="/access?next=upload"
            className="btn-luxury inline-flex min-h-11 w-full max-w-[18.5rem] items-center justify-center rounded-[10px] bg-lux-gold-dark px-10 py-[0.55rem] font-label text-[11px] font-light uppercase tracking-[0.34em] text-white shadow-[0_10px_32px_-8px_rgb(122_85_40/0.42),0_4px_12px_-4px_rgba(0,0,0,0.12)] sm:rounded-[11px] sm:py-[0.62rem]"
          >
            Share a Memory
          </Link>
          <Link
            to="/access?next=gallery"
            className="inline-flex min-h-11 w-full max-w-[18.5rem] items-center justify-center rounded-[10px] border border-lux-gold/40 bg-transparent px-10 py-[0.55rem] font-label text-[11px] font-light uppercase tracking-[0.34em] text-lux-gold-dark transition-colors hover:border-lux-gold/65 hover:bg-white/40 sm:rounded-[11px]"
          >
            View Our Memories
          </Link>
        </div>

        <Link
          to="/privacy"
          className="mt-10 font-label text-[10px] tracking-[0.2em] text-muted-foreground underline-offset-4 hover:underline"
        >
          Privacy
        </Link>
      </div>
    </main>
  )
}
