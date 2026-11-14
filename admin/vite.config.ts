import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  // Solo en las pruebas: leer el SQL para comparar las paletas del panel con
  // las que acepta la base (src/lib/paletas.test.ts). El servidor de
  // desarrollo no expone nada fuera de admin/.
  server: process.env.VITEST ? { fs: { allow: ['.', '../supabase/sql'] } } : undefined,
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // index.css se lee como texto en paletas.test.ts (?raw)
    css: { include: [/index\.css/] },
  },
})
