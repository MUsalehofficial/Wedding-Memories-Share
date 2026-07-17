# Environment variables

## Frontend (publishable only)

```bash
VITE_SUPABASE_URL=https://vszfgqylajnvdbjqadjr.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable or legacy anon key from dashboard>
VITE_APP_ORIGIN=http://localhost:5173
```

## Edge Function secrets

Set in Dashboard → Edge Functions → Secrets, or:

```bash
npx supabase secrets set --project-ref vszfgqylajnvdbjqadjr \
  R2_ACCOUNT_ID=... \
  R2_ACCESS_KEY_ID=... \
  R2_SECRET_ACCESS_KEY=... \
  R2_BUCKET_NAME=wedding-memories \
  R2_S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
  ADMIN_EMAIL=you@example.com \
  GUEST_TOKEN_SIGNING_SECRET=<long-random>
```

Never commit secrets. Microsoft / OneDrive secrets are **not** used (integration superseded).
