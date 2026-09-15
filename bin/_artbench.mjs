// Frame budget for the art renderer. Driven by bin/artbench.
//
// THE QUESTION THIS EXISTS TO ANSWER: the art direction was proven in a mockup
// that draws ONE STATIC FRAME into cached screen-space layers. The game has a
// camera that moves at sixty frames a second, and screen-space caching stops
// working the instant it does. So the art is proven and the RENDERING of it at
// speed is not, and finding that out after a prop system is built on top would
// be expensive.
//
// It flies the camera across a level at a realistic play speed and times the
// render call itself — not the loop, which also steps the sim and rewrites the
// HUD, and would therefore answer a question nobody asked. `window.velo.renderAt`
// renders exactly what a frame renders, at a camera the caller chooses, which
// makes "the art versus the old renderer on the same frame" a fair comparison
// rather than an estimate.
//
// The numbers it prints are a FLOOR, not a ceiling: this box has no GPU, so
// Chrome rasterises the canvas on the CPU. A machine with a GPU will be faster,
// never slower. If it holds 60 fps here it holds 60 fps anywhere.
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { reapOrphans, spawnChrome } from './_chrome.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

const LEVELS = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const levels = LEVELS.length ? LEVELS : ['10-cathedral'];
const W = Number(process.env.BENCH_W || 1600);
const H = Number(process.env.BENCH_H || 900);
/** Metres per second the camera travels. 18 m/s is a fast run, not a cruise. */
const SPEED = Number(process.env.BENCH_SPEED || 18);
/**
 * Art parameter overrides, as JSON, applied before measuring.
 *
 * This is what makes a before/after honest on ONE build: running
 * `BENCH_ART='{"derive":0,"variety":0,"props":0,"parallax":0}'` measures
 * exactly the Phase 1 look through the Phase 2 code, so the difference reported
 * is the difference the new layers make and not the difference between two
 * checkouts of the renderer.
 */
const ART = process.env.BENCH_ART ? JSON.parse(process.env.BENCH_ART) : {};
/**
 * Where to append results as they land.
 *
 * A twenty-level sweep takes half an hour, and a sweep that only writes to
 * stdout loses everything if the process dies — which has happened. Each level
 * is appended the moment it finishes, so a killed run costs the levels it had
 * not reached and nothing else.
 */
const OUT = process.env.BENCH_OUT || '';
/**
 * Measure ONLY the interleaved Phase 1 / Phase 2 comparison, and skip the
 * zoom-in pass, the overview pass, the old-renderer pass and the layer
 * breakdown.
 *
 * The full report takes several minutes a level, which is fine on a quiet box
 * and is two and a half hours across twenty levels on a busy one. The question
 * "what did Phase 2 add" only needs the interleaved pass, and that pass is also
 * the only part of the report whose answer survives a busy box — so when the
 * machine is loaded this is not a degraded run, it is the only honest one.
 */
const AB_ONLY = process.env.BENCH_AB === '1';
const say = (line) => {
  console.log(line);
  if (OUT) appendFileSync(OUT, `${line}\n`);
};

