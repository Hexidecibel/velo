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

// The leaderboard API is PROXIED to the real Hono server rather than
// reimplemented here, and the two halves of that split are deliberate.
//
// `/api/spec` is a middleware because live tune has to work with `bin/dev`
// alone: it is the tuning loop, one process, and a proxy stanza would mean
// remembering to run `bin/start` alongside it — the failure mode of forgetting
// being a poll that 404s forever while the game looks fine.
//
// The leaderboard is the opposite. It writes files, re-simulates submissions
// and holds a queue; a second implementation of any of that inside a Vite
// plugin is a second implementation of the anti-cheat. So `bin/dev` talks to
// the same server production talks to, and if it is not running the board
// simply reports itself offline — which the client is built to do anyway,
// because the device gate can sign you out mid-session.
//
// The route list is explicit rather than a bare `/api` prefix, so that the
// `/api/spec` middleware above is not shadowed by the proxy.
const API_PORT = process.env.PORT || '9422'
const LEADERBOARD_ROUTES = '^/api/(runs|leaderboard|replays|players|levels|rules|health)'

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
    proxy: {
      [LEADERBOARD_ROUTES]: {
        target: `http://127.0.0.1:${API_PORT}`,
        // `changeOrigin: false` — the server does not care about Host and
        // rewriting it would only make a proxied request differ from a real one.
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
