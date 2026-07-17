import assert from 'node:assert/strict'

function availableBytes(limit, usage) {
  if (limit == null) return null
  return Math.max(0, limit - usage)
}

function capacityLevel(limit, usage, warnRatio = 0.2, criticalRatio = 0.1) {
  const available = availableBytes(limit, usage)
  if (limit == null || available == null) return 'unknown'
  if (available <= 0) return 'full'
  const ratio = available / limit
  if (ratio < criticalRatio) return 'critical'
  if (ratio < warnRatio) return 'warn'
  return 'ok'
}

function canCreate(limit, usage, fileBytes, reserve, videoEnabled, kind) {
  if (kind === 'video' && !videoEnabled) return 'video_uploads_disabled'
  const available = availableBytes(limit, usage)
  if (available == null) return 'quota_unknown'
  if (fileBytes + reserve > available) return 'storage_full'
  return 'ok'
}

const fiveGb = 5 * 1024 ** 3
assert.equal(capacityLevel(fiveGb, fiveGb * 0.85), 'warn')
assert.equal(capacityLevel(fiveGb, fiveGb * 0.95), 'critical')
assert.equal(canCreate(fiveGb, fiveGb - 50_000_000, 40_000_000, 100_000_000, true, 'image'), 'storage_full')
assert.equal(canCreate(fiveGb, 1_000_000, 1_000_000, 100_000_000, false, 'video'), 'video_uploads_disabled')
assert.equal(canCreate(null, 1_000_000, 1_000_000, 0, true, 'image'), 'quota_unknown')
assert.ok(availableBytes(15 * 1024 ** 3, 0) !== fiveGb)
console.log('capacity self-check: ok')
