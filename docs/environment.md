# Environment variables

## Frontend (publishable only)

```bash
VITE_SUPABASE_URL=https://vszfgqylajnvdbjqadjr.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable or legacy anon key>
VITE_APP_ORIGIN=http://localhost:5173
```

## Edge Function secrets

```bash
npx supabase secrets set --project-ref vszfgqylajnvdbjqadjr \
  GOOGLE_CLIENT_ID=... \
  GOOGLE_CLIENT_SECRET=... \
  GOOGLE_REDIRECT_URI=https://vszfgqylajnvdbjqadjr.supabase.co/functions/v1/wedding-api/google-callback \
  GOOGLE_SCOPES="https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly" \
  ADMIN_EMAIL=you@example.com \
  ADMIN_PANEL_SECRET=<long-random-admin-panel-passphrase> \
  GUEST_TOKEN_SIGNING_SECRET=<long-random>
```

`ADMIN_PANEL_SECRET` is **required** for `/google-connect`, admin `gdrive-status`, and `/#/admin/drive` reconnect. If unset, those paths fail closed. `ADMIN_EMAIL` is identity-only and is **never** accepted as the admin passphrase.

Google Cloud Console → OAuth client (Web) → Authorized redirect URI must match `GOOGLE_REDIRECT_URI` exactly.

OAuth consent screen publishing status: **In production**. Keep the existing Vault refresh token while valid; on `invalid_grant` the API marks `reconnect_required`, pauses uploads, leaves gallery previews and Drive media intact, and exposes admin-only Reconnect.

R2 / Microsoft secrets are not used (superseded).

### Guest access code

Stored only as salt+hash in `events` (never in the frontend bundle). Verify via `POST …/verify-access-code`.