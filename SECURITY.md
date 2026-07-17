# Security

## Threat model (single wedding)

- Guests are untrusted devices on public networks.
- One administrator account (email allowlisted).
- Media is sensitive (faces, location EXIF in originals).

## Hard rules

1. Never put the wedding access code in the frontend bundle, QR URL, GitHub Actions, or public tables.
2. Never expose Microsoft client secret, access tokens, refresh tokens, guest signing secret, or Supabase service-role key to the browser.
3. Store only hashes of access codes and guest session tokens.
4. Store Microsoft refresh tokens in Supabase Vault; replace on rotation; never log.
5. Guests never receive original-file download links; gallery uses temporary authorized display URLs for previews only.
6. Edge Function CORS is restricted to the production origin and explicit local origins.
7. Admin destructive actions require confirmation and write `admin_audit_log`.

## Guest session

1. Guest submits code → Edge Function rate-limits → verifies hash → issues short-lived opaque token.
2. Browser sends token on guest APIs; server verifies hash + expiry + revocation.
3. Admin can revoke all guest sessions.

## OneDrive

- Delegated Graph `Files.ReadWrite` + `offline_access`.
- On `invalid_grant`, mark integration disconnected and require reconnect.
- Never trust client-supplied OneDrive paths; server resolves folder IDs.

## Reporting

Treat this as a private wedding site. If you find a vulnerability during setup, fix it before the wedding weekend and rotate the access code + Microsoft connection.