const serve = createServer(async (req, res) => {
  const raw = decodeURIComponent((req.url || '/').split('?')[0]);
  if (raw === '/api/spec') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end('{"version":"none","present":false,"override":{},"error":null}');
    return;
  }
  const rel = normalize(raw === '/' ? '/index.html' : raw).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(DIST, rel));
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('nope');
  }
});
await new Promise((r) => serve.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${serve.address().port}/`;

reapOrphans();
const profile = await mkdtemp(join(tmpdir(), 'velo-bench-'));
const cdpPort = await freePort();
const chrome = spawnChrome(profile, cdpPort, W, H);

let failed = false;
try {
  const cdp = await connect(await waitForTarget(cdpPort));
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  for (const lv of levels) {
    await cdp.send('Page.navigate', { url: `${url}?level=${lv}` });
    await settle(cdp);
    const out = await ev(cdp, BENCH(SPEED, ART, AB_ONLY));
    const net = report(lv, out);
    if (net > 16.7) failed = true;
  }
} catch (e) {
  console.error(`    FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  chrome.kill('SIGKILL');
  serve.close();
  // Chrome is still flushing its profile as it dies; a bare rm races it.
  await new Promise((r) => setTimeout(r, 300));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

if (failed) {
  console.log('');
  console.log('    p95 of a warm art frame is over the 16.7 ms budget.');
  console.log('    That is the STOP condition: a prop system built on a renderer');
  console.log('    that cannot carry it is the expensive mistake.');
  process.exitCode = 2;
}

// --- the measurement --------------------------------------------------------
//
// Injected verbatim. It runs inside the page because that is the only place the
// renderer exists, and it returns raw samples so the summarising happens here
// where it can be read and changed.
function BENCH(speed, art, abOnly) {
  return `(async () => {
  const v = window.velo;
  const lvl = v.level;
  const bake = v.rebake();
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const A = v.art;
  Object.assign(A, ${JSON.stringify(art)});
  // EVERY TIMED PASS BELOW RUNS AT FULL DETAIL. The adaptive system would
  // otherwise hold the p95 at its own target and this bench would report
  // "passes" when what it meant was "turned everything off to get there" —
  // which is precisely the failure mode a standing check must not have. What
  // the adaptive system settles at is measured separately, in the live loop,
  // and printed beside the honest numbers.
  //
  // SET IT BEFORE CAPTURING THE BASELINE. The layer breakdown restores the
  // baseline between variants, so capturing it first put adaptation back on for
  // every one of them — which is how a run came out claiming that turning bloom
  // OFF made the frame four milliseconds SLOWER.
  A.adaptive = 0;
  const base = { ...A };
  // FORCE THE FLUSH, or every number below is a lie.
  //
  // Canvas2D records a display list and rasterises it lazily, so timing
  // renderAt() alone measures how fast we can DESCRIBE a frame, not how fast
  // the browser can draw one. The first version of this bench reported the old
  // renderer at 0.33 ms and blamed 11.8 ms on the bloom pass — which was simply
  // the one call that read the canvas back and therefore paid for everybody
  // else's deferred work. A 1x1 getImageData after each render forces the
  // raster to complete inside the sample. It costs a constant readback, applied
  // identically to both renderers, which is exactly what a comparison needs.
  const cv = document.getElementById('view');
  const cctx = cv.getContext('2d');
  const flush = () => cctx.getImageData(0, 0, 1, 1);

  // A pass: fly left-to-right across the level at play speed, one render per
  // animation frame, timing the render call alone.
  async function pass(zoom, useArt, cap) {
    const samples = [];
    const dt = 1 / 60;
    let x = lvl.minX + 4;
    const end = lvl.maxX - 4;
    const yy = (lvl.minY + lvl.maxY) / 2;
    v.renderAt(x, yy, zoom, { art: useArt });
    flush();
    await raf();
    while (x < end && samples.length < (cap || 900)) {
      const t0 = performance.now();
      v.renderAt(x, yy, zoom, { art: useArt });
      flush();
      samples.push(performance.now() - t0);
      x += ${speed} * dt;
      await raf();
    }
    return samples;
  }

  // COLD: the bake thrown away, so the first frame pays for rebuilding every
  // path in the level. This is what a level load costs.
  v.rebake();
  const coldStart = performance.now();
  v.renderAt(lvl.minX + 4, (lvl.minY + lvl.maxY) / 2, 62, { art: true });
  flush();
  const firstFrame = performance.now() - coldStart;

  // What the readback alone costs, so the reader can subtract it.
  const flushOnly = [];
  for (let i = 0; i < 60; i++) { const t0 = performance.now(); flush(); flushOnly.push(performance.now() - t0); await raf(); }

  const AB = ${abOnly};
  const art110 = AB ? [0] : await pass(110, true);
  const old62 = AB ? [0] : await pass(62, false);

  // PHASE 1 AND PHASE 2, INTERLEAVED ALONG ONE FLIGHT.
  //
  // A before/after is only a comparison if the machine was equally busy for
  // both, and this box is shared. Two consecutive passes were not enough: a
  // load spike that lands on one of them lands on neither the other nor the
  // frames either side, and the run then reports a difference that is entirely
  // somebody else's build. One sweep came out claiming Phase 2 was fifty-nine
  // milliseconds FASTER than Phase 1, which is the same error with its sign
  // flipped, and is the reason to fix the method rather than to re-run until
  // the number looks plausible.
  //
  // So the two configurations alternate in blocks along a single flight across
  // the level. Drift slow enough to matter is shared between them; anything
  // faster averages out across the blocks.
  //
  // Switching derive or variety changes the bake signature, so each switch
  // costs one rebake. That is why the blocks are long and why the first few
  // frames after each switch are thrown away.
  const PHASE1 = { derive: 0, variety: 0, props: 0, parallax: 0 };
  const BLOCK = 110;
  const WARM = 6;
  const p1s = [];
  const p2s = [];
  {
    const dt = 1 / 60;
    let x = lvl.minX + 4;
    const end = lvl.maxX - 4;
    const yy = (lvl.minY + lvl.maxY) / 2;
    let block = 0;
    let n = 0;
    // Wrapped, so a short level still gets enough samples of each
    // configuration. 07-the-chimney is 52 m — one flight is 160 frames, which
    // would leave one of the two blocks with forty samples to take a p95 from.
    while (p1s.length + p2s.length < 1000) {
      if (x >= end) x = lvl.minX + 4;
      if (n % BLOCK === 0) {
        block++;
        Object.assign(A, base, block % 2 === 0 ? PHASE1 : {});
        v.renderAt(x, yy, 62, { art: true });
        flush();
        await raf();
      }
      const t0 = performance.now();
      v.renderAt(x, yy, 62, { art: true });
      flush();
      const ms = performance.now() - t0;
      if (n % BLOCK >= WARM) (block % 2 === 0 ? p1s : p2s).push(ms);
      n++;
      x += ${speed} * dt;
      await raf();
    }
    Object.assign(A, base);
  }
  const art62 = p2s;
  const p1 = p1s;
  const artOv = AB ? [0] : await pass(Math.max(6, Math.min(30, 900 / Math.max(lvl.maxX - lvl.minX, 1))), true);

  // THE END-TO-END NUMBER. Everything above times the render call with an
  // artificial readback to force the raster; this just drives the real game and
  // watches how long real frames take, art on and art off. It is the number a
  // player would feel, and it includes the sim step and the HUD.
  async function live(useArt, adaptive) {
    A.enabled = useArt ? 1 : 0;
    A.adaptive = adaptive ? 1 : 0;
    A.quality = 1;
    v.restart(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true }));
    const d = [];
    let last = performance.now();
    for (let i = 0; i < 260; i++) {
      await raf();
      const now = performance.now();
      if (i > 20) d.push(now - last);
      last = now;
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp', bubbles: true }));
    return d;
  }
  const liveArt = await live(true, false);
  const liveOld = AB ? [0] : await live(false, false);
  // And once more with the adaptive system ON, which is what actually ships.
  const liveAdapt = await live(true, true);
  const settled = { q: A.quality, solid: A.solidFrac, worst: A.artMs };
  A.enabled = 1;
  A.adaptive = 0;

  // Layer breakdown: turn ONE thing off and see what the frame gives back.
  // Short passes, because this is for deciding what to cut and not for the
  // headline number.
  const layers = {};
  const variants = {
    // The baseline has to be measured over the SAME window as the variants:
    // the headline pass covers the whole level and these cover its first two
    // hundred frames, so comparing a variant against the headline mean reports
    // the difference between two stretches of level as if it were the cost of a
    // layer. That produced negative costs the first time it ran.
    'ALL ON (baseline)': {},
    'no hatch': { hatch: 0 },
    'no wall detail': { wall: 0 },
    'no wall stamps': { stamps: 0 },
    'no patches/cracks': { detail: 0 },
    'no bloom': { bloom: 0 },
    'no chevrons': { chevrons: 0 },
    'no underworks': { underworks: 0 },
    'no motes': { motes: 0 },
    'no props': { props: 0 },
    'no parallax': { parallax: 0 },
    'no cel bands+lip+ink': { inkWidth: 0, lipWidth: 0, bandScale: 0 },
    'flat (all texture off)': { hatch: 0, wall: 0, stamps: 0, detail: 0, bloom: 0, motes: 0 },
    'background only': { hatch: 0, stamps: 0, detail: 0, bloom: 0, motes: 0, chevrons: 0, underworks: 0, inkWidth: 0, lipWidth: 0, bandScale: 0 },
  };
  if (!AB) {
    for (const [name, over] of Object.entries(variants)) {
      Object.assign(A, base, over);
      layers[name] = await pass(62, true, 130);
    }
  }
  Object.assign(A, base);

  return {
    level: lvl.name,
    span: [lvl.maxX - lvl.minX, lvl.maxY - lvl.minY],
    bakeMs: bake.ms,
    stats: bake.stats,
    firstFrame,
    art: { warm: art62, zoomIn: art110, overview: artOv, phase1: p1 },
    old: { warm: old62 },
    live: { art: liveArt, old: liveOld, adapt: liveAdapt },
    settled,
    props: bake.stats.props,
    budget: bake.stats.budget,
    sites: bake.stats.sites,
    flushOnly,
    layers: AB ? null : layers,
    abOnly: AB,
  };
})()`;
}

function pct(a, p) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
}
function stat(a) {
  return {
    n: a.length,
    mean: a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1),
    p50: pct(a, 0.5),
    p95: pct(a, 0.95),
    max: Math.max(...a),
  };
}

