// Difficulty, measured from what the search actually experienced.
//
// The brief for this was explicit and it is the right one: a difficulty number
// must come from the SEARCH, not from level statistics. Apple count, level
// length and polygon count are properties of a file; they say nothing about
// whether the level is hard, and a generator optimising against them would
// learn to make long boring levels.
//
// Four measures, and why each is defensible:
//
//   PRECISION (the primary). Take the winning input stream and nudge it. Each
//   trial picks one held-input run and makes it one frame longer or shorter —
//   7.8 ms, below the floor of human timing precision — then re-simulates and
//   watches what the slip does over the next second and a half. The fraction of
//   slips that KILL is the measure.
//
//   The obvious version of this — "does the perturbed stream still finish the
//   level" — was tried first and is not a difficulty measure at all. A
//   deterministic bike is chaotic: nudge one boundary near the start and
//   everything downstream is a different run, so the finish rate mostly reports
//   how LONG the stream is. The tutorial level scored 0.89 on it, above levels
//   nobody finds hard. Death within a bounded horizon of the slip is local, is
//   comparable between a 14-second level and a 50-second one, and is the thing
//   a player actually feels: on a hard level a slip kills you, on an easy one it
//   just means you come up short and go round again. The whole-run finish rate
//   is still reported, because it is interesting, but it is not weighted.
//
//   CLEARANCE. The smallest gap between the rider's head — the death sphere —
//   and solid rock, anywhere on the winning line. A line that passes within
//   five centimetres of killing you is a different experience from one with
//   half a metre in hand, whatever the timing statistics say.
//
//   EFFORT. Node expansions per metre of route. This is the search's own
//   report of how much of the state space it had to look at, and it rises on
//   exactly the things that make a level hard for a person: dead ends, obstacles
//   that need a specific approach speed, sections where most of what you could
//   do is wrong. Logged, because it spans three orders of magnitude.
//
//   LETHALITY. Deaths per expansion during the search. Dense hazard: the
//   fraction of the things you could try that kill you. A wide-open level has
//   near zero; a low-roof corridor is mostly deaths.
//
// WHAT THIS IS NOT. It is not a claim about how hard a HUMAN finds the level —
// nothing here models learning, reading a level, or nerve. It is a measure of
// how narrow the successful corridor is and how much work it took to find,
// which is what a generator needs to filter on and what an editor can show live.
// A level whose solution only a solver would ever find scores high here and may
// simply be bad; the number is a flag to go and look, not a verdict.
import { getEngine, SIM_REV } from '@/sim/rev.ts';
import type { Level } from '@/sim/level.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import { buildEdgeIndex, nearestSurface } from './field.ts';

export interface LineStats {
  /** Metres between the head sphere's surface and solid, at its worst. */
  minHeadClearance: number;
  /** Where that happened. */
  atX: number;
  atY: number;
  /** Fraction of input frames with neither wheel touching. */
  airFraction: number;
  /** Peak speed on the winning line, m/s. */
  maxSpeed: number;
  /** Times the run changed which end was the nose. */
  flips: number;
}

export interface Tolerance {
  trials: number;
  /**
   * Fraction of one-frame nudges that kill the rider within `horizon` frames of
   * the nudge. THIS is the precision measure.
   */
  lethal: number;
  /**
   * Fraction where the whole perturbed stream still finishes the level.
   * Reported because it is interesting; not weighted, because it is dominated
   * by stream length rather than by the level. See the header.
   */
  finished: number;
  /** Input frames after the nudged run that a death still counts. */
  horizon: number;
}

export interface Difficulty {
  /** 0-100. See `WEIGHTS` for how it is put together. */
  score: number;
  /** The four normalised components, each 0-1, before weighting. */
  precision: number;
  clearance: number;
  effort: number;
  lethality: number;
  /** The raw measurements the components come from. */
  line: LineStats;
  tolerance: Tolerance;
  expansionsPerMetre: number;
  deathsPerExpansion: number;
  routeMetres: number;
}

/**
 * The composite. Precision leads because it is the most direct measure of what
 * a level demands; lethality trails because a level can be dense with hazard
 * and still be generous about hitting the line through it.
 */
export const WEIGHTS = { precision: 0.4, clearance: 0.2, effort: 0.25, lethality: 0.15 };

/**
 * Normalisation constants, calibrated against the twenty hand-authored levels
 * in this repo so that the set spans most of 0-100 rather than bunching. They
 * are presentation, not measurement: the four raw numbers above are the
 * finding, and re-scaling these does not change which level is harder than
 * which.
 */
