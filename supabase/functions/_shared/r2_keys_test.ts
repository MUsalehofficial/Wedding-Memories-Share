import { assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { buildObjectKey, redactObjectKey, sanitizeFilename } from './r2_keys.ts'

Deno.test('buildObjectKey uses uuid path under originals/images', () => {
  const key = buildObjectKey('original-image', 'JPG', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  assertEquals(key, 'events/main/originals/images/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg')
})

Deno.test('buildObjectKey sanitizes extension', () => {
  const key = buildObjectKey('preview-image', '../webp!', '11111111-1111-1111-1111-111111111111')
  assertEquals(key, 'events/main/previews/images/11111111-1111-1111-1111-111111111111.webp')
})

Deno.test('sanitizeFilename strips path tricks', () => {
  assertEquals(sanitizeFilename('../../etc/passwd.jpg'), '.._.._etc_passwd.jpg')
  assertMatch(sanitizeFilename('Nice Photo (1).JPEG'), /Nice Photo \(1\)\.JPEG/)
})

Deno.test('redactObjectKey hides most of uuid', () => {
  const redacted = redactObjectKey(
    'events/main/originals/images/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg',
  )
  assertEquals(redacted, 'events/main/originals/images/aaaaaaaa….jpg')
})
