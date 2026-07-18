/** ISO Base Media File Format (MP4 / QuickTime MOV) container probe. */

const ACCEPTABLE_BRANDS = new Set([
  'qt  ', // QuickTime
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'M4A ',
  'dash',
  'msdh',
  'mmp4',
  'mp71',
])

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) >>> 0) +
    ((bytes[offset + 1]! << 16) >>> 0) +
    ((bytes[offset + 2]! << 8) >>> 0) +
    (bytes[offset + 3]! >>> 0)
  )
}

function readFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  )
}

/**
 * True when `bytes` begins with (or soon contains) a valid `ftyp` box and an
 * acceptable major/compatible brand. Scans the first ~64 KiB for a misplaced ftyp.
 */
export function isIsoBmffContainer(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false
  const limit = Math.min(bytes.byteLength, 64 * 1024)
  let offset = 0
  while (offset + 8 <= limit) {
    let size = readU32BE(bytes, offset)
    const type = readFourCC(bytes, offset + 4)
    if (size === 1) {
      // 64-bit largesize — skip probe if we lack bytes
      if (offset + 16 > limit) break
      // Only need to know box type; treat as skip if not ftyp
      size = Number(
        (BigInt(readU32BE(bytes, offset + 8)) << 32n) + BigInt(readU32BE(bytes, offset + 12)),
      )
      if (!Number.isFinite(size) || size < 16) break
    } else if (size === 0) {
      // Extends to EOF — only valid at end; for probe require ftyp with explicit size
      break
    }
    if (size < 8 || offset + size > bytes.byteLength + 8) {
      // Tolerant: if declared size overruns buffer but type is ftyp, still check brands in hand
      if (type !== 'ftyp') break
    }
    if (type === 'ftyp') {
      if (offset + 12 > bytes.byteLength) return false
      const major = readFourCC(bytes, offset + 8)
      if (ACCEPTABLE_BRANDS.has(major)) return true
      // Compatible brands start at offset+16
      for (let i = offset + 16; i + 4 <= Math.min(offset + size, bytes.byteLength); i += 4) {
        if (ACCEPTABLE_BRANDS.has(readFourCC(bytes, i))) return true
      }
      return false
    }
    // Skip free/skip/wide preamble boxes some writers emit before ftyp
    if (type === 'free' || type === 'skip' || type === 'wide' || type === 'mdat') {
      if (size < 8) break
      offset += size
      continue
    }
    // Unknown leading box — advance if size looks sane, else fail
    if (size < 8 || offset + size > limit) break
    offset += size
  }
  return false
}
