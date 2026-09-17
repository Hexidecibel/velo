// The hook rig: can a wheel catch on a thin obstacle and hang there, and does
// the bike visibly stretch when it does?
//
// The rig is built HERE rather than in levels/, for the same reason bin/_air.ts
// builds its own: it is an INSTRUMENT, not a level. One feature at a known
// place, flat approach, a scripted input stream, so the only thing that differs
// between two runs is the thing being varied.
//
// WHAT IS BEING ASKED. The user's idea, recalling Elasto Mania: "hooking one
// tire over a thing and sliding — in Elastomania it would stretch your bike
// out." Geometry already said this is possible (see the pitch/clearance table
// in the plan). Geometry is not dynamics. A wheel is a CIRCLE against polygon
// edges and a circle has no concavity, so nothing about it "hooks" in the way a
// grappling shape would. The only things that can hold it are:
//
//   * support from BELOW, because the suspension is a zero-rest-length spring
//     that pulls the wheel toward its chassis anchor — so a bike hanging under
//     a wheel pulls that wheel DOWN onto whatever it is resting on; and
//   * friction against sliding off, coefficient 1.4 at the contact patch.
//
// That makes the honest question "can the bike hang, as a pendulum, from a
// wheel resting on the tip of a ledge" — and the tip is what makes it a hook
// rather than a park, because the body has to swing PAST the tip into free air.
//
// The measurements are deflection (the stretch), how long contact survives, and
// how far below the tip the bike's lowest apple-collecting point reaches, which
// is the whole design question for "apples underneath the poles".
import { parseLevel } from '../src/sim/level.ts';
import type { Level, RawPolygon } from '../src/sim/level.ts';
import { createSim } from '../src/sim/sim.ts';
import type { Sim } from '../src/sim/sim.ts';
import type { BikeSpec } from '../src/sim/spec.ts';
import { rotX, rotY } from '../src/sim/rot.ts';
import { IN_THROTTLE, PICKUP_RADIUS, TICKS_PER_FRAME } from '../src/sim/consts.ts';

/** The chamber every rig feature floats in. Big enough that walls never matter. */
const ROOM = { x0: -60, x1: 60, y0: -30, y1: 30 };

function chamber(extra: RawPolygon[]): Level {
  return parseLevel({
    format: 'velo-level',
    name: 'hook rig',
    start: { x: -50, y: ROOM.y0 + 1 },
    flower: { x: 50, y: ROOM.y0 + 1 },
    apples: [],
    polygons: [
      {
        kind: 'cave',
        points: [
          [ROOM.x0, ROOM.y0],
          [ROOM.x1, ROOM.y0],
          [ROOM.x1, ROOM.y1],
          [ROOM.x0, ROOM.y1],
        ],
      },
      ...extra,
    ],
  });
}

export type LedgeShape = 'square' | 'tapered' | 'rounded' | 'spike';

/**
 * A ledge protruding rightward to a tip at x = 0, top surface at y = 0.
 *
 * The three tip shapes exist because "can a wheel hold on a thin obstacle" is
 * really "what does the contact normal do as the wheel rolls onto the corner",
 * and that is decided entirely by what the underside does:
 *
 *   square   a right-angled corner. The most catching shape available, and the
 *            control case.
 *   tapered  the underside rises to meet the top at the tip, so the tip is a
 *            wedge. Gives the hanging chassis clearance the square tip does not.
 *   rounded  the corner replaced by a quarter-ish fan of vertices. This is the
 *            pessimistic case — a rounded tip lets the contact normal rotate
 *            smoothly away from vertical as the wheel creeps over, which is the
 *            mechanism by which a hook would silently turn into a slide.
 */
