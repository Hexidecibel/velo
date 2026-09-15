// Milestone 1: one bike, a handful of hand-written levels, a tuning panel, and
// record-and-replay with export/import. No server, no menus, no art.
import './style.css';
import { createSim } from '@/sim/sim.ts';
import type { Sim } from '@/sim/sim.ts';
import { cloneSpec, parseSpec, specHash } from '@/sim/spec.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import { copyState } from '@/sim/step.ts';
import type { SimState } from '@/sim/step.ts';
import { checkReplayCompat, decodeInputs, replaySpec, ticksToSeconds } from '@/sim/replay.ts';
import type { Replay, ReplayFile } from '@/sim/replay.ts';
import { SIM_REV } from '@/sim/rev.ts';
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '@/sim/consts.ts';
import { createInput } from './input.ts';
import { createLoop } from './loop.ts';
import { interpolate, render } from './render.ts';
import type { Pose } from './render.ts';
import { createCamera, cloneCamera, DEFAULT_CAMERA } from './camera.ts';
import { createPanel } from './panel.ts';
import { BOOT_PRESET, PRESETS } from './presets.ts';
import { createAttemptLog, createRecorder, verify } from './recorder.ts';
import { crossCheck } from '@/sim/crosscheck.ts';
import { LEVELS, adoptLevel, findBySimHash, resolveLevel } from './levels.ts';
import type { LevelEntry } from './levels.ts';
import { createLegend, createLevelBar } from './chrome.ts';
import { downloadReplay, onReplayDropped, pickReplay } from './replayio.ts';
import { clearStoredSpec, loadBests, loadLastLevel, loadStoredSpec, recordBest, saveLastLevel, saveStoredSpec } from './store.ts';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const panelRoot = document.getElementById('panel') as HTMLElement;
const levelbarRoot = document.getElementById('levelbar') as HTMLElement;
const legendRoot = document.getElementById('legend') as HTMLElement;
const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;

// --- which level ------------------------------------------------------------
//
// Order of authority: the URL, then what you played last, then the first level
// that loads. The URL wins so a link to a level is a link to that level, and it
// is kept in sync with `history.replaceState` so the address bar is always a
// shareable link to what is on screen.

const urlWanted = new URLSearchParams(location.search).get('level');
let entry: LevelEntry = resolveLevel(urlWanted ?? loadLastLevel()) ?? resolveLevel(null)!;
if (!entry?.level) {
  hud.textContent = `no loadable level found${entry?.error ? `: ${entry.error}` : ''}`;
  throw new Error('no loadable level');
}
let level = entry.level;

// --- the bike ---------------------------------------------------------------
//
// A tune restored from localStorage beats the preset, because the user tunes
// live through bin/dev and every source edit hot-reloads the page. Losing an
// hour of slider work to somebody else's commit has already happened once; it
// does not get to happen twice. The restore is validated through parseSpec and
// falls back silently to the preset, because a stale or corrupt stored spec
// must never be able to stop the game booting.

let presetId = BOOT_PRESET.id;
let presetLabel = BOOT_PRESET.label;
let spec: BikeSpec = cloneSpec(BOOT_PRESET.spec);
let specIsTuned = false;

(function restoreSpec(): void {
  const stored = loadStoredSpec();
  if (!stored) return;
  const p = PRESETS.find((x) => x.id === stored.preset);
  if (!p) return;
  let parsed: BikeSpec;
  try {
    parsed = parseSpec(stored.spec);
  } catch {
    clearStoredSpec();
    return;
  }
  presetId = p.id;
  presetLabel = p.label;
  spec = parsed;
  specIsTuned = specHash(parsed) !== specHash(p.spec);
})();

let sim: Sim = createSim(level, spec);
let prevState: SimState = sim.snapshot();
const recorder = createRecorder();
const attempts = createAttemptLog();
let bests = loadBests();

// The last completed run, kept so T can replay it and E can export it. Cleared
// by anything that would make the input stream un-reproducible — a spec edit,
// most of all.
let lastReplay: Replay | null = null;
let replayNote = '';
let playback: { masks: number[]; at: number } | null = null;

