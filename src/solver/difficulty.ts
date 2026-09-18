// Difficulty, measured on the best line anyone has found.
//
// THE FINDING THAT FORCED THIS FILE TO BE REWRITTEN. The old composite was four
// axes — precision, clearance, effort, lethality — all of them measured from
// whatever run the satisficing gate happened to trip over first. Then
// `optimise.ts` arrived and produced a *different*, faster run on the same
// geometry, and re-measuring the same four axes on it moved the composite by up
// to fourteen points: 11-downhill 33 -> 47, 21-rollers 41 -> 31. Head clearance
// on 21-rollers went 0.282 m -> 0.586 m, which is to say THE FAST LINE IS THE
// ROOMIER ONE. The score was never a property of the level. It was a property
// of the run, and the run just changed.
//
// So the rework, and the rule it is built on: a term earns a place in the
// composite only if it is a property of the LEVEL. Everything that is really a
// property of the searcher is still measured, still reported, and no longer
// weighted.
//
// TWO AXES, and here is what each one had to prove.
//
//   SLIP (the primary, 0.65). Take the line and ride it badly on purpose:
//   fumble one input boundary and the few after it by a 31 ms standard
//   deviation — a real human timing error, not a frame — and ask whether the
//   bike is dead within a second and a half. The fraction that kill is the
//   measure. See `measureHumanSlip` in human.ts.
//
//   It replaced the old `precision`, which asked the same question with a
//   ONE-FRAME nudge: 7.8 ms, deliberately below human timing resolution. That
//   number sat at 0.00-0.20 for nearly every level in the set and did almost no
//   discriminating. Measured side by side on the same gate lines: 11-downhill
//   reads nudge 0.00 and slip 22%, 15-feather reads nudge 0.00 and slip 10%.
//   The one-frame nudge cannot tell those two levels apart at all and the
//   human-sized error puts one at twice the other. Same idea; the error size is
//   what made it a measurement rather than a rounding.
//
//   ONE SUPPORTING NUMBER DID NOT SURVIVE RE-MEASUREMENT AND IS RECORDED HERE
//   RATHER THAN QUIETLY DROPPED. test02-bowl was reported as reading 0% and 36%
//   on the two measures, which would have been the cleanest possible example.
//   It reads 0% on BOTH — on the gate line and on the optimised line, which for
//   that level are the same line, because it is a bowl with nothing in it that
//   can kill you and the correct answer to "how often does a fumble kill you
//   here" is never. 30% of fumbled runs still finish and the other 70% simply
//   come up short, which is what an easy level is.
//
//   THE TRAP, which this file's old header warned about and which two separate
//   passes walked into anyway: the obvious version — jitter EVERY boundary and
//   count how often the whole run still finishes — is not a difficulty measure.
//   A deterministic bike is chaotic, so a stream with an error on every
//   boundary has diverged into a different run long before the end, and the
//   finish rate mostly reports how LONG the stream is. It returned 0 of 100 on
//   a twelve-second level with no hazard in it. The error has to be LOCAL and
//   so does the verdict. The whole-run finish rate is still reported, because
//   it is interesting, and it is still not weighted.
//
//   CLEARANCE (0.35). The smallest gap between the rider's head — the death
//   sphere — and solid rock, anywhere on the line. It is geometry: a line that
//   passes within five centimetres of killing you is a different experience
//   from one with half a metre in hand, whatever the timing statistics say. It
//   stays, and the thing that changed is that `measuredOn` now records WHICH
//   LINE it was taken on, because that is where the whole problem came from.
//
//   IT SATURATES AND THAT IS ITS KNOWN WEAKNESS. Half the set passes within
//   seven centimetres of rock somewhere, which is an axis reading 0.90+ for all
//   of them, so what clearance really separates is ROOMY from TIGHT and not one
//   tight level from another. That is still a distinction worth 35% — 21-rollers
//   and 09-runaway are genuinely roomy and 08-needle genuinely is not — and the
//   discrimination inside the tight half comes from slip, which does not
//   saturate. Making it logarithmic would spread the tight end, and it would
//   also start claiming that one centimetre against five is a difference a rider
//   can feel, which is a claim nothing here has measured.
//
// AND TWO THAT WERE DEMOTED TO DIAGNOSTICS.
//
//   EFFORT — node expansions per metre of route — measures the searcher and the
//   heuristic, not the level. 17-backswing scores high on it because the
//   occupancy grid routes up a wall and the search has to be proved wrong about
//   it one corridor at a time. That is a fact about field.ts. Change the
//   heuristic and the number moves without a vertex of the level moving.
//
//   LETHALITY — deaths per expansion during the search — reads like a property
//   of the level ("how much of what you could try kills you") and is not one,
//   for a subtler reason: the denominator is expansions, and WHERE the search
//   spends its expansions is the heuristic's choice. A search that thrashes in
//   a safe corridor for a million nodes reports a level as safe; the same level
//   searched by something that goes straight to the hazard reports it as
//   lethal. It also saturates — five of the twenty levels sit at or above 0.9 —
//   which is what a measure does when it is reporting on the measurer.
//
//   Both are still computed and still reported, because they are how you tell a
//   level the solver finds hard from a level a person finds hard, and that gap
//   is worth looking at. Neither is in the score.
//
// WHICH LINE — AND THIS IS WHERE MEASUREMENT OVERRULED THE OBVIOUS ANSWER.
//
// The obvious answer, and the one this rework set out to implement, is "score
// the optimal line": par is the best-defined run on a level, so measure on it.
// Measured across twenty-six levels it is WRONG, and the level that shows it is
// 02-the-long-climb — the second tutorial, a wide corridor with a gentle climb
// and half a metre of head clearance throughout. Its slip reads 6% on the
// gate's line and 29% on the optimised one, because the optimised line rides
// that corridor at the limit, and riding ANY level at the limit is dangerous.
// Scored on par it comes out at 46/100, above 24-kickback and level with
// 22-stutter. That is not a fact about 02-the-long-climb. It is a fact about
// what "fastest" means.
//
// And it fails the same test `effort` failed: the optimiser's line gets more
// marginal the more budget it is given, so slip-on-par drifts with the budget.
//
// SO THE COMPOSITE IS SCORED ON THE MOST FORGIVING LINE ANYONE HAS FOUND, and
// par is scored on the fastest. Two minima, and they are the two questions:
//
//   par        the least TIME anyone has got round in
//   difficulty the least DANGER anyone has got round in
//
// Both converge downward as more lines are found, both are only as good as the
// budget that found them, and both are stored with that budget beside them. The
// difficulty one is the right minimum because of what the slip test asks — "how
// often does somebody who knows the line get down it" — and somebody who knows
// a level and is trying to FINISH it rides the forgiving line, not the fast one.
// Whoever is chasing par can read `parMode` and the slip on that line instead;
// they are different questions and averaging them would lose both.
//
// `measuredOn` records which line won, and it is genuinely mixed across the set.
// 02-the-long-climb (6% against 29%), 06-two-doors (16% against 29%),
// 10-cathedral (12% against 25%) and 15-feather (10% against 28%) are all much
// more forgiving on the gate's slower line; 22-stutter (38% against 18%),
// 24-kickback (27% against 12%) and 18-double (26% against 18%) are the other
// way round and by as much. There is no rule here to shortcut with — the fast
// line is not reliably the dangerous one and not reliably the safe one, which
// is exactly why both are measured and the winner is named.
//
// PAR IS NOT AN AXIS, IT IS THE POINT. The fastest run anything has found is
// the one number in this whole system that is about the level and nothing else,
// and it is what the chooser wants to show next to your own best. It lives on
// the solve result rather than in here, because it is not difficulty.
//
// WHAT THIS IS STILL NOT. It is not a claim about how hard a HUMAN finds the
// level — nothing here models learning, reading a level, or nerve. It is a
// measure of how much execution the best known line demands and how much room
// it leaves, which is what a generator needs to filter on and what an editor
// can show live. A level whose only line a solver would ever find scores high
// here and may simply be bad; the number is a flag to go and look.
//
// AND IT IS A PROPERTY OF THE LEVEL *AND THE BEST KNOWN LINE*. That is weaker
// than "a property of the level" and it is the strongest true statement
// available: find a faster line and the numbers move. What makes it usable
// anyway is that par CONVERGES — it only ever goes down, by a shrinking amount,
// as the budget grows — where "the first run the search tripped over" did not
// converge to anything. Every stored row records the budget it was measured
// with for exactly this reason.
import { getEngine, SIM_REV } from '@/sim/rev.ts';
import type { Level } from '@/sim/level.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import { buildEdgeIndex, nearestSurface } from './field.ts';
import { measureHumanSlip } from './human.ts';
import type { HumanSlip } from './human.ts';

