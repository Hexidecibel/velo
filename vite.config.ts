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
    // Vite rejects requests whose Host header it does not recognise, which is a
    // sensible default and exactly wrong for a cush-tools tunnel: the browser
    // sends `velo.tunnel.cush.rocks` and Vite answers 403 before any of our code
    // runs. Still bound to loopback above, so the only route in is the tunnel.
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
