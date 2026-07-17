# Google Drive upload spike + hardening

**Status:** HARDENING PASS (with wedding-readiness blockers listed below)  
**Supabase project:** `vszfgqylajnvdbjqadjr`  
**Edge Function:** `wedding-api` **v13** (`storage: google_drive`)  
**Rule:** Do not claim pass without evidence. Never paste tokens, OAuth codes, full resumable URIs, or signed URLs.

## Already proven (basic spike — do not rerun)

| Item | Evidence |
|------|----------|
| OAuth connect + Vault refresh | Basic spike 2026-07-17 — `google_drive_integrations.status=connected` |
| Live `about.get` quota | Basic spike table below (same account; reconfirmed after hardening cleanup) |
| Access-token refresh path | Basic spike + hardening quota/upload calls |
| Capacity HTTP 507 `storage_full` | Basic spike (temp reserve 6e9; restored to 100 MiB) |
| Tiny 331-byte Edge multipart upload | Basic spike only — **not** wedding-scale evidence |
| Edge-mediated Drive byte display | Basic spike — **not** gallery preview architecture |

### Basic spike quota snapshot (2026-07-17T18:14Z)

| Field | Value (bytes) |
|-------|----------------|
| `storageQuota.limit` | 16106127360 |
| `storageQuota.usage` | 11065752178 |
| `storageQuota.usageInDrive` | 10451326567 |
| `storageQuota.usageInDriveTrash` | 0 |
| Derived available | 5040375182 |
| Capacity level | ok |
| Safety reserve | 104857600 (restored) |

---

## Requirement matrix (hardening)

### 1. OAuth and account status

| Check | Evidence? | Result |
|-------|-----------|--------|
| Publishing status (Testing / Production) | **Insufficient** | Not readable via API. **Recorded as wedding-readiness blocker:** confirm in Google Cloud Console → OAuth consent screen. If still **Testing**, move to **Production** or re-consent shortly before the wedding per Google’s testing-token policy. Not a development blocker. |
| Test users | **Insufficient** | Do not publish addresses here. Confirm configured test users in Console if app remains in Testing. |
| Exact granted scopes | **Yes** — `gdrive-health` / hardening run | `openid` `email` `profile` `https://www.googleapis.com/auth/drive.file` `https://www.googleapis.com/auth/drive.metadata.readonly` |
| Drive access scope | **Yes** | File create/upload/delete uses **`drive.file` only**. `drive.metadata.readonly` is for `about.get` quota only (not file content access beyond app-created files). |
| Refresh-token persistence | **Yes** — basic spike + reconnect restore | Vault via `wedding_vault_put` / `get` / `update` |
| Reconnect when token invalid/revoked | **Yes** — live 2026-07-17 | Corrupted Vault refresh → `GET gdrive-quota` returned **HTTP 401** `invalid_grant` and Edge marks integration disconnected; restored from Vault backup → quota **HTTP 200** again |

### 2. Drive folder verification

| Check | Evidence? | Result |
|-------|-----------|--------|
| Hierarchy created & IDs stored | **Yes** — `POST gdrive-ensure-folders` | `Wedding Memories / Originals / Images|Videos / Exports` — redacted IDs only in evidence JSON |
| Uploads use stored parent IDs | **Yes** | Image `parentOk: true` + `inImages: true`; video `inVideos: true` |
| No per-upload name search after bootstrap | **Yes** (code) | `loadOrEnsureFolders` reuses DB columns when complete |
| Randomized filename | **Yes** | Server `collisionResistantDriveName` |
| MIME + size | **Yes** | Image `image/jpeg` / `5200032`; video `video/mp4` / `26214400` |
| Checksum | **Yes** | Image `md5Checksum` matched source MD5 |
| Ownership / private / no `anyone` | **Yes** | `private: true`, `hasAnyone: false`; no permanent public URL |

### 3. Realistic image upload (~5–10 MB)