function report(id, o) {
  const a = stat(o.art.warm);
  const rb = stat(o.flushOnly).p50;
  const z = stat(o.art.zoomIn);
  const ov = stat(o.art.overview);
  const old = stat(o.old.warm);
  o.art.warm = a;
  const f = (n) => n.toFixed(2).padStart(6);
  say('');
  say(`    ${id}  "${o.level}"  ${o.span[0].toFixed(0)}x${o.span[1].toFixed(0)} m  ${W}x${H}`);
  say(`    bake ${o.bakeMs.toFixed(1)} ms once  (${o.stats.subpaths} subpaths, ${o.stats.stamps} stamps, ${o.stats.chevrons} chevrons, ${o.stats.pipes} pipes, ${o.props}/${o.budget} props from ${o.sites} sites)`);
  say(`    first frame after a cold bake: ${o.firstFrame.toFixed(1)} ms`);
  say(`    readback overhead included in every sample below: ${stat(o.flushOnly).p50.toFixed(2)} ms`);
  say('');
  say(o.abOnly
    ? '    A/B ONLY: Phase 1 and Phase 2 interleaved along one flight, adaptive off'
    : '    FULL DETAIL (adaptive off, so this is the honest cost, not what it settles for)');
  say('                                mean    p50    p95    max |  net mean  net p95  % of 16.7 (net p95)');
  const row = (name, s) => say(
    `    ${name.padEnd(24)}${f(s.mean)} ${f(s.p50)} ${f(s.p95)} ${f(s.max)} |  ` +
    `${f(Math.max(0, s.mean - rb))}   ${f(Math.max(0, s.p95 - rb))}   ${(((s.p95 - rb) / 16.7) * 100).toFixed(0)}%`);
  row('PHASE 2 art @62 px/m', a);
  const p1 = stat(o.art.phase1);
  row('PHASE 1 art @62 px/m', p1);
  if (!o.abOnly) {
    row('art, panning @110 px/m', z);
    row(`art, overview @${(900 / Math.max(o.span[0], 1)).toFixed(0)} px/m`, ov);
    row('OLD renderer @62 px/m', old);
    say(`    art costs ${(a.p95 - old.p95).toFixed(2)} ms more than the old renderer at p95 — readback-free, so this is the honest delta`);
  }
  // The number Phase 2 is actually accountable for, measured on the same frames
  // in the same process, so it cannot be a difference between two machines or
  // two moments.
  // Absolute milliseconds on a shared box say more about the box than about the
  // renderer, so the RATIO is printed beside them: it is the part of this
  // measurement that survives a busy machine, because both numbers came from
  // frames interleaved along the same flight.
  const rn = (x) => Math.max(0.01, x - rb);
  say(`    PHASE 2 costs ${(a.p95 - p1.p95).toFixed(2)} ms more than PHASE 1 at p95 (${(a.mean - p1.mean).toFixed(2)} at the mean)`);
  say(`    PHASE 2 / PHASE 1 = ${(rn(a.mean) / rn(p1.mean)).toFixed(2)}x at the mean, ${(rn(a.p95) / rn(p1.p95)).toFixed(2)}x at p95  <- the number that survives a busy box`);
  if (o.live) {
    const la = stat(o.live.art);
    const lo = stat(o.live.old);
    say('');
    say('    REAL LOOP, throttle held, rAF frame-to-frame (sim + render + HUD):');
    say(`    art on      ${f(la.mean)} mean  ${f(la.p50)} p50  ${f(la.p95)} p95  ${f(la.max)} max   ${(1000 / la.p50).toFixed(0)} fps`);
    if (!o.abOnly) say(`    art off     ${f(lo.mean)} mean  ${f(lo.p50)} p50  ${f(lo.p95)} p95  ${f(lo.max)} max   ${(1000 / lo.p50).toFixed(0)} fps`);
    if (o.live.adapt) {
      const ld = stat(o.live.adapt);
      say(`    adaptive    ${f(ld.mean)} mean  ${f(ld.p50)} p50  ${f(ld.p95)} p95  ${f(ld.max)} max   ${(1000 / ld.p50).toFixed(0)} fps`);
      // WHAT IT SETTLED AT. "It passes" must not be allowed to quietly mean
      // "it passed by turning everything off", so the number is printed every
      // time rather than only when it is interesting. 100% means the adaptive
      // system did nothing at all, which on most levels is the right answer.
      say(`    adaptive settled at DETAIL ${(o.settled.q * 100).toFixed(0)}%  (viewport ${(o.settled.solid * 100).toFixed(0)}% solid, worst art frame ${o.settled.worst.toFixed(1)} ms)`);
    }
  }
  if (o.layers) {
    say('');
    say('    what each layer costs (one layer off, same 130 frames @62 px/m):');
    const bl = stat(o.layers['ALL ON (baseline)']).mean;
    for (const [name, arr] of Object.entries(o.layers)) {
      const s2 = stat(arr);
      const d = name.startsWith('ALL ON') ? '' : `saves ${(bl - s2.mean).toFixed(2)} ms`;
      say(`    ${name.padEnd(24)}${f(s2.mean)} mean   ${d}`);
    }
  }
  return a.p95 - rb;
}

// --- CDP plumbing -----------------------------------------------------------

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function waitForTarget(port) {
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('chrome never came up');
    await new Promise((r) => setTimeout(r, 150));
  }
}
function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      }
    };
    ws.onerror = rej;
    ws.onopen = () => res({
      send: (method, params = {}) => new Promise((resolve, reject) => {
        const i = ++id;
        pending.set(i, { resolve, reject });
        ws.send(JSON.stringify({ id: i, method, params }));
      }),
    });
  });
}
async function ev(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
}
async function settle(cdp) {
  // Long enough for the bundle, the fonts and the opening overview peek.
  await new Promise((r) => setTimeout(r, 2600));
  const ok = await ev(cdp, 'typeof window.velo !== "undefined" && !!window.velo.renderAt');
  if (!ok) throw new Error('page did not expose window.velo.renderAt');
}
