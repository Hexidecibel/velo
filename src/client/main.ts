// Milestone 1: one bike, a handful of hand-written levels, a tuning panel, and
// record-and-replay with export/import. No server, no menus, no art.
import './style.css';
import { createSim } from '@/sim/sim.ts';
import type { Sim } from '@/sim/sim.ts';
import { cloneSpec, parseSpec, specHash } from '@/sim/spec.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import { copyState } from '@/sim/step.ts';
import type { SimState } from '@/sim/step.ts';
import { applySpecOverride, diffSpec } from '@/sim/spec.ts';
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
import { clearStoredSpec, loadBests, loadFlag, loadLastLevel, loadStoredSpec, recordBest, saveFlag, saveLastLevel, saveStoredSpec } from './store.ts';
import { createLiveTune } from './livetune.ts';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const panelRoot = document.getElementById('panel') as HTMLElement;
const levelbarRoot = document.getElementById('levelbar') as HTMLElement;
const toastRoot = document.getElementById('toast') as HTMLElement;
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

// THREE specs, and the distinction is the whole of how live tune and the panel
// coexist:
//
//   localSpec  what the PANEL writes and what localStorage remembers. Yours.
//   remote     the partial override from data/spec.json, driven by bin/spec.
//   spec       the EFFECTIVE bike: localSpec with remote layered on top,
//              per field. This is what the sim runs and what a replay records.
//
// Precedence is per FIELD, not whole-spec: `bin/spec set gravity 9.2` takes
// gravity and leaves every slider you touched alone, and `bin/spec unset
// gravity` hands gravity back to your value rather than to the preset's. That
// is the only precedence under which both halves stay usable at once, and the
// panel makes it visible by greying out exactly the rows that are held.
let localSpec: BikeSpec = cloneSpec(BOOT_PRESET.spec);
let remoteOverride: Record<string, unknown> = {};
let spec: BikeSpec = cloneSpec(localSpec);
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
  localSpec = parsed;
  spec = cloneSpec(parsed);
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
let liveTuneError: string | null = null;

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
 * Recompute the effective spec from `localSpec` + `remoteOverride` and rebuild
 * the world around it.
 *
 * `carry` keeps the bike exactly where it is rather than teleporting it to the
 * start. Live tuning is the whole point of the panel and being thrown to the
 * start line on every slider drag would make it useless mid-air. A REMOTE
 * change does not get that treatment — see `applyRemote`.
 *
 * The recording dies either way: a replay whose spec changed halfway through is
 * not reproducible, and silently keeping one would be worse than losing it.
 */
function recomputeSpec(carry: boolean): void {
  spec = applySpecOverride(localSpec, remoteOverride).spec;
  const carried = carry ? sim.snapshot() : null;
  sim = createSim(level, spec);
  if (carried) sim.restore(carried);
  prevState = sim.snapshot();
  recorder.reset();
  lastReplay = null;
  playback = null;
  const p = PRESETS.find((x) => x.id === presetId);
  specIsTuned = p ? specHash(localSpec) !== specHash(p.spec) : true;
  panel.setTuned(specIsTuned);
}

/** A panel slider moved: `localSpec` has already been mutated in place. */
function onPanelEdit(): void {
  recomputeSpec(true);
  replayNote = 'spec changed — press R for a clean run to record';
  saveStoredSpec(presetId, localSpec);
  panel.setRemote(liveTune.heldPaths, remoteNote());
}

/** Set the whole local spec — a preset swap, a reset, or a replay's own bike. */
function setLocalSpec(next: BikeSpec, opts: { persist: boolean; carry: boolean }): void {
  localSpec = next;
  recomputeSpec(opts.carry);
  if (opts.persist) saveStoredSpec(presetId, localSpec);
  else clearStoredSpec();
  panel.sync();
  panel.setRemote(liveTune.heldPaths, remoteNote());
}

/**
 * A new override arrived from `data/spec.json`.
 *
 * It RESTARTS the attempt, deliberately and always. A replay records the bike
 * spec's hash, so a spec that changes mid-run makes that run meaningless — and
 * silently so, which is the worse half. Restarting costs nothing while tuning
 * and it is honest. Playback is cancelled for the same reason.
 *
 * And it SAYS WHAT CHANGED. A bike that silently changes under somebody
 * concentrating on a run is the worst possible outcome: they conclude they have
 * lost their touch rather than that the numbers moved.
 */
