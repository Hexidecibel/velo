// Re-simulate a replay file and say, precisely, what happened.
//
// This is the payoff for building determinism in on day one. "Sometimes it gets
// weird" is unactionable; "here is the file" is a bit-exact re-run of the exact
// moment, on any machine, with no renderer and no browser in the loop.
//
// What it reports, in order of how much you should care:
//
//   1. IDENTITY — sim rev, level, bike. A mismatch is stated, never papered
//      over. A rev-mismatched replay is refused outright rather than played
//      back against different physics, because a run that silently differs from
//      the one recorded is worse than no playback at all.
//   2. VERIFICATION — the hash chain. If the sim is deterministic, every
//      periodic hash reproduces; the first one that does not names the frame.
//   3. DIAGNOSTICS — the things that plausibly ARE "weird". Suspension
//      bottoming on maxDeflection, a velocity clamp firing, deep penetration, a
//      non-finite state, contact-count spikes. None of these are proof of a
//      bug; all of them are places to look first.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Level } from '../src/sim/level.ts';
import { DEFAULT_SPEC } from '../src/sim/spec.ts';
import type { BikeSpec } from '../src/sim/spec.ts';
// Nothing here calls the live rev's `createSim`, `parseLevel`, `parseSpec`,
// `specHash` or `verifyReplay` any more: every one of those belongs to the rev
// the FILE was recorded under, and comes off the `Engine` instead. That is the
// whole difference between a tool that can replay history and one that can only
// replay today.
import { checkReplayCompat, decodeInputs, parseReplayFile, replaySpec, revMismatchRefusal, ticksToSeconds } from '../src/sim/replay.ts';
import type { ReplayFile } from '../src/sim/replay.ts';
import { SIM_REV, REVS, getEngine, hasEngine } from '../src/sim/rev.ts';
import type { Engine } from '../src/sim/rev.ts';
import { MAX_ANGVEL, MAX_ARM_ANGVEL, MAX_SPEED, SIM_HZ } from '../src/sim/consts.ts';
import { rotX, rotY } from '../src/sim/rot.ts';
import { BOOT_PRESET } from '../src/client/presets.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Args {
  file: string;
  level?: string;
  spec?: string;
  csv?: string;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { file: '', quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--level') out.level = argv[++i];
    else if (a === '--spec') out.spec = argv[++i];
    else if (a === '--csv') out.csv = argv[++i];
    else if (a === '--quiet') out.quiet = true;
    else if (a.startsWith('-')) die(`unknown option ${a}`);
    else if (!out.file) out.file = a;
    else die(`unexpected argument ${a}`);
  }
  if (!out.file) die('usage: bin/replay <file.replay.json> [--level L.json] [--spec S.json] [--csv out.csv]');
  return out;
}

function die(msg: string): never {
  console.error(`bin/replay: ${msg}`);
  process.exit(2);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    die(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Find the level this replay was recorded on, in the order that needs the
 * fewest assumptions: what the caller said, then what the file carries, then
 * whatever in levels/ happens to hash the same. Every route is checked against
 * simHash afterwards, so "found it" always means "found the same geometry".
 */
function resolveLevel(file: ReplayFile, arg: string | undefined, engine: Engine): { level: Level; from: string } {
  // Compiled by the REV'S OWN loader: arc tessellation and the sag tolerance
  // decide what the bike hits and are as much a part of a rev as step.ts is.
  const parse = engine.parseLevel;
  if (arg) return { level: parse(readJson(arg)), from: arg };
  if (file.level !== undefined) return { level: parse(file.level), from: 'embedded in the replay' };
  const dir = join(ROOT, 'levels');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      try {
        const lvl = parse(readJson(join(dir, f)));
        if (lvl.simHash === file.simHash) return { level: lvl, from: `levels/${f} (matched by simHash)` };
      } catch {
        // A level that does not load is bin/level-check's problem, not ours.
      }
    }
  }
  die(
    `no level for simHash ${file.simHash}${file.levelName ? ` ("${file.levelName}")` : ''}. ` +
      'The replay carries no level and nothing in levels/ matches. Pass --level <file.json>.',
  );
}

