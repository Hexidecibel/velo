// Headless sanity check for bin/smoke. Not a feel test — feel needs hands.
//
// Serves dist/, drives the real page in headless Chrome over the DevTools
// protocol (Node's built-in WebSocket, so this adds no dependency), holds the
// throttle for a few seconds, and asserts that the page threw nothing, the sim
// actually advanced, and no state field went non-finite.
//
// It exists because a node-only unit test cannot see a broken bundle, a canvas
// that never paints, or a sim that explodes one second after the start line.
//
// It also drives the LEADERBOARD end to end, against a real server: a real
// velo server is started on a scratch data directory, a real replay is posted
// to it and re-simulated there, and the page is then asked to fetch that board
// and build a ghost out of it. Everything from `POST /api/runs` to a second sim
// stepping beside the player's is exercised in the built bundle. A unit test
// can prove a ghost does not touch the player's state; only this can prove the
// fetch, the compatibility check and the frame loop are actually wired up.
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

// The live-tune override the page will see. Served from memory rather than out
// of data/spec.json, so this check never touches a file somebody may be halfway
// through tuning with.
let liveSpec = { version: 'none', present: false, override: {}, error: null };

// A REAL velo server, on a scratch data directory, for the leaderboard half.
//
// Not a stub. A stub of `/api/runs` would assert that the client can talk to a
// stub — the interesting half is that a browser-recorded input stream verifies
// on the server and comes back as a ghost, and only the real thing can show
// that. VELO_DATA_DIR keeps it away from the real board; the directory is
// removed in the `finally`.
const apiData = await mkdtemp(join(tmpdir(), 'velo-smoke-data-'));
const apiPort = await freePort();
const api = spawn(
  join(ROOT, 'node_modules/.bin/tsx'),
  ['src/server/index.ts'],
  { cwd: ROOT, env: { ...process.env, PORT: String(apiPort), HOST: '127.0.0.1', VELO_DATA_DIR: apiData }, stdio: ['ignore', 'pipe', 'pipe'] },
);
const apiBase = `http://127.0.0.1:${apiPort}`;
// Killed on ANY exit, not only through the `finally` below: the health wait
// and the Chrome launch both happen before the try block, and a tsx child left
// holding a port is the kind of orphan that makes the NEXT run look flaky.
process.once('exit', () => api.kill('SIGKILL'));
await waitForHealth(apiBase);
console.log(`    api server on ${apiBase} (data in a scratch dir)`);

