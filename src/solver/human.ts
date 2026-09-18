// A rider who is not frame-perfect.
//
// The solver is, and that is the problem this file exists for. Difficulty is
// currently scored from what the SEARCH experienced, and the search experiences
// a level the way nothing that will ever play it does: it can change a held
// input after two frames, it can hit a sixteen-millisecond take-off window on
// the first attempt, and it never misses. A level whose only line runs through
// windows that tight scores as ordinary by every measure in difficulty.ts,
// because for the searcher it WAS ordinary.
//
// So: the same search, with the rider's hands.
//
//   RATE LIMIT. The macro alphabet's short end goes. DURATIONS starts at two
//   frames — 16 ms — and the README is explicit that this is load-bearing: with
//   a three-frame floor the search cannot clear 13-reservoir's first pit. That
//   is precisely the finding restated. A line that needs a 16 ms hold is a line
//   a person does not have, and a baseline that can use one is not a baseline
//   for a person.
//
//   A GRID, NOT JUST A FLOOR. Every duration here is a multiple of the floor,
//   so every boundary between two held inputs lands on a multiple of 62.5 ms
//   counted from the start of the run. A floor alone would still let the search
//   place a transition at any offset it liked and then need it to that
//   accuracy; the grid is what makes "no sub-30 ms window" true of the TIMING
//   and not only of the duration.
//
//   EXECUTION ERROR. The run it finds is then ridden badly on purpose:
//   `measureHumanSlip` jitters every input boundary by a draw from a human-
//   sized timing distribution and asks how often the level still gets
//   finished. That number is what a difficulty score should be calibrated
//   against — not "how hard was this to find" but "how often does somebody who
//   knows the line actually get down it".
//
// WHAT THIS IS NOT. It is not a model of a player. Nothing here reads a level,
// learns it, chooses a route the way a person would, or gets better with
// practice; it is the same best-first search wearing a constraint. The claim is
// only that its constraint is one a person really has and the solver's default
// really does not, which is enough to make it a fairer yardstick than a
// frame-perfect run.
import { getEngine, SIM_REV } from '@/sim/rev.ts';
import type { Level } from '@/sim/level.ts';
import type { BikeSpec } from '@/sim/spec.ts';

/**
 * Input frames a held mask may last, for a rider with hands.
 *
 * 62.5, 125, 250 and 500 ms, every one a multiple of 62.5 ms, so a boundary
 * between two held inputs can only ever land on that grid. The floor is about
 * the shortest press somebody makes on purpose and the grid is twice the
 * 30 ms the brief asks for.
 *
 * THE FLOOR WAS 94 ms AND THAT WAS TOO COARSE, which is the more useful finding
 * than the number that replaced it: at a twelve-frame floor the search cannot
 * complete the repo's own test level at all, in ninety seconds, and a baseline
 * that reports a level uncompletable because of its own alphabet is reporting
 * on itself. At eight it completes it in seven seconds. There is a real wall
 * somewhere between the two and this sits below it on purpose — the point of
 * the mode is to be a fair yardstick, and a yardstick that fails everything is
 * not one.
 *
 * Nested, so one rollout of the longest still emits all four.
 */
export const HUMAN_DURATIONS: readonly number[] = [8, 16, 32, 64];

export const HUMAN_GRID = 4;

export interface HumanSlip {
  /** Jitter trials actually run. */
  trials: number;
  /**
   * Fraction of bursts that KILL inside the horizon. This is the measure.
   */
  lethal: number;
  /** Fraction where the whole run still finished. Reported, not weighted. */
  finished: number;
  /** Standard deviation of the per-boundary timing error, input frames. */
  sigmaFrames: number;
  /** Consecutive input boundaries a single burst of error covers. */
  burst: number;
  /** Input frames after the burst within which a death still counts as caused by it. */
  horizon: number;
}

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

