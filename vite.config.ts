import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import path from 'node:path'
import { specPayload } from './src/server/specfile.ts'

/**
 * Serve `GET /api/spec` during `bin/dev`.
 *
 * A middleware rather than a proxy to the real Hono server, deliberately.
 * `bin/dev` is one process and should stay one process — a proxy stanza would
 * mean remembering to run `bin/start` alongside it, and the failure mode of
 * forgetting is a live-tune poll that 404s forever while the game looks fine.
 * Both routes call the same `specPayload()`, so dev and production cannot
 * disagree about what the endpoint says.
 *
 * Read-only here too: writes are `bin/spec`'s job and never the network's.
 */
function liveTuneApi(): Plugin {
  return {
    name: 'velo-live-tune',
    configureServer(server) {
      server.middlewares.use('/api/spec', (_req, res) => {
        res.setHeader('content-type', 'application/json')
        // The whole point is to notice a change within a couple of seconds.
        res.setHeader('cache-control', 'no-store')
        res.end(JSON.stringify(specPayload()))
      })
    },
  }
}

// Client-only for milestone 1 apart from the live-tune endpoint above. The
// leaderboard API lands with the server milestone and goes in as a proxy
// stanza exactly like codegrind's, with `changeOrigin: false`.
export default defineConfig({
  plugins: [liveTuneApi()],
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
