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
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

const LEVELS = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const levels = LEVELS.length ? LEVELS : ['10-cathedral'];
const W = Number(process.env.BENCH_W || 1600);
const H = Number(process.env.BENCH_H || 900);
/** Metres per second the camera travels. 18 m/s is a fast run, not a cruise. */
const SPEED = Number(process.env.BENCH_SPEED || 18);

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

const profile = await mkdtemp(join(tmpdir(), 'velo-bench-'));
const cdpPort = await freePort();
const chrome = spawn(process.env.CHROME || 'google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  `--window-size=${W},${H}`, '--hide-scrollbars',
  `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let failed = false;
try {
  const cdp = await connect(await waitForTarget(cdpPort));
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  for (const lv of levels) {
    await cdp.send('Page.navigate', { url: `${url}?level=${lv}` });
    await settle(cdp);
    const out = await ev(cdp, BENCH(SPEED));
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
function BENCH(speed) {
  return `(async () => {
  const v = window.velo;
  const lvl = v.level;
  const bake = v.rebake();
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const A = v.art;
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

  const art62 = await pass(62, true);
  const art110 = await pass(110, true);
  const old62 = await pass(62, false);
  const artOv = await pass(Math.max(6, Math.min(30, 900 / Math.max(lvl.maxX - lvl.minX, 1))), true);

  // THE END-TO-END NUMBER. Everything above times the render call with an
  // artificial readback to force the raster; this just drives the real game and
  // watches how long real frames take, art on and art off. It is the number a
  // player would feel, and it includes the sim step and the HUD.
  async function live(useArt) {
    A.enabled = useArt ? 1 : 0;
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
  const liveArt = await live(true);
  const liveOld = await live(false);
  A.enabled = 1;

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
    'no cel bands+lip+ink': { inkWidth: 0, lipWidth: 0, bandScale: 0 },
    'flat (all texture off)': { hatch: 0, wall: 0, stamps: 0, detail: 0, bloom: 0, motes: 0 },
    'background only': { hatch: 0, stamps: 0, detail: 0, bloom: 0, motes: 0, chevrons: 0, underworks: 0, inkWidth: 0, lipWidth: 0, bandScale: 0 },
  };
  for (const [name, over] of Object.entries(variants)) {
    Object.assign(A, base, over);
    layers[name] = await pass(62, true, 200);
  }
  Object.assign(A, base);

  return {
    level: lvl.name,
    span: [lvl.maxX - lvl.minX, lvl.maxY - lvl.minY],
    bakeMs: bake.ms,
    stats: bake.stats,
    firstFrame,
    art: { warm: art62, zoomIn: art110, overview: artOv },
    old: { warm: old62 },
    live: { art: liveArt, old: liveOld },
    flushOnly,
    layers,
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
  console.log('');
  console.log(`    ${id}  "${o.level}"  ${o.span[0].toFixed(0)}x${o.span[1].toFixed(0)} m  ${W}x${H}`);
  console.log(`    bake ${o.bakeMs.toFixed(1)} ms once  (${o.stats.subpaths} subpaths, ${o.stats.stamps} stamps, ${o.stats.chevrons} chevrons, ${o.stats.pipes} pipes)`);
  console.log(`    first frame after a cold bake: ${o.firstFrame.toFixed(1)} ms`);
  console.log(`    readback overhead included in every sample below: ${stat(o.flushOnly).p50.toFixed(2)} ms`);
  console.log('');
  console.log('                                mean    p50    p95    max |  net mean  net p95  % of 16.7 (net p95)');
  const row = (name, s) => console.log(
    `    ${name.padEnd(24)}${f(s.mean)} ${f(s.p50)} ${f(s.p95)} ${f(s.max)} |  ` +
    `${f(Math.max(0, s.mean - rb))}   ${f(Math.max(0, s.p95 - rb))}   ${(((s.p95 - rb) / 16.7) * 100).toFixed(0)}%`);
  row('art, panning @62 px/m', a);
  row('art, panning @110 px/m', z);
  row(`art, overview @${(900 / Math.max(o.span[0], 1)).toFixed(0)} px/m`, ov);
  row('OLD renderer @62 px/m', old);
  console.log(`    art costs ${(a.p95 - old.p95).toFixed(2)} ms more than the old renderer at p95 — readback-free, so this is the honest delta`);
  if (o.live) {
    const la = stat(o.live.art);
    const lo = stat(o.live.old);
    console.log('');
    console.log('    REAL LOOP, throttle held, rAF frame-to-frame (sim + render + HUD):');
    console.log(`    art on      ${f(la.mean)} mean  ${f(la.p50)} p50  ${f(la.p95)} p95  ${f(la.max)} max   ${(1000 / la.p50).toFixed(0)} fps`);
    console.log(`    art off     ${f(lo.mean)} mean  ${f(lo.p50)} p50  ${f(lo.p95)} p95  ${f(lo.max)} max   ${(1000 / lo.p50).toFixed(0)} fps`);
  }
  if (o.layers) {
    console.log('');
    console.log('    what each layer costs (one layer off, same 200 frames @62 px/m):');
    const bl = stat(o.layers['ALL ON (baseline)']).mean;
    for (const [name, arr] of Object.entries(o.layers)) {
      const s2 = stat(arr);
      const d = name.startsWith('ALL ON') ? '' : `saves ${(bl - s2.mean).toFixed(2)} ms`;
      console.log(`    ${name.padEnd(24)}${f(s2.mean)} mean   ${d}`);
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