/**
 * The scoring formula's own version, stamped on every stored row.
 *
 * 1 was the four-axis composite measured on the gate's line. 2 is slip and
 * clearance on the most forgiving known line. A row from a different scoreRev is
 * not a score on the same scale and must not be compared to one, which is why
 * the number is stored rather than assumed.
 *
 * IT COVERS `SCALE` TOO, and that is not obvious enough to leave implicit.
 * Moving a normalisation constant moves every score by the same rule as moving
 * a weight does, so two payloads produced either side of a SCALE edit cannot be
 * merged — and merging payloads across runs is exactly what bin/difficulty-import
 * is for. Changing anything in `WEIGHTS` or `SCALE`, or changing which line is
 * chosen, bumps this number.
 */
export const SCORE_REV = 2;

/** Which run the line measurements were taken on. */
export type LineMode = 'gate' | 'optimised';

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
   * Fraction of ONE-FRAME nudges that kill the rider within `horizon` frames.
   *
   * A diagnostic since scoreRev 2. 7.8 ms is below the floor of human timing
   * precision, and across this level set the number it produces barely
   * discriminates — 0.00 to 0.20, with most levels under 0.05. `HumanSlip.lethal`
   * is the same question asked with an error a person really makes, and it is
   * what the composite uses.
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

/**
 * Route tension: what the apple ORDER is worth, in seconds.
 *
 * Reported as its own axis and deliberately NOT folded into difficulty, because
 * it is depth rather than difficulty. A level where the obvious order is
 * twenty-five seconds off the best one is a level with something to discover;
 * that is not the same claim as "this level is hard to ride", and averaging the
 * two would lose both.
 *
 * Measured by solving twice — once with the order searched, once with plain
 * nearest-apple-first forced — and taking the spread. Against a run-to-run
 * noise floor of about three seconds, which is what repeated optimising runs of
 * the same level on the same budget actually vary by, so a spread under that is
 * not a finding.
 */
