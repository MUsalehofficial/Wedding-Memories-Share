# OneDrive upload spike

> **SUPERSEDED (2026-07-17)**  
> Architecture decision: permanent media storage is **Cloudflare R2**, not OneDrive.  
> Microsoft Entra OAuth, refresh-token rotation, and Graph upload sessions are **out of scope**.  
> See [`docs/r2-upload-spike.md`](r2-upload-spike.md) and [`docs/architecture.md`](architecture.md).  
> This document is retained for historical context only. Do not execute these steps.

---

**Status:** SUPERSEDED — OneDrive spike stopped before live OAuth/upload proof  
**Original goal:** Prove Graph upload session path (never completed)

## Provisioned project (still valid)

| Field | Value |
|-------|-------|
| Project name | `wedding-share-memories` |
| Project ref | `vszfgqylajnvdbjqadjr` |
| Region | `eu-central-1` |
| API URL | `https://vszfgqylajnvdbjqadjr.supabase.co` |

### Microsoft OAuth redirect URI (obsolete)

```
https://vszfgqylajnvdbjqadjr.supabase.co/functions/v1/wedding-api/microsoft-callback
```

Do **not** register this in Entra. Microsoft integration was cancelled.

## Evidence

Spike was not executed against Microsoft. No tokens were stored.
