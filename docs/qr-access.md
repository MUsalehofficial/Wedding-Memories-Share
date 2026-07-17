# QR guest access

Guests can open the wedding app by scanning one QR code — no wedding access code typing.

## How it works

1. Operator creates an opaque invite token (`create-qr-invite`).
2. Only the **SHA-256 hash** of the token is stored in `qr_invite_tokens`.
3. The guest URL is:

   `https://share-memories-with-us.musalehofficial.com/#/join/<INVITE_TOKEN>`

4. The SPA calls `POST …/exchange-invite-token`, receives a short-lived guest session, strips the token from the URL, and continues to upload/gallery.
5. Manual fallback remains: `/#/access` with the wedding access code.

**Security note:** Possession of a valid QR (or its invite URL) grants wedding guest access. Treat printed QRs like physical keys. Do not post the invite URL in public chats, commits, or issue trackers.

Rotating the wedding access code does **not** revoke QR invites. Revoking QR invites does **not** delete uploaded media. Use `revoke-guest-sessions` to invalidate already-issued guest sessions (including ones minted via QR).

## Create a QR invite

```bash
export SUPABASE_URL=https://vszfgqylajnvdbjqadjr.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...   # never commit

# Optional expiry (ISO-8601). Default: 180 days from now.
# export QR_INVITE_EXPIRES_AT=2026-12-31T23:59:59.000Z

node scripts/ops.mjs create-qr-invite
# stdout: the guest URL (once). stderr: sanitized metadata.
```

Never pass the token or URL as a CLI argument.

## Generate printable QR images

Paste the invite URL on stdin (not argv):

```bash
node scripts/ops.mjs generate-qr
# → /tmp/wedding-qr-*.png (phones / print)
# → /tmp/wedding-qr-*.svg (high-quality print)
```

Do **not** commit production QR images or invite URLs — they are live credentials.

## List / revoke

```bash
node scripts/ops.mjs list-qr-invites          # ids + timestamps only
OPS_CONFIRM=YES node scripts/ops.mjs revoke-qr-invites
```

After revoke, print a replacement: create a new invite, generate new PNG/SVG, destroy old prints.

## Manual wedding-code fallback

`/#/access` continues to work independently of QR invites.

## Wedding retirement

1. `OPS_CONFIRM=YES node scripts/ops.mjs revoke-qr-invites`
2. `node scripts/ops.mjs revoke-guest-sessions`
3. `node scripts/ops.mjs disable-uploads` (and gallery if desired)
4. Destroy printed QRs and any saved invite URLs
5. Optionally rotate the wedding access code
