// Slope-climb sweep: can this bike get up a hill, and if not, HOW does it fail.
//
// It exists because "impossible to go up a semi-steep slope, even with lots of
// speed" has at least three completely different causes with three completely
// different fixes, and guessing between them is how you tune the wrong number:
//
//   stalled   thrust ran out. The drive curve is the problem.
//   looped    the upslope pitched the nose and the bike backflipped. Rotation.
//   bounced   the corner at the base ate the momentum as a collision impulse.
//   short     it neither failed nor arrived inside the time budget.
//
// The rig is a synthetic level — flat run-up, one clean corner, a ramp of the
// requested angle, a flat top — and the bike is seeded on the flat at the
// requested speed. For each cell it runs a few simple human-plausible input
// policies and keeps the best result, because "a player could do this" is the
// question, not "does full throttle happen to work".
import { parseLevel } from '../src/sim/level.ts';
import { createSim } from '../src/sim/sim.ts';
import type { RawLevel } from '../src/sim/level.ts';
import type { BikeSpec } from '../src/sim/spec.ts';
import { IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '../src/sim/consts.ts';

export type Outcome = 'ok' | 'stalled' | 'looped' | 'bounced' | 'short';

export interface Cell {
  deg: number;
  entry: number;
  outcome: Outcome;
  /** Lowest total energy on the approach and face, as a fraction of the energy at entry. */
  retained: number;
  /** Peak chassis pitch away from upright, degrees. */
  peakPitch: number;
  /** Furthest distance up the ramp face, metres. */
  up: number;
}

const RUNUP = 14;
const RISE = 3.5;

/**
 * `fillet` is the radius of a circular transition at the base of the ramp, in
 * metres, written as ONE arc entry exactly as a level author would write it.
 * 0 is a sharp corner.
 *
 * It is a dimension of the sweep because it turned out to be the dominant one:
 * a wheel meeting a corner square loses the component of its velocity normal to
 * the new face, and with restitution 0.05 almost none of it comes back — so
 * cos^2(theta) of the kinetic energy is destroyed on contact, 41% of it at 50
 * degrees, before the rider has any say in the matter. A fillet converts the
 * velocity direction gradually instead, and the energy survives.
 */
function rampLevel(deg: number, fillet: number): RawLevel {
  const th = (deg * Math.PI) / 180;
  const dx = RISE / Math.tan(th);
  const topX = RUNUP + dx;
  const points: RawLevel['polygons'][number]['points'] = [[-4, 0]];
  if (fillet <= 0) {
    points.push([RUNUP, 0]);
  } else {
    // Tangent length from the corner, and the arc's sagitta off its own chord.
    const t = fillet * Math.tan(th / 2);
    points.push([RUNUP - t, 0]);
    points.push({
      arcTo: [RUNUP + t * Math.cos(th), t * Math.sin(th)],
      bulge: -fillet * (1 / Math.cos(th / 2) - 1),
    });
  }
  points.push([topX, RISE], [topX + 10, RISE], [topX + 10, RISE + 16], [-4, RISE + 16]);
  return {
    format: 'velo-level',
    start: { x: 0, y: 0.42 },
    flower: { x: topX + 6, y: RISE + 0.5 },
    polygons: [{ kind: 'cave', points }],
  };
}

/**
 * Input strategies, as separate dimensions rather than a best-of.
 *
 * The point of the sweep is the GAP between them. In Elasto Mania you cannot
 * blast up a steep face; you arrive with momentum, lean into the slope as you
 * make contact so the bike's attitude matches it, and correct your way up. That
 * gap is where the skill lives, so "naive fails, technique succeeds" is the
 * target — not "throttle alone works", which would delete the skill.
 */
export type Strategy = 'naive' | 'technique';

/**
 * `naive` is throttle and nothing else.
 *
 * `technique` is throttle plus a lean that tracks the surface the bike is about
 * to be on: level on the flat, pitched to the slope angle from just before the
 * corner onward, bang-bang with a deadband. That is a mechanical stand-in for
 * "lean in when you hit and correct your way up" — deliberately not
 * frame-perfect, because a technique that only works on a knife-edge of timing
 * is not a technique.
 */
function maskFor(strategy: Strategy, deg: number, x: number, oy: number, w: number, base: number): number {
  if (strategy === 'naive') return IN_THROTTLE;
  // Start matching the face a metre before the corner, which is "lean in as you
  // hit" rather than "lean in after you have already been thrown".
  const onFace = x > base - 2.0;
  const target = onFace ? Math.sin((deg * Math.PI) / 180) : 0;
  // Proportional on attitude plus a rate term. The rate term is the whole
  // difference between a technique and a flail: without it the correction is
  // always late by however long the bike has been rotating, and bang-bang at
  // 340 N m then overshoots into the opposite failure.
  const err = oy - target + w * 0.18;
  if (err > 0.05) return IN_THROTTLE | IN_LEAN_R;
  if (err < -0.05) return IN_THROTTLE | IN_LEAN_L;
  return IN_THROTTLE;
}

export function sweepCell(spec: BikeSpec, deg: number, entry: number, strategy: Strategy, fillet: number): Cell {
  const raw = rampLevel(deg, fillet);
  const level = parseLevel(raw);
  const dx = RISE / Math.tan((deg * Math.PI) / 180);
  const topX = RUNUP + dx;
  {
    const sim = createSim(level, spec);
    const s = sim.state;
    // Seed on the flat, 8 m short of the corner, already at speed.
    const x0 = RUNUP - 8;
    s.px = x0;
    s.py = 0.42;
    s.vx = entry;
    for (let i = 0; i < 2; i++) {
      const a = spec.wheel.anchors[i];
      s.wx[i] = x0 + a.x;
      s.wy[i] = 0.42 + a.y;
      s.wvx[i] = entry;
      s.wvy[i] = 0;
      // Spun up to match, so the first tick is not a burnout.
      s.wspin[i] = -entry / spec.wheel.radius;
    }
    s.ax = spec.rider.rest.x;
    s.ay = spec.rider.rest.y;

    const mass = spec.chassis.mass + spec.rider.mass + 2 * spec.wheel.mass;
    const energy = (vx: number, vy: number, y: number): number => 0.5 * mass * (vx * vx + vy * vy) + mass * spec.gravity * y;
    const e0 = energy(entry, 0, 0.42);
    let eMin = e0;
    let peakPitch = 0;
    let maxUp = 0;
    let outcome: Outcome = 'short';

    for (let f = 0; f < 128 * 12; f++) {
      const st = sim.state;
      sim.advance(maskFor(strategy, deg, st.px, st.oy, st.w, RUNUP));
      const t = sim.state;
      const pitch = (Math.abs(Math.atan2(t.oy, t.ox)) * 180) / Math.PI;
      if (pitch > peakPitch) peakPitch = pitch;
      if (t.px > RUNUP - 2 && t.px < topX) {
        const e = energy(t.vx, t.vy, t.py);
        if (e < eMin) eMin = e;
      }
      if (t.px > RUNUP) maxUp = Math.max(maxUp, Math.min(t.px, topX) - RUNUP);
      if (t.dead) { outcome = 'looped'; break; }
      if (t.px >= topX + 1.5) { outcome = 'ok'; break; }
      // Stalled: on the face, barely moving, and the run has had time to settle.
      if (f > 128 && t.px > RUNUP && t.px < topX && Math.hypot(t.vx, t.vy) < 0.4) { outcome = 'stalled'; break; }
    }
    if (outcome === 'short' && peakPitch > 90) outcome = 'looped';
    return { deg, entry, outcome, retained: eMin / e0, peakPitch, up: maxUp };
  }
}

export function sweep(spec: BikeSpec, degs: number[], entries: number[], strategy: Strategy, fillet = 0): Cell[] {
  const out: Cell[] = [];
  for (const d of degs) for (const e of entries) out.push(sweepCell(spec, d, e, strategy, fillet));
  return out;
}

export function table(cells: Cell[], degs: number[], entries: number[]): string {
  const lines: string[] = [];
  lines.push('    slope |' + entries.map((e) => ` ${String(e).padStart(2)} m/s`.padEnd(9)).join(''));
  lines.push('    ------+' + entries.map(() => '---------').join(''));
  for (const d of degs) {
    const row = entries.map((e) => {
      const c = cells.find((x) => x.deg === d && x.entry === e)!;
      const tag = c.outcome === 'ok' ? 'OK' : c.outcome;
      const extra = c.outcome === 'ok' ? '' : ` ${c.up.toFixed(1)}m`;
      return ` ${tag}${extra}`.padEnd(9);
    });
    lines.push(`    ${String(d).padStart(4)}° |` + row.join(''));
  }
  lines.push('');
  lines.push('    energy surviving the transition (fraction of the energy carried in)');
  lines.push('    ------+' + entries.map(() => '---------').join(''));
  for (const d of degs) {
    const row = entries.map((e) => {
      const c = cells.find((x) => x.deg === d && x.entry === e)!;
      return ` ${c.retained.toFixed(2)}`.padEnd(9);
    });
    lines.push(`    ${String(d).padStart(4)}° |` + row.join(''));
  }
  lines.push('');
  lines.push('    peak chassis pitch, degrees from upright (90+ is on its way over)');
  lines.push('    ------+' + entries.map(() => '---------').join(''));
  for (const d of degs) {
    const row = entries.map((e) => {
      const c = cells.find((x) => x.deg === d && x.entry === e)!;
      return ` ${c.peakPitch.toFixed(0)}`.padEnd(9);
    });
    lines.push(`    ${String(d).padStart(4)}° |` + row.join(''));
  }
  return lines.join('\n');
}
