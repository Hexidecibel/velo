// Milestone 1: one bike, one ugly hand-written level, a tuning panel, and
// record-and-replay. No server, no menus, no art, no level library.
import './style.css';
import { parseLevel } from '@/sim/level.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { createSim } from '@/sim/sim.ts';
import type { Sim } from '@/sim/sim.ts';
import { cloneSpec, specHash } from '@/sim/spec.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import { copyState } from '@/sim/step.ts';
import type { SimState } from '@/sim/step.ts';
import { ticksToSeconds, decodeInputs } from '@/sim/replay.ts';
import type { Replay } from '@/sim/replay.ts';
import { SIM_REV } from '@/sim/rev.ts';
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '@/sim/consts.ts';
import { createInput } from './input.ts';
import { createLoop } from './loop.ts';
import { interpolate, render } from './render.ts';
import type { Camera, Pose } from './render.ts';
import { createPanel } from './panel.ts';
import { BOOT_PRESET } from './presets.ts';
import { createRecorder, verify } from './recorder.ts';
import { crossCheck } from '@/sim/crosscheck.ts';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const panelRoot = document.getElementById('panel') as HTMLElement;
const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;

const level = parseLevel(TEST_LEVEL);
let spec: BikeSpec = cloneSpec(BOOT_PRESET.spec);
let presetLabel = BOOT_PRESET.label;

let sim: Sim = createSim(level, spec);
let prevState: SimState = sim.snapshot();
const recorder = createRecorder();

// The last completed run, kept so T can replay it. Cleared by anything that
// would make the input stream un-reproducible — a spec edit, most of all.
let lastReplay: Replay | null = null;
let replayNote = '';
let playback: { masks: number[]; at: number; ghostOf: Replay } | null = null;

const cam: Camera = { x: level.start.x, y: level.start.y, zoom: 62 };
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
  cam.x = level.start.x;
  cam.y = level.start.y;
}

/**
 * Rebuild the world around an edited spec WITHOUT teleporting the bike back to
 * the start. Live tuning is the whole point of the panel, and being thrown to
 * the start line on every slider drag would make it useless mid-air.
 *
 * The recording dies, though: a replay whose spec changed halfway through is
 * not reproducible, and silently keeping one would be worse than losing it.
 */
function applySpec(next: BikeSpec): void {
  const carry = sim.snapshot();
  spec = next;
  sim = createSim(level, spec);
  sim.restore(carry);
  prevState = sim.snapshot();
  recorder.reset();
  lastReplay = null;
  replayNote = 'spec changed — press R for a clean run to record';
  playback = null;
}

function finishRun(): void {
  const r = recorder.build(level, spec, sim);
  if (r) {
    lastReplay = r;
    replayNote = '';
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
  playback = { masks: decodeInputs(lastReplay.inputs), at: 0, ghostOf: lastReplay };
}

// --- the frame --------------------------------------------------------------

let wasOver = false;

function step(): void {
  prevState = copyState(sim.state);

  let mask: number;
  if (playback) {
    if (playback.at >= playback.masks.length) {
      playback = null;
      return;
    }
    mask = playback.masks[playback.at++];
    sim.advance(mask);
    return;
  }

  mask = input.mask();
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

  // Camera: follow with a little lead in the direction of travel, and never
  // snap. Lead is clamped so that at high speed the bike does not end up on the
  // edge of the screen with the terrain it is about to hit off-frame.
  const leadX = Math.max(-4, Math.min(4, sim.state.vx * 0.35));
  const leadY = Math.max(-2, Math.min(2, sim.state.vy * 0.18));
  cam.x += (pose.px + leadX - cam.x) * 0.12;
  cam.y += (pose.py + leadY - cam.y) * 0.12;

  let ghost: Pose | null = null;
  if (playback) ghost = null;

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

  const lines = [
    `<span class="k">velo</span> <span class="v">rev ${SIM_REV}</span>  <span class="k">preset</span> <span class="v">${presetLabel}</span>`,
    `<span class="k">level</span> ${level.name}  <span class="k">simHash</span> ${level.simHash}`,
    `<span class="k">spec </span> ${specHash(spec)}`,
    '',
    `${status}   <span class="k">apples</span> ${level.apples.length - s.applesLeft}/${level.apples.length}`,
    `<span class="k">speed</span> ${Math.sqrt(s.vx * s.vx + s.vy * s.vy).toFixed(2)} m/s   <span class="k">spin</span> ${s.wspin[0].toFixed(1)} / ${s.wspin[1].toFixed(1)}   <span class="k">ground</span> ${s.grounded === 3 ? 'both' : s.grounded === 1 ? 'rear' : s.grounded === 2 ? 'front' : 'air'}`,
    `<span class="k">keys </span> ${keys}`,
    `<span class="k">facing</span> ${s.facing > 0 ? '+x' : '-x'}   <span class="k">contacts</span> ${sim.world.contactCount}   <span class="k">fps</span> ${fps.toFixed(0)}`,
    '',
    `<span class="k">recorded</span> ${recorder.frames} frames${lastReplay ? `  <span class="k">banked</span> ${lastReplay.frames}` : ''}`,
    replayNote ? `<span class="${replayNote.startsWith('REPLAY DESYNC') ? 'bad' : 'warn'}">${replayNote}</span>` : '',
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

const panel = createPanel(panelRoot, spec, {
  onSpecChange: (s) => applySpec(s),
  onPreset: (s, label) => {
    spec = cloneSpec(s);
    presetLabel = label;
    sim = createSim(level, spec);
    restart(false);
    panel.sync();
  },
  onRestart: () => restart(false),
  onReplay: () => startPlayback(),
});

const loop = createLoop({ step, draw });

input.onCommand((code) => {
  switch (code) {
    case 'KeyR':
      restart(false);
      break;
    case 'KeyT':
      startPlayback();
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
    case 'Equal':
    case 'NumpadAdd':
      cam.zoom = Math.min(200, cam.zoom * 1.15);
      break;
    case 'Minus':
    case 'NumpadSubtract':
      cam.zoom = Math.max(12, cam.zoom / 1.15);
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
  restart,
  startPlayback,
  // Run the fixed cross-engine harness in THIS engine. bin/smoke runs the same
  // thing under node and compares the hash chains; that comparison is the only
  // real proof that a server can re-simulate a browser's replay.
  crossCheck: (frames?: number) => crossCheck(level, spec, frames),
};
