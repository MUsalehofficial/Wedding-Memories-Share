# Implementation plan

**Product:** Private single-wedding photo/video sharing for Muhammad & Basmala  
**Production URL:** https://share-memories-with-us.musalehofficial.com  
**Constraint:** Not multi-tenant SaaS — one event, one admin, guests via access code only

## Phase 0 — Foundations (this pass)

1. Repository inventory ✅  
2. Reference design audit ✅  
3. This implementation plan ✅  
4. OneDrive upload spike plan + execution (gate) → `docs/onedrive-upload-spike.md`

**Hard gate:** Do not build the full guest/admin UI until one real upload path (browser → Graph upload session → OneDrive → verified drive item → temporary display URL) is proven and documented with evidence.

## Phase 1 — Supabase project & schema

1. Create a **new** Supabase project (do not reuse inactive `wedding-invitation-rsvp`).
2. Migrations for: `events`, `guest_sessions`, `media`, `upload_sessions`, `app_settings`, `admin_audit_log`, `rate_limit_events`, plus OneDrive integration metadata (drive IDs, folder item IDs, vault secret refs).
3. RLS: anon has **no** direct writes to media/settings/uploads; guests go through Edge Functions; admin via Auth + RLS or secured functions.
4. Seed single event row + hashed wedding code (code never in frontend).
5. Configure secrets: Microsoft OAuth, `ADMIN_EMAIL`, `GUEST_TOKEN_SIGNING_SECRET`, Vault for refresh token.

## Phase 2 — OneDrive integration (spike → production)

1. Edge Functions: `microsoft-connect`, `microsoft-callback`, `microsoft-refresh`, `microsoft-disconnect`, `microsoft-health`.
2. Folder resolve/create: `/Wedding Memories/{Originals,Previews,Exports}/…`
3. Upload session creation + browser PUT **or** chunk proxy if CORS blocks.
4. Token rotation handled transactionally; `invalid_grant` → disconnected + reconnect UI.
5. Document proof in spike doc before continuing.

## Phase 3 — Guest API

Routed Edge Function `wedding-api` (or discrete functions) covering:

- `event-info`, `verify-wedding-code` / guest session issue
- `create-upload`, `create-onedrive-upload-session`, `upload-chunk`, `complete-upload`, `cancel-upload`
- `list-gallery-media`, `get-media-display-url`

Security: rate limits, hashed codes/sessions, CORS allowlist (prod + local), request IDs, idempotency keys, no guest-supplied OneDrive paths.

## Phase 4 — Frontend shell

Stack: React + TS + Vite + Tailwind + TanStack Query + RHF/Zod + Framer Motion + HashRouter (GitHub Pages-safe), base `/`.

1. Design tokens from audit → `styles/tokens.css`
2. Reuse invitation assets (monogram, sprig, wax) in `public/`
3. Guest routes: welcome → code → upload → success → gallery → viewer → slideshow → privacy → offline
4. Admin routes: login → dashboard → moderation → settings → OneDrive → security → export

## Phase 5 — Media pipeline

- Browser preview generation (≤1600px, JPEG/WebP, EXIF stripped)
- Video poster when possible; no server transcoding
- Controlled concurrency; cancel/retry/resume; verify Graph item before `complete`

## Phase 6 — Admin moderation & controls

Approve/hide/delete/download, feature flag uploads/gallery, rotate code, revoke sessions, audit log, metadata export, OneDrive health.

## Phase 7 — Deploy

- GitHub Actions → GitHub Pages
- Custom domain CNAME docs
- Frontend env: Supabase URL + publishable key only

## Phase 8 — Tests & wedding readiness

Unit, Edge, RLS, Playwright (iPhone/Android/desktop), CORS, interrupted upload, token expiry, disabled gallery/uploads checklist in `docs/wedding-readiness-checklist.md`.

## Out of scope (explicit)

Subscriptions, payments, multi-event tenancy, public accounts, social profiles, Supabase Storage for permanent media, wedding code in QR/JS/repo secrets for frontend.

## Suggested build order after spike success

```
schema + vault wiring
→ microsoft OAuth admin connect
→ guest code + session
→ upload complete path
→ gallery display URLs
→ guest UI polish (invitation visual)
→ admin moderation
→ slideshow
→ CI/Pages/DNS
→ load/readiness tests
```

## Open decisions requiring user input

1. **Supabase:** Confirm creating a new project in org `dikuoeotvqsevzgmrfie` (region preference, e.g. `eu-central-1` or `ap-southeast-1`).
2. **Microsoft Entra app:** Admin must register an app (personal + work/school via `common` or configured authority) and supply Client ID/secret for Edge secrets.
3. **Admin email** for `ADMIN_EMAIL` allowlist.
4. **GitHub repo** name/org for Pages (`<user>.github.io` CNAME target).
