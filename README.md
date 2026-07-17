# Share Memories With Us

Private wedding photo & video sharing for **Muhammad & Basmala**.

Production: https://share-memories-with-us.musalehofficial.com  
Visual reference: https://muhammad-and-basmala-wedding-invitation.musalehofficial.com/

## Status

Supabase project `vszfgqylajnvdbjqadjr` is live. **R2 upload spike** is the current gate (OneDrive was superseded).

## Docs

| Doc | Purpose |
|-----|---------|
| [docs/architecture.md](docs/architecture.md) | System design (R2) |
| [docs/r2-upload-spike.md](docs/r2-upload-spike.md) | Upload POC + evidence |
| [docs/r2-cors.md](docs/r2-cors.md) | Bucket CORS policy |
| [docs/reference-design-audit.md](docs/reference-design-audit.md) | Invitation design tokens |
| [docs/onedrive-upload-spike.md](docs/onedrive-upload-spike.md) | Historical — superseded |

## Stack

- Frontend: React, TypeScript, Vite, Tailwind, HashRouter (GitHub Pages)
- Backend: Supabase (Postgres, Auth, Edge Functions)
- Media: **Cloudflare R2** (private bucket, presigned URLs)

## Local frontend

```bash
cd frontend
cp ../docs/environment.md # use as guide for .env
npm install
npm run dev
```

Spike UI: `/#/admin/spike-upload`