/** Same idea for the bike: the file's own spec first, since it is definitive. */
function resolveSpec(file: ReplayFile, arg: string | undefined, engine: Engine): { spec: BikeSpec; from: string } {
  if (arg) return { spec: engine.parseSpec(readJson(arg)), from: arg };
  // `replaySpec` parses and hashes with the LIVE rev, so on a frozen rev it is
  // the wrong pair of functions; do the same two steps with the file's engine.
  if (file.spec !== undefined && file.spec !== null) {
    try {
      const own = engine.parseSpec(file.spec);
      if (engine.specHash(own) === file.specHash) return { spec: own, from: 'embedded in the replay' };
    } catch {
      // Falls through to the built-ins, and then to the die() below.
    }
  }
  const embedded = file.simRev === SIM_REV ? replaySpec(file) : null;
  if (embedded) return { spec: embedded, from: 'embedded in the replay' };
  for (const [name, s] of [['the M1 preset', BOOT_PRESET.spec], ['DEFAULT_SPEC', DEFAULT_SPEC]] as const) {
    if (engine.specHash(s) === file.specHash) return { spec: s, from: `${name} (matched by specHash)` };
  }
  die(
    `no bike spec for specHash ${file.specHash}. The replay carries none and neither built-in spec matches. ` +
      'Pass --spec <file.json>.',
  );
}

// --- diagnostics -------------------------------------------------------------

interface Diag {
  /** Frames on which the suspension hit its hard radial clamp. */
  bottomed: number;
  firstBottomFrame: number;
  maxDeflect: number;
  clampAng: number;
  clampArm: number;
  clampSpeed: number;
  maxSpeed: number;
  maxAngvel: number;
  maxDepth: number;
  maxDepthFrame: number;
  /** Which collider was that deep in, and in which edge. Names the suspect. */
  maxDepthWhat: string;
  maxContacts: number;
  nonFiniteFrame: number;
  groundFlips: number;
}

const CSV_HEAD = 'frame,t,px,py,vx,vy,ox,oy,w,ax,ay,aw,defl0,defl1,spin0,spin1,grounded,contacts,maxDepth\n';

function run(level: Level, spec: BikeSpec, masks: number[], csvPath: string | undefined, engine: Engine): Diag {
  const sim = engine.createSim(level, spec);
  const md = sim.world.spec.suspension.maxDeflection;
  const d: Diag = {
    bottomed: 0, firstBottomFrame: -1, maxDeflect: 0,
    clampAng: 0, clampArm: 0, clampSpeed: 0,
    maxSpeed: 0, maxAngvel: 0, maxDepth: 0, maxDepthFrame: -1, maxDepthWhat: '-', maxContacts: 0,
    nonFiniteFrame: -1, groundFlips: 0,
  };
  const rows: string[] = csvPath ? [CSV_HEAD] : [];
  let prevGround = 0;

  for (let f = 0; f < masks.length; f++) {
    sim.advance(masks[f]);
    const s = sim.state;

    if (d.nonFiniteFrame < 0 && !(Number.isFinite(s.px) && Number.isFinite(s.py) && Number.isFinite(s.vx) && Number.isFinite(s.w))) {
      d.nonFiniteFrame = f;
    }

    // Deflection: the anchor-to-hub distance, which is exactly what the hard
    // radial clamp in step.ts limits.
    const defl: number[] = [];
    for (let i = 0; i < 2; i++) {
      const a = sim.world.spec.wheel.anchors[i];
      const rx = rotX({ x: s.ox, y: s.oy }, a.x, a.y);
      const ry = rotY({ x: s.ox, y: s.oy }, a.x, a.y);
      const dx = s.px + rx - s.wx[i];
      const dy = s.py + ry - s.wy[i];
      const len = Math.sqrt(dx * dx + dy * dy);
      defl.push(len);
      if (len > d.maxDeflect) d.maxDeflect = len;
    }
    if (defl[0] >= md - 1e-9 || defl[1] >= md - 1e-9) {
      d.bottomed++;
      if (d.firstBottomFrame < 0) d.firstBottomFrame = f;
    }

    const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
    if (speed > d.maxSpeed) d.maxSpeed = speed;
    if (Math.abs(s.w) > d.maxAngvel) d.maxAngvel = Math.abs(s.w);
    if (speed >= MAX_SPEED - 1e-9) d.clampSpeed++;
    if (Math.abs(s.w) >= MAX_ANGVEL - 1e-9) d.clampAng++;
    if (Math.abs(s.aw) >= MAX_ARM_ANGVEL - 1e-9) d.clampArm++;
    if (s.grounded !== prevGround) d.groundFlips++;
    prevGround = s.grounded;

    // Contacts are the LAST tick of this frame only — the other three are gone
    // by the time we look. That is a real limitation of sampling from outside
    // the sim and it means a one-tick spike can hide; it is still enough to see
    // a corner the solver is fighting with.
    let depth = 0;
    let what = '-';
    for (let i = 0; i < sim.world.contactCount; i++) {
      const c = sim.world.contacts[i];
      if (c.depth > depth) {
        depth = c.depth;
        what = `${c.colliderIdx === 0 ? 'wheel0' : c.colliderIdx === 1 ? 'wheel1' : `chassis${c.colliderIdx - 2}`} in poly ${c.polyIdx} edge ${c.edgeIdx}`;
      }
    }
    if (depth > d.maxDepth) {
      d.maxDepth = depth;
      d.maxDepthFrame = f;
      d.maxDepthWhat = what;
    }
    if (sim.world.contactCount > d.maxContacts) d.maxContacts = sim.world.contactCount;

    if (csvPath) {
      rows.push([
        f, (f / 128).toFixed(5), s.px, s.py, s.vx, s.vy, s.ox, s.oy, s.w, s.ax, s.ay, s.aw,
        defl[0], defl[1], s.wspin[0], s.wspin[1], s.grounded, sim.world.contactCount, depth,
      ].join(',') + '\n');
    }
  }
  if (csvPath) writeFileSync(csvPath, rows.join(''));
  return d;
}