const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
cam.snap({ x: level.start.x, y: level.start.y, vx: 0, vy: 0 });
let debug = false;
let hudCache = '';
let fps = 0;

const input = createInput();

// --- run lifecycle ----------------------------------------------------------

function restart(keepReplay = true): void {
  if (!keepReplay) lastReplay = null;
  sim.reset();
  prevState = sim.snapshot();
  recorder.reset();
  playback = null;
  wasOver = false;
  cam.snap({ x: level.start.x, y: level.start.y, vx: 0, vy: 0 });
}

function setLevel(next: LevelEntry, note = ''): void {
  if (!next.level) {
    replayNote = `"${next.label}" does not load: ${next.error ?? '?'}`;
    return;
  }
  entry = next;
  level = next.level;
  sim = createSim(level, spec);
  lastReplay = null;
  replayNote = note;
  restart(false);
  saveLastLevel(entry.id);
  // Keep the address bar a shareable link to what is actually on screen.
  const url = new URL(location.href);
  url.searchParams.set('level', entry.id);
  history.replaceState(null, '', url);
  levelBar.update(entry.id, bests);
}

function stepLevel(delta: number): void {
  const playable = LEVELS.filter((l) => l.level !== null);
  if (playable.length < 2) return;
  const i = playable.findIndex((l) => l.id === entry.id);
  const next = playable[((i < 0 ? 0 : i) + delta + playable.length) % playable.length];
  setLevel(next);
}

/**
 * Rebuild the world around an edited spec WITHOUT teleporting the bike back to
 * the start. Live tuning is the whole point of the panel, and being thrown to
 * the start line on every slider drag would make it useless mid-air.
 *
 * The recording dies, though: a replay whose spec changed halfway through is
 * not reproducible, and silently keeping one would be worse than losing it.
 */
function applySpec(next: BikeSpec, persist = true): void {
  const carry = sim.snapshot();
  spec = next;
  sim = createSim(level, spec);
  sim.restore(carry);
  prevState = sim.snapshot();
  recorder.reset();
  lastReplay = null;
  replayNote = 'spec changed — press R for a clean run to record';
  playback = null;
  const p = PRESETS.find((x) => x.id === presetId);
  specIsTuned = p ? specHash(spec) !== specHash(p.spec) : true;
  panel.setTuned(specIsTuned);
  if (persist) saveStoredSpec(presetId, spec);
}

function finishRun(): void {
  const r = recorder.build(level, spec, sim);
  if (!r) return;
  lastReplay = r;
  attempts.add(r);
  if (r.finished && recordBest(level.simHash, r.timeTicks)) {
    bests = loadBests();
    levelBar.update(entry.id, bests);
    replayNote = `new local best: ${ticksToSeconds(r.timeTicks).toFixed(3)}s — E exports this run`;
  } else {
    replayNote = 'run banked — T replays it, E exports it as a file';
  }
}

function startPlayback(): void {
  if (!lastReplay) {
    replayNote = 'nothing recorded yet — drive, then die or finish';
    return;
  }
  const v = verify(level, spec, lastReplay);
  replayNote = v.result.ok
    ? `replay verified: ${lastReplay.frames} frames, hash ${v.result.finalHash}`
    : `REPLAY DESYNC: ${v.result.reason ?? '?'}${v.result.atFrame !== undefined ? ` at frame ${v.result.atFrame}` : ''}`;
  sim.reset();
  prevState = sim.snapshot();
  recorder.reset();
  playback = { masks: decodeInputs(lastReplay.inputs), at: 0 };
  cam.snap({ x: level.start.x, y: level.start.y, vx: 0, vy: 0 });
}

// --- replay files -----------------------------------------------------------

