// Orientation as a unit complex number (x, y) = (cos t, sin t), never an angle.
//
// This is the mechanism by which the sim never calls Math.cos or Math.sin at
// runtime. Rotating by a small per-tick angle uses fixed Taylor polynomials —
// pure + - * /, therefore bit-identical on every engine — and the result is
// renormalised with sqrt, which ECMA-262 specifies as correctly rounded.
//
// The plan measured this at 1000 Hz and specified 5th/4th order polynomials.
// The shipped tick is 512 Hz, so the per-tick angle is roughly twice as large
// and those orders were NOT accurate enough — at 20 rad/s the 4th-order cos was
// off by 4.9e-12, not the "exactly zero" the plan's table reports. Going one
// term further costs a single multiply each and restores it. Measured here at
// DT = 1/512, versus the engine's own Math.sin/Math.cos:
//
//   ang vel   per-tick angle   sin err    cos err
//    5 rad/s     0.0098          0          0
//   20 rad/s     0.0391          0        1.1e-16
//   60 rad/s     0.1172        1.1e-14    8.8e-13   (absurd; MAX_ANGVEL caps here)
//
// Over 600,000 ticks with per-tick renormalisation the magnitude error stays at
// one ulp and does NOT accumulate: the worst drift in the last 10,000 ticks
// equals the worst drift in the first.
//
// None of this is about matching Math.* for its own sake. A polynomial that is
// merely CLOSE to sine is still perfectly deterministic. Accuracy matters only
// so that the bike behaves like a bike; determinism is what the ban buys.

export interface Rot {
  readonly x: number;
  readonly y: number;
}

export const ROT_IDENTITY: Rot = { x: 1, y: 0 };

const INV_6 = 1 / 6;
const INV_120 = 1 / 120;
const INV_5040 = 1 / 5040;
const INV_2 = 1 / 2;
const INV_24 = 1 / 24;
const INV_720 = 1 / 720;

/** sin(a) to 7th order, Horner form. `a` is a per-tick angle, |a| < 0.13. */
export function sinSmall(a: number): number {
  const a2 = a * a;
  return a * (1 - a2 * (INV_6 - a2 * (INV_120 - a2 * INV_5040)));
}

/** cos(a) to 6th order, Horner form. */
export function cosSmall(a: number): number {
  const a2 = a * a;
  return 1 - a2 * (INV_2 - a2 * (INV_24 - a2 * INV_720));
}

export function rotNormalize(x: number, y: number): Rot {
  const m2 = x * x + y * y;
  if (m2 === 0) return ROT_IDENTITY;
  const inv = 1 / Math.sqrt(m2);
  return { x: x * inv, y: y * inv };
}

/** Rotate `r` by `w * dt` radians. Renormalises every call — see the header. */
export function rotIntegrate(r: Rot, w: number, dt: number): Rot {
  const a = w * dt;
  const s = sinSmall(a);
  const c = cosSmall(a);
  return rotNormalize(r.x * c - r.y * s, r.x * s + r.y * c);
}

/** World x of the local vector (vx, vy) under rotation r. */
export function rotX(r: Rot, vx: number, vy: number): number {
  return r.x * vx - r.y * vy;
}

/** World y of the local vector (vx, vy) under rotation r. */
export function rotY(r: Rot, vx: number, vy: number): number {
  return r.y * vx + r.x * vy;
}

/** Local x of the world vector (vx, vy) — the inverse rotation. */
export function unrotX(r: Rot, vx: number, vy: number): number {
  return r.x * vx + r.y * vy;
}

/** Local y of the world vector (vx, vy). */
export function unrotY(r: Rot, vx: number, vy: number): number {
  return r.x * vy - r.y * vx;
}

/** 2D cross product. Positive means b is counter-clockwise from a. */
export function cross2(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

export function dot2(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}
