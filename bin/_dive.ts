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
import { FEATURES } from './_air.ts';
import { createSim } from '../src/sim/sim.ts';
import type { BikeSpec } from '../src/sim/spec.ts';
import { IN_BRAKE, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '../src/sim/consts.ts';

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
  /** Seconds to reach 30 degrees nose-down, or -1 if it never does. */
  to30: number;
  /** Peak pitch RATE within the window, deg/s. */
  peakRate: number;
  /** True if it went past 90 degrees within the window — i.e. over the bars. */
  wentOver: boolean;
  grounded: boolean;
  died: boolean;
}

/** The fixed sample times, seconds. */
export const SAMPLES = [0.05, 0.1, 0.15, 0.2, 0.3];

/**
 * Run up on flat ground to `speed`, hold it level, then apply `mask` and watch
 * the chassis for `holdSeconds`. Attitude keeping is switched OFF the moment
 * the input lands: the whole question is what the bike does on its own.
 */
export function pitchUnder(
  spec: BikeSpec,
  mask: number,
  opts: { speed?: number; holdSeconds?: number; airborne?: boolean } = {},
): DiveResult {
  const speed = opts.speed ?? 9;
  const hold = Math.round((opts.holdSeconds ?? 0.4) * 128);
  const sim = createSim(FEATURES.drop, spec);

  // Settle, then run up to speed holding the chassis level.
  for (let f = 0; f < 192; f++) sim.advance(0);
  for (let f = 0; f < 128 * 20; f++) {
    const s = sim.state;
    const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
    if (v >= speed && s.grounded === 3 && Math.abs(s.oy) < 0.02 && Math.abs(s.w) < 0.2) break;
    if (s.px > 26) break;
    let m = v < speed ? IN_THROTTLE : 0;
    const err = s.oy + s.w * 0.18;
    if (err > 0.02) m |= IN_LEAN_R;
    else if (err < -0.02) m |= IN_LEAN_L;
    sim.advance(m);
  }

  if (opts.airborne) {
    // Off the 1.2 m step at x = 30 and then measured in free fall, so the only
    // torque acting is the one the input itself produces.
    while (sim.state.px < 31.5 && !sim.state.dead) {
      const s = sim.state;
      const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
      sim.advance(v < speed ? IN_THROTTLE : 0);
    }
  }

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