function exportReplay(): void {
  if (!lastReplay) {
    replayNote = 'nothing to export yet — drive, then die or finish';
    return;
  }
  try {
    const name = downloadReplay(lastReplay, {
      levelRaw: entry.raw,
      levelName: level.name,
      spec,
    });
    replayNote = `exported ${name} — re-run it with: bin/replay ${name}`;
  } catch (e) {
    replayNote = `export failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Load a replay and watch it play. Everything about this path is written to
 * FAIL LOUDLY rather than to play something that is not what was recorded —
 * this is the first real user of the versioning scheme and a silent
 * near-miss here would make the whole rev mechanism decorative.
 */
function loadReplay(file: ReplayFile, name: string): void {
  // Rev first, and it is fatal. Rev-mismatched physics means a different run.
  if (file.simRev !== SIM_REV) {
    replayNote =
      `CANNOT PLAY ${name}: recorded under SIM_REV ${file.simRev}, this build is rev ${SIM_REV}. ` +
      'The physics changed between them, so replaying it here would show you a different run. ' +
      'Through milestone 1 the rev bumps freely and replays do not survive it.';
    return;
  }

  // The level, by simHash and nothing else. If we ship it, switch to it; if the
  // file carries one we do not have, take that on.
  const notes: string[] = [];
  let target = findBySimHash(file.simHash);
  if (!target && file.level !== undefined) {
    try {
      target = adoptLevel(file.level, file.levelName ?? 'replay level');
      notes.push('level taken from the replay file');
    } catch (e) {
      replayNote = `CANNOT PLAY ${name}: its embedded level does not load — ${e instanceof Error ? e.message : String(e)}`;
      return;
    }
  }
  if (!target?.level) {
    replayNote =
      `CANNOT PLAY ${name}: it is for level ${file.simHash}` +
      (file.levelName ? ` ("${file.levelName}")` : '') +
      ', which this build does not have and the file does not carry.';
    return;
  }
  if (target.id !== entry.id) setLevel(target);

  // The bike. A mismatch is recoverable when the file carries its own spec, and
  // adopting it is stated rather than silent.
  if (specHash(spec) !== file.specHash) {
    const embedded = replaySpec(file);
    if (!embedded) {
      replayNote =
        `CANNOT PLAY ${name}: recorded on bike spec ${file.specHash}, the current bike is ${specHash(spec)}, ` +
        'and the file carries no usable spec of its own.';
      return;
    }
    applySpec(embedded, false);
    notes.push(`adopted the replay's bike spec ${file.specHash}`);
  }

  const compat = checkReplayCompat(file, { level: target.level, spec });
  if (!compat.ok) {
    replayNote = `CANNOT PLAY ${name}: ${compat.problems.join(' / ')}`;
    return;
  }

  lastReplay = file;
  startPlayback();
  const claimed = `${file.finished ? 'FINISHED' : file.dead ? 'DEAD' : 'unfinished'} at ${ticksToSeconds(file.timeTicks).toFixed(3)}s`;
  replayNote = `${name}: ${claimed}${notes.length ? ` (${notes.join('; ')})` : ''} — ${replayNote}`;
}

function importReplay(): void {
  pickReplay().then(
    (r) => {
      if (r) loadReplay(r.file, r.name);
    },
    (e: unknown) => {
      replayNote = `could not read that file: ${e instanceof Error ? e.message : String(e)}`;
    },
  );
}

// --- the frame --------------------------------------------------------------

let wasOver = false;

function step(): void {
  prevState = copyState(sim.state);

  if (playback) {
    if (playback.at >= playback.masks.length) {
      playback = null;
      return;
    }
    sim.advance(playback.masks[playback.at++]);
    return;
  }

  const mask = input.mask();
  const over = sim.state.dead || sim.state.finished;
  if (over) {
    // The run is frozen by the sim itself. Keep feeding it nothing so the
    // recorder does not grow, and bank the replay once.
    if (!wasOver) {
      finishRun();
      wasOver = true;
    }
    return;
  }
  wasOver = false;
  sim.advance(mask);
  recorder.capture(mask, sim);
  if (sim.state.dead || sim.state.finished) {
    finishRun();
    wasOver = true;
  }
}