export const SCALE = {
  /** Head clearance at or above this scores zero on the clearance axis. */
  roomyClearance: 0.7,
  /** Expansions per route metre: the log range mapped onto 0-1. */
  effortFloor: 2,
  effortCeil: 2000,
  /** Deaths per expansion mapped onto 0-1. */
  lethalCeil: 6,
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Deterministic, seeded, and reported, so a difficulty number is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Walk the winning line and measure it. */
export function measureLine(level: Level, spec: BikeSpec, masks: readonly number[], rev = SIM_REV): LineStats {
  const ix = buildEdgeIndex(level);
  const sim = getEngine(rev).createSim(level, spec);
  const s = sim.state;
  let minClear = Infinity;
  let atX = NaN;
  let atY = NaN;
  let air = 0;
  let maxSpeed = 0;
  let flips = 0;
  let facing = s.facing;
  for (const m of masks) {
    sim.advance(m);
    const hx = s.px + spec.rider.armLength * s.ax;
    const hy = s.py + spec.rider.armLength * s.ay;
    const c = nearestSurface(ix, hx, hy) - spec.rider.headRadius;
    if (c < minClear) {
      minClear = c;
      atX = hx;
      atY = hy;
    }
    if (s.grounded === 0) air++;
    const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
    if (v > maxSpeed) maxSpeed = v;
    if (s.facing !== facing) {
      flips++;
      facing = s.facing;
    }
    if (s.dead || s.finished) break;
  }
  return { minHeadClearance: minClear, atX, atY, airFraction: masks.length > 0 ? air / masks.length : 0, maxSpeed, flips };
}

/**
 * Run-length the stream, nudge one run by one frame, re-simulate, repeat.
 *
 * One run per trial rather than all of them, deliberately. Jittering every
 * boundary at once measures how brittle a 3000-frame stream is, which is a fact
 * about stream length; jittering one measures how much slack the level leaves
 * at its tightest moment, which is a fact about the level.
 */
export function measureTolerance(
  level: Level,
  spec: BikeSpec,
  masks: readonly number[],
  trials = 200,
  seed = 0x5e1f,
  horizon = 192,
  rev = SIM_REV,
): Tolerance {
  if (masks.length === 0) return { trials: 0, lethal: 0, finished: 0, horizon };
  const runs: { mask: number; len: number }[] = [];
  const startOf: number[] = [];
  let at = 0;
  for (const m of masks) {
    const last = runs[runs.length - 1];
    if (last && last.mask === m) last.len++;
    else { runs.push({ mask: m, len: 1 }); startOf.push(at); }
    at++;
  }
  const rnd = mulberry32(seed);
  let lethal = 0;
  let fin = 0;
  let done = 0;
  for (let t = 0; t < trials; t++) {
    const i = (rnd() * runs.length) | 0;
    const delta = rnd() < 0.5 ? -1 : 1;
    if (runs[i].len + delta < 1) continue;
    done++;
    const out: number[] = [];
    for (let k = 0; k < runs.length; k++) {
      const n = runs[k].len + (k === i ? delta : 0);
      for (let j = 0; j < n; j++) out.push(runs[k].mask);
    }
    // Deaths only count inside the window the slip could plausibly have caused.
    // Past that the run has diverged for reasons that are about chaos, not
    // about how tight the level is.
    const until = startOf[i] + runs[i].len + horizon;
    const sim = getEngine(rev).createSim(level, spec);
    let died = false;
    for (let f = 0; f < out.length; f++) {
      sim.advance(out[f]);
      if (sim.state.dead) { died = f <= until; break; }
      if (sim.state.finished) break;
    }
    if (died) lethal++;
    if (sim.state.finished) fin++;
  }
  const n = done > 0 ? done : 1;
  return { trials: done, lethal: lethal / n, finished: fin / n, horizon };
}

export function scoreDifficulty(args: {
  level: Level;
  spec: BikeSpec;
  masks: readonly number[];
  expansions: number;
  deaths: number;
  routeMetres: number;
  trials?: number;
  seed?: number;
  /** Which physics. Defaults to SIM_REV, the live rev. */
  rev?: number;
}): Difficulty {
  const rev = args.rev ?? SIM_REV;
  const line = measureLine(args.level, args.spec, args.masks, rev);
  const tolerance = measureTolerance(args.level, args.spec, args.masks, args.trials ?? 200, args.seed, undefined, rev);
  const metres = args.routeMetres > 1 ? args.routeMetres : 1;
  const epm = args.expansions / metres;
  const dpe = args.expansions > 0 ? args.deaths / args.expansions : 0;

  const precision = clamp01(tolerance.lethal);
  const clearance = clamp01(1 - line.minHeadClearance / SCALE.roomyClearance);
  const effort = clamp01(
    Math.log(Math.max(epm, SCALE.effortFloor) / SCALE.effortFloor) / Math.log(SCALE.effortCeil / SCALE.effortFloor),
  );
  const lethality = clamp01(dpe / SCALE.lethalCeil);
  const score =
    100 *
    (WEIGHTS.precision * precision +
      WEIGHTS.clearance * clearance +
      WEIGHTS.effort * effort +
      WEIGHTS.lethality * lethality);

  return {
    score, precision, clearance, effort, lethality,
    line, tolerance, expansionsPerMetre: epm, deathsPerExpansion: dpe, routeMetres: metres,
  };
}