/** Box-Muller, on a seeded uniform, so a slip number is reproducible. */
function gauss(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/**
 * Ride a stretch of the found line badly, many times, and count how often that
 * kills.
 *
 * THE OBVIOUS VERSION OF THIS IS WRONG AND WAS BUILT FIRST. "Jitter every
 * boundary by a human-sized error and see how often the run still finishes"
 * sounds like exactly the question and it is not a measure of the level at all:
 * on test02-bowl, a twelve-second line, it returned 0 of 100 — and it would
 * return 0 of 100 on a level with no hazard in it whatsoever, because a
 * thousand-frame stream with an error on every boundary has diverged into a
 * different run long before the end. It measures stream length. difficulty.ts's
 * header makes the same argument about the same trap; this file walked into it
 * anyway and the saturated number is what caught it.
 *
 * So the error is LOCAL and so is the verdict. One trial picks a boundary,
 * fumbles it and the few after it — about a second of a rider being slightly
 * off, which is what being slightly off actually looks like — and asks whether
 * the bike is dead within a second and a half of the fumble. That is local,
 * comparable between a fourteen-second level and a fifty-second one, and it is
 * what a player feels: on a hard level a fumble kills you, on an easy one you
 * come up short and go round again.
 *
 * What it does NOT share with difficulty.ts's `measureTolerance` is the size of
 * the error. That one nudges a single boundary by a single frame — 7.8 ms,
 * deliberately below the floor of human timing — because it is asking how
 * narrow the corridor is. This one uses an error a person really makes, on a
 * burst of inputs rather than one, because it is asking whether a person gets
 * down it. A level can be wide by the first measure and lethal by this one.
 */
export function measureHumanSlip(
  level: Level,
  spec: BikeSpec,
  masks: readonly number[],
  opts: { trials?: number; sigmaFrames?: number; seed?: number; rev?: number; burst?: number; horizon?: number } = {},
): HumanSlip {
  const trials = opts.trials ?? 100;
  // 31 ms. Keypress timing standard deviations in the 20-40 ms range are what
  // the motor-timing literature reports for a practised, self-paced action, and
  // this is the middle of that. It is a choice and it is reported alongside the
  // number so the number can be read against it.
  const sigma = opts.sigmaFrames ?? 4;
  const burst = opts.burst ?? 4;
  const horizon = opts.horizon ?? 192;
  const rev = opts.rev ?? SIM_REV;
  const empty: HumanSlip = { trials: 0, lethal: 0, finished: 0, sigmaFrames: sigma, burst, horizon };
  if (masks.length === 0 || trials <= 0) return empty;

  const runs: { mask: number; len: number }[] = [];
  const startOf: number[] = [];
  let at = 0;
  for (const m of masks) {
    const last = runs[runs.length - 1];
    if (last && last.mask === m) last.len++;
    else { runs.push({ mask: m, len: 1 }); startOf.push(at); }
    at++;
  }
  if (runs.length === 0) return empty;

  const rnd = mulberry32(opts.seed ?? 0x5e1f);
  const engine = getEngine(rev);
  let lethal = 0;
  let fin = 0;
  for (let t = 0; t < trials; t++) {
    const i = (rnd() * runs.length) | 0;
    const out: number[] = [];
    let burstEnd = 0;
    for (let k = 0; k < runs.length; k++) {
      const jitter = k >= i && k < i + burst ? Math.round(gauss(rnd) * sigma) : 0;
      let n = runs[k].len + jitter;
      if (n < 1) n = 1;
      for (let j = 0; j < n; j++) out.push(runs[k].mask);
      if (k < i + burst) burstEnd = out.length;
    }
    // Past the horizon the run has diverged for reasons that are about chaos
    // rather than about the fumble, and counting those would be counting stream
    // length again.
    const until = burstEnd + horizon;
    const sim = engine.createSim(level, spec);
    let died = false;
    for (let f = 0; f < out.length; f++) {
      sim.advance(out[f]);
      if (sim.state.dead) { died = f <= until; break; }
      if (sim.state.finished) break;
    }
    if (died) lethal++;
    if (sim.state.finished) fin++;
  }
  return { trials, lethal: lethal / trials, finished: fin / trials, sigmaFrames: sigma, burst, horizon };
}
