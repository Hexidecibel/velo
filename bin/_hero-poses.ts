// Re-simulate a replay and dump the bike's pose over time, for drawing a real
// ride somewhere that is not the game (the GitHub profile hero banner).
//
// Same machinery as bin/_replay.ts, on purpose: the file names its sim rev,
// `getEngine` hands out that rev's frozen engine, the level is found by simHash
// with that rev's own loader, and the hash chain is verified before a single
// pose is trusted. Nothing here touches physics; it only reads `sim.state`
// after each `advance`.
//
//   bin/hero-poses <replay.json>                        # stunt report only
//   bin/hero-poses <replay.json> --from 3.2 --to 8.4 \
//                  --fps 30 --out poses.json            # sampled window
//
// The report: cumulative chassis rotation while airborne (full flips and their
// direction), airtime per jump, and wheelies (one wheel down for a while).
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Level } from '../src/sim/level.ts';
import { DEFAULT_SPEC } from '../src/sim/spec.ts';
import type { BikeSpec } from '../src/sim/spec.ts';
import { decodeInputs, parseReplayFile, replaySpec, ticksToSeconds } from '../src/sim/replay.ts';
import type { ReplayFile } from '../src/sim/replay.ts';
import { SIM_REV, getEngine, hasEngine } from '../src/sim/rev.ts';
import type { Engine } from '../src/sim/rev.ts';
import { INPUT_HZ } from '../src/sim/consts.ts';
import { BOOT_PRESET } from '../src/client/presets.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function die(msg: string): never {
  console.error(`bin/hero-poses: ${msg}`);
  process.exit(2);
}

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

interface Args {
  file: string;
  from?: number;
  to?: number;
  fps: number;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { file: '', fps: 30 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--from') a.from = Number(argv[++i]);
    else if (k === '--to') a.to = Number(argv[++i]);
    else if (k === '--fps') a.fps = Number(argv[++i]);
    else if (k === '--out') a.out = argv[++i];
    else if (k.startsWith('-')) die(`unknown option ${k}`);
    else a.file = k;
  }
  if (!a.file) die('usage: bin/hero-poses <replay.json> [--from s --to s --fps 30 --out poses.json]');
  return a;
}

function resolveLevel(file: ReplayFile, engine: Engine): Level {
  if (file.level !== undefined) return engine.parseLevel(file.level);
  const dir = join(ROOT, 'levels');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      try {
        const lvl = engine.parseLevel(readJson(join(dir, f)));
        if (lvl.simHash === file.simHash) return lvl;
      } catch {
        // not our level
      }
    }
  }
  die(`no level for simHash ${file.simHash}`);
}

function resolveSpec(file: ReplayFile, engine: Engine): BikeSpec {
  if (file.spec !== undefined && file.spec !== null) {
    try {
      const own = engine.parseSpec(file.spec);
      if (engine.specHash(own) === file.specHash) return own;
    } catch {
      // fall through
    }
  }
  const embedded = file.simRev === SIM_REV ? replaySpec(file) : null;
  if (embedded) return embedded;
  for (const s of [BOOT_PRESET.spec, DEFAULT_SPEC]) if (engine.specHash(s) === file.specHash) return s;
  die(`no bike spec for specHash ${file.specHash}`);
}

/** One input frame's pose, read straight off the sim state. */
interface Frame {
  px: number; py: number;
  /** Unwrapped chassis angle, radians, CCW positive (world is y-up). */
  ang: number;
  wx: [number, number]; wy: [number, number];
  /** Wheel spin angles, radians. */
  ws: [number, number];
  /** Rider head centre: pivot + armLength * arm direction. */
  hx: number; hy: number;
  facing: number;
  grounded: number;
}

const args = parseArgs(process.argv.slice(2));
const file = parseReplayFile(readJson(args.file));
if (!hasEngine(file.simRev)) die(`no engine for sim rev ${file.simRev}`);
const engine = getEngine(file.simRev);
const level = resolveLevel(file, engine);
const spec = resolveSpec(file, engine);
const v = engine.verifyReplay(level, spec, file);
if (!v.ok) die(`hash chain FAILED at frame ${v.atFrame}: ${v.reason ?? '?'}`);

const masks = decodeInputs(file.inputs);
const sim = engine.createSim(level, spec);
const frames: Frame[] = [];
let prevAng = 0;
for (let f = 0; f < masks.length; f++) {
  sim.advance(masks[f]);
  const s = sim.state;
  const raw = Math.atan2(s.oy, s.ox);
  // unwrap: step by the shortest signed difference
  const d = Math.atan2(Math.sin(raw - prevAng), Math.cos(raw - prevAng));
  const ang = f === 0 ? raw : prevAng + d;
  prevAng = ang;
  const L = spec.rider.armLength;
  frames.push({
    px: s.px, py: s.py, ang,
    wx: [s.wx[0], s.wx[1]], wy: [s.wy[0], s.wy[1]],
    ws: [s.wspin[0], s.wspin[1]],
    hx: s.px + L * s.ax, hy: s.py + L * s.ay,
    facing: s.facing, grounded: s.grounded,
  });
}

// --- stunt report ------------------------------------------------------------
const T = (f: number): string => (f / INPUT_HZ).toFixed(2);
console.log(`${level.name}  rev ${file.simRev}  ${masks.length} frames (${T(masks.length)} s)  hash chain VERIFIED (${file.hashes.length} checkpoints)`);
const totalRot = frames[frames.length - 1].ang - frames[0].ang;
console.log(`total chassis rotation ${(totalRot * 180 / Math.PI).toFixed(0)} deg`);