function draw(alpha: number, dtMs: number): void {
  fps += (1000 / Math.max(dtMs, 1) - fps) * 0.08;
  const { cssW, cssH } = resize();
  const pose = interpolate(prevState, sim.state, alpha);
  cam.update({ x: pose.px, y: pose.py, vx: sim.state.vx, vy: sim.state.vy }, dtMs / 1000, cssW, cssH);

  const ghost: Pose | null = null;
  render(ctx, cssW, cssH, cam, sim.world, sim.state, pose, spec, { debug, ghost });
  updateHud();
}

// --- chrome -----------------------------------------------------------------

function resize(): { cssW: number; cssH: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { cssW, cssH };
}

function updateHud(): void {
  const s = sim.state;
  const m = input.mask();
  const keys =
    (m & IN_THROTTLE ? 'GAS ' : '&middot;&nbsp;&nbsp;&nbsp; ') +
    (m & IN_BRAKE ? 'BRK ' : '&middot;&nbsp;&nbsp;&nbsp; ') +
    (m & IN_LEAN_L ? '&lt;L&nbsp; ' : '&middot;&nbsp;&nbsp; ') +
    (m & IN_LEAN_R ? 'R&gt;&nbsp; ' : '&middot;&nbsp;&nbsp; ') +
    (m & IN_FLIP ? 'FLIP' : '&middot;');
  const status = s.finished
    ? `<span class="ok">FINISHED ${ticksToSeconds(s.endTick).toFixed(3)}s</span>`
    : s.dead
      ? `<span class="bad">DEAD at ${ticksToSeconds(s.endTick).toFixed(3)}s — R to restart</span>`
      : playback
        ? `<span class="warn">REPLAY ${playback.at}/${playback.masks.length}</span>`
        : `${ticksToSeconds(s.tick).toFixed(2)}s`;
  const best = bests[level.simHash];

  const lines = [
    `<span class="k">velo</span> <span class="v">rev ${SIM_REV}</span>  <span class="k">preset</span> <span class="v">${presetLabel}${specIsTuned ? ' <span class="warn">+tuned</span>' : ''}</span>`,
    `<span class="k">level</span> ${level.name}  <span class="k">simHash</span> ${level.simHash}`,
    `<span class="k">spec </span> ${specHash(spec)}`,
    '',
    `${status}   <span class="k">apples</span> ${level.apples.length - s.applesLeft}/${level.apples.length}` +
      (best !== undefined ? `   <span class="k">best</span> ${ticksToSeconds(best).toFixed(3)}s` : ''),
    `<span class="k">speed</span> ${Math.sqrt(s.vx * s.vx + s.vy * s.vy).toFixed(2)} m/s   <span class="k">spin</span> ${s.wspin[0].toFixed(1)} / ${s.wspin[1].toFixed(1)}   <span class="k">ground</span> ${s.grounded === 3 ? 'both' : s.grounded === 1 ? 'rear' : s.grounded === 2 ? 'front' : 'air'}`,
    `<span class="k">keys </span> ${keys}`,
    `<span class="k">facing</span> ${s.facing > 0 ? '+x' : '-x'}   <span class="k">contacts</span> ${sim.world.contactCount}   <span class="k">zoom</span> ${cam.zoom.toFixed(0)} px/m   <span class="k">fps</span> ${fps.toFixed(0)}`,
    '',
    `<span class="k">recorded</span> ${recorder.frames} frames${lastReplay ? `  <span class="k">banked</span> ${lastReplay.frames}` : ''}  <span class="k">attempts</span> ${attempts.forLevel(level.simHash).length}`,
    replayNote ? `<span class="${replayNote.startsWith('REPLAY DESYNC') || replayNote.startsWith('CANNOT PLAY') ? 'bad' : 'warn'}">${replayNote}</span>` : '',
    '',
    `<span class="k">rev ${SIM_REV} bumps freely during M1 — times reset on every physics change.</span>`,
  ];
  const html = lines.join('\n');
  if (html !== hudCache) {
    hudCache = html;
    hud.innerHTML = html;
  }
}

