import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const shotDir = path.join(__dirname, '../../docs/reference-screenshots/mvp')

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
})

test.describe('Guest MVP mobile', () => {
  test('welcome + access + privacy are reachable and accessible landmarks', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Muhammad/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Share a Memory/i })).toBeVisible()
    await page.screenshot({ path: path.join(shotDir, 'mobile-welcome.png'), fullPage: true })

    await page.getByRole('link', { name: /Share a Memory/i }).click()
    await expect(page.getByRole('heading', { name: /Enter the code/i })).toBeVisible()
    await expect(page.getByLabel(/Access code/i)).toBeVisible()
    await page.screenshot({ path: path.join(shotDir, 'mobile-access.png'), fullPage: true })

    await page.goto('/#/privacy')
    await expect(page.getByRole('heading', { name: /Your memories, kept private/i })).toBeVisible()
    await page.screenshot({ path: path.join(shotDir, 'mobile-privacy.png'), fullPage: true })
  })

  test('upload and gallery redirect to access without session', async ({ page }) => {
    await page.goto('/#/upload')
    await expect(page).toHaveURL(/access/)
    await page.goto('/#/gallery')
    await expect(page).toHaveURL(/access/)
  })
})