export interface Tension {
  /** Seconds, with the order searched. */
  searchedSeconds: number;
  /** Seconds, with nearest-apple-first forced. Null when that order cannot complete the level. */
  greedySeconds: number | null;
  /** The order nearest-first picks, so the finding can be looked at. */
  greedyOrder: number[];
  /** |searched - greedy|. Infinity when the obvious order cannot do the level at all. */
  spreadSeconds: number;
  /** What it was judged against. */
  noiseFloorSeconds: number;
  /** True when the spread clears the noise floor, and only then is it a finding. */
  real: boolean;
}

/** Repeated optimising runs of one level on one budget vary by about this much. */
export const TENSION_NOISE_FLOOR = 3;

export function tensionOf(searchedSeconds: number, greedySeconds: number | null, greedyOrder: number[]): Tension {
  const spread = greedySeconds === null ? Infinity : Math.abs(searchedSeconds - greedySeconds);
  return {
    searchedSeconds,
    greedySeconds,
    greedyOrder,
    spreadSeconds: spread,
    noiseFloorSeconds: TENSION_NOISE_FLOOR,
    real: spread > TENSION_NOISE_FLOOR,
  };
}

export interface Difficulty {
  /** 0-100. `WEIGHTS` is the whole of it and nothing else goes in. */
  score: number;
  /** Which formula produced it. See `SCORE_REV`. */
  scoreRev: number;
  /**
   * WHICH LINE every line measurement below was taken on — the most forgiving
   * of the candidates it was given.
   *
   * This is the field the rewrite exists for. The same geometry scores
   * differently on the gate's line and on the optimiser's, so a number that
   * does not say which one it came from is a number nobody can compare to
   * anything. It is genuinely mixed across the shipped set, which is the point:
   * the fast line is not reliably the dangerous one and is not reliably the
   * safe one either.
   */
  measuredOn: LineMode;