// --- main --------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const file = parseReplayFile(readJson(args.file));

console.log(`==> ${args.file}`);
console.log(`    recorded   rev ${file.simRev}${file.recordedAt ? `  at ${file.recordedAt}` : ''}${file.note ? `  note "${file.note}"` : ''}`);
console.log(`    claims     ${file.frames} frames, ${ticksToSeconds(file.timeTicks).toFixed(3)} s, ` +
  `${file.finished ? 'FINISHED' : file.dead ? 'DEAD' : 'unfinished'}, ${file.applesLeft} apples left`);

// THE PAYOFF OF THE FROZEN REVS, and the first thing in the tree to use them.
// Until rev 5 existed this was a flat refusal of anything not stamped SIM_REV,
// because there WAS only one engine and replaying a rev-3 file under rev-4
// physics would have shown a different run than the one recorded. Now the rev
// the file names is the rev it runs on, and a refusal means the rev is gone
// rather than merely old.
if (!hasEngine(file.simRev)) {
  console.error('');
  // One shared wording, so the CLI and the server's POST /api/runs cannot drift
  // apart about what a rev mismatch means.
  console.error(`!!! ${revMismatchRefusal(file.simRev)}`);
  console.error(`    This build carries engines for rev ${REVS.join(' and ')}.`);
  process.exit(3);
}
const engine: Engine = getEngine(file.simRev);
if (file.simRev !== SIM_REV) {
  console.log(`    ENGINE     rev ${file.simRev} — a frozen rev, not the live one (rev ${SIM_REV}).`);
}

const { level, from: levelFrom } = resolveLevel(file, args.level, engine);
const { spec, from: specFrom } = resolveSpec(file, args.spec, engine);
console.log(`    level      ${level.name}  ${level.simHash}   <- ${levelFrom}`);
console.log(`    bike       ${engine.specHash(spec)}   <- ${specFrom}`);

