# Google Drive upload spike

**Status:** PASS — live OAuth, quota, upload, preview, refresh, delete, capacity reject  
**Supabase project:** `vszfgqylajnvdbjqadjr`  
**Edge Function:** `wedding-api` v9 (`storage: google_drive`)  
**Rule:** Do not claim pass without evidence. Never paste tokens or full OAuth codes.  
**CLI note:** Local TLS to one Cloudflare address can fail; verification used `curl --resolve` to a working address for this machine only. Do not hardcode that IP in app code, OAuth settings, secrets, deploy config, or production docs.

## Progress

| Item | State |
|------|-------|
| Architecture → Google Drive | Done |
| Capacity rules (no hardcoded GB) | Done — `docs/gdrive-capacity.md` |
| Migration `google_drive_capacity` | Applied |
| Vault helpers + integrations table | Applied |
| Capacity unit self-check | Pass |
| `GET …/health` | Pass (`storage: google_drive`) |
| `GET …/gdrive-health` | Pass; `ready: true` (all Google secret flags) |
| Live `about.get` + upload proof | **Pass** (2026-07-17) |

## Must prove

1. Edge can read required Google secret **names** — Pass
2. Admin OAuth connect stores refresh token (Vault); never logged — Pass
3. Token refresh works — Pass (upload/display/delete/quota use `accessTokenForEvent`)
4. `about.get` returns quota fields (record sanitized numbers in evidence) — Pass
5. Create resumable upload session (or Edge upload for small spike file) — Pass (multipart Edge upload)
6. Browser or Edge completes upload of a test JPEG — Pass (Edge, 331-byte JPEG)
7. Verify Drive file metadata (size/mime) — Pass (`size: "331"`, `mimeType: image/jpeg`)
8. Temporary authorized display works — Pass (HTTP 200 `image/jpeg`, bytes matched source)
9. Capacity gate rejects when file + safety reserve exceeds available — Pass (HTTP 507 `storage_full`; reserve restored)
10. Delete test file + cleanup verified — Pass (`deleted: true`, `cleanupVerified: true`; media `upload_status: deleted`; post-delete display 404)

## OAuth redirect URI (exact)

```
https://vszfgqylajnvdbjqadjr.supabase.co/functions/v1/wedding-api/google-callback
```

## Evidence

### Quota from `about.get` (live run 2026-07-17T18:14Z)

| Field | Value (bytes) |
|-------|----------------|
| Timestamp (UTC) | 2026-07-17T18:14:29Z |
| `storageQuota.limit` | 16106127360 |
| `storageQuota.usage` | 11065752178 |
| `storageQuota.usageInDrive` | 10451326567 |
| `storageQuota.usageInDriveTrash` | 0 |
| `maxUploadSize` | 5242880000000 |
| Derived available | 5040375182 |
| Capacity level | ok |
| Admin GB view | limit 15 / usage 10.306 / available 4.694 |

Post-upload usage rose by 331 bytes (`11065752509`); post-delete returned to `11065752178`.

### Upload steps

| Step | Result |
|------|--------|
| Secrets present | Pass (`gdrive-health` ready:true) |
| OAuth connect | Pass (`google_drive_integrations.status=connected`, Vault refresh stored) |
| Refresh | Pass (token used across quota/upload/display/delete) |
| Upload | Pass (`mediaId` issued; Drive `fileId` redacted `1ZAVRwSX…`; size 331; jpeg) |
| Verify | Pass (Drive metadata via upload response) |
| Display | Pass (HTTP 200; downloaded bytes matched upload) |
| Capacity reject test | Pass (temporary reserve 6e9 → HTTP 507 `storage_full`; reserve restored to 104857600) |
| Delete/cleanup | Pass (`deleted`+`cleanupVerified`; media row `deleted`; get after delete failed with files.get 404) |

**Pass / Fail:** **PASS**
