# Reference design audit

**Source:** https://muhammad-and-basmala-wedding-invitation.musalehofficial.com/  
**Captured:** 2026-07-17  
**Method:** Live CSS/JS download + Playwright screenshots + `getComputedStyle` extraction  
**Evidence:** `docs/reference-screenshots/`

This photo-sharing site must feel like a continuation of the invitation — warm linen paper, gold accents, editorial typography — not a SaaS dashboard.

## Screenshots

| File | Viewport |
|------|----------|
| `desktop-viewport.png` / `desktop-full.png` | 1440×900 cover screen |
| `mobile-viewport.png` / `mobile-full.png` | 390×844 cover screen |
| `desktop-inner.png` / `mobile-inner.png` | After “OPEN INVITATION” |
| `extracted-tokens.json` | Live computed styles |

Default document class: `theme-light` (light linen theme). Dark linen (`invite-linen-dark`) exists via a theme toggle; guest photo-sharing pages should default to **light**, matching the invitation cover.

## Typography

| Role | Family | Weights / styles | Usage |
|------|--------|------------------|-------|
| **Heading / couple names** | **Italiana**, fallback Cormorant Garamond, serif | 400 | `.font-display` — “Muhammad & Basmala” |
| **Body** | **Cormorant Garamond**, Georgia, serif | 400, 500; italic 400/500 | `body` default; `.font-serif-italic` for “&” |
| **Script / calligraphy** | **Pinyon Script**, cursive | 400 | `.font-script` — e.g. “with love” |
| **Labels / UI chrome** | **Jura**, system-ui, sans-serif | 300 (light), 400 | `.font-label` — uppercase tracked labels, CTAs |

Fonts are self-hosted as WOFF2 on the invitation CDN (`/assets/cormorant-garamond-*.woff2`, `italiana-*.woff2`, `jura-*.woff2`, `pinyon-script-*.woff2`).  
**Do not substitute** with Inter/Roboto/Playfair approximations. Load the same families via `@fontsource` packages or copied WOFF2 files.

### Couple-name styling (cover)

- Stack: Muhammad / & / Basmala, centered
- Names: Italiana, color `var(--lux-gold-dark)` `#7a5528`
- Ampersand: Cormorant Garamond italic-adjacent, color `var(--lux-gold)` `#b8863b`
- Measured sizes:
  - Desktop: names **64.8px**, `&` **45.6px**
  - Mobile: names **35.1px**, `&` **25.35px**
- Inner invitation names: Italiana, foreground `#382b24` — desktop **~77.6px**, mobile **~43.2px** (`text-[2.7rem]` / `sm:text-[4.85rem]`)

### Label styling

- Jura 300, ~10–11px, uppercase, tracking **0.32em–0.36em**
- Color: `--lux-gold-dark` on cover; muted mist tones inside

## Color tokens (extracted)

### Brand golds (hex, always available)

| Token | Value | Role |
|-------|-------|------|
| `--lux-gold` | `#b8863b` | Accent gold |
| `--lux-gold-dark` | `#7a5528` | Primary CTA / name color (light theme) |
| `--lux-beige` | `#d8c7a3` | Soft gold / beige highlight |

### Light theme (`html.theme-light`) — HSL channels used as `hsl(var(--token))`

| Token | HSL | Approx hex | Role |
|-------|-----|------------|------|
| `--background` | `36 24% 97%` | `#f9f7f5` | Page background |
| `--foreground` | `22 22% 18%` | `#382b24` | Body text |
| `--card` | `0 0% 100%` | `#ffffff` | Card / frame fill |
| `--primary` | `30 36% 28%` | `#61472d` | Primary actions |
| `--primary-foreground` | `0 0% 100%` | `#ffffff` | On-primary text |
| `--secondary` | `35 28% 92%` | `#f0ebe4` | Secondary surfaces |
| `--muted` | `35 26% 93%` | `#f1ede8` | Muted surfaces |
| `--muted-foreground` | `24 14% 40%` | `#746357` | Secondary text |
| `--accent` | `34 32% 90%` | `#ede6dd` | Soft accent fill |
| `--border` | `34 24% 78%` | `#d4c8b9` | Borders / inputs |
| `--ring` | `30 36% 28%` | `#61472d` | Focus ring |
| `--candle` | `34 32% 40%` | `#866a45` | Warm accent |
| `--candle-soft` | `30 30% 24%` | `#503d2b` | Deep warm text |
| `--gold-line` | `34 22% 62%` | `#b3a088` | Frame borders |
| `--mist` | `24 16% 34%` | `#645348` | Soft body copy |
| `--radius` | `.55rem` | — | Base radius |

**Theme meta:** `theme-color` = `#2a2419`

### Main background (linen)

`.invite-linen-light`:

- Base `#faf7f0`
- Gradient: `linear-gradient(180deg, #fcf9f2, #f5f0e6)` plus radial beige wash `rgb(216 199 163 / .45)`
- SVG fractal-noise overlay at **22% opacity**, `mix-blend-mode: multiply`, tile **160×160**

