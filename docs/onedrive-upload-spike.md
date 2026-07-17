# OneDrive upload spike

**Status:** PLAN READY — execution blocked on Microsoft app credentials + new Supabase project  
**Goal:** Prove the permanent-media path before building the full product UI  
**Rule:** Do not claim success without recorded evidence below

## What must be proven

| # | Step | Pass criteria |
|---|------|---------------|
| 1 | Admin connects OneDrive | OAuth authorization code + PKCE completes; refresh token stored in Vault (never logged) |
| 2 | Edge Function refreshes token | Valid Graph access token obtained from stored refresh token |
| 3 | Edge Function creates upload session | Microsoft Graph returns `uploadUrl` for a collision-resistant filename under `/Wedding Memories/Originals/images/` |
| 4 | Browser uploads test file | PUT (or chunked proxy) of a small JPEG succeeds |
| 5 | Supabase verifies drive item | Graph `GET /drives/{id}/items/{id}` confirms size/hash; DB row stores drive item IDs |
| 6 | Browser displays image | Temporary authorized download/display URL returned by Edge Function; `<img>` loads |

## CORS assumption

Do **not** assume browser PUT to `uploadUrl` is allowed. Spike order:

1. Try direct browser PUT to Graph `uploadUrl`.
2. If CORS/network blocks → implement Edge Function chunk proxy (`upload-chunk`): small sequential chunks, stream where possible, keep `uploadUrl` server-side, persist progress, support retry/resume.
3. Document which path worked in **Evidence**.

## Folder structure to create

```
/Wedding Memories/
├── Originals/images/
├── Originals/videos/
├── Previews/images/
├── Previews/video-posters/
└── Exports/
```

Filenames: `2026-07-17T161522Z_<uuid>_original.jpg` (UTC + UUID + sanitized ext). Never trust user filenames as paths.

## Spike architecture (minimal)

```
Admin browser
  → microsoft-connect (Edge) → Microsoft authorize
  → microsoft-callback (Edge) → Vault store refresh_token

Spike page (admin-authenticated)
  → create-onedrive-upload-session (Edge)
      → refresh token if needed
      → createUploadSession
  → browser PUT uploadUrl  OR  upload-chunk (Edge)
  → complete-upload (Edge) verifies drive item
  → get-media-display-url (Edge) → temporary Graph download URL
```

## Secrets required (Edge Function only)

- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_AUTHORITY` (e.g. `https://login.microsoftonline.com/common`)
- `MICROSOFT_REDIRECT_URI`
- `MICROSOFT_SCOPES` (`Files.ReadWrite offline_access openid profile`)
- `ADMIN_EMAIL`
- `GUEST_TOKEN_SIGNING_SECRET` (not needed for admin-only spike, still provision)

Never expose client secret, access/refresh tokens, or service role key to the frontend.

## Execution checklist

- [ ] New Supabase project created and linked
- [ ] Microsoft Entra app registered (SPA + confidential web redirect for Edge callback, or confidential only with server-side exchange)
- [ ] Edge secrets set
- [ ] Migrations for spike tables applied (`onedrive_integrations`, minimal `media` / `upload_sessions`)
- [ ] Functions deployed: connect, callback, refresh, create upload session, upload-chunk, complete, display-url, health
- [ ] Admin connect UI / spike page reachable locally
- [ ] Steps 1–6 executed
- [ ] Evidence filled in below
- [ ] Decision recorded: **direct PUT** vs **chunk proxy**

## Evidence (fill only after real runs)

### Environment

| Field | Value |
|-------|-------|
| Date | _pending_ |
| Supabase project ref | _pending_ |
| Microsoft authority | _pending_ |
| Account type tested | Personal / Work-school |
| Upload path used | Direct PUT / Chunk proxy |

### Step results

| Step | Result | Notes / request IDs |
|------|--------|---------------------|
| 1 Connect | _pending_ | |
| 2 Refresh | _pending_ | |
| 3 Create session | _pending_ | |
| 4 Upload bytes | _pending_ | |
| 5 Verify item | _pending_ | driveItem id: |
| 6 Display URL | _pending_ | |

### Failure log

_None yet — spike not executed._

## Exit criteria to unlock full app build

All six steps pass once with a real JPEG in OneDrive, tokens never appearing in logs, and this section updated with non-empty evidence.