export function ledge(shape: LedgeShape, thickness = 0.35, length = 14): RawPolygon {
  const x0 = -length;
  const b = -thickness;
  if (shape === 'square') {
    return { kind: 'ground', points: [[x0, 0], [0, 0], [0, b], [x0, b]] };
  }
  if (shape === 'tapered') {
    return { kind: 'ground', points: [[x0, 0], [0, 0], [-thickness * 1.8, b], [x0, b]] };
  }
  if (shape === 'spike') {
    // A long wedge tapering to the tip: the underside falls away from the
    // corner all the way back. Everything below and right of the tip is free
    // air, which is the only shape that gives the hanging FRAME room — see the
    // clearance arithmetic in bin/hook's header.
    return { kind: 'ground', points: [[x0, 0], [0, 0], [x0, -thickness]] };
  }
  const pts: [number, number][] = [[x0, 0]];
  const r = thickness * 0.5;
  // Quarter fan from the top surface round to the underside, centred at
  // (-r, -r). Eight segments is smooth at the 0.25 m wheel.
  for (let i = 0; i <= 8; i++) {
    const t = (i / 8) * (Math.PI / 2);
    pts.push([-r + r * Math.sin(t), -r + r * Math.cos(t)]);
  }
  pts.push([x0, b]);
  return { kind: 'ground', points: pts };
}

/**
 * A POLE: a slender mast standing up from below, tapering to a point at (0, 0).
 *
 * This is the shape the idea was actually described with — "apples underneath
 * the poles" — and it is also the shape the wedge test says should work, for a
 * reason worth writing down: a wheel is a circle, so it cannot hook anything,
 * but the CONTACT POINT on a sharp convex vertex is PINNED to that vertex,
 * whereas on a flat lip it slides along as the wheel rolls. A point is the only
 * thing a circle can hang on.
 */
export function pole(halfWidth = 0.1, height = 6, taper = 0.9): RawPolygon {
  return {
    kind: 'ground',
    points: [
      [0, 0],
      [halfWidth, -taper],
      [halfWidth, -height],
      [-halfWidth, -height],
      [-halfWidth, -taper],
    ],
  };
}

/** A free-floating rail: a thin beam with both ends open. The grind case. */
export function rail(length = 24, thickness = 0.35): RawPolygon {
  return { kind: 'ground', points: [[-length, 0], [0, 0], [0, -thickness], [-length, -thickness]] };
}

export interface Placement {
  /** Which wheel is hooked: 0 is the -x anchor, 1 is the +x anchor. */
  wheel: 0 | 1;
  /** Chassis rotation, degrees. -90 hangs the bike nose-down. */
  pitchDeg: number;
  /** Where the hooked wheel's CENTRE starts, world. */
  x: number;
  y: number;
  /** Initial velocity of the whole bike. */
  vx?: number;
  vy?: number;
  /**
   * Top surface of the feature, world y. Default 0, which is where every rig
   * shape puts it.
   *
   * It is a separate field from `y` and has to be: `y` is where the wheel
   * STARTS, and once a drop height is involved the two differ. Deriving the
   * hang test from the start height instead measured a bike sitting flat on the
   * deck as a two-metre hang, which is how a 0.3 % catch rate first looked like
   * a result.
   */
  topY?: number;
}

/**
 * Put the bike in a chosen attitude with one wheel at a chosen point.
 *
 * Writing the state directly is legitimate for an instrument and would not be
 * for anything that gets hashed or verified: nothing downstream of this is a
 * replay. It is what makes the STATICS question answerable on its own — "does a
 * hang hold" is a different question from "can you get into one", and mixing
 * them is how you end up unable to say which half failed.
 */
export function place(sim: Sim, p: Placement): void {
  const sp = sim.world.spec;
  const s = sim.state;
  const th = (p.pitchDeg * Math.PI) / 180;
  const rot = { x: Math.cos(th), y: Math.sin(th) };
  const a = sp.wheel.anchors[p.wheel];
  s.ox = rot.x;
  s.oy = rot.y;
  s.w = 0;
  s.px = p.x - rotX(rot, a.x, a.y);
  s.py = p.y - rotY(rot, a.x, a.y);
  s.vx = p.vx ?? 0;
  s.vy = p.vy ?? 0;
  for (let i = 0; i < 2; i++) {
    const an = sp.wheel.anchors[i];
    s.wx[i] = s.px + rotX(rot, an.x, an.y);
    s.wy[i] = s.py + rotY(rot, an.x, an.y);
    s.wvx[i] = s.vx;
    s.wvy[i] = s.vy;
    s.wspin[i] = 0;
  }
  s.ax = rotX(rot, sp.rider.rest.x, sp.rider.rest.y);
  s.ay = rotY(rot, sp.rider.rest.x, sp.rider.rest.y);
  s.aw = 0;
}

