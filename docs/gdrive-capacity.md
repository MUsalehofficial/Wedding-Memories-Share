# Google Drive capacity

## Source of truth

Live Google Drive `about.get` fields (bytes):

| Field | Use |
|-------|-----|
| `storageQuota.limit` | Total quota (`null` → treat as unknown, never invent a number) |
| `storageQuota.usage` | Used across Google account |
| `storageQuota.usageInDrive` | Used in Drive |
| `storageQuota.usageInDriveTrash` | Trash |
| `maxUploadSize` | Hard per-object ceiling from Google |

`available = limit - usage` when `limit` is present.

## Product rules

1. Admin UI shows total / used / available in **GB** (compute from bytes).
2. Warning when `available / limit < 0.20`.
3. Critical when `available / limit < 0.10`.
4. Before creating an original upload session, re-fetch quota; reject if  
   `fileBytes + safety_reserve_bytes > available` (or file > `maxUploadSize`).
5. Administrator may disable video uploads independently (`video_uploads_enabled`).
6. Never use only a sum of local `media.size_bytes` as capacity.
7. Guests see “uploads temporarily unavailable” when storage cannot accept the file / quota unknown-and-unsafe / uploads disabled.
8. Never auto-delete existing media when full.

## Configurable settings (DB)

| Key | Meaning | Default |
|-----|---------|---------|
| `upload_safety_reserve_bytes` | Extra free space required beyond file size | `104857600` (100 MiB) |
| `video_uploads_enabled` | Allow video create-upload | `true` |
| `capacity_warn_ratio` | Warn threshold | `0.20` |
| `capacity_critical_ratio` | Critical threshold | `0.10` |

Changing Google storage plan requires **no** code or migration — next `about.get` reflects the new limit.
