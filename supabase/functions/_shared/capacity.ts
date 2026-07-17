/** Capacity decisions from live Google Drive about.get — never invent total GB. */

export type DriveQuota = {
  limit: number | null
  usage: number
  usageInDrive: number
  usageInDriveTrash: number
  maxUploadSize: number | null
}

export type CapacitySettings = {
  safetyReserveBytes: number
  videoUploadsEnabled: boolean
  warnRatio: number
  criticalRatio: number
  uploadsEnabled?: boolean
  maxImageBytes?: number
  maxVideoBytes?: number
}

export type CapacityLevel = 'ok' | 'warn' | 'critical' | 'full' | 'unknown'

export function parseQuota(about: {
  storageQuota?: {
    limit?: string
    usage?: string
    usageInDrive?: string
    usageInDriveTrash?: string
  }
  maxUploadSize?: string
}): DriveQuota {
  const q = about.storageQuota ?? {}
  const toNum = (v?: string) => (v == null || v === '' ? null : Number(v))
  const usage = toNum(q.usage) ?? 0
  return {
    limit: toNum(q.limit),
    usage,
    usageInDrive: toNum(q.usageInDrive) ?? 0,
    usageInDriveTrash: toNum(q.usageInDriveTrash) ?? 0,
    maxUploadSize: toNum(about.maxUploadSize),
  }
}

export function availableBytes(quota: DriveQuota): number | null {
  if (quota.limit == null) return null
  return Math.max(0, quota.limit - quota.usage)
}

export function capacityLevel(
  quota: DriveQuota,
  settings: Pick<CapacitySettings, 'warnRatio' | 'criticalRatio'>,
): CapacityLevel {
  const available = availableBytes(quota)
  if (quota.limit == null || available == null) return 'unknown'
  if (available <= 0) return 'full'
  const ratio = available / quota.limit
  if (ratio < settings.criticalRatio) return 'critical'
  if (ratio < settings.warnRatio) return 'warn'
  return 'ok'
}

export function bytesToGb(bytes: number | null): number | null {
  if (bytes == null) return null
  return Math.round((bytes / (1024 ** 3)) * 1000) / 1000
}

export type UploadGate =
  | { ok: true }
  | { ok: false; code: string; message: string }

/** Recheck quota before each original upload session. */
export function canCreateOriginalUpload(
  quota: DriveQuota,
  settings: CapacitySettings,
  fileBytes: number,
  mediaKind: 'image' | 'video',
): UploadGate {
  if (settings.uploadsEnabled === false) {
    return {
      ok: false,
      code: 'uploads_disabled',
      message: 'Uploads are temporarily disabled by the administrator.',
    }
  }
  if (mediaKind === 'video' && !settings.videoUploadsEnabled) {
    return {
      ok: false,
      code: 'video_uploads_disabled',
      message: 'Video uploads are temporarily disabled by the administrator.',
    }
  }
  if (!Number.isFinite(fileBytes) || fileBytes <= 0) {
    return { ok: false, code: 'invalid_size', message: 'Invalid file size.' }
  }
  if (quota.maxUploadSize != null && fileBytes > quota.maxUploadSize) {
    return {
      ok: false,
      code: 'exceeds_max_upload_size',
      message: 'This file exceeds Google Drive’s maximum upload size.',
    }
  }
  const available = availableBytes(quota)
  if (available == null) {
    // ponytail: unknown limit — still allow only if maxUploadSize permits; admin should monitor
    // Safer for wedding: block when we cannot prove capacity
    return {
      ok: false,
      code: 'quota_unknown',
      message: 'Uploads temporarily unavailable — storage capacity could not be verified.',
    }
  }
  const needed = fileBytes + settings.safetyReserveBytes
  if (needed > available) {
    return {
      ok: false,
      code: 'storage_full',
      message: 'Uploads temporarily unavailable — not enough storage remaining.',
    }
  }
  return { ok: true }
}

export function adminCapacityView(quota: DriveQuota, settings: CapacitySettings) {
  const available = availableBytes(quota)
  const level = capacityLevel(quota, settings)
  return {
    bytes: {
      limit: quota.limit,
      usage: quota.usage,
      usageInDrive: quota.usageInDrive,
      usageInDriveTrash: quota.usageInDriveTrash,
      available,
      maxUploadSize: quota.maxUploadSize,
      safetyReserve: settings.safetyReserveBytes,
    },
    gb: {
      limit: bytesToGb(quota.limit),
      usage: bytesToGb(quota.usage),
      available: bytesToGb(available),
      maxUploadSize: bytesToGb(quota.maxUploadSize),
    },
    level,
    videoUploadsEnabled: settings.videoUploadsEnabled,
    warnRatio: settings.warnRatio,
    criticalRatio: settings.criticalRatio,
  }
}
