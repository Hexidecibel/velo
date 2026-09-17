// What the Super Meat Boy montage costs a frame. Driven by bin/montagebench.
//
// THE QUESTION: the plan estimated 50 ghosts at ~3.7 ms of a 16.7 ms frame from
// the sim benchmark alone — 8.8 µs per sim-tick times four ticks per input
// frame times 2.13 input frames per rendered frame. That arithmetic is right
// and it is only half the bill, because a montage rider also has to be DRAWN,
// and on the art renderer a bike is not free. So the cap is measured here
// rather than derived, and it is measured on the level it will hurt on.
//
// TWO NUMBERS, SEPARATELY, because they scale with different things:
//
//   STEP  advancing N riders' own sims. Scales with the level's edge count and
//         is paid in full whatever the camera is looking at — the riders are
//         never culled from the sim, only from the draw.
//   DRAW  N more bikes in the frame. Scales with how many are ON SCREEN, which
//         on a sprawling level is a fraction of the crowd and on a tight one is
//         all of it. That is why 20-close-quarters is the level that decides
//         the cap: everybody dies in the same few metres, so nothing culls.
//
// The numbers are a FLOOR, not a ceiling: this box has no GPU, so Chrome
// rasterises the canvas on the CPU. A machine with a GPU is faster, never
// slower.
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { reapOrphans, spawnChrome } from './_chrome.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const levels = args.length ? args : ['20-close-quarters'];
const W = Number(process.env.BENCH_W || 1600);
const H = Number(process.env.BENCH_H || 900);
/** Rider counts to sweep. 0 is the baseline the rest are measured against. */
const COUNTS = (process.env.BENCH_COUNTS || '0,10,25,40,60,100').split(',').map(Number);
/** Input frames timed per step sample. 2048 is 16 s of run at 128 Hz. */
const STEP_FRAMES = Number(process.env.BENCH_STEP_FRAMES || 512);
/** Rendered frames timed per draw sample. */
const DRAW_FRAMES = Number(process.env.BENCH_DRAW_FRAMES || 150);

/** 60 fps against a 128 Hz input rate: 2.13 input frames per rendered frame. */
const FRAMES_PER_RENDER = 128 / 60;
const BUDGET_MS = 1000 / 60;

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

