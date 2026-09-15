// Measure how much air the bike gets off a feature, in metres, at a stated
// speed — so that "more air" is a number and not an adjective.
//
// The test rig is built HERE rather than in levels/, deliberately: it is an
// instrument, not a level. It has one feature at a known place with known
// dimensions, flat ground either side, and a fixed scripted input stream, so
// the only thing that differs between two runs is the bike.
//
// Three features, because they exercise different halves of the suspension:
//
//   kicker  a 2 m ramp to a 0.35 m lip with a clean edge. Mostly geometry: you
//           leave at the ramp angle. Sensitive to rebound only insofar as the
//           spring is still extending as you leave.
//   bump    a 2 m wide, 0.2 m triangular bump. This is "hitting stuff" — the
//           suspension compresses on the way up and the REBOUND STROKE is what
//           throws you off the back. This is the one the rebound coefficient
//           actually moves.
//   drop    a 1.2 m step down onto flat, and `bigdrop` the same at 3.5 m. Nothing to do with launching; it is
//           the landing half, and it is where you find out whether the change
//           made landings worse and whether the hard deflection clamp is being
//           hit on an ordinary landing.
import { parseLevel } from '../src/sim/level.ts';
import type { Level } from '../src/sim/level.ts';
import { createSim } from '../src/sim/sim.ts';
import type { BikeSpec } from '../src/sim/spec.ts';
import { cloneSpec } from '../src/sim/spec.ts';
import { IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '../src/sim/consts.ts';
import { rotX, rotY } from '../src/sim/rot.ts';

const CEILING = 14;
const END = 70;

function cave(floor: [number, number][]): Level {
  return parseLevel({
    format: 'velo-level',
    name: 'air rig',
    start: { x: 2, y: 1 },
    flower: { x: END - 2, y: 1 },
    apples: [],
    polygons: [{ kind: 'cave', points: [...floor, [END, CEILING], [0, CEILING]] }],
  });
}

export type FeatureName = 'kicker' | 'bump' | 'drop' | 'bigdrop';

/** Feature at x = 30 in every case, so the run-up is always the same. */
export const FEATURES: Record<FeatureName, Level> = {
  kicker: cave([[0, 0], [28, 0], [30, 0.35], [30, 0], [END, 0]]),
  bump: cave([[0, 0], [28, 0], [29, 0.2], [30, 0], [END, 0]]),
  drop: cave([[0, 0], [30, 0], [30, -1.2], [END, -1.2]]),
  // Deliberately past what a level would normally ask for: this is the one that
  // answers "does an ordinary landing reach the hard deflection clamp, and how
  // big does the landing have to be before it does".
  bigdrop: cave([[0, 0], [30, 0], [30, -3.5], [END, -3.5]]),
};

export interface AirResult {
  /** Speed as the bike reaches the throttle-release point. */
  approach: number;
  /** Peak chassis height above its own resting height on flat ground. */
  peak: number;
  /** Seconds with neither wheel touching, longest single stretch. */
  airtime: number;
  /** Peak suspension deflection, and whether the hard clamp was reached. */
  maxDeflect: number;
  bottomedFrames: number;
  /** Landing: worst downward speed at touchdown, and time to settle after it. */
  landingVy: number;
  settleSeconds: number;
  /** Where the run ended up, as a sanity check that it went over the feature. */
  endX: number;
  died: boolean;
}

/**
 * One measured pass.
 *
 * The rider policy is the minimum a person does without thinking: hold the
 * chassis level with the lean keys, and throttle only while under the target
 * approach speed, letting go entirely a metre before the feature. Two reasons
 * it has to be this and not "hold gas":
 *
 *   * holding gas from a standstill loops every soft bike on this list, so the
 *     measurement would be of a backflip rather than of a jump;
 *   * approach speed has to be the SAME for every bike or the comparison is
 *     between run-ups, not between suspensions. Capping at a target speed makes
 *     the approach a constant and the suspension the only variable.
 *
 * Attitude control stays on in the air. It changes no linear momentum — that is
 * the whole point of `attitudeTorque` — so peak height and airtime are
 * untouched, and it stops the bike dying on its head before it can land.
 */
export function measure(
  level: Level,
  spec: BikeSpec,
  opts: { releaseX?: number; seconds?: number; targetSpeed?: number } = {},
): AirResult {
  const releaseX = opts.releaseX ?? 29;
  const target = opts.targetSpeed ?? 9;
  const frames = Math.round((opts.seconds ?? 16) * 128);
  const sim = createSim(level, spec);
  const md = sim.world.spec.suspension.maxDeflection;

  // Settle on the suspension first: measuring "height above rest" needs a rest.
  for (let f = 0; f < 192; f++) sim.advance(0);
  const restY = sim.state.py;

  let approach = 0;
  let peak = 0;
  let air = 0;
  let bestAir = 0;
  let maxDeflect = 0;
  let bottomed = 0;
  let landingVy = 0;
  let landedAt = -1;
  let settleAt = -1;
  let measuredApproach = false;
  let past = false;

  for (let f = 0; f < frames; f++) {
    const s = sim.state;
    const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
    let mask = s.px < releaseX && speed < target ? IN_THROTTLE : 0;
    // Hold the chassis level. Proportional on attitude plus a rate term, the
    // same shape bin/_pilot.ts uses and for the same reason: without the rate
    // term the correction is always late and the attitude torque overshoots.
    const err = s.oy + s.w * 0.18;
    if (err > 0.03) mask |= IN_LEAN_R;
    else if (err < -0.03) mask |= IN_LEAN_L;
    sim.advance(mask);
    const t = sim.state;

    if (!measuredApproach && t.px >= releaseX) {
      approach = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
      measuredApproach = true;
    }
    if (t.px >= 30) past = true;

    for (let i = 0; i < 2; i++) {
      const a = sim.world.spec.wheel.anchors[i];
      const rx = rotX({ x: t.ox, y: t.oy }, a.x, a.y);
      const ry = rotY({ x: t.ox, y: t.oy }, a.x, a.y);
      const dx = t.px + rx - t.wx[i];
      const dy = t.py + ry - t.wy[i];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > maxDeflect) maxDeflect = len;
      if (len >= md - 1e-9) bottomed++;
    }

    if (past) {
      const h = t.py - restY;
      if (h > peak) peak = h;
      if (t.grounded === 0) {
        air++;
        if (air > bestAir) bestAir = air;
      } else {
        if (air > 8 && landedAt < 0) {
          // Touchdown after a real flight, not a wheel skimming a crest.
          landedAt = f;
          landingVy = t.vy;
        }
        air = 0;
      }
      // Settled = both wheels down and the chassis no longer moving vertically.
      if (landedAt >= 0 && settleAt < 0 && f > landedAt + 4 && t.grounded === 3 && Math.abs(t.vy) < 0.15) {
        settleAt = f;
      }
    }
    if (t.dead || t.finished) break;
  }

  return {
    approach,
    peak,
    airtime: bestAir / 128,
    maxDeflect,
    bottomedFrames: bottomed,
    landingVy,
    settleSeconds: landedAt >= 0 && settleAt >= 0 ? (settleAt - landedAt) / 128 : -1,
    endX: sim.state.px,
    died: sim.state.dead,
  };
}

/** The same bike with one suspension coefficient replaced. */
export function withRebound(spec: BikeSpec, rebound: number): BikeSpec {
  const s = cloneSpec(spec);
  s.suspension.reboundDamping = rebound;
  return s;
}

export function withCompression(spec: BikeSpec, compression: number): BikeSpec {
  const s = cloneSpec(spec);
  s.suspension.compressionDamping = compression;
  return s;
}
