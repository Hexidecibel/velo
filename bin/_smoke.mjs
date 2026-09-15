// Headless sanity check for bin/smoke. Not a feel test — feel needs hands.
//
// Serves dist/, drives the real page in headless Chrome over the DevTools
// protocol (Node's built-in WebSocket, so this adds no dependency), holds the
// throttle for a few seconds, and asserts that the page threw nothing, the sim
// actually advanced, and no state field went non-finite.
//
// It exists because a node-only unit test cannot see a broken bundle, a canvas
// that never paints, or a sim that explodes one second after the start line.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

const serve = createServer(async (req, res) => {
  const raw = decodeURIComponent((req.url || '/').split('?')[0]);
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
console.log(`    serving dist/ at ${url}`);

const profile = await mkdtemp(join(tmpdir(), 'velo-smoke-'));
// Ask the OS for a free port rather than guessing one. A random guess collided
// often enough to make this script look flaky, which is the worst thing a
// smoke test can be — you stop believing its failures.
const cdpPort = await freePort();
const chrome = spawn(
  process.env.CHROME || 'google-chrome',
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    '--window-size=1280,800', '--hide-scrollbars',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, 'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let failed = null;
try {
  const target = await waitForTarget(cdpPort);
  const cdp = await connect(target);
  const problems = [];
  cdp.on('Runtime.exceptionThrown', (p) => problems.push('exception: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text)));
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') problems.push('console.error: ' + p.args.map((a) => a.description || a.value).join(' '));
  });
  await cdp.send('Runtime.enable', {});
  await cdp.send('Page.enable', {});
  // Pinned to test01 with an explicit ?level=, not left to the default. The
  // default is "the first level in levels/ that loads", which MOVES whenever
  // somebody adds a level — and a smoke check whose expectations depend on
  // what got authored this week is a smoke check that cries wolf. The query
  // parameter also outranks the stored last-played level, so this is
  // independent of whatever a previous run left in localStorage.
  await cdp.send('Page.navigate', { url: url + '?level=test01' });
  await cdp.waitFor('Page.loadEventFired', 15000);

  const boot = await evalIn(cdp, `!!(window.velo && window.velo.sim)`);
  if (boot !== true) throw new Error('page loaded but window.velo never appeared — the bundle did not run');

  // Hold the throttle for three seconds of wall clock through the real input
  // path, not by poking the sim.
  await evalIn(cdp, `
    (() => {
      const k = (t, code) => window.dispatchEvent(new KeyboardEvent(t, { code, bubbles: true }));
      k('keydown', 'ArrowUp');
      setTimeout(() => k('keydown', 'ArrowLeft'), 900);
      setTimeout(() => k('keyup', 'ArrowLeft'), 1100);
      setTimeout(() => k('keydown', 'Space'), 1800);
      setTimeout(() => k('keyup', 'Space'), 1850);
      setTimeout(() => k('keyup', 'ArrowUp'), 2800);
      return true;
    })()
  `);
  await new Promise((r) => setTimeout(r, 3400));

  const report = await evalIn(cdp, `
    (() => {
      const s = window.velo.sim.state;
      const nums = [s.px, s.py, s.vx, s.vy, s.ox, s.oy, s.w, s.ax, s.ay, s.aw,
                    ...s.wx, ...s.wy, ...s.wvx, ...s.wvy, ...s.wspin];
      const c = document.getElementById('view');
      return {
        tick: s.tick, x: s.px, y: s.py, vx: s.vx,
        dead: s.dead, finished: s.finished, apples: s.applesLeft,
        startX: window.velo.level.start.x,
        levelName: window.velo.level.name,
        levels: window.velo.levels.length,
        legend: !!document.querySelector('#legend details'),
        levelbar: document.querySelectorAll('#levelbar select option').length,
        recorded: window.velo.sim.state.tick > 0,
        finite: nums.every(Number.isFinite),
        canvas: c ? c.width + 'x' + c.height : 'missing',
        hud: (document.getElementById('hud').textContent || '').split('\\n').filter(Boolean).length,
        sliders: document.querySelectorAll('#panel input[type=range]').length,
      };
    })()
  `);

  console.log('    ' + JSON.stringify(report));
  if (problems.length) throw new Error('page reported errors:\n      ' + problems.join('\n      '));
  if (!report.finite) throw new Error('sim state went non-finite');
  if (report.tick < 512) throw new Error(`sim barely advanced (${report.tick} ticks in ~3 s)`);
  if (report.levelName !== 'test01 — the ugly one') throw new Error(`?level=test01 did not select test01 (got "${report.levelName}")`);
  // Displacement from the level's OWN start, never an absolute coordinate.
  if (report.x - report.startX <= 2.5) throw new Error(`bike did not move under throttle (${(report.x - report.startX).toFixed(2)} m from the start line)`);
  if (!report.legend) throw new Error('the control legend never rendered');
  if (report.levelbar < report.levels) throw new Error(`level selector listed ${report.levelbar} of ${report.levels} levels`);
  if (report.sliders < 20) throw new Error(`tuning panel only built ${report.sliders} sliders`);
  if (report.canvas === 'missing' || report.canvas.startsWith('0x')) throw new Error(`canvas never sized (${report.canvas})`);

  // And the replay path, which is the whole determinism bet.
  await evalIn(cdp, `window.velo.startPlayback(), true`);
  // The note is painted by the next draw, so give it a couple of frames.
  await new Promise((r) => setTimeout(r, 400));
  const replay = await evalIn(cdp, `
    (() => {
      const t = document.getElementById('hud').textContent;
      if (t.includes('DESYNC')) return 'DESYNC';
      const m = t.match(/replay verified: [^\\n]+/);
      return m ? m[0] : 'NO-REPLAY';
    })()
  `);
  console.log('    ' + replay);
  if (replay === 'DESYNC') throw new Error('replay desynced against the live run');
  if (replay === 'NO-REPLAY') throw new Error('the run banked no replay — record-and-replay is not wired up');

  // The cross-engine check. This is the one that actually proves a server can
  // re-simulate a browser's replay: the same fixed input stream, run in
  // Chrome's V8 and in Node's V8, must produce an identical hash chain. When a
  // second engine (SpiderMonkey via Playwright) is wired up, it plugs in here.
  const inChrome = await evalIn(cdp, `JSON.stringify(window.velo.crossCheck(2000))`);
  const inNode = execFileSync(
    join(ROOT, 'node_modules/.bin/tsx'),
    ['-e', `
      import { parseLevel } from './src/sim/level.ts';
      import { TEST_LEVEL } from './src/sim/testlevel.ts';
      import { crossCheck } from './src/sim/crosscheck.ts';
      import { cloneSpec } from './src/sim/spec.ts';
      import { PRESETS } from './src/client/presets.ts';
      const spec = cloneSpec(PRESETS[0].spec);
      process.stdout.write(JSON.stringify(crossCheck(parseLevel(TEST_LEVEL), spec, 2000)));
    `],
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();

  const a = JSON.parse(inChrome);
  const b = JSON.parse(inNode);
  if (a.final !== b.final) {
    const at = a.hashes.findIndex((h, i) => h !== b.hashes[i]);
    throw new Error(
      `CROSS-ENGINE DESYNC: chrome and node disagree` +
      (at >= 0 ? ` from frame ${(at + 1) * a.hashEvery} (chrome ${a.hashes[at]}, node ${b.hashes[at]})` : '') +
      `\n      chrome final ${a.final}\n      node   final ${b.final}`,
    );
  }
  console.log(`    cross-engine: chrome === node over ${a.frames} frames / ${a.ticks} ticks / ${a.runs + 1} runs, final ${a.final}`);

  cdp.close();
} catch (e) {
  failed = e;
} finally {
  chrome.kill('SIGKILL');
  serve.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

if (failed) {
  console.error('==> SMOKE FAILED: ' + failed.message);
  process.exit(1);
}
console.log('==> smoke ok');
process.exit(0);

// --- the smallest CDP client that does the job ------------------------------

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
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
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

async function evalIn(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('evaluate threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