// `checkReplayCompat` answers the CLIENT's question — "can this build, on the
// live rev, play this file" — using the live rev's `specHash` and `SIM_REV`.
// That is the wrong question once we have the file's own engine in hand, and
// asking it anyway produces two false alarms on a frozen-rev file: a SIM_REV
// mismatch we have already handled, and a spec mismatch that is really just the
// live rev hashing a spec it has no field names for. So on a non-live rev only
// the LEVEL is worth comparing, and the rev is reported above as a fact.
const compat = checkReplayCompat(file, file.simRev === SIM_REV ? { level, spec } : { level });
for (const p of compat.problems) {
  if (!compat.revOk && p.startsWith('SIM_REV mismatch')) continue;
  console.log(`    MISMATCH   ${p}`);
}

const v = engine.verifyReplay(level, spec, file);
console.log('');
if (v.ok) {
  console.log(`==> VERIFIED  ${file.hashes.length} hash checkpoints, every one reproduced`);
} else {
  console.log(`==> FAILED    ${v.reason ?? '?'}`);
  if (v.atFrame !== undefined) {
    console.log(`    first divergence at input frame ${v.atFrame} (t = ${(v.atFrame / 128).toFixed(3)} s)`);
    console.log(`    expected ${v.expected}  got ${v.actual}`);
  }
}
console.log(`    re-simulated: ${ticksToSeconds(v.timeTicks).toFixed(3)} s, ` +
  `${v.finished ? 'FINISHED' : v.dead ? 'DEAD' : 'unfinished'}, ${v.applesLeft} apples left, final hash ${v.finalHash}`);

if (!args.quiet) {
  const masks = decodeInputs(file.inputs);
  const d = run(level, spec, masks, args.csv, engine);
  const md = spec.suspension.maxDeflection;
  const pct = (n: number): string => `${((n / Math.max(masks.length, 1)) * 100).toFixed(1)}%`;
  console.log('');
  console.log('==> diagnostics — places to look first, not verdicts');
  console.log(`    peak speed          ${d.maxSpeed.toFixed(2)} m/s      peak |angvel| ${d.maxAngvel.toFixed(2)} rad/s`);
  console.log(`    peak deflection     ${d.maxDeflect.toFixed(4)} m of ${md} max`);
  console.log(`    suspension bottomed ${d.bottomed} frames (${pct(d.bottomed)})` +
    (d.firstBottomFrame >= 0 ? `, first at frame ${d.firstBottomFrame} (${(d.firstBottomFrame / 128).toFixed(2)} s)` : ''));
  console.log(`    peak penetration    ${d.maxDepth.toFixed(5)} m` +
    (d.maxDepthFrame >= 0 ? ` at frame ${d.maxDepthFrame} (${(d.maxDepthFrame / 128).toFixed(2)} s), ${d.maxDepthWhat}` : ''));
  console.log(`    peak contacts       ${d.maxContacts} in one tick`);
  console.log(`    ground transitions  ${d.groundFlips}`);
  const alarms: string[] = [];
  if (d.nonFiniteFrame >= 0) alarms.push(`NON-FINITE STATE at frame ${d.nonFiniteFrame} — this is a bug, not a tuning issue`);
  if (d.clampSpeed) alarms.push(`the ${MAX_SPEED} m/s speed clamp fired on ${d.clampSpeed} frames`);
  if (d.clampAng) alarms.push(`the ${MAX_ANGVEL} rad/s angular clamp fired on ${d.clampAng} frames`);
  if (d.clampArm) alarms.push(`the ${MAX_ARM_ANGVEL} rad/s arm clamp fired on ${d.clampArm} frames`);
  if (d.maxDepth > 0.05) alarms.push(`penetration reached ${d.maxDepth.toFixed(3)} m — the solver is losing a contact`);
  if (d.bottomed > masks.length * 0.02) {
    alarms.push(`the suspension is on its hard clamp for ${pct(d.bottomed)} of the run — that clamp absorbs energy ` +
      'into the wheel alone and is felt as the bike sticking');
  }
  if (alarms.length === 0) {
    console.log('    nothing anomalous');
  } else {
    console.log('');
    for (const a of alarms) console.log(`    !!! ${a}`);
  }
  if (args.csv) console.log(`\n    per-frame telemetry -> ${args.csv}  (${masks.length} rows, ${SIM_HZ / 128} ticks per row)`);
}

process.exit(v.ok && compat.ok ? 0 : 1);