Use this linen treatment for guest-facing pages. Do not use flat pure white or purple SaaS gradients.

### Card / invitation frame (light)

`.frame-cinematic` under light theme:

- Fill: `#fffcf6eb` with soft beige radial + `#fffefa` → `#faf7f0` gradient
- Border: gold `#b8863b` at ~28–38% alpha (`#b8863b47` / `#b8863b61`)
- Shadow: `0 24px 44px -24px #1c140d26`, inset highlight `#ffffffb3`

## Buttons

Primary CTA pattern (`.btn-luxury` + gold-dark fill):

- Background: `var(--lux-gold-dark)` `#7a5528`
- Text: white, Jura light, uppercase, tracking `0.34em`, ~11px
- Radius: **10px** mobile / **11px** desktop
- Padding: ~`0.55–0.62rem` vertical, generous horizontal (`px-14`)
- Shadow: `0 10px 32px -8px rgb(122 85 40 / 0.42), 0 4px 12px -4px rgba(0,0,0,0.12)`
- Hover: `brightness(1.10)`, lift via `translateY(-1px)`, deeper gold shadow
- Active: `scale(0.99)`
- Transition: `transform/box-shadow/filter` **300–320ms**, easing `cubic-bezier(.22, 1, .36, 1)`

Secondary / ghost: transparent with gold border; avoid heavy card chrome on guest pages.

## Border radii

| Token / usage | Value |
|---------------|-------|
| `--radius` | `0.55rem` (~8.8px) |
| Primary CTA | 10–11px |
| Theme toggle | `9999px` (full pill — use sparingly; invitation uses it only for the floating theme control) |

## Shadows

| Context | Value |
|---------|-------|
| Primary button | Gold-tinted elevation (see Buttons) |
| Soft panel | `0 24px 44px -24px #1c140d26` |
| Floating control | `0 8px 24px -8px rgba(0,0,0,0.35)` |
| Hover luxury | `0 16px 40px -12px #7a552859` |

Avoid multi-layer neon/glow shadows.

## Spacing scale

Tailwind default spacing is in use (4px base). Invitation patterns observed:

- Generous vertical rhythm; cover content vertically centered
- Section padding roughly `py-8`–`py-16` with constrained `max-w` columns
- CTA `min-w-[min(100%,18.5rem)]` for comfortable touch width

## Decorative assets (reused from invitation)

Downloaded for audit / reuse (hashless copies):

| Asset | Source | Role |
|-------|--------|------|
| `wax.png` | `wax-C-oPC6hn.png` | Wax seal ornament |
| `MB-monogram.png` | `MB-D7ElmX27.png` | M·B monogram |
| `ringslove.png` | `ringslove-C3XG7upH.png` | Rings / love graphic |
| `sprig.png` | `sprig-a6b0BBkc.png` | Floral sprig |
| `og-share.png` | site root | Open Graph share image |
| `favicon.svg` | site root | Favicon |

No random stock wedding photos. Prefer monogram, sprig, wax, and linen texture as ornament.

## Animation timing and easing

| Animation | Duration | Easing | Effect |
|-----------|----------|--------|--------|
| `editorial-fade-up` / `.animate-editorial-rise` | **0.95s** | `cubic-bezier(.22, 1, .36, 1)` | Fade + rise 18px |
| `cinematic-rise` | **0.7s** | same | Rise 22px |
| `cinematic-fade` | **0.9s** | `ease` | Opacity only |
| Button transitions | **0.32s** | same + ease for shadow | Lift / shadow |
| Accordion | 0.2s | ease-out | UI chrome only |

Respect `prefers-reduced-motion`: disable rise/drift; keep opacity fades minimal or instant.

## Responsive behavior

- Mobile-first cover: smaller Italiana names (~35px), stacked CTAs full-width capped
- Desktop: larger display type, more horizontal breathing room
- Safe areas: invitation uses fixed bottom-right theme control with `bottom-7 right-6` — photo app should add `env(safe-area-inset-*)` on iPhone upload chrome
- Touch targets: primary CTA height comfortably ≥44px with wide padding

## Copy cues to continue

From the invitation (for welcome / romantic tone):

- “Love is in the air.”
- “Where Our Forever Begins”
- “We invite you to share in our joy…”
- “with love” (Pinyon Script)

Suggested photo-site parallel: invite guests to share memories of the night, not “upload assets.”

## Implementation rule for this repo

Centralize tokens as CSS custom properties in `frontend/src/styles/tokens.css` mirroring the invitation names (`--lux-gold`, `--lux-gold-dark`, linen backgrounds, HSL shadcn-compatible channels). Tailwind theme maps to those variables. Guest pages use linen + Italiana; admin may be slightly denser but must keep the same palette (no blue/purple SaaS skin).