function applyRemote(override: Record<string, unknown>, held: ReadonlySet<string>): void {
  const before = spec;
  remoteOverride = override;
  recomputeSpec(false);
  restart(false);
  panel.setRemote(held, remoteNote());
  panel.sync();

  const changes = diffSpec(before, spec);
  if (changes.length === 0) return;
  const shown = changes.slice(0, 4).map((c) => `${c.path} ${fmtNum(c.from)} → ${fmtNum(c.to)}`);
  if (changes.length > shown.length) shown.push(`and ${changes.length - shown.length} more`);
  toast(shown.join('   '), 'live tune');
  replayNote = `live tune: ${shown.join(', ')} — attempt restarted`;
}

function remoteNote(): string {
  const n = liveTune.heldPaths.size;
  if (n === 0) return '';
  return (
    `LIVE TUNE holding ${n} field${n === 1 ? '' : 's'} from data/spec.json. ` +
    'Those rows are read-only here; run `bin/spec unset <path>` (or `bin/spec reset`) to take them back. ' +
    'Your own tuning underneath is untouched.'
  );
}

function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(6)));
}

let toastTimer = 0;
/** Brief, non-blocking, and never in the way of the collision edge. */
function toast(message: string, label = ''): void {
  toastRoot.textContent = '';
  if (label) {
    const tag = document.createElement('b');
    tag.textContent = label;
    toastRoot.append(tag);
  }
  toastRoot.append(document.createTextNode(message));
  toastRoot.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastRoot.classList.remove('show'), 6000);
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
    // Live tune has to come OFF here, not just be layered under. A replay only
    // reproduces against the exact spec it was recorded on, and the next poll
    // two seconds from now would quietly change the bike underneath the
    // playback and make the hash chain diverge. Turning it off is stated, and
    // the toggle is right there.
    if (liveTune.enabled) {
      liveTune.setEnabled(false);
      saveFlag('livetune', false);
      panel.setLiveTune(false);
      notes.push('live tune switched off so the recorded bike can be reproduced');
    }
    setLocalSpec(embedded, { persist: false, carry: false });
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
    liveTuneError
      ? `<span class="bad">${liveTuneError}</span>`
      : liveTune.enabled
        ? `<span class="k">live tune</span> on${liveTune.heldPaths.size ? `, holding ${liveTune.heldPaths.size} field(s)` : ', no override'}`
        : '<span class="k">live tune</span> off',
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

// On by default under `bin/dev` and off by default in a build, because that is
// where each is wanted: a dev server is somebody tuning, a built page is
// somebody playing. Either way the toggle is remembered once touched.
const liveTuneDefault = loadFlag('livetune', import.meta.env.DEV);

const panel = createPanel(panelRoot, localSpec, () => spec, cam.params, liveTuneDefault, {
  onSpecChange: () => onPanelEdit(),
  onCameraChange: () => {
    // Nothing to rebuild: the camera reads its params every frame. It is here
    // so that adding a camera parameter that DOES need work has a place to go.
  },
  onLiveTune: (on) => {
    saveFlag('livetune', on);
    liveTune.setEnabled(on);
    replayNote = on
      ? 'live tune ON — following data/spec.json, change it with bin/spec'
      : 'live tune OFF — the bike is yours again';
    toast(replayNote);
  },
  onPreset: (s, label) => {
    const p = PRESETS.find((x) => x.label === label);
    presetId = p?.id ?? presetId;
    presetLabel = label;
    setLocalSpec(cloneSpec(s), { persist: false, carry: false });
    restart(false);
  },
  onResetSpec: () => {
    const p = PRESETS.find((x) => x.id === presetId) ?? BOOT_PRESET;
    setLocalSpec(cloneSpec(p.spec), { persist: false, carry: false });
    restart(false);
    // Deliberately does NOT clear the remote override: that is somebody else's
    // and it is not this button's to throw away. The banner says how.
    replayNote = liveTune.heldPaths.size
      ? `reset to "${p.label}" as shipped — live tune still holds ${liveTune.heldPaths.size} field(s); bin/spec reset clears those`
      : `reset to "${p.label}" as shipped`;
  },
  onRestart: () => restart(false),
  onReplay: () => startPlayback(),
  onExport: () => exportReplay(),
  onImport: () => importReplay(),
});
panel.setTuned(specIsTuned);

// Live tune. Created after the panel, because a poll that lands before the
// panel exists has nothing to grey out. The first poll fires immediately, so a
// spec file that is already in place is in force before the first frame the
// player sees rather than two seconds into their first run.
const liveTune = createLiveTune(() => localSpec, {
  onChange: (override, held) => applyRemote(override, held),
  onError: (msg) => {
    liveTuneError = msg;
  },
}, liveTuneDefault);

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
  specHash: () => specHash(spec),
  liveTune,
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
