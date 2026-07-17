# Share Memories With Us

Private wedding photo & video sharing for **Muhammad & Basmala**.

Production: https://share-memories-with-us.musalehofficial.com

## Status

- Storage: **Google Drive** originals + private Supabase `wedding-previews`
- OAuth consent: **In production**
- Product: Guest upload + gallery MVP (no admin dashboard)

## Guest routes

| Path | Purpose |
|------|---------|
| `/#/` | Welcome |
| `/#/join/<token>` | QR automatic guest access (opaque invite) |
| `/#/access` | Manual wedding code (fallback) |
| `/#/upload` | Multi-file resumable upload |
| `/#/gallery` | Preview gallery |
| `/#/privacy` | Privacy |

## Operator controls

No public admin UI. Use [`docs/operations.md`](docs/operations.md) and `node scripts/ops.mjs …`.

## Docs

- Capacity: `docs/gdrive-capacity.md`
- Spike / hardening evidence: `docs/gdrive-upload-spike.md`
- Environment: `docs/environment.md`
- Operations: `docs/operations.md`
- QR access: `docs/qr-access.md`
