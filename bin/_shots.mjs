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
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};
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

/**
 * Shoot the CHROME rather than the art — `SHOTS_CHROME=1`.
 *
 * Two extra frames per level: the level chooser with its thumbnails drawn, and
 * the same frame with the debug readout switched off. Both are page elements
 * over the canvas, so they are in the screenshot like the touch pads are, and
 * both are judged the same way the art is — by looking at one. The chooser shot
 * deliberately waits: thumbnails are rendered one per animation frame on
 * purpose, so a shot taken immediately would photograph placeholders.
 */
const CHROME = process.env.SHOTS_CHROME === '1';
/**
 * SHOTS_BIKES=scrambler,cafe,... — one shot per BIKE TYPE, at close camera.
 *
 * "Do six bikes read as six bikes" is a comparison and not an opinion, which is
 * the same argument the art/old A/B pair is here for. The shots are taken at
 * 110 px/m because that is where the fine tier lives and where a silhouette
 * either differs or does not; the overview tier is deliberately three blobs for
 * everybody and proves nothing about this.
 */
const BIKES = (process.env.SHOTS_BIKES || '').split(',').map((x) => x.trim()).filter(Boolean);
/**
 * REAL PHONE VIEWPORTS — `SHOTS_PHONES=1`, or `SHOTS_PHONES=name:WxH,...`.
 *
 * This exists because the last touch pass shipped a layout that was fine at an
 * idealised 844 x 390 and unusable at the size a phone actually hands you. A
 * landscape Android phone in Chrome is about 915 x 348 once the URL bar and the
 * system bars have taken their quarter, and at that aspect the width-only zoom
 * put the whole level in a band across the top with the pads covering the empty
 * rest. Every part of that is visible in a picture and none of it is visible in
 * a number, which is the entire argument for this flag.
 *
 * Each entry re-emulates the metrics and re-shoots, so one run produces the set
 * to compare: landscape with browser chrome, landscape without it (what
 * `display: standalone` or the fullscreen pad buys), portrait, and a tablet.
 */
const PHONE_PRESETS = [
  ['land-chrome', 915, 348],
  ['land-full', 915, 412],
  ['land-small', 736, 280],
  ['land-iphone', 844, 390],
  ['portrait', 412, 800],
  ['portrait-narrow', 360, 640],
  ['tablet', 1180, 820],
];
/**
 * `SHOTS_MENU=1` — open the touch command drawer before the phone shot.
 *
 * Restart and `more` are the only commands with permanent glass now; the other
 * four live behind `more`. "Where does the drawer land, and does it cover the
 * level" is a question about a picture — it opens into the bottom gutter on a
 * wide landscape phone and above the pads on a narrow one — and the whole point
 * of this flag is that neither of those is visible in a number.
 */
const MENU = process.env.SHOTS_MENU === '1';
/**
 * `SHOTS_LEGEND=1` — leave the control legend up on the phone pass.
 *
 * It is OPEN ON A FIRST RUN, which is the point of it: a phone has no keyboard
 * to fumble the flip out of, so the one screen that teaches the flip has to be
 * in front of you once. A fresh Chrome profile is a first run every time, so
 * without this every phone shot would be a shot of the legend rather than of
 * the pads — and the pads are what the phone pass exists to photograph. Closing
 * it goes through the same button a thumb goes through, which also puts the
 * pads back (main.ts hides them underneath it, like the results screen).
 */
const LEGEND = process.env.SHOTS_LEGEND === '1';
const CLOSE_LEGEND = `(()=>{const b=document.querySelector('#legend .lg-close');`
  + `if(b&&!b.closest('.lg-card').hidden)b.click();})();`;
/**
 * `SHOTS_OVERVIEW=1` — press the overview pad before the phone shot.
 *
 * Overview on a phone is a whole mode: the camera goes below its own readability
 * floor, the sim freezes, and a banner has to say so loudly enough that a frozen
 * game does not read as a crashed one. Every part of that is a picture. The pad
 * is pressed the way a thumb presses it, and then a beat is allowed for the ease
 * to finish — the blend is a half-life, so a shot taken immediately photographs
 * the transition rather than the destination.
 */
const OVERVIEW = process.env.SHOTS_OVERVIEW === '1';
const phonesEnv = process.env.SHOTS_PHONES || '';
const PHONES = !phonesEnv ? [] : phonesEnv === '1' ? PHONE_PRESETS : phonesEnv.split(',').map((x) => {
  const m = /^([A-Za-z0-9-]+):(\d+)x(\d+)$/.exec(x.trim());
  if (!m) throw new Error(`SHOTS_PHONES entry should look like name:915x348, got ${x}`);
  return [m[1], Number(m[2]), Number(m[3])];
});

/**
 * Press the `more` pad, the way a thumb does.
 *
 * Through a real `pointerdown` on the element rather than by reaching into the
 * module: the drawer is opened by the same handler a finger goes through, so
 * this photographs the state a player gets and not one only the harness can
 * reach.
 */
const pressPad = (cls) => `(()=>{const el=document.querySelector('#touch .${cls}');if(!el)return;`
  + `const r=el.getBoundingClientRect();`
  + `el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:99,`
  + `clientX:r.x+r.width/2,clientY:r.y+r.height/2}));})();`;
