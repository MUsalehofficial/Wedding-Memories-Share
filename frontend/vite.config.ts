import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages custom domain — base must remain "/"
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
})