/** Suspension stretch on one wheel, metres: |wheel - its anchor in world|. */
export function deflection(sim: Sim, i: 0 | 1): number {
  const s = sim.state;
  const a = sim.world.spec.wheel.anchors[i];
  const ax = s.px + rotX({ x: s.ox, y: s.oy }, a.x, a.y);
  const ay = s.py + rotY({ x: s.ox, y: s.oy }, a.x, a.y);
  const dx = s.wx[i] - ax;
  const dy = s.wy[i] - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Lowest point at which the bike can still take an apple.
 *
 * Apples are collected by ANY of four reference points — head, chassis origin,
 * both wheels — within PICKUP_RADIUS. So the reach of a hang is the lowest of
 * those four, plus the pickup radius, and that number is the entire design
 * budget for "put the apples underneath the poles".
 */
export function reachY(sim: Sim): number {
  const s = sim.state;
  const sp = sim.world.spec;
  const hy = s.py + sp.rider.armLength * s.ay;
  let lo = s.py;
  if (hy < lo) lo = hy;
  for (let i = 0; i < 2; i++) if (s.wy[i] < lo) lo = s.wy[i];
  return lo - PICKUP_RADIUS;
}

export interface HangResult {
  /** Frames the hooked wheel kept a contact, out of `frames`. */
  contactFrames: number;
  /**
   * Longest unbroken stretch, in seconds, of a real HANG: the hooked wheel on
   * the feature, the other wheel touching nothing, and the chassis below the
   * feature's top surface.
   *
   * Without all three conditions the metric is worthless, and measurably so —
   * the first sweep reported hundreds of four-second "hangs" that were the bike
   * parked flat on the ledge with both wheels down.
   */
  hungSeconds: number;
  /** Longest unbroken stretch of contact, in seconds. */
  heldSeconds: number;
  /** Peak and settled stretch on the hooked wheel. */
  peakDeflect: number;
  finalDeflect: number;
  bottomed: boolean;
  /** How far the hooked wheel wandered along the ledge from where it started. */
  slideX: number;
  /** Lowest apple-reach achieved at any point, world y. */
  bestReachY: number;
  /** Where the bike ended up. A fall shows up here as a big negative y. */
  endX: number;
  endY: number;
  died: boolean;
  /** Peak deflection as a multiple of the static one-wheel hang. */
  gPeak: number;
}

/** The stretch a motionless bike hanging off one wheel produces, metres. */
export function staticHangDeflection(spec: BikeSpec): number {
  const m = spec.chassis.mass + spec.rider.mass + 2 * spec.wheel.mass;
  return (m * spec.gravity) / spec.suspension.stiffness;
}

/**
 * Run one hang and report it.
 *
 * `policy` is the rider: given the frame index it returns an input mask. A
 * constant 0 is "let go and see what the physics does", which is the honest
 * first question; anything else is testing controllability, which is a second
 * and separate question.
 */
export function hang(
  level: Level,
  spec: BikeSpec,
  p: Placement,
  frames: number,
  policy: (f: number, sim: Sim) => number = () => 0,
): HangResult {
  const sim = createSim(level, spec);
  place(sim, p);
  const startX = sim.state.wx[p.wheel];
  const md = spec.suspension.maxDeflection;
  const stat = staticHangDeflection(spec);

  let contact = 0;
  let run = 0;
  let best = 0;
  let hangRun = 0;
  let hangBest = 0;
  let peak = 0;
  let bottomed = false;
  let slide = 0;
  let reach = Infinity;

  for (let f = 0; f < frames; f++) {
    sim.advance(policy(f, sim));
    // Contact WITH THE FEATURE, not with anything. Without the height gate the
    // metric happily counts the floor of the chamber after a fall, which reads
    // as a four-second hang and is the exact wrong answer.
    const on = (sim.state.grounded & (1 << p.wheel)) !== 0 && sim.state.wy[p.wheel] > (p.topY ?? 0) - 1;
    const other = p.wheel === 0 ? 1 : 0;
    const hung = on
      && (sim.state.grounded & (1 << other)) === 0
      && sim.state.py < (p.topY ?? 0) - spec.wheel.radius;
    if (hung) {
      hangRun++;
      if (hangRun > hangBest) hangBest = hangRun;
    } else {
      hangRun = 0;
    }
    if (on) {
      contact++;
      run++;
      if (run > best) best = run;
      const d = Math.abs(sim.state.wx[p.wheel] - startX);
      if (d > slide) slide = d;
    } else {
      run = 0;
    }
    const d = deflection(sim, p.wheel);
    if (d > peak) peak = d;
    if (d >= md - 1e-9) bottomed = true;
    const r = reachY(sim);
    if (r < reach && hung) reach = r;
    if (sim.state.dead) break;
  }

  return {
    contactFrames: contact,
    hungSeconds: (hangBest * TICKS_PER_FRAME) / 512,
    heldSeconds: (best * TICKS_PER_FRAME) / 512,
    peakDeflect: peak,
    finalDeflect: deflection(sim, p.wheel),
    bottomed,
    slideX: slide,
    bestReachY: reach === Infinity ? NaN : reach,
    endX: sim.state.px,
    endY: sim.state.py,
    died: sim.state.dead,
    gPeak: peak / stat,
  };
}

export { chamber };

// --- the ridden entry --------------------------------------------------------

/**
 * A deck at y = 0 ending in a blade tip at x = 0, over a void.
 *
 * Separate from `chamber` because this one is RIDDEN: it has a start you can
 * accelerate along, which is the difference between "does a hang hold" and "can
 * a player get into one", and those two questions have different answers here.
 */
export function deckRig(bladeThickness: number): Level {
  return parseLevel({
    format: 'velo-level',
    name: 'hook entry rig',
    start: { x: -24, y: 0.55 },
    flower: { x: 20, y: -11.4 },
    apples: [],
    polygons: [
      { kind: 'cave', points: [[-30, -12], [30, -12], [30, 22], [-30, 22]] },
      { kind: 'ground', points: [[-30, 0], [0, 0], [-30, -bladeThickness]] },
    ],
  });
}

export interface EntryResult {
  /** Longest stretch, in seconds, with a wheel on the tip and the body below the deck. */
  hookedSeconds: number;
  peakDeflect: number;
  approach: number;
  died: boolean;
}

/**
 * Ride at the tip and try to catch it.
 *
 * `hold` is what is held on the approach once up to speed, `tail` what is held
 * from a metre before the tip. Two masks rather than a free input stream on
 * purpose: a player has one plan and one commitment, and a search over arbitrary
 * per-frame inputs would answer a question nobody can execute.
 */
export function rideAtTip(
  level: Level,
  spec: BikeSpec,
  target: number,
  hold: number,
  tail: number,
  frames = 900,
): EntryResult {
  const sim = createSim(level, spec);
  let run = 0;
  let best = 0;
  let defl = 0;
  let approach = 0;
  for (let f = 0; f < frames; f++) {
    const s = sim.state;
    let mask: number;
    if (s.px > -0.8) mask = tail;
    else if (s.px < -3) mask = s.vx < target ? IN_THROTTLE : 0;
    else mask = hold;
    sim.advance(mask);
    if (s.px < -1 && s.vx > approach) approach = s.vx;
    const near = (i: 0 | 1): boolean =>
      (s.grounded & (1 << i)) !== 0 && s.wy[i] > -0.7 && s.wx[i] > -1.3 && s.wx[i] < 0.6;
    const i: 0 | 1 | -1 = near(0) ? 0 : near(1) ? 1 : -1;
    if (i !== -1 && s.py < -0.3 && !s.dead) {
      run++;
      if (run > best) best = run;
      const d = deflection(sim, i);
      if (d > defl) defl = d;
    } else {
      run = 0;
    }
    if (s.dead || s.py < -9) break;
  }
  return { hookedSeconds: (best * TICKS_PER_FRAME) / 512, peakDeflect: defl, approach, died: sim.state.dead };
}