  /** The two weighted components, each 0-1. */
  slip: number;
  clearance: number;

  /**
   * Reported, never weighted. See the header for why each was demoted: both are
   * measures of the SEARCH. They are kept because the gap between "hard for the
   * solver" and "hard for a person" is worth being able to see.
   */
  nudge: number;
  effort: number;
  lethality: number;

  /** The raw measurements the components come from. */
  line: LineStats;
  humanSlip: HumanSlip;
  tolerance: Tolerance;
  expansionsPerMetre: number;
  deathsPerExpansion: number;
  routeMetres: number;
}

/**
 * The composite, and there are only two terms in it because only two terms
 * survived the question "is this a property of the level".
 *
 * Slip leads because it is the direct measure of what the line demands of a
 * pair of hands. Clearance is the other half and it is not a proxy for slip —
 * 21-rollers is roomy and slippery, 17-backswing is tight and forgiving — which
 * is exactly why two terms rather than one.
 */
export const WEIGHTS = { slip: 0.65, clearance: 0.35 };

/**
 * Normalisation constants, calibrated against the hand-authored levels in this
 * repo so that the set spans most of 0-100 rather than bunching. They are
 * presentation, not measurement: the raw numbers above are the finding, and
 * re-scaling these does not change which level is harder than which.
 */
