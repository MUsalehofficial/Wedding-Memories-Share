/** Product upload ceilings — Drive plan size is never hardcoded here. */

/** Absolute max accepted video (MP4/MOV), bytes. */
export const MAX_VIDEO_BYTES = 2_000_000_000

/** Default safety reserve kept free on Drive (100 MiB). */
export const DEFAULT_SAFETY_RESERVE_BYTES = 100 * 1024 * 1024

export const VIDEO_TOO_LARGE_MESSAGE = 'Videos must be 2 GB or smaller.'
export const VIDEO_STORAGE_FULL_MESSAGE = 'There is not enough storage available for this video.'
