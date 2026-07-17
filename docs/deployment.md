# Deployment

## Frontend (GitHub Pages)

1. Push to GitHub.
2. Enable Pages: Settings → Pages → GitHub Actions.
3. Workflow: `.github/workflows/deploy-pages.yml` (added when CI is wired).
4. Vite `base` is `/` for the custom domain.
5. Frontend env (Actions secrets / vars): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` only.

## Custom domain

`share-memories-with-us.musalehofficial.com` — see `dns.md`.

## Supabase

1. Create dedicated project (not the inactive RSVP project).
2. Apply migrations under `supabase/migrations/`.
3. Deploy `wedding-api` Edge Function.
4. Set secrets listed in `environment.md`.

## Verify

```bash
node scripts/verify-deployment.mjs
```

(Script lands with CI wiring.)
