import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Served from https://manel27.github.io/film-club/ (GitHub Pages project site).
export default defineConfig({
  base: '/film-club/',
  plugins: [react()],
})
