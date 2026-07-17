# Google Drive upload spike

**Status:** CODE DEPLOYED — live OAuth/`about.get` blocked until Google secrets  
**Supabase project:** `vszfgqylajnvdbjqadjr`  
**Edge Function:** `wedding-api` v5 (`storage: google_drive`)  
**Rule:** Do not claim pass without evidence. Never paste tokens or full OAuth codes.

## Progress

| Item | State |
|------|-------|
| Architecture → Google Drive | Done |
| Capacity rules (no hardcoded GB) | Done — `docs/gdrive-capacity.md` |
| Migration `google_drive_capacity` | Applied |
| Vault helpers + integrations table | Applied |
| Capacity unit self-check | Pass |
| `GET …/health` | Pass (`storage: google_drive`) |
| `GET …/gdrive-health` | Pass; `ready: false` (secrets missing) |
| Live `about.get` + upload proof | **Blocked** on your Google OAuth secrets |

## Must prove

1. Edge can read required Google secret **names**
2. Admin OAuth connect stores refresh token (Vault); never logged
3. Token refresh works
4. `about.get` returns quota fields (record sanitized numbers in evidence)
5. Create resumable upload session (or Edge upload for small spike file)
6. Browser or Edge completes upload of a test JPEG
7. Verify Drive file metadata (size/mime)
8. Temporary authorized display works in browser
9. Capacity gate rejects when file + safety reserve exceeds available
10. Delete test file + cleanup verified

## OAuth redirect URI (exact)

```
https://vszfgqylajnvdbjqadjr.supabase.co/functions/v1/wedding-api/google-callback
```

## Evidence

### Quota from `about.get` (fill after live run)

| Field | Value (bytes) |
|-------|----------------|
| Timestamp (UTC) | _pending_ |
| `storageQuota.limit` | _pending_ |
| `storageQuota.usage` | _pending_ |
| `storageQuota.usageInDrive` | _pending_ |
| `storageQuota.usageInDriveTrash` | _pending_ |
| `maxUploadSize` | _pending_ |
| Derived available | _pending_ |
| Capacity level | _pending_ |

### Upload steps

| Step | Result |
|------|--------|
| Secrets present | _pending_ |
| OAuth connect | _pending_ |
| Refresh | _pending_ |
| Upload | _pending_ |
| Verify | _pending_ |
| Display | _pending_ |
| Capacity reject test | _pending_ |
| Delete/cleanup | _pending_ |

**Pass / Fail:** _pending_ (NO-GO until filled)
