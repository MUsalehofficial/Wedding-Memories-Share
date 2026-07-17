# Security

## Hard rules

1. Wedding access code never in frontend / QR / Actions.
2. Never expose Google client secret, refresh/access tokens, service-role key, or guest signing secret.
3. Google refresh token in Supabase Vault; rotate on refresh; `invalid_grant` → disconnected.
4. Capacity from live Drive `about.get` — never a hardcoded total (including not 15 GB).
5. Guests get Edge-mediated display only; no public Drive folder links.
6. Do not auto-delete media when storage is full.

See `docs/gdrive-capacity.md`.
