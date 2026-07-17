#!/usr/bin/env node
/**
 * Export media metadata JSON from Supabase (service role required).
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/export-metadata.mjs
 */
console.log(
  'Wire after Supabase project exists: select media metadata and write JSON. Do not print secrets.',
)
