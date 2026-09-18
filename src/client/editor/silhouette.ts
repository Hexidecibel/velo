// THE BIKE, AT REST, AS A RULER.
//
// The editor's most useful instrument is not a number. Levels are in metres and
// a metre is nothing to look at; what an author actually needs to know is
// whether the thing they just drew is bike-sized, and the only honest answer to
// that is a bike drawn against it at the same scale.
//
// EVERY DIMENSION COMES OUT OF THE LIVE `BikeSpec`, never a constant. The spec
// is what the sim collides with and what `specHash` covers, so a silhouette
// built from hard-coded numbers would be a picture of a bike that used to
// exist — and it would go wrong silently, which is the worst way for a ruler to
// be wrong.
//
// AND THE RESTING HEIGHT IS MEASURED, NOT DERIVED. The closed form below —
// sprung weight over two springs — is off by about a centimetre on the shipped
// bike, because the static equilibrium involves the contact slop, the rider arm
// and the wheels' own weight, and reproducing all of that here would be a
// second implementation of step.ts. So `measureRestingBike` settles an actual
// sim on an actual flat floor for a fifth of a second and reads the answer off
// it. That is exact by construction, costs about a millisecond once, and cannot
// drift from the physics because it IS the physics.
//
// Renderer-side code, so the Math.* ban does not apply.
import { createSim } from '@/sim/sim.ts';
import { parseLevel } from '@/sim/level.ts';
import type { BikeSpec } from '@/sim/spec.ts';

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface Silhouette {
  /** The two wheels, in a frame whose origin is the ground under the bike's middle. */
  wheels: [Circle, Circle];
  /** Frame circles. These do not kill on contact; they do stop you. */
  chassis: Circle[];
  /** THE ONE THAT KILLS. */
  head: Circle;
  /** Nose to tail, metres. 1.70 on the shipped bike. */
  length: number;
  /** Ground to the top of the head, metres. 1.07 on the shipped bike. */
  height: number;
}

/**
 * Lay the circles out for a chassis origin `chassisY` above the ground.
 *
 * Pure, and the only part of this file with no physics in it: given where the
 * chassis sits, everything else is the spec's own offsets. Split out so that
 * the measured path and the closed-form path produce identical pictures.
 */
export function layout(spec: BikeSpec, chassisY: number): Silhouette {
  const r = spec.wheel.radius;
  const wheels: [Circle, Circle] = [
    { x: spec.wheel.anchors[0].x, y: r, r },
    { x: spec.wheel.anchors[1].x, y: r, r },
  ];
  const chassis = spec.chassis.colliders.map((c) => ({ x: c.x, y: chassisY + c.y, r: c.r }));
  const head = {
    x: spec.rider.rest.x * spec.rider.armLength,
    y: chassisY + spec.rider.rest.y * spec.rider.armLength,
    r: spec.rider.headRadius,
  };
  let minX = Infinity;
  let maxX = -Infinity;
  for (const c of [...wheels, ...chassis]) {
    if (c.x - c.r < minX) minX = c.x - c.r;
    if (c.x + c.r > maxX) maxX = c.x + c.r;
  }
  return { wheels, chassis, head, length: maxX - minX, height: head.y + head.r };
}

/**
 * Where the chassis origin sits above the ground, from arithmetic alone.
 *
 * The suspension is a ZERO-REST-LENGTH spring pulling each wheel toward its
 * chassis-local anchor, so at rest the anchor hangs below the wheel centre by
 * however far the sprung weight stretches the pair: `m g / (2 k)`, clamped to
 * the travel the spec allows. That is about 4 cm on the shipped bike — small,
 * and included anyway, because it is the difference between a ruler that reads
 * 1.07 m of head height and one that reads 1.11, and the numbers that matter
 * here are 1.20 clean and 1.10 fatal.
 *
 * Used when there is no sim to ask. `measureRestingBike` is the better answer.
 */
export function restingChassisY(spec: BikeSpec): number {
  const sprung = spec.chassis.mass + spec.rider.mass;
  const sag = Math.min(
    (sprung * spec.gravity) / (2 * spec.suspension.stiffness),
    spec.suspension.maxDeflection,
  );
  const anchorY = (spec.wheel.anchors[0].y + spec.wheel.anchors[1].y) * 0.5;
  return spec.wheel.radius - anchorY - sag;
}

/** A flat floor with nothing on it, to stand a bike on. */
const FLAT = {
  format: 'velo-level',
  name: 'ruler',
  start: { x: 0, y: 0.5 },
  flower: { x: 4, y: 0.5 },
  apples: [],
  polygons: [{
    kind: 'cave',
    points: [[-8, 0], [8, 0], [8, 8], [-8, 8]],
  }],
};

/** Input frames to settle. 128 is one second at the sim's input rate. */
const SETTLE_FRAMES = 128;

/**
 * Stand the bike on flat ground, let it settle, and measure it.
 *
 * Exact by construction, and the reason the silhouette can be trusted as a
 * ruler at all: it is not a drawing of the bike, it is where the bike is.
 */
export function measureRestingBike(spec: BikeSpec): Silhouette {
  const sim = createSim(parseLevel(FLAT), spec);
  for (let i = 0; i < SETTLE_FRAMES; i++) sim.advance(0);
  const s = sim.state;
  // The floor is y = 0 in FLAT, so the state's own y values are already heights
  // above the ground. The chassis origin is what `layout` needs; everything
  // else follows from the spec, which is what keeps the two paths identical.
  return layout(spec, s.py);
}
