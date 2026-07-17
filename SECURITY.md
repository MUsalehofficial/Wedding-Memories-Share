# Security

## Threat model (single wedding)

- Guests are untrusted devices on public networks.
- One administrator account (email allowlisted).
- Media is sensitive (faces; strip GPS from previews).

## Hard rules

1. Never put the wedding access code in the frontend bundle, QR URL, GitHub Actions, or public tables.
2. Never expose R2 access keys, Supabase service-role key, or guest signing secret to the browser.
3. Store only hashes of access codes and guest session tokens.
4. Guests receive short-lived presigned GET URLs for **previews** only — never permanent object URLs or originals.
5. Edge Function CORS is restricted to the production origin and explicit local origins.
6. R2 bucket stays private; no public access; no guest bucket listing.
7. Admin destructive actions require confirmation and write `admin_audit_log`.

## Guest session

1. Guest submits code → Edge Function rate-limits → verifies hash → issues short-lived opaque token.
2. Browser sends token on guest APIs; server verifies hash + expiry + revocation.
3. Admin can revoke all guest sessions.

## Cloudflare R2

- Presigned PUT bound to `Content-Type`, short expiry (~5 minutes).
- Complete path verifies with `HeadObject` before marking uploaded.
- Delete only via secured admin/Edge paths.

## Historical note

OneDrive / Microsoft Graph was cancelled before production use. See `docs/onedrive-upload-spike.md` (superseded).