// Airborne spans: both wheels off the ground for at least 0.15 s.
const air: { a: number; b: number }[] = [];
for (let f = 0; f < frames.length;) {
  if (frames[f].grounded !== 0) { f++; continue; }
  let g = f;
  while (g < frames.length && frames[g].grounded === 0) g++;
  if (g - f >= 0.15 * INPUT_HZ) air.push({ a: f, b: g - 1 });
  f = g;
}
let totalAir = 0;
for (const s of air) {
  const rot = frames[s.b].ang - frames[s.a].ang;
  const dur = (s.b - s.a + 1) / INPUT_HZ;
  totalAir += dur;
  const turns = rot / (2 * Math.PI);
  // CCW in a y-up world, with the bike facing +x, is nose-up then over the
  // back: a backflip. Facing -x mirrors it.
  const fac = frames[s.a].facing;
  const dir = Math.abs(turns) < 0.5 ? '' : (rot * fac > 0 ? ' BACKFLIP' : ' FRONTFLIP');
  console.log(`  air ${T(s.a)}-${T(s.b)} s  ${dur.toFixed(2)} s  rot ${(rot * 180 / Math.PI).toFixed(0)} deg (${turns.toFixed(2)} turns)  facing ${fac > 0 ? '+x' : '-x'}${dir}`);
}
console.log(`total airtime (spans >= 0.15 s) ${totalAir.toFixed(2)} s`);

// Rotation over any 2 s window, for spins that touch down mid-way.
let best = { a: 0, rot: 0 };
const W2 = 2 * INPUT_HZ;
for (let f = 0; f + W2 < frames.length; f++) {
  const r = frames[f + W2].ang - frames[f].ang;
  if (Math.abs(r) > Math.abs(best.rot)) best = { a: f, rot: r };
}
console.log(`max rotation in any 2 s window: ${(best.rot * 180 / Math.PI).toFixed(0)} deg starting ${T(best.a)} s`);

// Wheelies: exactly one wheel down for >= 0.4 s.
for (let f = 0; f < frames.length;) {
  const g0 = frames[f].grounded;
  if (g0 !== 1 && g0 !== 2) { f++; continue; }
  let g = f;
  while (g < frames.length && frames[g].grounded === g0) g++;
  if (g - f >= 0.4 * INPUT_HZ) {
    console.log(`  ${g0 === 1 ? 'wheel0 (-x)' : 'wheel1 (+x)'} only ${T(f)}-${T(g - 1)} s  ${((g - f) / INPUT_HZ).toFixed(2)} s`);
  }
  f = g;
}
const facings = frames.filter((fr, i) => i > 0 && fr.facing !== frames[i - 1].facing).length;
console.log(`facing changes ${facings}`);

// --- sampled window ----------------------------------------------------------
if (args.out) {
  const from = args.from ?? 0;
  const to = args.to ?? masks.length / INPUT_HZ;
  const fa = Math.max(0, Math.round(from * INPUT_HZ));
  const fb = Math.min(frames.length - 1, Math.round(to * INPUT_HZ));
  const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
  const r3 = (x: number): number => Math.round(x * 1000) / 1000;
  const samples = [];
  const n = Math.round(((fb - fa) / INPUT_HZ) * args.fps);
  for (let i = 0; i <= n; i++) {
    const fx = fa + (i / n) * (fb - fa);
    const f0 = Math.floor(fx);
    const f1 = Math.min(f0 + 1, frames.length - 1);
    const u = fx - f0;
    const A = frames[f0], B = frames[f1];
    const L = (k: 'px' | 'py' | 'ang' | 'hx' | 'hy'): number => r3(lerp(A[k], B[k], u));
    samples.push({
      t: r3((fx - fa) / INPUT_HZ),
      px: L('px'), py: L('py'), ang: L('ang'), hx: L('hx'), hy: L('hy'),
      wx: [0, 1].map((k) => r3(lerp(A.wx[k], B.wx[k], u))),
      wy: [0, 1].map((k) => r3(lerp(A.wy[k], B.wy[k], u))),
      ws: [0, 1].map((k) => r3(lerp(A.ws[k], B.ws[k], u))),
      facing: A.facing,
      grounded: A.grounded,
    });
  }
  // Terrain: every collidable polygon, as-is. The consumer clips to its view.
  const polys = level.polys.map((p) => ({
    solidInside: p.solidInside,
    pts: Array.from(p.vx, (x, i) => [r3(x), r3(p.vy[i])]),
  }));
  writeFileSync(args.out, JSON.stringify({
    source: {
      replay: args.file.replace(/^.*data\/replays\//, 'data/replays/'),
      level: level.name, simHash: level.simHash, simRev: file.simRev,
      recordedAt: file.recordedAt ?? null, verified: true, checkpoints: file.hashes.length,
      from: fa / INPUT_HZ, to: fb / INPUT_HZ, fps: args.fps,
    },
    bike: {
      wheelRadius: spec.wheel.radius, headRadius: spec.rider.headRadius,
      anchors: spec.wheel.anchors, armLength: spec.rider.armLength,
    },
    flower: { x: level.flower.x, y: level.flower.y },
    finished: v.finished, endTime: ticksToSeconds(v.timeTicks),
    polys, samples,
  }));
  console.log(`wrote ${samples.length} samples ${T(fa)}-${T(fb)} s -> ${args.out}`);
}
