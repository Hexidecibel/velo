// What the sound costs a frame. Driven by bin/audiobench.
//
// THE QUESTION: level 20 is already near the frame budget on a software
// rasteriser and the user can feel it, so audio has to be a rounding error or
// it does not ship. The claim being measured is that a handful of long-lived
// oscillators whose parameters are modulated costs the MAIN THREAD almost
// nothing — the synthesis itself happens on the audio thread, and what the game
// loop pays is the scheduling calls.
//
// It measures two things on the same build, over the same fixed input stream:
//
//   1. `velo.audio.lastMs` — the audio update call itself, per frame.
//   2. whole frame time, muted versus loud. Muting SUSPENDS the context, so
//      "muted" really is the cost of not having audio at all, which makes this
//      an honest A/B rather than a comparison against a different build.
//
// The numbers are a FLOOR like artbench's: this box has no GPU, so Chrome
// rasterises the canvas on the CPU and the frame is dominated by drawing.
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { reapOrphans, spawnChrome } from './_chrome.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

const levels = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const LEVELS = levels.length ? levels : ['20-close-quarters', '10-cathedral'];
const W = Number(process.env.BENCH_W || 1600);
const H = Number(process.env.BENCH_H || 900);
/** Input frames per pass. 1600 at 128 Hz is 12.5 s of riding. */
const FRAMES = Number(process.env.BENCH_FRAMES || 1600);
/** Passes per condition. Interleaved, so a busy box biases both equally. */
const PASSES = Number(process.env.BENCH_PASSES || 3);

const f = (ms) => `${ms.toFixed(3).padStart(7)}`;
const over = (m) => m.overPct.toFixed(1);

