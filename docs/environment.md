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
  GUEST_TOKEN_SIGNING_SECRET=<long-random>
```

Google Cloud Console → OAuth client (Web) → Authorized redirect URI must match `GOOGLE_REDIRECT_URI` exactly.

R2 / Microsoft secrets are not used (superseded).
