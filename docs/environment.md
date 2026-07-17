# Environment variables

Copy into a local `.env` for the frontend (never commit secrets).

## Frontend (publishable only)

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
VITE_APP_ORIGIN=http://localhost:5173
```

## Edge Function secrets

Set with `supabase secrets set` — never commit:

```
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
MICROSOFT_AUTHORITY=https://login.microsoftonline.com/common
MICROSOFT_REDIRECT_URI=https://YOUR_PROJECT.supabase.co/functions/v1/wedding-api/microsoft-callback
MICROSOFT_SCOPES=Files.ReadWrite offline_access openid profile
ADMIN_EMAIL
GUEST_TOKEN_SIGNING_SECRET
ALLOWED_ORIGINS=https://share-memories-with-us.musalehofficial.com,http://localhost:5173
```
