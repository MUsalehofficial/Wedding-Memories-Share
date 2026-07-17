#!/usr/bin/env node
/**
 * Minimal deployment smoke check.
 * Usage: node scripts/verify-deployment.mjs [baseUrl]
 */
const base = process.argv[2] ?? 'https://share-memories-with-us.musalehofficial.com'

async function main() {
  const res = await fetch(base, { redirect: 'follow' })
  console.log('GET', base, res.status)
  if (!res.ok) process.exit(1)
  const html = await res.text()
  if (!html.includes('Share Memories') && !html.includes('Muhammad')) {
    console.warn('Warning: unexpected HTML body — confirm Pages deploy')
  }
  console.log('ok')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
