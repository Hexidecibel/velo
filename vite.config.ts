import { defineConfig } from 'vite'
import path from 'node:path'

// Client-only for milestone 1. There is no server yet, so there is no /api
// proxy stanza here — when the server lands it goes in exactly like
// codegrind's, with `changeOrigin: false`.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
