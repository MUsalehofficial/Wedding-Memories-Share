# Share Memories With Us

Private wedding photo & video sharing for **Muhammad & Basmala**.

Production: https://share-memories-with-us.musalehofficial.com

## Status

Storage backend: **Google Drive** (R2 / OneDrive superseded).  
Current gate: [`docs/gdrive-upload-spike.md`](docs/gdrive-upload-spike.md) — live OAuth + `about.get` quota proof.

## Stack

- Frontend: React, Vite, GitHub Pages
- Backend: Supabase (`vszfgqylajnvdbjqadjr`)
- Media: Google Drive via Edge Functions + Vault refresh token
- Capacity: live `about.get` (never hardcoded GB totals)

## Spike UI

`/#/admin/spike-upload` · `/#/admin/capacity`