let worstLevel = null;
try {
  const cdp = await connect(await waitForTarget(cdpPort));
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  for (const lv of levels) {
    await cdp.send('Page.navigate', { url: `${url}?level=${lv}` });
    await settle(cdp);
    const rows = await ev(cdp, BENCH(COUNTS, STEP_FRAMES, DRAW_FRAMES));
    const r = report(lv, rows);
    if (!worstLevel || r.perRider > worstLevel.perRider) worstLevel = r;
  }
} catch (e) {
  console.error(`    FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  chrome.kill('SIGKILL');
  serve.close();
  await new Promise((r) => setTimeout(r, 300));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

if (worstLevel) {
  console.log('');
  console.log(`    worst level: ${worstLevel.id} at ${worstLevel.perRider.toFixed(3)} ms per rider per frame`);
  console.log(`    a 16.7 ms frame with 4 ms of headroom fits ~${Math.floor(4 / worstLevel.perRider)} riders`);
}

// --- the measurement --------------------------------------------------------
//
// Injected verbatim; it runs inside the page because that is the only place the
// riders and the renderer exist. It returns raw samples and the summarising
// happens out here, where it can be read.
function BENCH(counts, stepFrames, drawFrames) {
  return `(async () => {
  const v = window.velo;
  const lvl = v.level;
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  // FULL DETAIL, always. The adaptive controller would otherwise hold the frame
  // at its own target and this bench would report "fits" when what it meant was
  // "turned the art down until it fit" — which is exactly the failure mode a
  // number that decides a cap must not have.
  v.art.adaptive = 0;
  v.rebake();
  // Canvas2D records a display list and rasterises it lazily, so timing the
  // render call alone measures how fast we can DESCRIBE a frame. A 1x1
  // getImageData forces the raster to complete inside the sample. Same constant
  // readback on both halves of every pair, so it cancels in the delta.
  const cctx = document.getElementById('view').getContext('2d');
  const flush = () => cctx.getImageData(0, 0, 1, 1);
  const zoom = 62;

  const out = [];
  for (const n of ${JSON.stringify(counts)}) {
    const built = v.montageBench(n);
    // Advance the crowd into the level so it is spread the way a real montage
    // is, rather than stacked on the start line where forty bikes overdraw the
    // same pixels and flatter the draw number.
    v.montageStepBench(256);

    // STEP: N sims advancing one input frame each. The riders are never culled
    // from the sim — only from the draw — so this is paid in full whatever the
    // camera is looking at.
    const stepMs = v.montageStepBench(${stepFrames});

    // DRAW, PAIRED AND INTERLEAVED. This box is shared and its load average
    // moves by a factor of three inside a minute; two consecutive passes would
    // report whatever somebody else's build was doing, which has already
    // produced a negative cost for an extra forty bikes. So each sample draws
    // the SAME frame twice back to back, with the crowd and without it, and the
    // number kept is the difference. Drift slow enough to matter is shared
    // between the halves of a pair and cancels.
    const m = v.montage;
    const at = { x: v.sim.state.px, y: v.sim.state.py };
    v.renderAt(at.x, at.y, zoom, { art: true });
    flush();
    await raf();
    const withM = [];
    const without = [];
    for (let i = 0; i < ${drawFrames}; i++) {
      const a0 = performance.now();
      v.renderAt(at.x, at.y, zoom, { art: true });
      flush();
      withM.push(performance.now() - a0);
      const b0 = performance.now();
      v.renderAt(at.x, at.y, zoom, { art: true, montage: false });
      flush();
      without.push(performance.now() - b0);
      await raf();
    }
    out.push({
      n,
      buildMs: built.buildMs,
      stepMs,
      stepFrames: ${stepFrames},
      drawn: m ? m.count : 0,
      withM,
      without,
    });
  }
  v.montageBench(0);
  return { levelName: lvl.name, rows: out };
})()`;
}

// --- reporting --------------------------------------------------------------

function pct(a, p) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * s.length) - 1))];
}

function report(id, o) {
  console.log('');
  console.log(`==> ${id} — ${o.levelName}`);
  console.log(`    empty frame on this box: p50 ${pct(o.rows[0].without, 50).toFixed(1)} ms ` +
    `(no GPU, CPU raster — a floor, and the reason only the DELTA below is trusted)`);
  console.log('    riders   step ms/frame   draw delta p50   draw delta p95   montage ms/frame @60fps');
  let perRider = 0;
  for (const r of o.rows) {
    const stepPerFrame = r.stepMs / r.stepFrames;
    // PAIRED DIFFERENCES, not a difference of medians: the pairing is the whole
    // point on a loaded box, and taking medians first throws it away.
    const deltas = r.withM.map((a, i) => a - r.without[i]);
    const d50 = r.n === 0 ? 0 : pct(deltas, 50);
    const d95 = r.n === 0 ? 0 : pct(deltas, 95);
    const total = d50 + stepPerFrame * FRAMES_PER_RENDER;
    if (r.n > 0) perRider = Math.max(perRider, total / r.n);
    console.log(
      `    ${String(r.n).padStart(6)}   ` +
      `${stepPerFrame.toFixed(4).padStart(13)}   ` +
      `${d50.toFixed(2).padStart(14)}   ` +
      `${d95.toFixed(2).padStart(14)}   ` +
      `${total.toFixed(2).padStart(23)}` +
      (total > BUDGET_MS ? '  OVER BUDGET' : ''),
    );
  }
  return { id, perRider };
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
  await new Promise((r) => setTimeout(r, 2600));
  const ok = await ev(cdp, 'typeof window.velo !== "undefined" && !!window.velo.montageBench');
  if (!ok) throw new Error('page did not expose window.velo.montageBench');
}