const serve = createServer(async (req, res) => {
  const raw = decodeURIComponent((req.url || '/').split('?')[0]);
  if (raw === '/api/spec') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(liveSpec));
    return;
  }
  // Everything else under /api goes to the real server. The page is served from
  // this origin, so the leaderboard has to answer on this origin too — a proxy
  // rather than a CORS hole, which is also exactly what production is (one
  // process serving both).
  if (raw.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    try {
      const upstream = await fetch(apiBase + (req.url || ''), {
        method: req.method,
        headers: { 'content-type': req.headers['content-type'] || 'application/json' },
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json' });
      res.end(text);
    } catch (e) {
      res.writeHead(502).end(String(e));
    }
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

  // --- audio starts, on a REAL gesture -------------------------------------
  //
  // Before the gesture the game must be silent and complaint-free: no context,
  // no console error, no throw. Browsers refuse to start audio without a user
  // gesture and the only acceptable response to that is to wait for one.
  const preGesture = await evalIn(cdp, `JSON.stringify(window.velo.audio)`);
  const pre = JSON.parse(preGesture);
  if (pre.started !== false || pre.state !== 'idle') {
    throw new Error(`audio started before any gesture (${pre.state}) — browsers forbid this and log about it`);
  }
  if (pre.error) throw new Error(`audio reported an error before it was even started: ${pre.error}`);

  // A TRUSTED click, through the CDP input domain. `dispatchEvent(new
  // MouseEvent(...))` from page script is untrusted and does not satisfy the
  // gesture requirement, so it would test the wrong thing — the page would stay
  // silent and this check would pass for the wrong reason.
  await click(cdp, 640, 700);
  const audioDeadline = Date.now() + 5000;
  let au = null;
  for (;;) {
    au = JSON.parse(await evalIn(cdp, `JSON.stringify(window.velo.audio)`));
    if (au.started && au.state !== 'starting') break;
    if (Date.now() > audioDeadline) throw new Error(`audio never started after a gesture (${JSON.stringify(au)})`);
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('    audio: ' + JSON.stringify({ state: au.state, muted: au.muted, error: au.error }));
  if (au.error) throw new Error(`audio failed to initialise: ${au.error}`);
  if (au.state !== 'running') {
    throw new Error(`audio did not reach 'running' after a gesture (${au.state})`);
  }

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

  // --- muted and unmuted are the SAME RUN ---------------------------------
  //
  // The contract audio has to keep: it reads sim state and never writes it, so
  // a replay is bit-identical whether the tab was silent or loud. A leaderboard
  // where the volume slider can move a time is not a leaderboard.
  //
  // Driven through `velo.scriptRun`, which feeds a FIXED mask stream through
  // the real frame loop — the real recorder, the real draw, the real audio
  // sampling. Two runs driven by a wall-clock timer could not answer this: the
  // number of input frames would depend on how long the browser took, and two
  // runs of different lengths differ for reasons that have nothing to do with
  // sound.
  const ab = await evalIn(cdp, `
    (async () => {
      const masks = [];
      for (let i = 0; i < 800; i++) {
        masks.push((i % 7 < 5 ? 1 : 0) | (i % 13 < 4 ? 4 : 0) | (i % 29 < 3 ? 8 : 0) | (i % 61 === 0 ? 16 : 0));
      }
      window.velo.setMuted(false);
      const c0 = window.velo.audio.cues;
      const loud = await window.velo.scriptRun(masks);
      const loudCues = window.velo.audio.cues - c0;
      const loudMs = window.velo.audio.lastMs;
      window.velo.setMuted(true);
      const c1 = window.velo.audio.cues;
      const quiet = await window.velo.scriptRun(masks);
      const quietCues = window.velo.audio.cues - c1;
      window.velo.setMuted(false);
      return {
        loud: JSON.stringify(loud),
        quiet: JSON.stringify(quiet),
        frames: loud && loud.frames,
        loudCues, quietCues, loudMs,
        state: window.velo.audio.state,
        error: window.velo.audio.error,
      };
    })()
  `);
  console.log('    audio a/b: ' + JSON.stringify({
    frames: ab.frames, loudCues: ab.loudCues, quietCues: ab.quietCues,
    updateMs: Number(ab.loudMs.toFixed(3)), bytes: ab.loud.length, state: ab.state,
  }));
  if (ab.error) throw new Error(`audio errored during the a/b: ${ab.error}`);
  if (!ab.loud || ab.frames < 100) throw new Error(`the scripted run recorded nothing (${ab.frames} frames)`);
  if (ab.loud !== ab.quiet) {
    throw new Error('MUTED AND UNMUTED RUNS DIFFER — audio is reaching the sim.\n      ' +
      `loud  ${ab.loud.slice(0, 200)}\n      quiet ${ab.quiet.slice(0, 200)}`);
  }
  // And the comparison was not vacuous: the loud run really did make sounds,
  // and the muted one really did make none.
  if (ab.loudCues < 1) throw new Error('the unmuted scripted run fired no cues at all — nothing was being compared');
  if (ab.quietCues !== 0) throw new Error(`a muted run still fired ${ab.quietCues} cues`);
  if (ab.loudMs > 1.5) throw new Error(`the audio frame update cost ${ab.loudMs.toFixed(2)} ms — it is meant to be a rounding error`);

  // Hiding the tab must SUSPEND the context, not merely turn it down: a
  // backgrounded game should cost nothing at all.
  //
  // `document.hidden` is overridden and `visibilitychange` dispatched by hand
  // rather than driven through the CDP — `Emulation.setPageVisibilityOverride`
  // is gone from current Chrome and a headless tab is never backgrounded
  // anyway. What is under test is OUR handler, which is the only part of this
  // that is ours; the browser firing the event is not in question.
  const visibility = async (hidden) => {
    await evalIn(cdp, `
      (() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${hidden} });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => '${hidden ? 'hidden' : 'visible'}' });
        document.dispatchEvent(new Event('visibilitychange'));
        return true;
      })()
    `);
    await new Promise((r) => setTimeout(r, 400));
    return JSON.parse(await evalIn(cdp, `JSON.stringify(window.velo.audio)`)).state;
  };
  const hiddenState = await visibility(true);
  const shownState = await visibility(false);
  console.log(`    audio visibility: hidden -> ${hiddenState}, shown -> ${shownState}`);
  if (hiddenState !== 'suspended') throw new Error(`a hidden tab left audio ${hiddenState}, not suspended`);
  if (shownState !== 'running') throw new Error(`a re-shown tab left audio ${shownState}, not running`);

  // Live tune, end to end. LAST, because applying an override restarts the
  // attempt and would throw away the banked replay the checks above need.
  //
  // Every part of this is fine in isolation and useless if the poll never
  // fires, so the poll, the layering, the restart, the toast and the panel's
  // read-only rows are asserted together. It has to be switched ON first: a
  // production build defaults it off, which is the intended behaviour and is
  // itself worth asserting.
  if ((await evalIn(cdp, `window.velo.liveTune.enabled`)) !== false) {
    throw new Error('live tune should default OFF in a production build');
  }
  await evalIn(cdp, `(window.velo.liveTune.setEnabled(true), true)`);
  // Land on a KNOWN baseline before measuring the restart below. The playback
  // started above resets the sim to tick 0 and then runs for a second and a
  // half, so a baseline sampled while it is still going can be anything —
  // including a small number that makes "the tick went backwards" unfalsifiable.
  // That was an intermittent failure, not a theoretical one.
  await evalIn(cdp, `(window.velo.restart(false), true)`);
  await new Promise((r) => setTimeout(r, 1500));
  const hashBefore = await evalIn(cdp, `window.velo.specHash()`);
  const tickBefore = await evalIn(cdp, `window.velo.sim.state.tick`);
  if (tickBefore < 512) throw new Error(`live-tune baseline never ran (${tickBefore} ticks)`);
  liveSpec = { version: 'v1', present: true, override: { gravity: 4.25 }, error: null };
  await evalIn(cdp, `(window.velo.liveTune.poke(), true)`);
  await new Promise((r) => setTimeout(r, 600));
  const live = await evalIn(cdp, `
    (() => ({
      gravity: window.velo.spec.gravity,
      hash: window.velo.specHash(),
      held: [...window.velo.liveTune.heldPaths],
      toast: (document.getElementById('toast').textContent || ''),
      greyed: document.querySelectorAll('.row.remote-held').length,
      tick: window.velo.sim.state.tick,
    }))()
  `);
  console.log('    live tune: ' + JSON.stringify(live));
  if (live.gravity !== 4.25) throw new Error(`live tune did not apply (gravity=${live.gravity})`);
  if (live.hash === hashBefore) throw new Error('live tune applied but the spec hash did not move');
  if (!live.held.includes('gravity')) throw new Error(`gravity not reported as held (${live.held})`);
  if (!live.toast.includes('gravity')) throw new Error(`no toast naming the change (got "${live.toast}")`);
  if (live.greyed < 1) throw new Error('the held row was not greyed out in the panel');
  // The tick going BACKWARDS is the restart. An absolute threshold would be
  // wrong: the loop keeps running during the poll, so a fresh attempt is
  // already a few hundred ticks old by the time this reads it.
  if (live.tick >= tickBefore) {
    throw new Error(`live tune did not restart the attempt (tick ${tickBefore} -> ${live.tick})`);
  }

  // ...and clearing it hands the field back rather than freezing the last value.
  liveSpec = { version: 'v2', present: false, override: {}, error: null };
  await evalIn(cdp, `(window.velo.liveTune.poke(), true)`);
  await new Promise((r) => setTimeout(r, 600));
  const cleared = await evalIn(cdp, `({ gravity: window.velo.spec.gravity, held: [...window.velo.liveTune.heldPaths] })`);
  if (cleared.gravity === 4.25) throw new Error('clearing the override left the remote value in place');
  if (cleared.held.length !== 0) throw new Error(`fields still held after a clear (${cleared.held})`);

  // Hold-to-overview, end to end and through the real key path.
  //
  // The claim being checked is the one the whole feature rests on: while TAB is
  // held the sim does not move and the recorder gains nothing, so an overview
  // cannot change a recorded run. Asserting it in the browser as well as in the
  // unit test matters because the gate lives in main.ts's frame loop, which no
  // unit test can reach.
  await evalIn(cdp, `(window.velo.restart(false), true)`);
  await evalIn(cdp, `
    (() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true })); return true; })()
  `);
  await new Promise((r) => setTimeout(r, 500));
  await evalIn(cdp, `
    (() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', bubbles: true })); return true; })()
  `);
  // WAIT FOR THE FREEZE, THEN take the baseline.
  //
  // The claim under test is "no sim tick advances WHILE the overview is held".
  // Sampling the clock before dispatching the keydown tested something else and
  // something weaker: that the freeze engages within one frame of the key, which
  // depends on how long a CDP round trip takes relative to a frame. It passed
  // for as long as the round trip happened to be shorter than a frame, and
  // started failing by eight ticks — exactly one 60 Hz frame's worth of input —
  // the moment frames got heavier. That is a timing property of this harness,
  // not a property of the freeze.
  //
  // So: dispatch, wait for `frozen`, and only then start the clock. The
  // promptness of the freeze is still asserted, as a deadline, which is what it
  // actually is.
  const froze = Date.now();
  for (;;) {
    const f = await evalIn(cdp, `window.velo.overview.frozen`);
    if (f) break;
    if (Date.now() - froze > 2000) throw new Error('holding TAB never froze the sim');
    await new Promise((r) => setTimeout(r, 16));
  }
  const before = await evalIn(cdp, `({ tick: window.velo.sim.state.tick, frames: window.velo.recordedFrames })`);
  await new Promise((r) => setTimeout(r, 800));
  const during = await evalIn(cdp, `
    ({
      tick: window.velo.sim.state.tick,
      frames: window.velo.recordedFrames,
      frozen: window.velo.overview.frozen,
      blend: window.velo.overview.blend,
      zoom: window.velo.cam.zoom,
      minZoom: window.velo.cam.params.minZoom,
    })
  `);
  await evalIn(cdp, `
    (() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Tab', bubbles: true }));
      return true;
    })()
  `);
  await new Promise((r) => setTimeout(r, 600));
  const after = await evalIn(cdp, `
    ({ tick: window.velo.sim.state.tick, frames: window.velo.recordedFrames, frozen: window.velo.overview.frozen, zoom: window.velo.cam.zoom })
  `);
  await evalIn(cdp, `
    (() => { window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp', bubbles: true })); return true; })()
  `);
  console.log('    overview: ' + JSON.stringify({ before, during, after }));
  if (!during.frozen) throw new Error('holding TAB did not freeze the sim');
  if (during.tick !== before.tick) throw new Error(`the clock ran during overview (${before.tick} -> ${during.tick})`);
  if (during.frames !== before.frames) throw new Error(`the recorder grew during overview (${before.frames} -> ${during.frames}) — a held overview would change the replay`);
  if (during.blend < 0.9) throw new Error(`overview never eased in (blend ${during.blend})`);
  if (during.zoom >= during.minZoom) throw new Error(`overview did not zoom past the play floor (${during.zoom} >= ${during.minZoom})`);
  if (after.frozen) throw new Error('releasing TAB did not unfreeze the sim');
  if (after.tick <= during.tick) throw new Error('the sim did not resume after TAB was released');
  if (after.zoom <= during.zoom) throw new Error('the camera never eased back toward play framing');

  // --- the leaderboard and the ghost, end to end ---------------------------
  //
  // Posted from here rather than ridden in the browser, because finishing a
  // level under scripted input is not something a smoke test can do reliably —
  // and it is not the part that needs proving. What needs proving is the chain
  // from a verified time on a real server to a second sim stepping beside the
  // player's inside the built bundle, and that is what this checks.
  const fixture = JSON.parse(await readFile(join(ROOT, 'src/server/fixture.replay.json'), 'utf8'));
  const posted = await (await fetch(apiBase + '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: 'smokepilot01', name: 'Smoke Pilot', category: 'human', replay: fixture }),
  })).json();
  if (!posted.ok) throw new Error(`the server refused the fixture replay: ${posted.code} ${posted.reason}`);
  console.log(`    posted: ${posted.levelName} ${posted.timeSeconds.toFixed(3)}s verified server-side in ${posted.verifyMs} ms`);

  await cdp.send('Page.navigate', { url: url + '?level=01-first-light' });
  await cdp.waitFor('Page.loadEventFired', 15000);

  // The board fetch and then the ghost fetch, both real round trips.
  const ghostDeadline = Date.now() + 10000;
  for (;;) {
    const g = await evalIn(cdp, `!!(window.velo && window.velo.ghost)`);
    if (g === true) break;
    if (Date.now() > ghostDeadline) {
      const why = await evalIn(cdp, `JSON.stringify({ board: !!(window.velo && window.velo.board), note: window.velo && window.velo.ghostNote })`);
      throw new Error(`no ghost appeared within 10 s — ${why}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // Drive, and check the ghost steps WITH the player: one ghost frame per input
  // frame is the contract, and it is what makes the gap on screen mean anything.
  await evalIn(cdp, `(window.velo.restart(false), true)`);
  await evalIn(cdp, `
    (() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true })); return true; })()
  `);
  await new Promise((r) => setTimeout(r, 1500));
  await evalIn(cdp, `
    (() => { window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp', bubbles: true })); return true; })()
  `);
  const lb = await evalIn(cdp, `
    (() => {
      const b = window.velo.board;
      const g = window.velo.ghost;
      return {
        total: b && b.total,
        top: b && b.top.map((e) => e.name),
        rank: b && b.rank,
        above: b && b.above && b.above.name,
        rows: document.querySelectorAll('#board .bd-row').length,
        shown: (document.getElementById('board').textContent || '').includes('Smoke Pilot'),
        ghostName: g && g.name,
        ghostKind: g && g.kind,
        ghostAt: g && g.at,
        ghostFrames: g && g.frames,
        ghostMoved: g && (g.x !== window.velo.level.start.x),
        recorded: window.velo.recordedFrames,
        hudGhost: (document.getElementById('hud').textContent || '').includes('ghost'),
      };
    })()
  `);
  console.log('    leaderboard: ' + JSON.stringify(lb));
  if (lb.total !== 1) throw new Error(`board did not reach the page (total=${lb.total})`);
  if (!lb.shown || lb.rows < 1) throw new Error('the board panel rendered no rows');
  // This browser profile is fresh, so it has no time here: the entry "just
  // above" an unranked player is the slowest one on the board, which is the
  // only one there is.
  if (lb.rank !== null) throw new Error(`a fresh profile should have no rank (got ${lb.rank})`);
  if (lb.above !== 'Smoke Pilot') throw new Error(`wrong ghost offered (above=${lb.above})`);
  if (lb.ghostName !== 'Smoke Pilot' || lb.ghostKind !== 'above') throw new Error(`wrong ghost built (${lb.ghostName}/${lb.ghostKind})`);
  if (!lb.ghostMoved) throw new Error('the ghost never left the start line — its sim is not being stepped');
  if (lb.ghostAt !== lb.recorded) {
    throw new Error(`the ghost is out of step with the player (${lb.ghostAt} ghost frames vs ${lb.recorded} recorded)`);
  }
  if (!lb.hudGhost) throw new Error('the HUD never named the ghost — a second bike with no label reads as a bug');

  // --- the end-of-level screen, end to end ---------------------------------
  //
  // Two assertions, and the second is the one that protects the core loop: the
  // panel appears on a FINISH, and it does not appear on a death. Dying is the
  // common case in a die-and-retry game and it already has instant restart —
  // a panel in front of that would be the single worst thing this feature could
  // do — so "never on death" is checked rather than trusted.
  //
  // Driven with the fixture's own input stream, which is a real recorded finish
  // on this level and on this bike (the ghost above is built from it, so it is
  // already proven to reproduce here).
  const rs = await evalIn(cdp, `
    (async () => {
      const decode = (str) => {
        const out = [];
        for (const part of str.split(',')) {
          const star = part.indexOf('*');
          const mask = Number(star < 0 ? part : part.slice(0, star));
          const n = Number(star < 0 ? 1 : part.slice(star + 1));
          for (let i = 0; i < n; i++) out.push(mask);
        }
        return out;
      };
      const panel = document.getElementById('results');
      const shut = () => panel.classList.contains('hidden');

      // A death: throttle held from the start line puts the head into the
      // terrain on this level well inside 600 frames.
      await window.velo.scriptRun(new Array(600).fill(1));
      const death = { dead: window.velo.sim.state.dead, model: !!window.velo.results, hidden: shut() };

      // A finish.
      window.velo.restart(false);
      const fin = await window.velo.scriptRun(decode(${JSON.stringify(fixture.inputs)}));
      const model = window.velo.results;
      const finish = {
        finished: !!(fin && fin.finished),
        hidden: shut(),
        time: model && model.time,
        actions: model ? model.actions.map((a) => a.id + ':' + a.key) : null,
        text: (panel.textContent || '').slice(0, 400),
      };

      // Escape closes it, instantly and with nothing to wait through.
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
      const dismissed = { hidden: shut(), model: !!window.velo.results };
      return { death, finish, dismissed };
    })()
  `);
  console.log('    results: ' + JSON.stringify({ ...rs, finish: { ...rs.finish, text: undefined } }));
  if (!rs.death.dead) throw new Error('the death run did not die — the check proves nothing');
  if (!rs.death.hidden || rs.death.model) {
    throw new Error('the results panel appeared on a DEATH — that is the one thing it must never do');
  }
  if (!rs.finish.finished) throw new Error('the fixture input stream did not finish the level in the browser');
  if (rs.finish.hidden) throw new Error('the results panel did not appear on a finish');
  if (!rs.finish.time || !rs.finish.text.includes(rs.finish.time)) {
    throw new Error(`the panel did not print the time (${rs.finish.time})`);
  }
  if (!rs.finish.actions.includes('next:Enter') || !rs.finish.actions.includes('retry:R')) {
    throw new Error(`the panel did not offer next-on-Enter and retry-on-R (${rs.finish.actions})`);
  }
  if (!rs.dismissed.hidden || rs.dismissed.model) throw new Error('Escape did not dismiss the results panel');

  cdp.close();
} catch (e) {
  failed = e;
} finally {
  chrome.kill('SIGKILL');
  api.kill('SIGKILL');
  serve.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await rm(apiData, { recursive: true, force: true }).catch(() => {});
}

if (failed) {
  console.error('==> SMOKE FAILED: ' + failed.message);
  process.exit(1);
}
console.log('==> smoke ok');
process.exit(0);

async function waitForHealth(base) {
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) return;
    } catch {
      // not listening yet — tsx has to compile the entry point first
    }
    if (Date.now() > deadline) throw new Error(`the api server never answered on ${base}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

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

/** A TRUSTED click. Page-dispatched MouseEvents do not satisfy a gesture gate. */
async function click(cdp, x, y) {
  const base = { x, y, button: 'left', clickCount: 1, buttons: 1 };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
}

async function evalIn(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('evaluate threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
