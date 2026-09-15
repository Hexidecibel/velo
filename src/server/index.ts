// =============================================================================
// velo — the server
// =============================================================================
// One Node process. Today it serves the built client out of dist/ and answers a
// health probe, and that is ALL it does: there is no game API yet, because
// replays and leaderboards are a later milestone and inventing their endpoints
// now would freeze a wire format before the sim that feeds it has settled.
//
// It exists anyway, rather than being deferred until there is something to
// serve, for two reasons. It is the thing HAProxy points at — a static bundle
// still needs a process behind a backend — and it is the shell the leaderboard
// API grows into, so `bin/deploy`, the unit, the port and the route all get
// proven now against something trivial instead of all at once later.
//
// NO AUTHENTICATION LIVES HERE, ON PURPOSE. This binds loopback and HAProxy
// fronts it; the cush-auth device gate is what decides who gets in. That is
// only true while the bind stays on 127.0.0.1 — binding 0.0.0.0 would hand
// every machine on the LAN an ungated copy, which is a wart the port registry
// already records against another app on this box. Do not "just for testing"
// it.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { SPEC_FILE, specPayload } from './specfile.ts';

const app = new Hono();

// Health. Deliberately the first route and deliberately dependency-free: every
// caller of it — bin/deploy's wait loop, bin/status, HAProxy's `check`, and
// sentinel if it ever watches this — is asking "is the process listening",
// not "is the game fun". A health endpoint that touches anything that can be
// slow or absent turns a working service into a failed deploy.
//
// It probes /api/health rather than `/`: GETting an app root every N seconds
// is a recorded incident on this box (a probe against jam's root minted 13,105
// session rows in 18 days, one per poll).
app.get('/api/health', (c) => c.json({ status: 'ok', service: 'velo' }));

// Live tune. The client polls this while somebody at a terminal drives
// `bin/spec`, so that changing the bike does not mean talking a player through
// a table of sliders to drag.
//
// READ-ONLY, and that is a decision rather than an omission. Writes go through
// `bin/spec` to `data/spec.json`, which means nothing reachable over the
// network can change the bike — this binds loopback behind the cush-auth gate
// today, but "the only way to write is to be on the box" is a property worth
// having unconditionally rather than one that depends on the front door staying
// shut.
//
// `version` is a content hash of the override, so a poll is one cheap
// comparison and rewriting identical values does not read as a change. A
// malformed file answers 200 with `error` set rather than 500: the client shows
// it and keeps playing, because a typo in a tuning file must not take the game
// down.
app.get('/api/spec', (c) => c.json(specPayload()));

// WHAT IS PUBLISHED IS NOT WHAT IS BUILT, AND THAT SEPARATION IS THE POINT.
//
// This used to serve `./dist` directly. serveStatic reads from disk per request,
// so ANY `bin/build` in this working tree went live instantly — no deploy step,
// no health check, no commit, nobody choosing to publish. It was found the
// honest way: an agent rebuilt dist/ for screenshots and the user saw a
// half-ported renderer on the public URL six hours after the last restart.
//
// Now the service serves a separate release directory that only `bin/deploy`
// writes, after the build has typechecked, bundled, precompressed and passed
// its bundle check. Builds stay local; publishing is a deliberate act.
//
// Override with VELO_STATIC_ROOT for a preview of an arbitrary directory.
const STATIC_ROOT = process.env.VELO_STATIC_ROOT || './release';

// `precompressed` makes serveStatic prefer a `.br`/`.gz` sibling when the
// request's Accept-Encoding allows it — bin/deploy writes those after the
// bundle. HAProxy does NOT compress this backend, so if the siblings are
// missing the bundle simply goes out uncompressed; nothing breaks, it is just
// bigger.
app.use('/*', serveStatic({ root: STATIC_ROOT, precompressed: true }));

// SPA fallback. Anything that is not an /api route and did not match a real
// file gets index.html, so a deep link or a refresh lands in the game rather
// than on a 404. The /api guard matters even with no API yet: without it, a
// typo'd future endpoint would answer 200 with a page of HTML, and the client
// would report "unexpected token '<'" instead of "404".
app.get('*', (c, next) => {
  if (c.req.path.startsWith('/api')) return next();
  return serveStatic({ root: STATIC_ROOT, path: 'index.html' })(c, next);
});

// PORT from the environment with a literal fallback, never a bare literal in
// the probe path — reading the port one way here and hardcoding it in a health
// check is a recorded incident in this tree (a service moved to another port
// restarts fine and then reports a false failure).
const port = Number.parseInt(process.env.PORT || '9422', 10);
const hostname = process.env.HOST || '127.0.0.1';

console.log(`velo server listening on http://${hostname}:${port}`);
console.log(`  static root: ${STATIC_ROOT} (precompressed) — written only by bin/deploy`);
console.log('  api:         /api/health, /api/spec (read-only live tune)');
console.log(`  live tune:   ${SPEC_FILE} — change it with bin/spec`);

serve({ fetch: app.fetch, port, hostname });