const serve = createServer(async (req, res) => {
  const raw = decodeURIComponent((req.url || '/').split('?')[0]);
  if (raw === '/api/spec') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end('{"version":"none","present":false,"override":{},"error":null}');
    return;
  }
  if (raw.startsWith('/api/')) {
    res.writeHead(503, { 'content-type': 'application/json' }).end('{"ok":false}');
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

reapOrphans(['velo-audiobench-']);
const profile = await mkdtemp(join(tmpdir(), 'velo-audiobench-'));
const cdpPort = await freePort();
const chrome = spawnChrome(profile, cdpPort, W, H);

let failed = null;
try {
  const cdp = await connect(await waitForTarget(cdpPort));
  await cdp.send('Runtime.enable', {});
  await cdp.send('Page.enable', {});

  for (const level of LEVELS) {
    await cdp.send('Page.navigate', { url: `${url}?level=${encodeURIComponent(level)}` });
    await cdp.waitFor('Page.loadEventFired', 20000);
    if ((await ev(cdp, 'typeof window.velo !== "undefined" && !!window.velo.scriptRun')) !== true) {
      throw new Error('page did not expose window.velo.scriptRun');
    }
    // A TRUSTED click: a page-dispatched MouseEvent does not satisfy the
    // gesture gate, so without this the context never starts and the bench
    // would cheerfully report that audio is free.
    await click(cdp, Math.floor(W / 2), Math.floor(H * 0.8));
    // Mute is remembered in localStorage, and the last pass of the previous
    // level left it ON. Without this the second level boots muted, the context
    // never resumes, and the bench reports that audio is free.
    await ev(cdp, '(window.velo.setMuted(false), true)');
    for (let i = 0; i < 50; i++) {
      if ((await ev(cdp, 'window.velo.audio.state')) === 'running') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const state = await ev(cdp, 'window.velo.audio.state');
    if (state !== 'running') throw new Error(`audio never reached 'running' (${state})`);
    await ev(cdp, '(window.velo.overview.skipIntro(), true)');

    const loud = [];
    const quiet = [];
    // INTERLEAVED. A box that gets busy halfway through a sweep would
    // otherwise put all of its noise into whichever condition ran second, and
    // report it as the cost of audio.
    for (let p = 0; p < PASSES; p++) {
      loud.push(await pass(cdp, false));
      quiet.push(await pass(cdp, true));
    }

    const L = merge(loud);
    const Q = merge(quiet);
    console.log(`==> ${level}  (${W}x${H}, ${FRAMES} input frames x ${PASSES} passes each way)`);
    console.log(`    audio update      ${f(L.aMean)} mean  ${f(L.aP50)} p50  ${f(L.aP95)} p95  ${f(L.aMax)} max   over ${L.n} frames`);
    console.log(`    frame time loud   ${f(L.fMean)} mean  ${f(L.fP50)} p50  ${f(L.fP95)} p95  ${f(L.fMax)} max`);
    console.log(`    frame time muted  ${f(Q.fMean)} mean  ${f(Q.fP50)} p50  ${f(Q.fP95)} p95  ${f(Q.fMax)} max   (context SUSPENDED)`);
    console.log(`    delta             ${f(L.fMean - Q.fMean)} mean  ${f(L.fP50 - Q.fP50)} p50  ${f(L.fP95 - Q.fP95)} p95` +
      `   = ${(((L.fP50 - Q.fP50) / 16.7) * 100).toFixed(1)}% of a 60 fps frame at p50`);
    console.log(`    cues fired        ${L.cues} loud / ${Q.cues} muted`);
    // The frame clock is vsync-locked, so frame time is quantised to 16.7 ms
    // and cannot resolve a delta this small. That is the honest reading: the
    // A/B says "below the resolution of a frame", and the audio-update column
    // above is the number with any precision in it.
    console.log(`    over 16.7 ms      ${over(L)}% loud / ${over(Q)}% muted`);
    await ev(cdp, '(window.velo.setMuted(false), true)');
  }

  cdp.close();
} catch (e) {
  failed = e;
} finally {
  chrome.kill('SIGKILL');
  serve.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

if (failed) {
  console.error('==> AUDIOBENCH FAILED: ' + failed.message);
  process.exit(1);
}
process.exit(0);

/** One scripted run, timing every rendered frame from inside the page. */
async function pass(cdp, muted) {
  const out = await ev(cdp, `
    (async () => {
      window.velo.setMuted(${muted});
      // Let the suspend or resume settle before anything is timed.
      await new Promise((r) => setTimeout(r, 250));
      const masks = [];
      for (let i = 0; i < ${FRAMES}; i++) {
        masks.push((i % 7 < 5 ? 1 : 0) | (i % 13 < 4 ? 4 : 0) | (i % 29 < 3 ? 8 : 0) | (i % 61 === 0 ? 16 : 0));
      }
      const frames = [];
      const audio = [];
      let last = performance.now();
      let running = true;
      const tick = (now) => {
        if (!running) return;
        requestAnimationFrame(tick);
        frames.push(now - last);
        last = now;
        audio.push(window.velo.audio.lastMs);
      };
      requestAnimationFrame(tick);
      const c0 = window.velo.audio.cues;
      await window.velo.scriptRun(masks);
      running = false;
      // The first two samples straddle the start and describe the setTimeout
      // above rather than the run.
      return { frames: frames.slice(2), audio: audio.slice(2), cues: window.velo.audio.cues - c0 };
    })()
  `);
  return out;
}

function merge(passes) {
  const frames = passes.flatMap((p) => p.frames);
  const audio = passes.flatMap((p) => p.audio);
  const cues = passes.reduce((a, p) => a + p.cues, 0);
  const s = (a) => a.slice().sort((x, y) => x - y);
  const pct = (a, q) => (a.length ? s(a)[Math.min(a.length - 1, Math.floor(a.length * q))] : 0);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    n: frames.length,
    cues,
    overPct: frames.length ? (frames.filter((x) => x > 16.7 * 1.5).length / frames.length) * 100 : 0,
    fMean: mean(frames), fP50: pct(frames, 0.5), fP95: pct(frames, 0.95), fMax: Math.max(0, ...frames),
    aMean: mean(audio), aP50: pct(audio, 0.5), aP95: pct(audio, 0.95), aMax: Math.max(0, ...audio),
  };
}

// --- the smallest CDP client that does the job -------------------------------

async function freePort() {
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const p = probe.address().port;
  await new Promise((r) => probe.close(r));
  return p;
}

async function waitForTarget(port) {
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch { /* chrome not up yet */ }
    if (Date.now() > deadline) throw new Error('chrome never opened its debugging port');
    await new Promise((r) => setTimeout(r, 150));
  }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = new Map();
    const api = {
      on: (method, fn) => listeners.set(method, [...(listeners.get(method) || []), fn]),
      send: (method, params) =>
        new Promise((res, rej) => {
          const n = ++id;
          pending.set(n, { res, rej });
          ws.send(JSON.stringify({ id: n, method, params }));
        }),
      waitFor: (method, ms) =>
        new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error(`timed out waiting for ${method}`)), ms);
          api.on(method, (p) => { clearTimeout(t); res(p); });
        }),
      close: () => ws.close(),
    };
    ws.addEventListener('open', () => resolve(api));
    ws.addEventListener('error', (e) => reject(new Error('cdp socket error: ' + (e.message || 'unknown'))));
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method) {
        for (const fn of listeners.get(msg.method) || []) fn(msg.params);
      }
    });
  });
}

async function click(cdp, x, y) {
  const base = { x, y, button: 'left', clickCount: 1, buttons: 1 };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
}

async function ev(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('evaluate threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
