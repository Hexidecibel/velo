// Screenshots of the real renderer, for judging READABILITY. Driven by bin/shots.
//
// The acceptance criterion for the art is not that it looks good, it is that the
// collision edge stays the most legible line in a loud frame. You cannot check
// that from a description and you cannot check it from one level — so this takes
// the same moment on several levels, at the three zooms the camera actually
// reaches, with the art on, the art off, and the G overlay up.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { reapOrphans, spawnChrome } from './_chrome.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const OUT = process.env.SHOTS_OUT || join(ROOT, 'shots');
const W = Number(process.env.SHOTS_W || 1600);
const H = Number(process.env.SHOTS_H || 900);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };
const levels = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const want = levels.length ? levels : ['07-the-chimney', '10-cathedral', '19-low-roof', '20-close-quarters'];
/**
 * Which of the seven shots to take, as a comma list.
 *
 * Added for the question Phase 2 has to answer that Phase 1 did not: "do the
 * twenty levels look like twenty places". That is judged by looking at ONE shot
 * of each as a SET, and taking seven of each first means a hundred and forty
 * images to compare twenty of. `SHOTS_ONLY=art-62 bin/shots <all twenty>`.
 */
const only = (process.env.SHOTS_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
/**
 * `SHOTS_AT=x,y,zoom` frames one exact place instead of following the bike.
 *
 * Added while debugging a prop that looked wrong in an overview and could not
 * be identified from it. "What does this thing at world x=83 actually look
 * like" is a question the bike-follows-the-level framing cannot answer.
 */
const at = (process.env.SHOTS_AT || '').split(',').map(Number).filter((n) => Number.isFinite(n));
/**
 * Extra query string on every page load — `SHOTS_QUERY=touch=1`.
 *
 * The screenshot is of the PAGE and not of the canvas, so this is what makes
 * the touch controls photographable: whether the thumb zones sit where a hand
 * actually is, and whether they compete with the collision edge, are both
 * comparisons rather than opinions, and neither can be judged from a unit test
 * that knows only the fractions.
 */
const QUERY = process.env.SHOTS_QUERY || '';
/**
 * Stand up N montage riders before shooting — `SHOTS_MONTAGE=24`.
 *
 * The one question a montage screenshot has to answer is whether the winning
 * line still READS against the crowd, and that is the whole acceptance
 * criterion for the feature's look. It uses the same synthetic riders
 * bin/montagebench does, because a real montage would mean grinding real
 * attempts out of a headless browser to photograph the same pile of bikes.
 */
const MONTAGE = Number(process.env.SHOTS_MONTAGE || 0);

await mkdir(OUT, { recursive: true });
const serve = createServer(async (req, res) => {
  const raw = decodeURIComponent((req.url || '/').split('?')[0]);
  if (raw === '/api/spec') {
    res.writeHead(200, { 'content-type': 'application/json' });
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
const profile = await mkdtemp(join(tmpdir(), 'velo-shots-'));
const cdpPort = await freePort();
const chrome = spawnChrome(profile, cdpPort, W, H);

try {
  const cdp = await connect(await waitForTarget(cdpPort));
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  for (const lv of want) {
    await cdp.send('Page.navigate', { url: `${url}?level=${lv}${QUERY ? `&${QUERY}` : ''}` });
    await new Promise((r) => setTimeout(r, 2600));
    // Drive for a moment so the bike is mid-level and moving, then freeze the
    // loop: a still of a bike sitting on the start line says nothing about
    // whether the art survives a busy part of a level.
    await ev(cdp, `(()=>{window.velo.overview.skipIntro();window.velo.restart(false);window.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowUp',bubbles:true}));return 1})()`);
    await new Promise((r) => setTimeout(r, 1500));
    await ev(cdp, `(()=>{window.dispatchEvent(new KeyboardEvent('keyup',{code:'ArrowUp',bubbles:true}));return 1})()`);
    await new Promise((r) => setTimeout(r, 120));
    // STOP THE LOOP. Otherwise the next animation frame repaints the play
    // framing over whatever we just captured, and every shot comes out
    // identical — which is exactly what happened the first time this ran.
    await ev(cdp, '(()=>{window.velo.loop.stop();return 1})()');
    // FULL DETAIL FOR A SCREENSHOT. The adaptive system is doing its job during
    // the drive above, but a still taken to judge the art must show the art
    // rather than whatever the last two seconds of frame times asked for.
    await ev(cdp, '(()=>{window.velo.art.adaptive=0;window.velo.art.quality=1;return 1})()');
    if (MONTAGE > 0) {
      // Stepped on so the crowd is spread through the level the way a real
      // montage is, rather than stacked on the start line.
      await ev(cdp, `(()=>{window.velo.montageBench(${MONTAGE});window.velo.montageStepBench(400);return 1})()`);
    }

    const where = await ev(cdp, 'JSON.stringify({x:window.velo.sim.state.px,y:window.velo.sim.state.py})');
    const { x, y } = JSON.parse(where);
    const variants = at.length === 3 ? [
      ['at', `window.velo.renderAt(${at[0]},${at[1]},${at[2]},{art:true})`],
      ['at-debug', `window.velo.renderAt(${at[0]},${at[1]},${at[2]},{art:true,debug:true})`],
    ] : [
      ['art-62', `window.velo.renderAt(${x},${y},62,{art:true})`],
      ['art-110', `window.velo.renderAt(${x},${y},110,{art:true})`],
      ['art-debug', `window.velo.renderAt(${x},${y},62,{art:true,debug:true})`],
      ['old-62', `window.velo.renderAt(${x},${y},62,{art:false})`],
      // THE TIGHTEST CEILING IN THE LEVEL. 19-low-roof's whole lesson is head
      // clearance, so a shot of its open start line proves nothing: if the art
      // obscures a ceiling edge, that level becomes unfair, and this is the
      // frame where it would show.
      ['art-tight', `(()=>{const g=window.velo.tightestGap();return window.velo.renderAt(g.x,g.y,62,{art:true})})()`],
      ['art-tight-debug', `(()=>{const g=window.velo.tightestGap();return window.velo.renderAt(g.x,g.y,62,{art:true,debug:true})})()`],
      ['art-overview', `window.velo.renderAt((window.velo.level.minX+window.velo.level.maxX)/2,(window.velo.level.minY+window.velo.level.maxY)/2,Math.min(30,${W - 80}/(window.velo.level.maxX-window.velo.level.minX)),{art:true,overview:1})`],
    ];
    for (const [name, expr] of variants.filter(([n]) => !only.length || only.includes(n))) {
      await ev(cdp, `(()=>{${expr};return 1})()`);
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
      await writeFile(join(OUT, `${lv}--${name}.png`), Buffer.from(r.data, 'base64'));
    }
    console.log(`    ${lv}: ${variants.filter(([n]) => !only.length || only.includes(n)).length} shots`);
  }
  console.log(`==> ${OUT}`);
} catch (e) {
  console.error(`    FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  chrome.kill('SIGKILL');
  serve.close();
  await new Promise((r) => setTimeout(r, 300));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

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
