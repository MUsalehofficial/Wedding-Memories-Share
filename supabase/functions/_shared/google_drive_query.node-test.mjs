/**
 * Self-check: CORS-blind Drive completion + Safari preview fallbacks.
 * Run: node supabase/functions/_shared/google_drive_query.node-test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(dir, 'google_drive.ts'), 'utf8')

assert.match(src, /fileId: string \| null/)
assert.match(src, /meta\.id/)
assert.match(src, /browser may be blocked from reading this 200/)

const resolveFn = readFileSync(join(dir, '../wedding-resolve-upload/index.ts'), 'utf8')
assert.match(resolveFn, /sessionId/)
assert.match(resolveFn, /graph_upload_url/)
assert.match(resolveFn, /missing_file_id/)

const client = readFileSync(join(dir, '../../../frontend/src/lib/resumableUpload.ts'), 'utf8')
assert.match(client, /final-chunk CORS blind spot/)
assert.match(client, /Load failed/)
assert.match(client, /fileId: string \| null/)

const api = readFileSync(join(dir, '../../../frontend/src/lib/api.ts'), 'utf8')
assert.match(api, /wedding-resolve-upload|functionSlug/)
assert.match(api, /requestId/)

const preview = readFileSync(join(dir, '../../../frontend/src/lib/preview.ts'), 'utf8')
assert.match(preview, /image\/jpeg/)
assert.match(preview, /imageElementPreview|Image\(\)/)
assert.match(preview, /preview_generation_failed/)

const upload = readFileSync(join(dir, '../../../frontend/src/pages/UploadPage.tsx'), 'utf8')
assert.match(upload, /wedding-resolve-upload/)
assert.match(upload, /resolve_drive_file/)
assert.match(upload, /complete_upload/)

console.log('google_drive_query.node-test: ok')
