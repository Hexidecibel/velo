// Measure chassis pitch under braking and under throttle — the stoppie and the
// wheelie — so that "braking should slam the front end down" is a number.
//
// Two cases, kept apart because they are two different mechanisms and only one
// of them is what the report was about:
//
//   GROUNDED   rear wheel in contact, steady speed, then full brake. The rider's
//              mass keeps going forward while the pivot decelerates, and that is
//              where a stoppie comes from. This is the number to judge.
//   AIRBORNE   the same brake input with no contact at all. Braking a spinning
//              wheel puts reaction torque on the chassis and pitches it. A real
//              technique, unrelated to weight transfer, and deliberately NOT
//              suppressed — it is reported separately so the two are visibly
//              distinguishable rather than conflated.
//
// EVERY ROW IS A MEAN OVER SEVERAL ENTRIES, and that is not polish — it is what
// makes the rig an instrument. The run-up cannot be brought to rest: the
// throttle and the level-hold are both bang-bang controllers with large
// authority, so a bike cruising on dead-flat ground sits in a LIMIT CYCLE
// rather than at a fixed point, oscillating a degree or two of pitch. Take one
// entry and you have measured the phase of that cycle as much as the input, and
// that is precisely the failure the old rig had: rows that were not monotone in
// the coefficient being swept, which no physics can produce. Sampling `ENTRIES`
// starts spread across more than one period and averaging them removes the
// phase and leaves the input. The spread is reported too — a row whose spread
// rivals its mean is still not telling you anything.
import { parseLevel } from '../src/sim/level.ts';
import { getEngine, SIM_REV } from '../src/sim/rev.ts';
import type { Sim } from '../src/sim/sim.ts';
import type { BikeSpec } from '../src/sim/spec.ts';
import { IN_BRAKE, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '../src/sim/consts.ts';

/**
 * The rig's own level, and it has to be its own.
 *
 * This borrowed `FEATURES.drop` from bin/air until SIM_REV 4, and that was a
 * silent bug rather than a shortcut: that rig's flat section ends at x = 30, so
 * the run-up below NEVER satisfied its settle condition and every measurement
 * started from the `px` bail-out instead — at whatever attitude and whatever
 * point in the suspension's oscillation the bike happened to be in when it ran
 * out of runway. Entry speed was right to within 0.3 m/s, which is why it read
 * as a working instrument, but the entry ATTITUDE was arbitrary, and pitch
 * measured relative to an arbitrary attitude is noise. It showed up as rows
 * that were not monotone in the coefficient being swept, which no amount of
 * physics could have produced.
 *
 * So: 140 m of flat, which is enough for a soft bike to reach 9 m/s AND stop
 * ringing on its springs, and a step at the end for the airborne case. Numbers
 * measured before rev 4 were taken on the old rig and do not reproduce here.
 */
const CEILING = 14;
const END = 160;
/** Where the flat ends and the step down begins — the airborne case's launch. */
const STEP_X = 140;
const RIG = parseLevel({
  format: 'velo-level',
  name: 'dive rig',
  start: { x: 2, y: 1 },
  flower: { x: END - 2, y: 1 },
  apples: [],
  polygons: [{
    kind: 'cave',
    points: [[0, 0], [STEP_X, 0], [STEP_X, -1.2], [END, -1.2], [END, CEILING], [0, CEILING]],
  }],
});

/** Chassis pitch in degrees. Renderer-grade trig; bin/ is not under src/sim. */
function pitchDeg(ox: number, oy: number): number {
  return (Math.atan2(oy, ox) * 180) / Math.PI;
}

export interface DiveResult {
  /** Speed at the moment the input was applied. */
  entry: number;
  /**
   * Pitch at fixed sample times, degrees, negative = nose down.
   *
   * Samples rather than a peak, because a peak is useless here: hold full brake
   * at 9 m/s and the bike eventually goes all the way over, at every setting,
   * so "peak pitch" measures the somersault and not the dive. What a player
   * feels is the first fifth of a second, and that is what these sample.
   */
  at: number[];
  /** Spread — max minus min across the entries — at the LAST sample time. */
  spread: number;
  /** Seconds to reach 30 degrees nose-down, or -1 if it never does. */
  to30: number;
  /** Peak pitch RATE within the window, deg/s. */
  peakRate: number;
  /** True if it went past 90 degrees within the window — i.e. over the bars. */
  wentOver: boolean;
  grounded: boolean;
  died: boolean;
  /**
   * Whether the run-up reached the target speed. False means the bike ran out
   * of runway first and the row is not a measurement — print it, do not trust
   * it.
   */
  upToSpeed: boolean;
  /** How many entries the mean is over. */
  entries: number;
}

/**
 * Entries per measurement, and frames between them. 8 x 5 spans 40 frames =
 * 0.31 s, comfortably more than one period of the run-up's limit cycle.
 */
const ENTRIES = 8;
const ENTRY_GAP = 5;

/** The fixed sample times, seconds. */
export const SAMPLES = [0.05, 0.1, 0.15, 0.2, 0.3];

/**
 * Run up on flat ground to `speed`, hold it level, then apply `mask` from
 * `ENTRIES` successive points of the run-up and average what the chassis does
 * over `holdSeconds`. Attitude keeping is switched OFF the moment the input
 * lands: the whole question is what the bike does on its own.
 *
 * Snapshot/restore is what makes the averaging cheap, and it is there because
 * the sim was designed snapshot/restore-able for the solver. This is the first
 * thing other than a test to use it.
 */
export function pitchUnder(
  spec: BikeSpec,
  mask: number,
  opts: { speed?: number; holdSeconds?: number; airborne?: boolean; rev?: number } = {},
): DiveResult {
  const speed = opts.speed ?? 9;
  const hold = Math.round((opts.holdSeconds ?? 0.4) * 128);
  // RIG is hand-built above and contains no arcs, so every rev's loader
  // compiles it identically; only the ENGINE needs choosing.
  const sim = getEngine(opts.rev ?? SIM_REV).createSim(RIG, spec);

  // Settle on the springs, then run up to speed holding the chassis level.
  for (let f = 0; f < 192; f++) sim.advance(0);
  let upToSpeed = false;
  for (let f = 0; f < 128 * 60; f++) {
    const s = sim.state;
    const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
    if (v >= speed && s.grounded === 3) {
      upToSpeed = true;
      break;
    }
    if (s.px > STEP_X - 40) break;
    sim.advance(cruise(sim.state, speed));
  }

  if (opts.airborne) {
    // Off the 1.2 m step and then measured in free fall, so the only torque
    // acting is the one the input itself produces. No averaging is possible
    // here — there is exactly one launch — so the entry count is 1 and the
    // spread is 0 by construction.
    while (sim.state.px < STEP_X + 1.5 && !sim.state.dead) {
      sim.advance(cruise(sim.state, speed));
    }
    const one = hold_(sim, mask, hold);
    return {
      entry: one.entry, at: one.at, spread: 0, to30: one.to30, peakRate: one.peakRate,
      wentOver: one.wentOver, grounded: one.grounded, died: one.died, upToSpeed, entries: 1,
    };
  }

  const runs: Hold[] = [];
  for (let i = 0; i < ENTRIES; i++) {
    if (i > 0) for (let f = 0; f < ENTRY_GAP; f++) sim.advance(cruise(sim.state, speed));
    const save = sim.snapshot();
    runs.push(hold_(sim, mask, hold));
    sim.restore(save);
  }

  const mean = (pick: (r: Hold) => number): number => runs.reduce((a, r) => a + pick(r), 0) / runs.length;
  const last = SAMPLES.length - 1;
  const lastVals = runs.map((r) => r.at[last]);
  const reached = runs.filter((r) => r.to30 >= 0);
  return {
    entry: mean((r) => r.entry),
    at: SAMPLES.map((_, i) => mean((r) => r.at[i])),
    spread: Math.max(...lastVals) - Math.min(...lastVals),
    // Averaged over the entries that got there at all; -1 if fewer than half did,
    // since "half the entries went over" is not a time to quote.
    to30: reached.length * 2 >= runs.length ? reached.reduce((a, r) => a + r.to30, 0) / reached.length : -1,
    peakRate: mean((r) => r.peakRate),
    wentOver: runs.filter((r) => r.wentOver).length * 2 >= runs.length,
    grounded: runs.every((r) => r.grounded),
    died: runs.some((r) => r.died),
    upToSpeed,
    entries: runs.length,
  };
}

/** The run-up policy: throttle under target, and hold the chassis level. */
function cruise(s: { vx: number; vy: number; oy: number; w: number }, speed: number): number {
  const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  let m = v < speed ? IN_THROTTLE : 0;
  const err = s.oy + s.w * 0.18;
  if (err > 0.02) m |= IN_LEAN_R;
  else if (err < -0.02) m |= IN_LEAN_L;
  return m;
}

interface Hold {
  entry: number;
  at: number[];
  to30: number;
  peakRate: number;
  wentOver: boolean;
  grounded: boolean;
  died: boolean;
}

/** One entry: apply `mask` for `hold` frames and watch the chassis. */
function hold_(sim: Sim, mask: number, hold: number): Hold {
  const st = sim.state;
  const entry = Math.sqrt(st.vx * st.vx + st.vy * st.vy);
  const base = pitchDeg(st.ox, st.oy);
  const grounded = st.grounded !== 0;
  const at = SAMPLES.map(() => 0);
  let to30 = -1;
  let peakRate = 0;
  let wentOver = false;

  for (let f = 0; f < hold; f++) {
    sim.advance(mask);
    const s = sim.state;
    const t = (f + 1) / 128;
    let d = pitchDeg(s.ox, s.oy) - base;
    // Unwrap once: a full flip is not a bigger dive.
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    for (let i = 0; i < SAMPLES.length; i++) if (t <= SAMPLES[i] + 1 / 256) at[i] = d;
    if (to30 < 0 && d <= -30) to30 = t;
    if (Math.abs(d) > 90) wentOver = true;
    if (!wentOver) {
      const rate = (s.w * 180) / Math.PI;
      if (Math.abs(rate) > Math.abs(peakRate)) peakRate = rate;
    }
    if (s.dead) break;
  }
  return { entry, at, to30, peakRate, wentOver, grounded, died: sim.state.dead };
}

export const BRAKE = IN_BRAKE;
export const THROTTLE = IN_THROTTLE;

// --- the standstill launch ---------------------------------------------------

/**
 * Full throttle from a dead stop: how fast does the front come up, and how far?
 *
 * THIS IS THE ROW THAT DISCRIMINATES THE DRIVE HALF, and the grounded-throttle
 * row above is not. At 9 m/s the drive torque has already tapered against
 * `maxWheelSpin`, so by the time the input lands there is very little torque
 * left to react onto the chassis and every value of `inertialTransferDrive`
 * reads within noise of every other. From rest the wheel is stopped, the torque
 * is at its peak, and the coefficient is the only thing deciding whether the
 * front comes up — which is exactly the question `inertialTransferDrive` exists
 * to answer, and it had to be produced by hand until now.
 *
 * It also measures the thing that actually matters to a player: the wheelie
 * threshold is a torque balance, so it moves with `drive.maxTorque` as well.
 * The two are a PAIR and this is the only row that shows them as one.
 *
 * NO AVERAGING, and that is not an omission. The grounded rows average eight
 * entries because a bike cruising on flat ground sits in a limit cycle and one
 * sample measures its phase; a bike that has settled at REST has no cycle to be
 * in. There is exactly one standstill and this measures it, so `entries` is 1
 * and `spread` is 0 by construction — the same convention the airborne case
 * already uses.
 */
export function launchFromRest(spec: BikeSpec, opts: { holdSeconds?: number; rev?: number } = {}): DiveResult {
  const hold = Math.round((opts.holdSeconds ?? 1.2) * 128);
  const sim = getEngine(opts.rev ?? SIM_REV).createSim(RIG, spec);
  // Long enough for a soft spring to stop ringing. Launching off a bike still
  // moving on its suspension measures the spring's phase, which is the same
  // mistake the grounded rows average away.
  for (let f = 0; f < 384; f++) sim.advance(0);

  const st = sim.state;
  const base = pitchDeg(st.ox, st.oy);
  const at = SAMPLES.map(() => 0);
  let to30 = -1;
  let peakRate = 0;
  let wentOver = false;
  let died = false;

  for (let f = 0; f < hold; f++) {
    sim.advance(IN_THROTTLE);
    const s = sim.state;
    const t = (f + 1) / 128;
    let d = pitchDeg(s.ox, s.oy) - base;
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    for (let i = 0; i < SAMPLES.length; i++) if (t <= SAMPLES[i] + 1 / 256) at[i] = d;
    // POSITIVE is nose-up here, which is the opposite sign from the brake rows
    // and is why `to30` is a different comparison rather than a shared helper.
    if (to30 < 0 && d >= 30) to30 = t;
    if (Math.abs(d) > 90) wentOver = true;
    if (!wentOver) {
      const rate = (s.w * 180) / Math.PI;
      if (Math.abs(rate) > Math.abs(peakRate)) peakRate = rate;
    }
    if (s.dead) {
      died = true;
      break;
    }
  }
  return {
    entry: 0, at, spread: 0, to30, peakRate, wentOver,
    grounded: true, died, upToSpeed: true, entries: 1,
  };
}

/**
 * Seconds of full throttle from rest before the nose reaches 30 degrees up, or
 * -1 if it never does within the window. The one number `--sweep-drive` moves.
 */
export function timeToWheelie(spec: BikeSpec, holdSeconds = 1.2, rev?: number): number {
  return launchFromRest(spec, { holdSeconds, rev }).to30;
}
