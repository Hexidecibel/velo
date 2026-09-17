// Does the rider's linear reaction actually buy PUMPING? The instrument.
//
// The user asked for one thing in particular: "pumping back then forward to
// lift off the jump. going up big hill and then pushing off with a pump to get
// to other side." Rev 5 adds the term that makes it physically possible — the
// rider's mass can finally move relative to the bike — but "possible" and "a
// mechanic" are different claims and only the second one is worth shipping. So
// this rig answers the second, in metres and m/s, on both revs.
//
// HOW IT AVOIDS FOOLING ITSELF. Three things, and each of them is a way an
// earlier version of this measurement would have lied:
//
//   THE APPROACH IS LITERALLY THE SAME RUN. Every candidate branches from ONE
//   snapshot taken before the pump window opens, via `sim.snapshot()`. So
//   "faster off the lip than without the pump" cannot be a different run-up, a
//   different suspension phase, or a different attitude — it is the same bike
//   at the same instant, given different inputs.
//
//   THE BASELINE IS SEARCHED TOO. The no-pump number is not "hold nothing": it
//   is the best of the same search space evaluated with the reaction term at
//   zero, plus the do-nothing policy. Comparing a tuned input against an untuned
//   one measures the tuning, not the physics.
//
//   THE SAME SEARCH RUNS ON REV 4. If rev 4 finds most of the gain, the gain is
//   not the new term — it is the lean keys rotating the bike into a better
//   launch attitude, which rev 4 could always do. That control is the whole
//   point of running the search twice.
import { parseLevel } from '../src/sim/level.ts';
import type { Level } from '../src/sim/level.ts';
import type { Sim } from '../src/sim/sim.ts';
import type { SimState } from '../src/sim/step.ts';
import type { BikeSpec } from '../src/sim/spec.ts';
import { IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '../src/sim/consts.ts';
import type { RevChoice } from './_rev.ts';

const CEILING = 40;
const END = 220;

function cave(floor: [number, number][]): Level {
  return parseLevel({
    format: 'velo-level',
    name: 'pump rig',
    start: { x: 2, y: 1 },
    flower: { x: END - 2, y: 30 },
    apples: [],
    polygons: [{ kind: 'cave', points: [...floor, [END, CEILING], [0, CEILING]] }],
  });
}

/**
 * A lip at the end of a long flat runway.
 *
 * 120 m of run-up because a soft bike needs most of it to reach 10 m/s AND stop
 * ringing on its springs — the same lesson bin/dive learned the hard way, where
 * a short runway meant every measurement started at an arbitrary point in the
 * suspension's limit cycle and the rows came out non-monotone.
 *
 * The lip itself is small on purpose: 0.45 m over 2.5 m of ramp. A big kicker
 * launches the bike whatever the rider does and drowns the thing being measured.
 */
export const LIP = cave([[0, 0], [120, 0], [122.5, 0.45], [122.5, 0], [END, 0]]);

/** The flat runway alone, for the stability probes. */
export const FLAT = cave([[0, 0], [END, 0]]);

/**
 * The user's sentence, as geometry: "going up big hill and then pushing off
 * with a pump to get to other side".
 *
 *   0..94      flat run-up
 *   94..118    6 m of climb over 24 m — 14 degrees, climbable but it costs
 *              speed, which is the point: you arrive at the top slow
 *   118..122   a ROUNDED CREST, 0.35 m of rise and fall over 4 m
 *   122        the edge
 *   ..+width   the gap, 12 m deep
 *   then       the landing ledge, 1.5 m below the crest
 *
 * The crest is rounded rather than flat because a flat edge makes the test
 * unanswerable rather than hard: leaving a flat edge horizontally, a projectile
 * can only land LOWER, so the only thing that clears anything is a pump, and
 * "the baseline is zero" is not a comparison. A rounded crest is also what a
 * real pumpable feature is — you compress into the rise and extend over the top,
 * and the timing of that against the crest is exactly the skill being asked for.
 *
 * The landing ledge sits below the crest for the same reason every real gap jump
 * does: a same-height landing needs the takeoff to point upward, which a crest
 * does not.
 */
export function hillGap(width: number, drop = 1.5): Level {
  const top = 118;
  const edge = 122;
  const y = 6;
  return cave([
    [0, 0],
    [94, 0],
    [top, y],
    [top + 1, y + 0.25],
    [top + 2, y + 0.35],
    [top + 3, y + 0.25],
    [edge, y],
    [edge, -12],
    [edge + width, -12],
    [edge + width, y - drop],
    [END, y - drop],
  ]);
}

/** The takeoff edge. The pump window opens well before it. */
export const CREST_X = 122;
/** Where the pump window opens: 12 m of run-in, about 1.5 s at crest speed. */
export const GAP_WINDOW_X = 110;
/** Height of the landing ledge for the default `hillGap`. */
export const GAP_LEDGE_Y = 4.5;

/** A plain hill: `rise` metres over 24 m, then flat. For the climb probe. */
export function hill(rise: number): Level {
  return cave([[0, 0], [94, 0], [118, rise], [END, rise]]);
}

/** Full-throttle from the flat, how fast the bike is at the top of `hill`. */
export function climb(
  choice: RevChoice,
  spec: BikeSpec,
  rise: number,
  target: number,
): { entry: number; top: number; reached: boolean } {
  const level = hill(rise);
  const sim: Sim = choice.engine.createSim(level, spec);
  for (let f = 0; f < 192; f++) sim.advance(0);
  let entry = 0;
  for (let f = 0; f < 128 * 40; f++) {
    const s = sim.state;
    sim.advance(throttle(s, target, 1e9) | holdLevel(s));
    const t = sim.state;
    if (entry === 0 && t.px >= 94) entry = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
    if (t.dead) break;
    if (t.px >= 118) {
      return { entry, top: Math.sqrt(t.vx * t.vx + t.vy * t.vy), reached: true };
    }
  }
  return { entry, top: 0, reached: false };
}

/** Where the roller section starts. 120 m of flat before it, as everywhere. */
export const ROLL_START = 120;

/**
 * A roller section — the canonical pumping test, and the only one of these rigs
 * that can answer "does the rider ADD energy" rather than "does the rider use
 * the terrain better".
 *
 * A real rider comes out of a set of rollers FASTER than they went in with no
 * pedalling at all, by extending on the back of each crest and compressing into
 * each trough. So the measurement is: coast in at a fixed speed with the
 * throttle switched off, and read the speed at the far end. Any gain is energy
 * the rider put in, because nothing else in the rig can have put it there.
 *
 * Sinusoidal rather than triangular, sampled every eighth of a wavelength: a
 * triangular crest is an impulse and the bike's reaction to it drowns the thing
 * being measured. `Math.cos` is fine here — this is an instrument in bin/, not
 * the sim, and the purity ban is about what has to reproduce bit-identically on
 * somebody else's browser.
 */
export function rollerLevel(count = 8, wavelength = 4.5, amp = 0.3): Level {
  const floor: [number, number][] = [[0, 0], [ROLL_START, 0]];
  const per = 8;
  for (let i = 1; i <= count * per; i++) {
    const x = ROLL_START + (i * wavelength) / per;
    floor.push([x, (amp * (1 - Math.cos((2 * Math.PI * i) / per))) / 2]);
  }
  floor.push([END, 0]);
  return cave(floor);
}

export function rollerEnd(count = 8, wavelength = 4.5): number {
  return ROLL_START + count * wavelength;
}

export interface Coast {
  exitSpeed: number;
  reachedExit: boolean;
  died: boolean;
  /** How far it got, for a run that stalled before the exit. */
  endX: number;
}

/**
 * Coast from the window to `exitX` with NO throttle, and report the speed there.
 *
 * The throttle being off is the entire point. With it on, "faster at the exit"
 * measures the drive torque's interaction with the terrain; with it off, the
 * only things that can move the total energy are gravity (identical between
 * runs that reach the same x at the same height) and the rider.
 */
export function coastThrough(
  choice: RevChoice,
  level: Level,
  spec: BikeSpec,
  opts: { windowX: number; exitX: number; target: number; seconds?: number },
): { approach: number; run: (p: Pump) => Coast } {
  const sim: Sim = choice.engine.createSim(level, spec);
  const frames = Math.round((opts.seconds ?? 10) * 128);
  for (let f = 0; f < 192; f++) sim.advance(0);
  let guard = 0;
  while (sim.state.px < opts.windowX && guard++ < 8000 && !sim.state.dead) {
    const s = sim.state;
    sim.advance(throttle(s, opts.target, opts.windowX) | holdLevel(s));
  }
  const entry = sim.snapshot();
  const approach = Math.sqrt(entry.vx * entry.vx + entry.vy * entry.vy);

  const run = (p: Pump): Coast => {
    sim.restore(entry);
    for (let f = 0; f < frames; f++) {
      const s = sim.state;
      const pm = pumpMask(p, f);
      sim.advance(pm === null ? holdLevel(s) : pm);
      const t = sim.state;
      if (t.dead) return { exitSpeed: 0, reachedExit: false, died: true, endX: t.px };
      if (t.px >= opts.exitX) {
        return {
          exitSpeed: Math.sqrt(t.vx * t.vx + t.vy * t.vy),
          reachedExit: true,
          died: false,
          endX: t.px,
        };
      }
    }
    return { exitSpeed: 0, reachedExit: false, died: false, endX: sim.state.px };
  };
  return { approach, run };
}

/** The attitude-hold a rider does without thinking. Same shape as bin/_air.ts. */
function holdLevel(s: SimState): number {
  const err = s.oy + s.w * 0.18;
  if (err > 0.03) return IN_LEAN_R;
  if (err < -0.03) return IN_LEAN_L;
  return 0;
}

function throttle(s: SimState, target: number, untilX: number): number {
  const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  return s.px < untilX && speed < target ? IN_THROTTLE : 0;
}

/**
 * A pump, as a literal program: a delay, then a list of (lean key, frames)
 * strokes, then hand the controls back to the attitude-hold.
 *
 * A program rather than "back for N frames then forward for M" because the
 * SECOND lever turned out to matter more than the first, and a two-direction
 * encoding cannot express it. The rider's arm is rigid, so swinging it left and
 * right barely changes how high the rider sits — but going from a LEAN to
 * NEUTRAL does: `rest` is (0, 1) and the lean targets are (+-0.643, 0.766), so
 * a lean drops 35 kg by 0.55 * (1 - 0.766) = 0.13 m and releasing it stands the
 * rider back up. That is a crouch and a stand, which is what pumping physically
 * IS on a bicycle, and it needs `0` to be one of the strokes.
 */
export interface Pump {
  /** Frames after the window opens before the first stroke starts. */
  delay: number;
  /** (mask, frames) pairs. A mask of 0 is the rider standing up, not idling. */
  strokes: { mask: number; frames: number }[];
}

export const NO_PUMP: Pump = { delay: 0, strokes: [] };

/**
 * Genuinely hands off: the rider stands at rest and the attitude-hold is not
 * running either. The other "no pump" baseline still presses lean keys to keep
 * the chassis level, and those are the same keys a pump uses — so without this
 * one it would be impossible to say whether a measured gain came from the pump
 * or from having stopped the level-hold fighting it.
 */
export const HANDS_OFF: Pump = { delay: 0, strokes: [{ mask: 0, frames: 1 << 20 }] };

/** null = "not my turn", i.e. hand the frame back to the attitude-hold. */
function pumpMask(p: Pump, f: number): number | null {
  if (f < p.delay) return null;
  let k = f - p.delay;
  for (const st of p.strokes) {
    if (k < st.frames) return st.mask;
    k -= st.frames;
  }
  return null;
}

export interface Launch {
  /** Speed at the last frame in contact before the flight. */
  takeoffSpeed: number;
  /** Vertical speed at that instant — the half a pump is supposed to move. */
  takeoffVy: number;
  /** Peak chassis height above the takeoff point, metres. */
  peak: number;
  /** Horizontal metres travelled between takeoff and the next contact. */
  carry: number;
  airSeconds: number;
  /** Where the flight ended. NaN if it had not landed when the clock ran out. */
  landX: number;
  landY: number;
  died: boolean;
  /** No flight happened at all — the bike never left the ground. */
  neverLeft: boolean;
}

const DEAD: Launch = {
  takeoffSpeed: 0, takeoffVy: 0, peak: 0, carry: 0, airSeconds: 0,
  landX: NaN, landY: NaN, died: true, neverLeft: true,
};

/**
 * Run to the pump window, snapshot, and return a function that evaluates any
 * candidate from that one instant.
 *
 * Returning a closure over a snapshot rather than re-running the approach each
 * time is what makes the comparison exact AND what makes the search affordable:
 * the 120 m run-up is ~1500 frames and the search is hundreds of candidates.
 */
export function atWindow(
  choice: RevChoice,
  level: Level,
  spec: BikeSpec,
  opts: { windowX: number; target: number; seconds?: number; fromX?: number },
): { approach: number; run: (p: Pump) => Launch } {
  const sim: Sim = choice.engine.createSim(level, spec);
  const frames = Math.round((opts.seconds ?? 12) * 128);

  // Settle, then cruise up to the window.
  for (let f = 0; f < 192; f++) sim.advance(0);
  let guard = 0;
  while (sim.state.px < opts.windowX && guard++ < 6000 && !sim.state.dead) {
    const s = sim.state;
    sim.advance(throttle(s, opts.target, opts.windowX + 40) | holdLevel(s));
  }
  const entry = sim.snapshot();
  const approach = Math.sqrt(entry.vx * entry.vx + entry.vy * entry.vy);

  const run = (p: Pump): Launch => {
    sim.restore(entry);
    // The throttle keeps doing what it was doing; the pump replaces only the
    // lean keys, and only while it is running. That is the honest comparison —
    // a rider pumping has not let go of the throttle.
    let lastGroundY = sim.state.py;
    let lastGroundSpeed = 0;
    let lastGroundVy = 0;
    let takeoff = -1;
    let takeoffX = 0;
    let peak = 0;
    let land = -1;
    let landX = NaN;
    let landY = NaN;
    for (let f = 0; f < frames; f++) {
      const s = sim.state;
      const pm = pumpMask(p, f);
      sim.advance(throttle(s, opts.target, opts.windowX + 40) | (pm === null ? holdLevel(s) : pm));
      const t = sim.state;
      if (t.dead) return { ...DEAD, died: true };
      // Contacts BEFORE the feature are not the flight. A bike climbing a hill
      // skips off it constantly, and without this gate the measurement is of the
      // first 5 cm hop on the run-in — which is what the first version of this
      // rig actually measured, and why every gap read as uncleared.
      if (opts.fromX !== undefined && t.px < opts.fromX) {
        lastGroundY = t.py;
        lastGroundSpeed = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
        lastGroundVy = t.vy;
        takeoffX = t.px;
        continue;
      }
      if (t.grounded !== 0) {
        if (takeoff >= 0) {
          land = f;
          landX = t.px;
          landY = t.py;
          break;
        }
        lastGroundY = t.py;
        lastGroundSpeed = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
        lastGroundVy = t.vy;
        takeoffX = t.px;
      } else if (takeoff < 0) {
        takeoff = f;
      }
      if (takeoff >= 0) {
        const h = t.py - lastGroundY;
        if (h > peak) peak = h;
      }
    }
    if (takeoff < 0) return { ...DEAD, died: false, neverLeft: true };
    return {
      takeoffSpeed: lastGroundSpeed,
      takeoffVy: lastGroundVy,
      peak,
      carry: (land >= 0 ? landX : sim.state.px) - takeoffX,
      airSeconds: ((land >= 0 ? land : frames) - takeoff) / 128,
      landX,
      landY,
      died: false,
      neverLeft: false,
    };
  };
  return { approach, run };
}

/**
 * Every pump worth trying, as one list.
 *
 * Deliberately coarse. The input frame is 7.8 ms and a human cannot place a
 * stroke to better than about three of them, so a grid finer than this would be
 * measuring a timing precision no player has — and the point of the exercise is
 * whether a PERSON can pump, not whether a search can.
 */
export function pumpGrid(maxDelay = 48): Pump[] {
  const out: Pump[] = [NO_PUMP];
  const KEYS = [IN_LEAN_L, IN_LEAN_R, 0];
  for (const a of KEYS) {
    for (const b of KEYS) {
      if (a === b) continue;
      for (let delay = 0; delay <= maxDelay; delay += 4) {
        for (const first of [8, 14, 20, 28]) {
          for (const second of [8, 14, 20, 28]) {
            out.push({ delay, strokes: [{ mask: a, frames: first }, { mask: b, frames: second }] });
          }
        }
      }
    }
  }
  return out;
}

/**
 * A SUSTAINED pump: alternate two strokes for the whole run.
 *
 * This is the one that answers "can a rider add energy", because a single
 * stroke can only cash in what the terrain already offered. Riding a roller
 * section is the canonical test — a rider who can pump comes out of a set of
 * bumps faster than they went in, with no throttle at all.
 */
export function cycleGrid(): Pump[] {
  const out: Pump[] = [NO_PUMP];
  const PAIRS: [number, number][] = [
    [IN_LEAN_L, IN_LEAN_R],
    [IN_LEAN_L, 0],
    [IN_LEAN_R, 0],
  ];
  for (const [a, b] of PAIRS) {
    for (const half of [6, 8, 10, 12, 16, 20, 26, 32]) {
      for (let delay = 0; delay < half * 2; delay += Math.max(2, Math.round(half / 3))) {
        const strokes: { mask: number; frames: number }[] = [];
        for (let i = 0; i < 40; i++) strokes.push({ mask: i % 2 === 0 ? a : b, frames: half });
        out.push({ delay, strokes });
      }
    }
  }
  return out;
}

function keyName(m: number): string {
  return m === IN_LEAN_L ? 'back' : m === IN_LEAN_R ? 'fwd' : 'up';
}

export function describePump(p: Pump): string {
  if (p.strokes.length === 0) return 'no pump';
  if (p.strokes.length > 2) {
    return `cycle ${keyName(p.strokes[0].mask)}/${keyName(p.strokes[1].mask)} ` +
      `${p.strokes[0].frames}f half-period, d${p.delay}`;
  }
  return `${p.strokes.map((st) => `${keyName(st.mask)}${st.frames}`).join('->')} d${p.delay}`;
}

/** The candidate that maximises `score`, and the do-nothing baseline. */
export function best(
  run: (p: Pump) => Launch,
  grid: Pump[],
  score: (l: Launch) => number,
): { pump: Pump; launch: Launch; baseline: Launch } {
  const baseline = run(NO_PUMP);
  let bestP = NO_PUMP;
  let bestL = baseline;
  let bestS = -Infinity;
  for (const p of grid) {
    const l = run(p);
    if (l.died || l.neverLeft) continue;
    const sc = score(l);
    if (sc > bestS) {
      bestS = sc;
      bestP = p;
      bestL = l;
    }
  }
  return { pump: bestP, launch: bestL, baseline };
}