| Check | Evidence? | Result |
|-------|-----------|--------|
| Real JPEG size | **Yes** | **5 200 032** bytes (`/tmp/wedding-hardening.jpg`) |
| Edge creates resumable session | **Yes** | `POST gdrive-create-resumable-session` |
| Direct upload to Google resumable URL | **Yes** | Client `PUT` chunks to Google `upload` URL (URI redacted) |
| Origin | **Partial → Pass for CORS** | Harness used `Origin: http://localhost:5173` on session + Google OPTIONS/PUT. **Not** a full SPA page load. CORS: OPTIONS **200**, `Access-Control-Allow-Origin: http://localhost:5173`, `Allow-Methods: PUT` |
| Multi-chunk + 1 MiB | **Yes** | `chunkSize: 1048576`; progress marks `1MiB…5.2MiB` (5 steps) |
| Non-final chunks 256 KiB aligned | **Yes** | First chunk 1048576 aligned; interrupt range `bytes=0-1048575` |
| Progress measurable | **Yes** | Range query `nextOffset: 1048576` mid-upload |
| Final metadata matches | **Yes** | size/mime/md5 match |
| In `Originals/Images` + private | **Yes** | `inImages: true`, `private: true` |

### 4. Interruption and resume

| Check | Evidence? | Result |
|-------|-----------|--------|
| Interrupted after ≥1 chunk | **Yes** | First PUT → **308** `bytes=0-1048575` |
| Session range query | **Yes** | `GET gdrive-resumable-status` → status **308**, `nextOffset: 1048576` |
| Resume from next byte | **Yes** | Continued from 1048576 → complete |
| No duplicate Drive file | **Yes** | Single `fileId`; complete idempotent |
| Media idempotent | **Yes** | Same `mediaId`; second complete `reused: true` |
| Repeat complete safe | **Yes** | `completeIdempotent: true` |

### 5. Video upload (~20–50 MB)

| Check | Evidence? | Result |
|-------|-----------|--------|
| Fixture size | **Yes** | **26 214 400** bytes (temporary non-sensitive `video/mp4` fixture; deleted after) |
| Video setting enabled | **Yes** | Session created with `videoUploadsEnabled: true` |
| Capacity before session | **Yes** | Live `about.get` inside create-session |
| Destination `Originals/Videos` | **Yes** | `inVideos: true`, `parentOk: true` |
| Multi-chunk + progress | **Yes** | 25 × 1 MiB chunks |
| Size/MIME + private | **Yes** | `26214400` / `video/mp4` / private |
| Cleanup returns quota | **Yes** | Usage returned to **11065752178** (trash **0**) |
| No transcoding | **Yes** | Not implemented (by design) |

### 6. Preview storage (Supabase private bucket)

| Check | Evidence? | Result |
|-------|-----------|--------|
| 331-byte spike ≠ gallery preview | **Yes** | Basic spike returned Drive original via Edge; **not** sufficient for gallery |
| Bucket `wedding-previews` private | **Yes** | Migration + `public: false` |
| Browser-side-ish preview ≤1600px | **Partial** | Generated via ffmpeg scale 1600; uploaded as JPEG (~640 KB). EXIF/GPS strip: synthetic fixture had none |
| Path in Postgres only | **Yes** | `preview_object_key` / poster path; no signed URL stored |
| Signed URL display | **Yes** | HTTP **200**, **640047** bytes |
| Unsigned direct access fails | **Yes** | public **400** + authenticated anon **400**; `rejected: true` |
| Video poster in same bucket | **Yes** | Poster object uploaded then removed in cleanup |

### 7. Validation / negatives

| Case | Result |
|------|--------|
| Unsupported MIME / bad ext | `disallowed_extension` (pdf) |
| Disallowed extension | `disallowed_extension` (.exe) |
| MIME/ext mismatch | `mime_extension_mismatch` |
| Zero-byte | `invalid_size` |
| Over configured max (declared) | `exceeds_configured_max` (no huge upload) |
| `video_uploads_enabled=false` | HTTP **403** `video_uploads_disabled` |
| `uploads_enabled=false` | HTTP **403** `uploads_disabled` |
| Capacity 507 | Basic spike (still valid) |
| Idempotency key reuse | `reused: true`, same session + media |
| Invalid guest session | HTTP **401** `guest_token_invalid` |
| Guest cannot set parent folder | `parent_folder_forbidden` |

