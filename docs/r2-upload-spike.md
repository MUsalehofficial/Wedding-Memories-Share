# R2 upload spike

**Status:** CODE DEPLOYED — live upload/display proof blocked until R2 secrets + bucket CORS  
**Bucket (expected):** `wedding-memories` (private Standard)  
**Supabase project:** `vszfgqylajnvdbjqadjr`  
**Edge Function:** `wedding-api` v4 (`storage: r2`)  
**Rule:** Do not claim pass without sanitized evidence below. Never paste credentials or full presigned URLs.

## Progress

| Item | State |
|------|-------|
| Architecture docs | Done |
| Additive migration `r2_media_columns` | Applied (events row seeded) |
| R2 module + spike routes | Deployed |
| Unit self-check (`r2_keys.node-test.mjs`) | Pass |
| `GET …/health` | Pass (`storage: r2`) |
| `GET …/r2-health` | Pass response; `ready: false` (no secrets yet) |
| Browser PUT/GET/delete proof | **Blocked** — needs your R2 secrets + CORS |

## What must be proven

| # | Step | Pass criteria |
|---|------|---------------|
| 1 | Secrets readable | Edge Function sees required `R2_*` names (values never logged) |
| 2 | Presigned PUT | Function returns short-lived PUT URL for randomized key |
| 3 | CORS preflight | OPTIONS from allowed origin succeeds |
| 4 | Browser PUT | Test JPEG uploads to R2 with bound `Content-Type` |
| 5 | HeadObject verify | Edge confirms size/type |
| 6 | Presigned GET | Function returns short-lived GET URL |
| 7 | Browser display | `<img>` loads JPEG |
| 8 | Expiry | Expired URL fails as expected |
| 9 | Wrong Content-Type | Mismatched type rejected |
| 10 | Bad origin | Unauthorized origin blocked by browser CORS |
| 11 | Delete | Secured path deletes test object |
| 12 | Cleanup verified | HeadObject after delete → not found |

## Spike API routes (`wedding-api`)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `r2-health` | Confirm R2 secret **names** present (boolean flags only) |
| POST | `r2-spike-create` | Create `processing` media row + presigned PUT |
| POST | `r2-spike-complete` | HeadObject verify + mark pending |
| POST | `r2-spike-display` | Presigned GET |
| POST | `r2-spike-delete` | DeleteObject + cleanup check |

Presigned PUT expiry: **300 seconds**. Content-Type bound into signature. No overwrite/upsert.

## Evidence (fill only after real runs)

### Environment

| Field | Value |
|-------|-------|
| Timestamp (UTC) | _pending_ |
| Bucket name | _pending_ |
| Test filename | _pending_ |
| Test size (bytes) | _pending_ |
| Object key (redacted) | `events/main/originals/images/<redacted>.jpg` |
| Presigned expiry | 300s |
| Browser origin | _pending_ |

### Step results

| Step | Result | Notes |
|------|--------|-------|
| 1 Secrets | _pending_ | |
| 2 Presigned PUT | _pending_ | |
| 3 Preflight | _pending_ | |
| 4 PUT status | _pending_ | ETag: _redacted_ |
| 5 HEAD verify | _pending_ | |
| 6 Presigned GET | _pending_ | |
| 7 Display | _pending_ | |
| 8 Expiration | _pending_ | |
| 9 Invalid Content-Type | _pending_ | |
| 10 Unauthorized origin | _pending_ | |
| 11 Delete | _pending_ | |
| 12 Cleanup | _pending_ | |

### Final

**Pass / Fail:** **NO-GO** until steps 1–12 are executed with real R2 credentials and recorded above.

### Partial probe (2026-07-17)

- `health` → `{"ok":true,"storage":"r2"}`
- `r2-health` → all `R2_*` presence flags `false`, HTTP 503 `ready:false`