// --- wiring -----------------------------------------------------------------

const levelBar = createLevelBar(levelbarRoot, LEVELS, (id) => {
  const hit = LEVELS.find((l) => l.id === id);
  if (hit) setLevel(hit);
});
levelBar.update(entry.id, bests);
createLegend(legendRoot);
// Sync the URL on boot as well as on every change, so that the address bar is a
// shareable link to what is on screen even when the level came from the stored
// preference rather than from the URL.
(function syncUrl(): void {
  const url = new URL(location.href);
  if (url.searchParams.get('level') === entry.id) return;
  url.searchParams.set('level', entry.id);
  history.replaceState(null, '', url);
})();

const panel = createPanel(panelRoot, spec, cam.params, {
  onSpecChange: (s) => applySpec(s),
  onCameraChange: () => {
    // Nothing to rebuild: the camera reads its params every frame. It is here
    // so that adding a camera parameter that DOES need work has a place to go.
  },
  onPreset: (s, label) => {
    const p = PRESETS.find((x) => x.label === label);
    presetId = p?.id ?? presetId;
    presetLabel = label;
    spec = cloneSpec(s);
    specIsTuned = false;
    clearStoredSpec();
    sim = createSim(level, spec);
    restart(false);
    panel.sync();
    panel.setTuned(false);
  },
  onResetSpec: () => {
    const p = PRESETS.find((x) => x.id === presetId) ?? BOOT_PRESET;
    spec = cloneSpec(p.spec);
    specIsTuned = false;
    clearStoredSpec();
    sim = createSim(level, spec);
    restart(false);
    panel.sync();
    panel.setTuned(false);
    replayNote = `reset to "${p.label}" as shipped`;
  },
  onRestart: () => restart(false),
  onReplay: () => startPlayback(),
  onExport: () => exportReplay(),
  onImport: () => importReplay(),
});
panel.setTuned(specIsTuned);

onReplayDropped(
  window,
  (r) => loadReplay(r.file, r.name),
  (msg) => {
    replayNote = `could not read that file: ${msg}`;
  },
);

const loop = createLoop({ step, draw });

input.onCommand((code) => {
  switch (code) {
    case 'KeyR':
      restart(false);
      break;
    case 'KeyT':
      startPlayback();
      break;
    case 'KeyE':
      exportReplay();
      break;
    case 'KeyL':
      importReplay();
      break;
    case 'KeyG':
      debug = !debug;
      break;
    case 'KeyH':
      panel.toggle();
      break;
    case 'KeyP':
      loop.paused = !loop.paused;
      break;
    case 'BracketLeft':
      stepLevel(-1);
      break;
    case 'BracketRight':
      stepLevel(1);
      break;
    case 'Equal':
    case 'NumpadAdd':
      // A bias on top of the auto zoom rather than a zoom value, so the
      // speed-driven zoom keeps working around whatever you chose.
      cam.zoomBias = Math.min(3, cam.zoomBias * 1.15);
      break;
    case 'Minus':
    case 'NumpadSubtract':
      cam.zoomBias = Math.max(0.35, cam.zoomBias / 1.15);
      break;
    default:
      break;
  }
});

loop.start();

// A handle for the headless smoke check in bin/smoke, and for poking at the sim
// from devtools while tuning. Not load-bearing.
interface VeloWindow extends Window {
  velo?: unknown;
}
(window as VeloWindow).velo = {
  get sim() {
    return sim;
  },
  get spec() {
    return spec;
  },
  get level() {
    return level;
  },
  get lastReplay() {
    return lastReplay;
  },
  get attempts() {
    return attempts.all;
  },
  levels: LEVELS,
  restart,
  startPlayback,
  exportReplay,
  // Run the fixed cross-engine harness in THIS engine. bin/smoke runs the same
  // thing under node and compares the hash chains; that comparison is the only
  // real proof that a server can re-simulate a browser's replay.
  crossCheck: (frames?: number) => crossCheck(level, spec, frames),
};
