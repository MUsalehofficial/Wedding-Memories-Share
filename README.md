# Share Memories With Us

Private wedding photo & video sharing for **Muhammad & Basmala**.

Production: https://share-memories-with-us.musalehofficial.com  
Visual reference: https://muhammad-and-basmala-wedding-invitation.musalehofficial.com/

## Status

Phase 0 complete (inventory, design audit, implementation plan, OneDrive spike plan).  
OneDrive upload spike is the next gate — requires a Supabase project and Microsoft Entra app credentials before live proof.

## Docs

| Doc | Purpose |
|-----|---------|
| [docs/repository-inventory.md](docs/repository-inventory.md) | What was in the repo at start |
| [docs/reference-design-audit.md](docs/reference-design-audit.md) | Extracted invitation design tokens |
| [docs/implementation-plan.md](docs/implementation-plan.md) | Phased build plan |
| [docs/onedrive-upload-spike.md](docs/onedrive-upload-spike.md) | Upload POC plan + evidence |

## Stack

- Frontend: React, TypeScript, Vite, Tailwind, HashRouter (GitHub Pages)
- Backend: Supabase (Postgres, Auth, Edge Functions, Vault)
- Media: Microsoft OneDrive via Graph (not Supabase Storage)

## Local frontend

```bash
cd frontend
npm install
npm run dev
```

## Principles

- Single wedding, single admin — no SaaS multi-tenancy
- Guests use a wedding access code (never shipped in the JS bundle)
- Originals and previews live in OneDrive; Supabase stores metadata only
- Secrets stay in Edge Function / Vault configuration
