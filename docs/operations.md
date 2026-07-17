# Operations (single wedding — no admin dashboard)

Operational controls are **not** exposed in the guest UI. Use Supabase Studio, secured API calls, or:

```bash
export SUPABASE_URL=https://vszfgqylajnvdbjqadjr.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...   # never commit

node scripts/ops.mjs help
node scripts/ops.mjs status
node scripts/ops.mjs enable-uploads
node scripts/ops.mjs disable-uploads
node scripts/ops.mjs enable-videos
node scripts/ops.mjs disable-videos
node scripts/ops.mjs enable-gallery
node scripts/ops.mjs disable-gallery
node scripts/ops.mjs revoke-guest-sessions
node scripts/ops.mjs list-media 30
node scripts/ops.mjs hide-media <mediaId>
OPS_CONFIRM=YES node scripts/ops.mjs delete-media <mediaId>
node scripts/ops.mjs quota
OPS_CONFIRM=YES node scripts/ops.mjs clean-abandoned
node scripts/ops.mjs reconcile              # report-only
OPS_CONFIRM=YES node scripts/ops.mjs reconcile --apply
node scripts/ops.mjs rotate-access-code     # prompts twice (no echo); or pipe two matching lines on stdin
node scripts/ops.mjs create-qr-invite       # prints guest URL once; stores hash only
node scripts/ops.mjs list-qr-invites
OPS_CONFIRM=YES node scripts/ops.mjs revoke-qr-invites
node scripts/ops.mjs generate-qr            # stdin: invite URL → PNG+SVG in /tmp
```

### Rotate wedding access code

Never pass the raw code as a CLI argument (shell history / `ps`).

```bash
node scripts/ops.mjs rotate-access-code
# or non-interactive:
# printf '%s\n%s\n' "$NEW_CODE" "$NEW_CODE" | node scripts/ops.mjs rotate-access-code
```

Stores only a fresh salt + SHA-256 hash, increments `guest_token_version` (revokes existing guest sessions), and prints a sanitized result (no raw code).

Does **not** automatically revoke QR invite tokens — see `docs/qr-access.md`.

## QR automatic access

See **`docs/qr-access.md`** for create / revoke / print / retirement. Guest URL shape:

`https://share-memories-with-us.musalehofficial.com/#/join/<INVITE_TOKEN>`

Manual fallback: `/#/access`.

## Google Drive reconnect

When Edge reports `google_drive_reconnect_required` / `invalid_grant`:

1. Uploads are paused automatically; gallery previews remain available.
2. Drive media is **not** deleted.
3. Admin-only reconnect: open `/#/admin/drive`, enter `ADMIN_PANEL_SECRET` (password field → `sessionStorage` only), or call `GET …/google-connect` with header `x-admin-secret: <ADMIN_PANEL_SECRET>` over HTTPS and complete Google consent in the browser.
   - `ADMIN_EMAIL` is never accepted as a passphrase.
   - If `ADMIN_PANEL_SECRET` is unset, reconnect is disabled and the page shows “Administrator access is not configured.”
4. Existing Vault refresh token is updated in place when reconnect succeeds — do not revoke a still-valid token preemptively.

## Manual Google Drive deletion warning

Deleting an original **directly in Google Drive** does **not** automatically remove:

- The Supabase `media` row
- The private preview / poster in `wedding-previews`
- The gallery entry (until the row is hidden/deleted)

After manual Drive deletion, run:

```bash
node scripts/ops.mjs reconcile
```

Prefer the secured delete path so Drive + Storage + DB stay consistent:

```bash
OPS_CONFIRM=YES node scripts/ops.mjs delete-media <mediaId>
```

## Moderation

`events.moderation_enabled` defaults to **false** for this wedding.

- `false`: after Drive verification succeeds, media is auto-`approved` for the gallery.
- `true`: verified completes stay `pending` (not shown in gallery until approved via Studio/SQL).

Upload verification (capacity, MIME, Drive metadata, private permissions) always runs regardless of moderation.
