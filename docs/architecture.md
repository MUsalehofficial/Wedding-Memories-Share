# Architecture

Single-wedding private media sharing for Muhammad & Basmala.

```
Guest phone ──HashRouter SPA (GitHub Pages)──► Supabase Edge Functions
                                                    │
                                                    ├─► Postgres (metadata, RLS, capacity settings)
                                                    ├─► Vault (Google refresh token)
                                                    └─► Google Drive API
                                                          Wedding Memories / …
Admin browser ──Supabase Auth──► same Edge Functions + authenticated RLS
```

## Hosting

| Piece | Choice |
|-------|--------|
| Frontend | GitHub Pages |
| Domain | `https://share-memories-with-us.musalehofficial.com` |
| Backend | Supabase project `vszfgqylajnvdbjqadjr` |
| Metadata | Supabase Postgres |
| Admin auth | Supabase Auth (`ADMIN_EMAIL` allowlist) |
| APIs | Edge Function `wedding-api` |
| Media bytes | **Google Drive** (private app folder tree) |

## Capacity (source of truth)

Before every original upload session, Edge Functions call Google Drive `about.get` and read:

- `storageQuota.limit`
- `storageQuota.usage`
- `storageQuota.usageInDrive`
- `storageQuota.usageInDriveTrash`
- `maxUploadSize`

Never hardcode total capacity (including not assuming 15 GB). Google plan upgrades apply automatically because quota is re-fetched live.

Configurable (DB settings, not baked-in GB totals):

- Safety reserve bytes (extra headroom beyond the file size)
- Video uploads enabled/disabled
- Warn / critical thresholds (default 20% / 10% remaining)

## Media principles

- Never use guest filenames as Drive paths; store sanitized name as metadata only.
- Collision-resistant server-generated names + Drive file IDs in Postgres.
- Gallery uses short-lived authorized display URLs (Edge-mediated); no public Drive folder links.
- Originals for admin only.
- Do not auto-delete media when capacity is exhausted.

## Secrets (Edge only)

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_SCOPES`
- `ADMIN_EMAIL`
- `GUEST_TOKEN_SIGNING_SECRET`

## Docs map

- Spike gate: `gdrive-upload-spike.md`
- Capacity rules: `gdrive-capacity.md`
- Design: `reference-design-audit.md`
- R2 spike (superseded): `r2-upload-spike.md`
- OneDrive spike (superseded): `onedrive-upload-spike.md`