### 8. Capacity controls

| Check | Evidence? | Result |
|-------|-----------|--------|
| Live `about.get` fields | **Yes** | limit/usage/usageInDrive/trash/available/maxUploadSize recorded |
| Warn 20% / critical 10% | **Unit** + settings | Live level **ok** (~31% free). Arithmetic covered by `hardening.node-test.mjs` / `capacity.node-test.mjs` |
| Safety reserve 100 MiB | **Yes** | Restored; present in quota payload |
| Quota rechecked per session | **Yes** | create-session calls `fetchDriveQuota` |
| Upgrade needs no code/schema | **Yes** | Live limit from Google |
| Delete frees quota | **Yes** | After delete, usage **11065752178**, trash **0** (permanent delete) |

### 9. Network routing note (environmental only)

- One Cloudflare address reset TLS from this network; `104.18.38.10` worked for CLI.
- `curl --resolve` used **only** for local diagnostics.
- **Not** hardcoded in app, OAuth, secrets, deploy config, or production docs.
- App continues to use the normal Supabase hostname.

### 10. Cleanup

| Check | Result |
|-------|--------|
| Drive originals deleted | `deleted: true`, `cleanupVerified: true` (404 on verify) |
| Previews/posters removed | Storage remove via delete route |
| Media marked | `upload_status: deleted` (test rows); incomplete session `abandoned` / `cancelled` |
| Quota after cleanup | usage **11065752178**, available **5040375182** |
| Incomplete ≠ success | Abandoned session never completed |

---

## Automated tests

```bash
node supabase/functions/_shared/hardening.node-test.mjs
node supabase/functions/_shared/capacity.node-test.mjs
```

**Output:** `hardening.node-test.mjs: ok` / `capacity self-check: ok`

Covers: chunk alignment, resume offset, capacity math, MIME/ext validation, parent-folder forbid, preview path shape, guest token verify, idempotency map, video/uploads disable gates.

Live harness (not committed secrets): `node scripts/gdrive-hardening-live.mjs`

---

## Changed files (uncommitted)

- `supabase/functions/wedding-api/index.ts` — resumable/session/preview/folder routes
- `supabase/functions/_shared/google_drive.ts` — folders, permissions, resumable status
- `supabase/functions/_shared/chunks.ts` — chunk math
- `supabase/functions/_shared/upload_validation.ts` — MIME/ext/size/parent guard
- `supabase/functions/_shared/guest_token.ts` — guest HMAC
- `supabase/functions/_shared/capacity.ts` — `uploadsEnabled` gate
- `supabase/functions/_shared/hardening.node-test.mjs`
- `supabase/migrations/20260717210000_gdrive_hardening.sql` — folder cols + `wedding-previews` bucket
- `scripts/gdrive-hardening-live.mjs`
- `docs/gdrive-upload-spike.md` (this file)

**Migration status:** applied (`gdrive_hardening`)  
**Edge version:** **v13** (`verify_jwt: false`)

---

## Wedding-readiness blockers (remaining)

1. **OAuth consent publishing status** — confirm Testing vs Production in Google Cloud Console; if Testing, Production (or planned re-consent) before wedding.
2. **Dedicated `GUEST_TOKEN_SIGNING_SECRET`** — set explicitly for production (Edge currently falls back to service role if unset; health may show the dedicated flag).
3. **Full browser SPA upload** from `localhost:5173` / production origin — CORS + Origin proven via harness; guest uploader UI not built (out of scope).
4. **Real camera JPEG EXIF-strip proof** — synthetic fixture; regenerate preview from a phone JPEG before wedding if needed.
5. **Do not start** full guest/admin gallery/slideshow/QR product until you approve this hardening checkpoint.

---

## Final recommendation

**GO for continued development of guest/admin product** after you review this doc.  
**NO-GO for wedding day** until OAuth publishing status is confirmed/Production and the blockers above are cleared.

**Pass / Fail (hardening milestone):** **PASS** (with blockers listed)
