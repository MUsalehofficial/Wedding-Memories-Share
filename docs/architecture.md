# Architecture

Single-wedding private media sharing for Muhammad & Basmala.

```
Guest phone ──HashRouter SPA (GitHub Pages)──► Supabase Edge Functions
                                                    │
                                                    ├─► Postgres (metadata, RLS)
                                                    └─► Cloudflare R2 (private bucket)
                                                          wedding-memories
                                                          events/main/...
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
| Media bytes | **Cloudflare R2** (private Standard bucket) |

## Media principles

- Bucket is private — no public access, no guest listing.
- Edge Functions mint short-lived presigned URLs (`PutObject` / `GetObject`).
- Browser uploads **directly to R2** via presigned PUT (CORS allowlisted origins only).
- Gallery uses preview objects + short-lived GET URLs from Postgres-backed pagination.
- Originals only via admin-secured GET.
- Never store presigned URLs in Postgres.
- Never use guest filenames as object keys.

## Object key layout

```
events/main/originals/images/<uuid>.<ext>
events/main/originals/videos/<uuid>.<ext>
events/main/previews/images/<uuid>.webp
events/main/previews/video-posters/<uuid>.webp
```

## Secrets (Edge Function only)

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME` (expected: `wedding-memories`)
- `R2_S3_ENDPOINT` (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`)
- `ADMIN_EMAIL`
- `GUEST_TOKEN_SIGNING_SECRET`

## Docs map

- Design: `reference-design-audit.md`
- R2 spike gate: `r2-upload-spike.md`
- R2 CORS: `r2-cors.md`
- OneDrive spike (historical): `onedrive-upload-spike.md` — **superseded**