const OPEN_MENU = pressPad('tc-menu');
const OPEN_OVERVIEW = pressPad('tc-overview');

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
  // One pass per phone viewport, or one pass at the window size when there are
  // none. The metrics override goes on BEFORE the navigate, so the game boots
  // into the viewport rather than resizing into it — which is what a phone does,
  // and which is the one path where a wrong first frame would not be caught.
  const passes = PHONES.length ? PHONES : [[null, 0, 0]];
  for (const [phone, pw, ph] of passes) {
  if (phone) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: pw, height: ph, deviceScaleFactor: 1, mobile: true,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    console.log(`  == ${phone}  ${pw}x${ph}`);
  }
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
    // THE PHONE SHOT IS OF THE PAGE, not of a chosen camera. `renderAt` frames a
    // place at a px/m the caller picked, which is exactly the wrong tool for
    // judging whether the DERIVED framing is right on this viewport — it would
    // paint over the answer with the question. So the phone pass restarts the
    // loop, drives briefly and photographs whatever the game decided, pads and
    // HUD and all.
    const variants = phone ? [
      [`phone-${phone}`, `(()=>{window.velo.loop.start();${LEGEND ? '' : CLOSE_LEGEND}`
        + `${MENU ? OPEN_MENU : ''}`
        + `${OVERVIEW ? OPEN_OVERVIEW : ''}return 1})()`],
    ] : at.length === 3 ? [
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
    for (const bike of BIKES) {
      variants.push([
        `bike-${bike}`,
        `(()=>{window.velo.setAppearance('bike',${JSON.stringify(bike)});`
          + `return window.velo.renderAt(${x},${y},110,{art:true})})()`,
      ]);
    }
    if (CHROME) {
      // The loop is restarted for this one: the readout is a DOM overlay but the
      // in-canvas HUD is painted by a FRAME, so a shot with the loop stopped
      // photographs the canvas as it was before the key was pressed.
      variants.push(['hud-off', `(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code:'Backquote',bubbles:true}));window.velo.loop.start();return 1})()`]);
      // Opens the chooser and WAITS for every thumbnail, reporting how long they
      // took. Thumbnails are rendered one per animation frame on purpose, so a
      // shot taken immediately photographs placeholders — and "how long do
      // twenty renders of a level take" is a number worth printing rather than
      // a sleep worth guessing.
      // The customiser, with its live preview. The preview is the one place the
      // bike is drawn STANDING STILL and upright, which is the framing that
      // actually answers "do six silhouettes read as six bikes" — a shot taken
      // mid-wheelie answers a different question.
      // THE CONTROL LEGEND, which is now pictures of the bike rather than a
      // list of keys — so whether it reads is a question about an image and
      // nothing else. Three frames: as it sits, with the dev toolbar up, and
      // collapsed to its chip. `riding` is stripped because the drive above
      // left the bike moving and the legend deliberately fades to a fifth while
      // it is; the faded state is judged in the ordinary art-62 shots.
      variants.push(['legend', `(()=>{
        document.body.classList.remove('riding');
        window.velo.legend.setOpen(true);
        return document.querySelectorAll('#legend .lg-bike').length;
      })()`]);
      variants.push(['legend-dev', `(()=>{
        document.body.classList.remove('riding');
        window.velo.legend.setOpen(true);
        const b = document.querySelector('#legend .lg-devtoggle');
        if (b && !b.classList.contains('on')) b.click();
        return document.querySelectorAll('#legend .lg-tool').length;
      })()`]);
      variants.push(['legend-shut', `(()=>{
        document.body.classList.remove('riding');
        const b = document.querySelector('#legend .lg-devtoggle');
        if (b && b.classList.contains('on')) b.click();
        window.velo.legend.setOpen(false);
        return 1;
      })()`]);
      variants.push(['look', `(()=>{
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyY',bubbles:true}));
        return document.querySelectorAll('#look .lk-opt').length;
      })()`]);
      // The claim code, which has to be photographed rather than described:
      // "is that QR big enough to scan" is not a thing a unit test can answer.
      variants.push(['claim', `(()=>{
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',bubbles:true}));
        const r = window.velo.openClaim();
        return JSON.stringify(r.qr);
      })()`]);
      variants.push(['chooser', `(async()=>{
        const t0=performance.now();
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyC',bubbles:true}));
        for(;;){
          await new Promise((r)=>requestAnimationFrame(r));
          const want=document.querySelectorAll('#chooser .ch-card').length;
          const got=document.querySelectorAll('#chooser .ch-shot img').length;
          if((want>0&&got>=want)||performance.now()-t0>15000) return JSON.stringify({thumbs:got+'/'+want,ms:Math.round(performance.now()-t0)});
        }
      })()`]);
    }
    for (const [name, expr] of variants.filter(([n]) => !only.length || only.includes(n))) {
      const said = await ev(cdp, `(()=>{const r=${expr};return r===undefined?1:r})()`);
      if (name === 'chooser') console.log(`    thumbnails: ${await said}`);
      // The overview blend is an exponential with a 0.13 s half-life that only
      // LANDS on 1 within a thousandth, so half a second photographs the
      // transition and not the destination. Wait it out when it is in play.
      if (name === 'hud-off' || name.startsWith('legend') || name.startsWith('phone-')) {
        await new Promise((r) => setTimeout(r, OVERVIEW && name.startsWith('phone-') ? 1600 : 500));
      }
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
      await writeFile(join(OUT, `${lv}--${name}.png`), Buffer.from(r.data, 'base64'));
    }
    console.log(`    ${lv}: ${variants.filter(([n]) => !only.length || only.includes(n)).length} shots`);
  }
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
