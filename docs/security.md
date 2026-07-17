# Security notes

See also root `SECURITY.md`.

## CORS

Edge Functions must allow only:

- `https://share-memories-with-us.musalehofficial.com`
- Explicit local origins (`http://localhost:5173`, etc.)

## Secrets

| Secret | Where |
|--------|-------|
| Microsoft client secret | Edge secrets only |
| Microsoft refresh token | Supabase Vault |
| Guest token signing secret | Edge secrets |
| Wedding access code | Hashed in DB only |
| Supabase service role | Edge / CI server only |

## Admin

`ADMIN_EMAIL` allowlist; Supabase Auth session required for admin routes.
