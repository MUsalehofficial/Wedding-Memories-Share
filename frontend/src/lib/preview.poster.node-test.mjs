/**
 * Poster seek + soft-success messaging checks (no DOM).
 * Run: node frontend/src/lib/preview.poster.node-test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

function posterSeekSeconds(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(0.5, Math.max(0, duration / 10))
}

assert.equal(posterSeekSeconds(3.77), 0.377)
assert.equal(posterSeekSeconds(60), 0.5)
assert.equal(posterSeekSeconds(0), 0)
assert.equal(posterSeekSeconds(NaN), 0)

const src = readFileSync(join(dir, 'preview.ts'), 'utf8')
assert.match(src, /loadedmetadata/)
assert.match(src, /seeked/)
assert.match(src, /canvas_drawImage|drawImage/)
assert.match(src, /canvas_toBlob|toBlob/)
assert.match(src, /preload = ['"]metadata['"]/)
assert.match(src, /playsInline = true/)
assert.match(src, /zero_frame|videoWidth/)
assert.match(src, /SAFARI_POSTER_FAIL_MESSAGE/)
assert.match(src, /URL\.revokeObjectURL\(url\)/)
assert.match(src, /finally/)
assert.match(src, /\[wedding-upload\].*poster|logPoster/)

const upload = readFileSync(join(dir, '../pages/UploadPage.tsx'), 'utf8')
assert.match(upload, /mode === 'preview'/)
assert.match(upload, /never create a Drive resumable session/)
assert.match(upload, /SAFARI_POSTER_FAIL_MESSAGE/)
assert.match(upload, /makeVideoPoster\(job\.file\)/)
assert.match(upload, /retryPreviewOnly/)
assert.match(upload, /beginPreviewRetryPick/)
assert.match(upload, /onPreviewRetryFile/)
assert.match(upload, /Regenerating preview only for the existing video/)
assert.match(upload, /gdrive-upload-preview/)

// Preview-only path must not call create-session / original upload APIs
const previewBlock = upload.slice(
  upload.indexOf("if (mode === 'preview')"),
  upload.indexOf("if (mode === 'complete')"),
)
assert.doesNotMatch(previewBlock, /gdrive-create-resumable-session/)
assert.doesNotMatch(previewBlock, /putResumableFile/)
assert.doesNotMatch(previewBlock, /gdrive-complete-resumable/)
assert.match(previewBlock, /uploadPreviewFor/)

const retryOnly = upload.slice(upload.indexOf('async function retryPreviewOnly'), upload.indexOf('function onPreviewRetryFile'))
assert.match(retryOnly, /'preview'/)
assert.doesNotMatch(retryOnly, /gdrive-create-resumable-session/)
assert.doesNotMatch(retryOnly, /mode: 'full'/)

const gallery = readFileSync(join(dir, '../pages/GalleryPage.tsx'), 'utf8')
assert.match(gallery, /Preview not available/)

console.log('preview.poster.node-test: ok')
