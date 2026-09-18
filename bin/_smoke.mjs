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
        // THE LEGEND IS PICTURES NOW, drawn by the game's own renderer into
        // data URLs (legendart.ts). Counting the images is a much stronger
        // check than the old "is there a details element": it proves a canvas
        // was obtained, a pose was built out of the spec, and drawBike ran --
        // none of which a unit test can reach. Six: two on the flip tile and
        // one on each of the four drive tiles.
        legend: document.querySelectorAll('#legend .lg-bike[src^="data:image"]').length,
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
  if (report.legend < 6) throw new Error(`the control legend drew ${report.legend} bikes, wanted 6`);

  // `?` OPENS AND CLOSES IT, END TO END. keys.test.ts asserts that every
  // advertised key reaches a handler by reading the dispatch; this asserts that
  // the handler does the thing, through a real KeyboardEvent on the real page.
  // Three advertised keys in this game have turned out to be dead, and the
  // cheapest of the three to have caught was the one that opens the panel that
  // lists the other seventeen.
  const helpKey = JSON.parse(await evalIn(cdp, `
    (() => {
      const card = () => !document.querySelector('#legend .lg-card').hidden;
      const tap = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Slash', bubbles: true }));
      const a = card(); tap();
      const b = card(); tap();
      return JSON.stringify({ a, b, c: card() });
    })()
  `));
  console.log('    ? key: ' + JSON.stringify(helpKey));
  if (helpKey.a === helpKey.b || helpKey.b === helpKey.c) {
    throw new Error(`? did not toggle the control legend (${JSON.stringify(helpKey)})`);
  }
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
  // THE THROTTLE IS PART OF THE BASELINE NOW. A restart leaves the run ARMED —
  // posed and frozen until the first control, so the clock and the ghost start
  // with the player rather than ahead of them — so a harness that restarts and
  // then waits is a harness watching a bike that is correctly doing nothing.
  // It has to press something, exactly as a player does. The gate is asserted
  // properly further down; this is just a run being started.
  await evalIn(cdp, `(window.velo.restart(false), true)`);
  await evalIn(cdp, `
    (() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true })); return true; })()
  `);
  await new Promise((r) => setTimeout(r, 1500));
  await evalIn(cdp, `
    (() => { window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp', bubbles: true })); return true; })()
  `);
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

  // A RENAMED FIELD IS LOUD, and this is the assertion that keeps it that way.
  //
  // `applySpecOverride` does not error on a path this build has no field for —
  // it applies what it recognises and the bike keeps its own value — so a rename
  // used to revert the bike in silence. That cost a real twenty-minute session
  // once, with nothing on screen to explain it, and the bug is invisible to
  // every unit test that does not also look at what the PAGE said.
  liveSpec = { version: 'v1b', present: true, override: { gravity: 4.25, 'rider': { 'inertialTransfer': 0.6 } }, error: null };
  await evalIn(cdp, `(window.velo.liveTune.poke(), true)`);
  await new Promise((r) => setTimeout(r, 600));
  const dropped = await evalIn(cdp, `
    (() => ({
      dropped: [...window.velo.liveTune.droppedPaths],
      toast: (document.getElementById('toast').textContent || ''),
      hud: (document.getElementById('hud')?.textContent || ''),
    }))()
  `);
  console.log('    live tune, renamed field: ' + JSON.stringify({ dropped: dropped.dropped, toastHasIt: dropped.toast.includes('inertialTransfer') }));
  if (!dropped.dropped.includes('rider.inertialTransfer')) {
    throw new Error(`a path with no such field was not reported as dropped (${JSON.stringify(dropped.dropped)})`);
  }
  if (!dropped.toast.includes('inertialTransfer')) {
    throw new Error(`no toast NAMING the dropped key (got "${dropped.toast}")`);
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
  //
  // THE NAME ON THIS RUN IS HOSTILE ON PURPOSE, and it is hostile HERE rather
  // than in a test of its own because this is the only path in the repo that
  // carries a display name the whole way: typed by one person, posted, stored,
  // served to a DIFFERENT client, and rendered into that client's readout and
  // board. That is the shape of the bug it guards — STORED, not reflected.
  //
  // `cleanName` (identity.ts, and the server's own copy) is hygiene and not
  // sanitisation: it collapses control characters, squeezes whitespace and caps
  // the length at 24, and it passes `<` and `>` through, because a name is text.
  // Twenty-four characters is a working payload, `<img src=x>` fires its
  // handler on a 404, and the readout is on by default. So every assertion
  // below now doubles as the proof that a name is drawn as TEXT: if the
  // escaping at the sink is ever dropped, `#hud img` appears and this fails.
  const HOSTILE = 'Smoke<img src=x>Pilot';
  const fixture = JSON.parse(await readFile(join(ROOT, 'src/server/fixture.replay.json'), 'utf8'));
  const posted = await (await fetch(apiBase + '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: 'smokepilot01', name: HOSTILE, category: 'human', replay: fixture }),
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
        shown: (document.getElementById('board').textContent || '').includes(${JSON.stringify(HOSTILE)}),
        // MARKUP IN A NAME IS TEXT, EVERYWHERE IT IS DRAWN. Asserted on the
        // rendered DOM rather than on the escaper, because an escaper proves
        // nothing about a sink that forgot to call it — which is exactly the
        // bug this guards. boardui.ts builds nodes and sets textContent; the
        // readout builds markup and escapes. Both have to come out as an
        // element count of zero.
        // The board legitimately contains <img> — the avatars, which are canvas
        // data: URLs it drew itself. Anything else with a src is not ours.
        injectedInBoard: [...document.querySelectorAll('#board img')]
          .filter((e) => !(e.getAttribute('src') || '').startsWith('data:')).length
          + document.querySelectorAll('#board script, #board iframe, #board svg, #board object').length,
        injectedInHud: document.querySelectorAll('#hud img, #hud script, #hud iframe, #hud svg, #hud object').length,
        hudHasNameAsText: (document.getElementById('hud').textContent || '').includes(${JSON.stringify(HOSTILE)}),
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
  if (lb.above !== HOSTILE) throw new Error(`wrong ghost offered (above=${lb.above})`);
  if (lb.ghostName !== HOSTILE || lb.ghostKind !== 'above') throw new Error(`wrong ghost built (${lb.ghostName}/${lb.ghostKind})`);
  if (!lb.ghostMoved) throw new Error('the ghost never left the start line — its sim is not being stepped');
  if (lb.ghostAt !== lb.recorded) {
    throw new Error(`the ghost is out of step with the player (${lb.ghostAt} ghost frames vs ${lb.recorded} recorded)`);
  }
  if (!lb.hudGhost) throw new Error('the HUD never named the ghost — a second bike with no label reads as a bug');
  // The name came back off the server intact, so the two checks under it are
  // testing what they claim to. If a future server-side filter strips the
  // markup, this is what says so — rather than the escaping checks quietly
  // passing because there was nothing left to escape.
  if (lb.above !== HOSTILE) throw new Error(`the server rewrote the name (${lb.above}) — the XSS checks below are no longer testing anything`);
  if (lb.injectedInBoard !== 0) throw new Error(`a display name created ${lb.injectedInBoard} element(s) in the board panel — stored XSS`);
  if (lb.injectedInHud !== 0) throw new Error(`a display name created ${lb.injectedInHud} element(s) in the readout — stored XSS`);
  if (!lb.hudHasNameAsText) throw new Error('the readout did not draw the name as visible text — markup in a name must be shown, not interpreted');

  // --- the armed start line, through the real key path ---------------------
  //
  // THE WHOLE CLAIM IN ONE BLOCK, and it has to be here rather than in a unit
  // test for the same reason the overview's does: the gate lives in main.ts's
  // frame loop, and no unit test reaches a frame loop. It also has to be HERE
  // rather than earlier in this file, because a ghost only exists after the
  // section above — and "the ghost does not go either" is the actual complaint
  // this feature answers. A fix where the player waits on the line and the
  // ghost sets off is not a fix; it just moves the false gap from the clock to
  // the road.
  //
  // Four things frozen, then three things starting together on the first
  // control: the clock, the recorder and the ghost.
  await evalIn(cdp, `(() => { window.velo.overview.skipIntro(); window.velo.restart(false); return 1; })()`);
  await new Promise((r) => setTimeout(r, 200));
  const armBefore = JSON.parse(await evalIn(cdp, `JSON.stringify({
    armed: window.velo.armed.armed,
    tick: window.velo.sim.state.tick,
    frames: window.velo.recordedFrames,
    ghostAt: window.velo.ghost && window.velo.ghost.at,
    ghostX: window.velo.ghost && window.velo.ghost.x,
    startX: window.velo.level.start.x,
    says: (document.getElementById('hud').textContent || '').includes('ARMED'),
  })`));
  // A COMMAND KEY IS NOT GO. The legend, the chooser, the board and R itself
  // all leave the run on the line — only a control starts it, and `?` is the
  // cheapest one to press here because it is visibly a no-op for the sim.
  await evalIn(cdp, `
    (() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Slash', bubbles: true })); return true; })()
  `);
  await new Promise((r) => setTimeout(r, 700));
  const armHeld = JSON.parse(await evalIn(cdp, `JSON.stringify({
    armed: window.velo.armed.armed,
    tick: window.velo.sim.state.tick,
    frames: window.velo.recordedFrames,
    ghostAt: window.velo.ghost && window.velo.ghost.at,
    ghostX: window.velo.ghost && window.velo.ghost.x,
  })`));
  // Shut the legend again, then GO. Held or freshly pressed makes no difference
  // to the gate — it reads the mask, not an edge — and this is the fresh press.
  await evalIn(cdp, `
    (() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Slash', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true }));
      return true;
    })()
  `);
  await new Promise((r) => setTimeout(r, 600));
  const armAfter = JSON.parse(await evalIn(cdp, `JSON.stringify({
    armed: window.velo.armed.armed,
    tick: window.velo.sim.state.tick,
    frames: window.velo.recordedFrames,
    ghostAt: window.velo.ghost && window.velo.ghost.at,
    ghostX: window.velo.ghost && window.velo.ghost.x,
    says: (document.getElementById('hud').textContent || '').includes('ARMED'),
  })`));
  await evalIn(cdp, `
    (() => { window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp', bubbles: true })); return true; })()
  `);
  console.log('    armed: ' + JSON.stringify({ before: armBefore, held: armHeld, after: armAfter }));
  if (!armBefore.armed) throw new Error('a restart did not arm the start line');
  if (armBefore.tick !== 0) throw new Error(`a restart left the clock at ${armBefore.tick} rather than 0`);
  if (!armBefore.says) throw new Error('the readout never said the run was ARMED — a frozen game that says nothing reads as a crashed one');
  if (!armHeld.armed) throw new Error('a command key started the run — only sim input may');
  if (armHeld.tick !== 0) throw new Error(`the clock ran while armed (0 -> ${armHeld.tick})`);
  if (armHeld.frames !== 0) throw new Error(`the recorder grew while armed (0 -> ${armHeld.frames}) — an armed run would change the replay`);
  if (armHeld.ghostAt !== 0) throw new Error(`the ghost advanced ${armHeld.ghostAt} frames while the player was still on the line`);
  if (armHeld.ghostX !== armBefore.ghostX) throw new Error('the ghost moved while the player was still on the line — the false time gap is still there');
  if (armAfter.armed) throw new Error('the throttle did not start the run');
  if (armAfter.says) throw new Error('the readout still says ARMED after the run started');
  if (armAfter.tick <= 0) throw new Error('the clock never started');
  if (armAfter.frames <= 0) throw new Error('the recorder never started');
  if (armAfter.ghostAt <= 0) throw new Error('the ghost never started with the player');
  // ALL THREE ON THE SAME FRAME, which is the contract the ghost's whole
  // meaning rests on: one ghost frame per recorded input frame, from the first.
  if (armAfter.ghostAt !== armAfter.frames) {
    throw new Error(`the ghost and the recorder did not start together (${armAfter.ghostAt} ghost frames vs ${armAfter.frames} recorded)`);
  }

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
  // `montage:F`, not `montage:A`. KeyA is LEAN LEFT under WASD and input.ts
  // returns on a sim-bound key before any command dispatch runs, so the montage
  // was moved to F when that was found — and this expectation was not moved
  // with it, which is why bin/smoke had been failing on a feature that works.
  if (!rs.finish.actions.includes('montage:F')) {
    throw new Error(`the panel did not offer the montage after two attempts (${rs.finish.actions})`);
  }

  // --- the montage, end to end ---------------------------------------------
  //
  // Two attempts exist by now — the death above and the finish — so pressing F
  // must stand up a crowd and ride it. What this proves that the unit tests
  // cannot: the attempts really are RETAINED across a restart in the live
  // client (the recorder used to throw each run away), the riders really do
  // step in the real frame loop, and a restart really does clear them.
  const mont = await evalIn(cdp, `
    (async () => {
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const before = window.velo.attempts.length;
      window.velo.startMontage();
      const started = window.velo.montage;
      const at0 = started ? started.riding : -1;
      for (let i = 0; i < 20; i++) await raf();
      const running = window.velo.montage;
      window.velo.restart(false);
      return {
        attempts: before,
        count: started ? started.count : 0,
        coarse: started ? started.alpha : 0,
        ridingAtStart: at0,
        ridingLater: running ? running.riding : -1,
        clearedByRestart: window.velo.montage === null,
      };
    })()
  `);
  console.log('    montage: ' + JSON.stringify(mont));
  if (mont.attempts < 2) throw new Error('the attempt log did not RETAIN both runs — the montage has nothing to show');
  if (mont.count < 1) throw new Error('pressing the montage action stood up no riders');
  if (mont.ridingAtStart < 1) throw new Error('the montage riders started already finished');
  if (!(mont.coarse > 0 && mont.coarse <= 0.3)) throw new Error(`montage alpha out of range (${mont.coarse})`);
  if (!mont.clearedByRestart) throw new Error('a restart did not clear the montage — faint bikes over a live run');

  // --- customisation, through the real bundle -------------------------------
  //
  // WHAT THE UNIT TESTS CANNOT SEE. `bikeart.test.ts` proves a livery resolves
  // to legible colours for every bike, accessory and level palette, and
  // `appearance.test.ts` proves none of it can reach `specHash`. Neither can
  // prove the panel exists in the built page, that the preview canvas gets
  // drawn, or that a chosen bike reaches the renderer — which is the class of
  // failure where every test passes and the screen is wrong.
  const look = await evalIn(cdp, `
    (async () => {
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const opened = window.velo.openLook();
      const before = window.velo.appearance;
      const picked = window.velo.setAppearance('bike', 'bobber');
      const painted = window.velo.setAppearance('paint', 'acid');
      await raf();
      const hashBefore = window.velo.specHash();
      window.velo.setAppearance('helmet', 'bucket');
      await raf();
      const hashAfter = window.velo.specHash();
      window.velo.closeLook();
      return {
        opened,
        startedAs: before.bike,
        bike: picked.bike,
        paint: painted.paint,
        hashBefore,
        hashAfter,
        closed: !document.getElementById('look').classList.contains('hidden') === false,
      };
    })()
  `);
  console.log('    customiser: ' + JSON.stringify(look));
  if (!look.opened.visible) throw new Error('the customiser did not open');
  if (!look.opened.preview || look.opened.preview.w < 100) {
    throw new Error(`the customiser preview canvas was not drawn (${JSON.stringify(look.opened.preview)})`);
  }
  if (look.opened.rows < 5) throw new Error(`the customiser offered ${look.opened.rows} axes`);
  if (look.opened.options < 20) throw new Error(`the customiser offered ${look.opened.options} options`);
  if (look.bike !== 'bobber' || look.paint !== 'acid') throw new Error('picking an option did not stick');
  // THE ONE THAT MATTERS. Repainting the bike must leave the spec hash
  // bit-identical, or the server refuses the next run with "this bike is not
  // the shipped one" — the refusal that has already confused this user twice.
  if (look.hashBefore !== look.hashAfter) {
    throw new Error(`changing the bike moved specHash (${look.hashBefore} -> ${look.hashAfter})`);
  }
  if (!look.closed) throw new Error('the customiser did not close');

  // --- the claim code -------------------------------------------------------
  //
  // A hand-rolled QR encoder is checked module-for-module against an
  // independent implementation in qr.test.ts. What is checked HERE is that it
  // reaches a canvas in the built page at a size a phone camera could read,
  // and that the typable fallback is printed beside it.
  const claim = await evalIn(cdp, `
    (async () => {
      const opened = window.velo.openClaim();
      window.velo.closeClaim();
      return opened;
    })()
  `);
  console.log('    claim: ' + JSON.stringify({ ...claim, code: claim.code.slice(0, 9) + '…' }));
  if (!claim.visible) throw new Error('the claim panel did not open');
  if (!claim.qr || claim.qr.w < 100 || claim.qr.w !== claim.qr.h) {
    throw new Error(`the QR canvas was not drawn square and large (${JSON.stringify(claim.qr)})`);
  }
  if (!claim.code.replace(/\s+/g, '').includes(claim.playerId)) {
    throw new Error('the claim panel did not print the typable code');
  }

  // --- the touch controls come up on a coarse pointer -----------------------
  //
  // The layout and the bitmask are unit-tested in plain node; what cannot be
  // tested there is the wiring — that the overlay exists in the built page,
  // that `?touch=1` turns it on, that every pad is actually in the DOM, and
  // that the body class which hides the desktop chrome is applied. All four are
  // the kind of thing that breaks silently in a bundle and not in a test.
  await cdp.send('Page.navigate', { url: url + '?level=01-first-light&touch=1' });
  await cdp.waitFor('Page.loadEventFired', 15000);
  await new Promise((r) => setTimeout(r, 1500));
  const tc = await evalIn(cdp, `
    (() => {
      const root = document.getElementById('touch');
      const ids = [...root.querySelectorAll('.tc-zone')].map((e) => e.className.split(' ')[1]);
      return {
        visible: !root.classList.contains('hidden'),
        bodyClass: document.body.classList.contains('touch'),
        ids,
        biasCap: window.velo.cam.params.screenBiasY,
        thumbInsetPx: Math.round(window.velo.cam.params.thumbInsetPx),
        hudInsetPx: window.velo.cam.params.hudInsetPx,
        padTop: Math.round(Math.min(...[...root.querySelectorAll('.tc-zone')]
          .filter((e) => /tc-(leanL|leanR|brake|throttle)$/.test(e.className.split(' ')[1]))
          .map((e) => e.getBoundingClientRect().top))),
        zoomBias: window.velo.cam.zoomBias,
        viewportH: window.innerHeight,
      };
    })()
  `);
  console.log('    touch: ' + JSON.stringify(tc));
  if (!tc.visible || !tc.bodyClass) throw new Error('?touch=1 did not bring the touch controls up');
  for (const want of ['tc-throttle', 'tc-brake', 'tc-leanL', 'tc-leanR', 'tc-flip', 'tc-restart', 'tc-zoom']) {
    if (!tc.ids.includes(want)) throw new Error(`the touch overlay is missing ${want} (${tc.ids})`);
  }
  // Thumbs cover the bottom corners, which is where a grounded bike sits when
  // the camera centres it, so the bias has to actually be in force — and the
  // number it is derived FROM has to have reached the camera. `thumbInsetPx` is
  // measured off the real pads every frame; a zero here is the whole mechanism
  // silently not wired up, with a camera that looks fine on a desktop.
  if (!(tc.biasCap > 0)) throw new Error('the touch camera did not raise the bias cap');
  if (!(tc.thumbInsetPx > 0)) throw new Error('the camera was never told where the thumbs are');
  if (Math.abs(tc.thumbInsetPx - (tc.viewportH - tc.padTop)) > 1) {
    throw new Error(`the thumb inset (${tc.thumbInsetPx}) does not match the pads (top ${tc.padTop})`);
  }
  // AND THE ZOOM IS NOT TOUCHED. There used to be a 1.25x zoom-IN here, on the
  // reasoning that the bike looks small on a phone. The bike was never the
  // problem: a fixed px/m showed a phone less than half the level a desktop
  // saw, and zooming in made that worse. The framing is derived from the
  // viewport for everybody now, and the manual bias starts at 1.
  if (tc.zoomBias !== 1) throw new Error(`the touch camera moved the manual zoom bias (${tc.zoomBias})`);

  // --- the framing follows the viewport ------------------------------------
  //
  // The derivation is unit-tested in plain node; what cannot be tested there is
  // that a REAL resize reaches it. The camera reads the canvas every frame
  // rather than listening for anything, so an emulated phone is the honest test
  // of the case that matters — a rotated phone, an address bar collapsing, a
  // keyboard sliding up — and it proves the easing lands somewhere sane too.
  const framing = async (label) => {
    const f = await evalIn(cdp, `
      (() => {
        const el = document.getElementById('view');
        const w = el.clientWidth;
        const h = el.clientHeight;
        return { w, h, zoom: window.velo.cam.zoom, metres: w / window.velo.cam.zoom, up: h / window.velo.cam.zoom };
      })()
    `);
    console.log(`    framing ${label}: ` + JSON.stringify(f));
    return f;
  };
  // THE OPENING PEEK IS AN OVERVIEW, and the overview is the one thing allowed
  // to ignore the readability floor. Measuring the play framing while it is
  // still easing in measures the wrong camera entirely.
  await evalIn(cdp, `(() => { window.velo.overview.skipIntro(); return 1; })()`);
  await new Promise((r) => setTimeout(r, 2000));
  const wide = await framing('desktop');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 844, height: 390, deviceScaleFactor: 2, mobile: true,
  });
  await new Promise((r) => setTimeout(r, 2000));
  const phone = await framing('844x390');

  // --- THE VIEWPORT THE BUG WAS ACTUALLY ABOUT -----------------------------
  //
  // 844 x 390 is the phone a developer types into a test. 915 x 348 is the one
  // Chrome hands you on a large Android phone in landscape, once the URL bar and
  // the system bars have taken their quarter — and at that aspect a zoom derived
  // from width alone gave 7.4 m of VERTICAL world, which put the whole level in
  // a band across the top of the canvas with the pads covering the empty rest.
  // The derivation takes the limiting dimension now, and this is the number that
  // says so out loud.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 915, height: 348, deviceScaleFactor: 2, mobile: true,
  });
  await new Promise((r) => setTimeout(r, 2000));
  const shortLand = await framing('915x348 (chrome on screen)');
  if (!(shortLand.up > 8.6)) {
    throw new Error(`a short landscape phone framed ${shortLand.up.toFixed(1)} m of vertical world`);
  }
  // And the desktop chrome is GONE rather than drawn on top of the in-canvas
  // HUD, which is what the screenshot that started this showed: a level-name
  // dropdown and a `browse C` button printed through the level card and the
  // clock. Nothing in a unit test can see a DOM panel over a canvas.
  //
  // THE CONTROL LEGEND IS THE ONE PIECE OF DESKTOP CHROME THAT CAME BACK, and
  // it is a different thing here: a card in the middle that prints the name of
  // each PAD rather than a keycap for a keyboard the device does not have, open
  // on a first run because flip is the whole double-back design and a phone has
  // no keyboard to find it by accident. So it is checked rather than banned —
  // and then CLOSED, because main.ts hides the pads underneath it (its close
  // button sits exactly where a thumb cluster is) and everything below this
  // measures where the pads are.
  const help = JSON.parse(await evalIn(cdp, `
    (() => {
      const open = !document.querySelector('#legend .lg-card').hidden;
      const caps = document.querySelectorAll('#legend .lg-card .lg-cap').length;
      const pads = document.querySelectorAll('#legend .lg-card .lg-pad').length;
      // The class, not the geometry: the pads are taken away with opacity and
      // pointer-events rather than display, so a hidden pad still has a rect.
      const padsHidden = document.getElementById('touch').classList.contains('tc-away');
      document.querySelector('#legend .lg-close').click();
      return JSON.stringify({ open, caps, pads, padsHidden,
        shut: document.querySelector('#legend .lg-card').hidden });
    })()
  `));
  console.log('    touch legend: ' + JSON.stringify(help));
  if (!help.open) throw new Error('the control legend was not offered on a first run on a phone');
  if (help.caps > 0) throw new Error(`the touch legend printed ${help.caps} keycaps on a device with no keyboard`);
  if (help.pads < 5) throw new Error(`the touch legend named ${help.pads} pads, wanted at least 5`);
  // The bug this catches, which a screenshot caught first: the card's own `×`
  // went past the wrapper that hides the pads, so closing it left a phone with
  // no controls at all.
  if (!help.padsHidden) throw new Error('the pads were live underneath the control legend');
  if (!help.shut) throw new Error('the control legend would not close');
  await new Promise((r) => setTimeout(r, 200));

  const chrome2 = JSON.parse(await evalIn(cdp, `
    (() => {
      const vis = (id) => getComputedStyle(document.getElementById(id)).display !== 'none';
      // VISIBLE pads only. touch.ts creates an element for every zone that
      // could ever exist and hides the ones this state does not use — a
      // deliberate choice, because rebuilding the set with a thumb down on the
      // gas drops the pointer capture and holds the throttle forever. A hidden
      // element's rect is all zeros, so min-of-top over every element reports 0
      // the moment any zone is hidden (the menu drawer, for one) and this check
      // fails on a pad that is not drawn anywhere at all.
      const pads = [...document.querySelectorAll('#touch .tc-zone')]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      return JSON.stringify({
        levelbar: vis('levelbar'), legend: vis('legend'), hud: vis('hud'),
        pads: pads.length,
        highest: Math.round(Math.min(...pads.map((r) => r.top))),
        lowest: Math.round(Math.max(...pads.map((r) => r.bottom))),
      });
    })()
  `));
  console.log('    touch chrome: ' + JSON.stringify(chrome2));
  for (const id of ['levelbar', 'hud']) {
    if (chrome2[id]) throw new Error(`the desktop ${id} is still drawn over the touch HUD`);
  }
  // 52 px is the band the art renderer draws the level card, clock and apple
  // counter in. Nothing in the overlay may be up there.
  if (!(chrome2.highest >= 52)) throw new Error(`a pad reaches into the in-canvas HUD (top ${chrome2.highest})`);
  if (!(chrome2.lowest <= 348)) throw new Error(`a pad runs off the bottom (${chrome2.lowest})`);

  // The level bar is gone, so `levels` is the ONLY way a phone changes level.
  // A hidden control with nothing replacing it would be a worse bug than the
  // one hiding it fixed.
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const tapPad = async (cls) => {
    const r = JSON.parse(await evalIn(cdp, `
      (() => { const b = document.querySelector('.${cls}').getBoundingClientRect();
        return JSON.stringify({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }); })()
    `));
    const pt = { x: r.x, y: r.y, id: 9, radiusX: 8, radiusY: 8, force: 1 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
    await new Promise((r2) => setTimeout(r2, 60));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await new Promise((r2) => setTimeout(r2, 400));
  };
  // THE DRAWER, which is the new thing on the glass and the reason the chooser
  // is two presses now. Five permanent pads for five occasional actions was the
  // trade that put a row of buttons across the band the bike rides through, so
  // `levels`, `full screen`, `gas-mode` and the zoom readout live behind `more`
  // — and every one of "it opens", "it is shut until you open it" and "it does
  // not survive into a run" is a DOM fact a unit test cannot see.
  const padSeen = async (cls) => evalIn(cdp, `
    (() => { const e = document.querySelector('.${cls}');
      if (!e) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0; })()
  `);
  if (await padSeen('tc-levels')) throw new Error('the command drawer was open with nothing pressed');
  await tapPad('tc-menu');
  if (!(await padSeen('tc-levels'))) throw new Error('the `more` pad did not open the command drawer');
  // A HOLD PAD SHUTS IT. This is the one that matters: a drawer that survived
  // into a run would be four pads sitting over the level while you drive.
  await tapPad('tc-leanL');
  if (await padSeen('tc-levels')) throw new Error('pressing a hold pad left the command drawer open');
  await tapPad('tc-menu');
  const wasLevel = await evalIn(cdp, `window.velo.level.name`);
  await tapPad('tc-levels');
  const chooserUp = await evalIn(cdp, `!document.getElementById('chooser').classList.contains('hidden')`);
  const drawerShut = !(await padSeen('tc-levels'));
  // AND THE LEVEL DID NOT CHANGE, which is the other half and is the bug this
  // found. A touch that ends synthesises a `click` at the point the finger
  // lifted, aimed at whatever is under it BY THEN — and `levels` opens a grid
  // of level cards under exactly that point. The phantom click rode one, so
  // pressing "levels" dropped you into a level you never chose. `touch.ts`
  // cancels the touchstart behind a pad press; without that line this reads
  // "02 — The Long Climb" and the chooser is already shut again.
  const nowLevel = await evalIn(cdp, `window.velo.level.name`);
  console.log('    levels pad: ' + JSON.stringify({ chooser: chooserUp, drawerShut, level: nowLevel }));
  if (!chooserUp) throw new Error('the levels pad did not open the chooser');
  if (!drawerShut) throw new Error('a command in the drawer did not shut it behind itself');
  if (nowLevel !== wasLevel) {
    throw new Error(`the levels pad picked a level by itself (${wasLevel} -> ${nowLevel})`);
  }
  await evalIn(cdp, `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true })); return 1; })()`);
  await new Promise((r) => setTimeout(r, 300));

  // --- the overview pad, which is the phone's TAB key -----------------------
  //
  // THE FREEZE GATE LIVES IN THE FRAME LOOP and no unit test can reach it, which
  // is why the keyboard half of this is already checked above. The pad is a
  // SECOND way into the same gate, through a real touch, and the claim that has
  // to survive it is the one the whole feature is licensed by: no tick advances
  // and the recorder gains no frame while it is up. A second freeze, or a pad
  // that only moved the camera, would both pass every test in the repo and lose
  // a tick out of a replay here.
  await evalIn(cdp, `(() => { window.velo.overview.skipIntro(); window.velo.restart(false); return 1; })()`);
  await tapPad('tc-throttle');
  await new Promise((r) => setTimeout(r, 400));
  const ovBefore = JSON.parse(await evalIn(cdp, `JSON.stringify({
    frozen: window.velo.overview.frozen, tick: window.velo.sim.state.tick,
    frames: window.velo.recordedFrames,
  })`));
  await tapPad('tc-overview');
  const ovLabel = await evalIn(cdp, `document.querySelector('.tc-overview span').textContent`);
  const ovLit = await evalIn(cdp, `document.querySelector('.tc-overview').classList.contains('open')`);
  const ovDuring = JSON.parse(await evalIn(cdp, `JSON.stringify({
    frozen: window.velo.overview.frozen, tick: window.velo.sim.state.tick,
    frames: window.velo.recordedFrames, zoom: window.velo.cam.zoom,
  })`));
  await new Promise((r) => setTimeout(r, 900));
  const ovHeld = JSON.parse(await evalIn(cdp, `JSON.stringify({
    tick: window.velo.sim.state.tick, frames: window.velo.recordedFrames,
    zoom: window.velo.cam.zoom, minZoom: window.velo.cam.params.minZoom,
  })`));
  // TOUCH ANYTHING TO RIDE. A hold pad is the most important case: it is
  // somebody who has finished looking and wants the bike back, and if it did not
  // drop out of the overview their throttle would go into a frozen sim.
  await tapPad('tc-leanL');
  await new Promise((r) => setTimeout(r, 500));
  const ovAfter = JSON.parse(await evalIn(cdp, `JSON.stringify({
    frozen: window.velo.overview.frozen, tick: window.velo.sim.state.tick,
    label: document.querySelector('.tc-overview span').textContent,
  })`));
  console.log('    overview pad: ' + JSON.stringify({
    label: ovLabel, lit: ovLit, before: ovBefore, held: ovHeld, after: ovAfter,
  }));
  if (!ovDuring.frozen) throw new Error('the overview pad did not freeze the sim');
  if (ovLabel !== 'ride') throw new Error(`the overview pad still says "${ovLabel}" while it is up`);
  if (!ovLit) throw new Error('the overview pad is up and does not look like it');
  if (ovHeld.tick !== ovDuring.tick) {
    throw new Error(`the clock ran while the overview pad was up (${ovDuring.tick} -> ${ovHeld.tick})`);
  }
  if (ovHeld.frames !== ovDuring.frames) {
    throw new Error(`the recorder gained a frame while the overview pad was up`);
  }
  if (!(ovHeld.zoom < ovHeld.minZoom)) {
    throw new Error(`the overview pad did not take the camera past the driving floor (${ovHeld.zoom})`);
  }
  if (ovAfter.frozen) throw new Error('a hold pad did not drop out of the overview');
  if (ovAfter.label !== 'overview') throw new Error('the overview pad did not go back to saying so');
  if (!(ovAfter.tick > ovHeld.tick)) throw new Error('the sim did not resume after the overview');

  // --- the pinch, driven by two real fingers -------------------------------
  //
  // Which pointers constitute a pinch is unit-tested in plain node, because
  // that is the part that would actually go wrong. What node cannot see is the
  // wiring, and it is unusually easy to get silently wrong here: the overlay is
  // `pointer-events: none`, so a play-area touch never reaches its handlers at
  // all and the gesture has to be recognised on the window — with a filter that
  // keeps it off the canvas's own panels. A typo in that filter is a feature
  // that simply never fires, on a device the developer is not holding.
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const finger = (x, y, id) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 });
  const touchSeq = async (frames) => {
    for (const [type, points] of frames) {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
      await new Promise((r) => setTimeout(r, 60));
    }
  };
  // WHERE THE PADS ACTUALLY ARE, read off the DOM rather than written down.
  // They are sized in millimetres now and placed from the live viewport, so a
  // hard-coded coordinate is a test that passes until somebody changes a pad by
  // a millimetre and then taps empty glass while reporting success.
  const padBox = async (cls) => JSON.parse(await evalIn(cdp, `
    (() => { const r = document.querySelector('.${cls}').getBoundingClientRect();
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); })()
  `));
  // Both fingers land in the play area, well clear of every pad, and spread
  // from 400 px apart to 880. Mid-height and mid-width is the one region this
  // layout guarantees is the game.
  const mid = JSON.parse(await evalIn(cdp, `
    (() => JSON.stringify({ w: window.innerWidth, h: window.innerHeight }))()
  `));
  const my = Math.round(mid.h * 0.45);
  await touchSeq([
    ['touchStart', [finger(Math.round(mid.w * 0.34), my, 1), finger(Math.round(mid.w * 0.66), my, 2)]],
    ['touchMove', [finger(Math.round(mid.w * 0.28), my, 1), finger(Math.round(mid.w * 0.72), my, 2)]],
    ['touchMove', [finger(Math.round(mid.w * 0.16), my, 1), finger(Math.round(mid.w * 0.84), my, 2)]],
    ['touchEnd', []],
  ]);
  const pinched = await evalIn(cdp, `
    (() => ({ bias: window.velo.cam.zoomBias, label: document.querySelector('.tc-zoom span').textContent }))()
  `);
  console.log('    pinch: ' + JSON.stringify(pinched));
  if (!(pinched.bias > 1.5)) throw new Error(`a two-finger spread did not zoom (bias ${pinched.bias})`);
  if (!pinched.label.includes(pinched.bias.toFixed(1))) {
    throw new Error(`the zoom pad printed ${pinched.label} for a bias of ${pinched.bias}`);
  }
  // And the way back, which is the whole reason the pad is there: a gesture
  // that went wrong mid-run must not need another gesture to undo it. It is
  // behind `more` now, which is the trade the drawer makes — the readout is
  // read far more often than the pad is pressed, and the pinch that got you
  // here needed no pad at all.
  await tapPad('tc-menu');
  if (!(await padSeen('tc-zoom'))) throw new Error('the `more` pad did not reveal the zoom pad');
  const zoomPad = await padBox('tc-zoom');
  await touchSeq([
    ['touchStart', [finger(Math.round(zoomPad.x), Math.round(zoomPad.y), 3)]],
    ['touchEnd', []],
  ]);
  const reset = await evalIn(cdp, `window.velo.cam.zoomBias`);
  console.log('    zoom reset: ' + reset);
  if (reset !== 1) throw new Error(`the zoom pad did not reset the zoom (${reset})`);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  if (!(phone.w > 800 && phone.w < 900)) throw new Error(`the canvas did not follow the viewport (${phone.w}px)`);
  // The numbers the fix is FOR: a landscape phone used to see 10.9 m of level
  // against a desktop's 25.8. Anything in this band is the derivation working;
  // outside it is either the old fixed px/m or a floor that has been quietly
  // lowered to make the number look good.
  if (!(phone.metres > 15 && phone.metres < 24)) {
    throw new Error(`a phone-sized viewport framed ${phone.metres.toFixed(1)} m of level`);
  }
  if (!(wide.metres > phone.metres)) throw new Error('the wider viewport did not show more world');
  if (!(wide.metres / phone.metres < wide.w / phone.w)) {
    throw new Error('the framing scaled with the viewport as if the zoom were still fixed');
  }

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
