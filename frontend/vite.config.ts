import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

// GitHub Pages custom domain — base must remain "/"
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Single source of truth with Edge shared upload_limits.ts
      '@upload-limits': path.resolve(root, '../supabase/functions/_shared/upload_limits.ts'),
    },
  },
})
