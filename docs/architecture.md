# Architecture

Single-wedding private media sharing.

```
Guest phone ──HashRouter SPA (GitHub Pages)──► Supabase Edge Functions
                                                    │
                                                    ├─► Postgres (metadata, RLS)
                                                    ├─► Vault (Microsoft refresh token)
                                                    └─► Microsoft Graph ──► OneDrive
                                                                            /Wedding Memories/...
Admin browser ──Supabase Auth──► same Edge Functions + authenticated RLS
```

## Principles

- One event row; no multi-tenant SaaS.
- Guests: access code → short-lived hashed session token; no accounts.
- Media binaries only in OneDrive; Supabase stores IDs and moderation state.
- Browser may upload via Graph `uploadUrl` if CORS allows; otherwise Edge chunk proxy.

## Docs map

- Design: `reference-design-audit.md`
- Spike gate: `onedrive-upload-spike.md`
- Deploy/DNS/security/readiness: sibling docs in this folder