export const SCALE = {
  /** Head clearance at or above this scores zero on the clearance axis. */
  roomyClearance: 0.7,
  /**
   * The slip window, and it is deliberately NOT calibrated off this level set.
   *
   * Calibrating a scale against the twenty-six levels you then score with it is
   * circular — add a twenty-seventh harder level and every existing score
   * silently moves — so the two ends are chosen on the meaning of the number
   * instead. The floor is zero: a level where no human-sized fumble kills you is
   * asking nothing of your hands, and that is the honest bottom. The ceiling is
   * a half: a line where a fumble kills you every other attempt is as punishing
   * as this axis needs to distinguish, and everything past it is the same
   * verdict. So `slip 1.00` reads as "a fumble here kills you at least half the
   * time", which is a sentence, and the composite does not move when the set
   * grows.
   */
  slipFloor: 0,
  slipCeil: 0.5,
  /** Diagnostics only, kept so the reported numbers stay on a 0-1 scale. */
  effortFloor: 2,
  effortCeil: 2000,
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
 * A DIAGNOSTIC since scoreRev 2, not the score. One frame is 7.8 ms, chosen to
 * sit below human timing resolution so that the number would be about how
 * narrow the corridor is rather than about how good anybody's hands are — and
 * that is exactly why it turned out not to discriminate. Across this set it
 * runs 0.00 to 0.20 with most levels under 0.05. `measureHumanSlip` asks the
 * same question with an error a person really makes and spans 24-56% over the
 * same levels.
 *
 * It is kept because the RATIO of the two is informative: a level where a
 * one-frame nudge already kills is asking for frame-accuracy, and a level where
 * only the human-sized error kills is asking for consistency. Those are
 * different levels and only this number separates them.
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

/** One candidate line, and which run it came from. */
export interface Line {
  mode: LineMode;
  masks: readonly number[];
}

export function scoreDifficulty(args: {
  level: Level;
  spec: BikeSpec;
  /**
   * The lines to choose between. The MOST FORGIVING of them is scored and named
   * in `measuredOn`; see the header for why that is the right minimum and for
   * the level that proved the obvious alternative wrong.
   *
   * Ties and a single candidate both resolve to the first entry, so passing one
   * line is exactly "score this line".
   */
  lines: readonly Line[];
  /**
   * Search totals for the DIAGNOSTIC axes only.
   *
   * These must come from the cheap satisficing gate even when the line being
   * scored is the optimiser's, because expansions-per-metre measured on an
   * optimising run reports how long the optimiser was given. They are not in
   * the composite either way; scoring them on a fixed pass is what keeps them
   * comparable between levels.
   */
  expansions: number;
  deaths: number;
  routeMetres: number;
  /** One-frame nudge trials, the `nudge` diagnostic. */
  trials?: number;
  /** Human-sized fumble trials, the `slip` axis. */
  slipTrials?: number;
  /** Timing error per boundary, input frames. 4 is 31 ms. */
  slipSigmaFrames?: number;
  seed?: number;
  /** Which physics. Defaults to SIM_REV, the live rev. */
  rev?: number;
}): Difficulty {
  const rev = args.rev ?? SIM_REV;
  const seed = args.seed;
  if (args.lines.length === 0) throw new Error('scoreDifficulty needs at least one line to score');
  const slipOpts = {
    trials: args.slipTrials ?? 100,
    sigmaFrames: args.slipSigmaFrames ?? 4,
    seed,
    rev,
  };
  // THE MOST FORGIVING LINE WINS. Every candidate is ridden badly and the one a
  // fumble kills you least often on is the one the composite describes — see
  // the header. Strictly less than, so a tie keeps the first candidate and the
  // one-line case costs exactly one slip test.
  //
  // The slip numbers are sampled — a hundred trials is a standard error of
  // about five points — so a min over two candidates is biased a couple of
  // points low. `slipTrials` is the knob if that matters more than the seconds.
  let chosen = 0;
  const slips = args.lines.map((l) => measureHumanSlip(args.level, args.spec, l.masks, slipOpts));
  for (let i = 1; i < slips.length; i++) if (slips[i].lethal < slips[chosen].lethal) chosen = i;
  const masks = args.lines[chosen].masks;
  const measuredOn = args.lines[chosen].mode;
  const humanSlip = slips[chosen];
  const line = measureLine(args.level, args.spec, masks, rev);
  const tolerance = measureTolerance(args.level, args.spec, masks, args.trials ?? 200, seed, undefined, rev);
  const metres = args.routeMetres > 1 ? args.routeMetres : 1;
  const epm = args.expansions / metres;
  const dpe = args.expansions > 0 ? args.deaths / args.expansions : 0;

  const slip = clamp01((humanSlip.lethal - SCALE.slipFloor) / (SCALE.slipCeil - SCALE.slipFloor));
  const clearance = clamp01(1 - line.minHeadClearance / SCALE.roomyClearance);
  const effort = clamp01(
    Math.log(Math.max(epm, SCALE.effortFloor) / SCALE.effortFloor) / Math.log(SCALE.effortCeil / SCALE.effortFloor),
  );
  const lethality = clamp01(dpe / SCALE.lethalCeil);
  const score = 100 * (WEIGHTS.slip * slip + WEIGHTS.clearance * clearance);

  return {
    score, scoreRev: SCORE_REV, measuredOn,
    slip, clearance,
    nudge: clamp01(tolerance.lethal), effort, lethality,
    line, humanSlip, tolerance,
    expansionsPerMetre: epm, deathsPerExpansion: dpe, routeMetres: metres,
  };
}
