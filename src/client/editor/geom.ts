// The editor's geometry: snapping, hit-testing, the arc handle, and the two
// measurements that make the bike's envelope visible while you draw.
//
// Pure, and tested in plain node. Nothing here touches a canvas — the overlay
// asks these functions where things are and then draws them.
//
// THE RULER IS THE BIKE, and every number in here is in metres for that reason.
// A pixel is whatever the zoom happens to be; 1.20 m of gap is clean and 1.10 m
// kills, on every screen, forever.
import type { CompiledPolygon, Level } from '@/sim/level.ts';
import type { EditDoc, EditPoint } from './doc.ts';

/** Metres. What the bike needs to get through a gap without the head touching. */
export const GAP_CLEAN = 1.2;
/** Metres. Measured: this one kills. Between the two is a squeeze. */
export const GAP_TIGHT = 1.1;
/** Degrees. Sustained climbs are rideable to about here with a run-up. */
export const CLIMB_LIMIT_DEG = 34;
/** Metres. A vertical step taller than this stops the bike dead. */
export const STEP_LIMIT = 0.35;

export function snapTo(v: number, grid: number): number {
  if (!(grid > 0)) return v;
  return Math.round(v / grid) * grid;
}

export function snapPoint(p: EditPoint, grid: number): EditPoint {
  return { x: snapTo(p.x, grid), y: snapTo(p.y, grid) };
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * The signed sagitta of `p` off the chord `a -> b`: the arc primitive's `bulge`
 * for an arc through those three points, in metres, positive to the LEFT of the
 * direction of travel.
 *
 * This is the whole of the arc interaction. The handle sits at the middle of
 * the arc, you drag it, and where you dropped it IS the number the file stores
 * — no radius, no flags, no dialog. It is exactly arc.ts's definition, which
 * is what makes dragging the handle and typing the number the same operation.
 */
export function bulgeFor(a: EditPoint, b: EditPoint, p: EditPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-9) return 0;
  const mx = (a.x + b.x) * 0.5;
  const my = (a.y + b.y) * 0.5;
  // Unit LEFT normal of a -> b.
  const ux = -dy / len;
  const uy = dx / len;
  return (p.x - mx) * ux + (p.y - my) * uy;
}

/** Where the bulge handle for the edge `a -> b` sits: the middle of the arc. */
export function arcHandle(a: EditPoint, b: EditPoint, bulge: number): EditPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-9) return { x: a.x, y: a.y };
  return { x: (a.x + b.x) * 0.5 - (dy / len) * bulge, y: (a.y + b.y) * 0.5 + (dx / len) * bulge };
}

export function distToSegment(p: EditPoint, a: EditPoint, b: EditPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-18) return Math.sqrt(dist2(p.x, p.y, a.x, a.y));
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.sqrt(dist2(p.x, p.y, a.x + t * dx, a.y + t * dy));
}

// --- what is under the pointer ----------------------------------------------

export type HandleKind = 'vertex' | 'arc' | 'start' | 'flower' | 'apple' | 'draft';

export interface Handle {
  kind: HandleKind;
  /** Polygon index for `vertex` and `arc`; apple index for `apple`; -1 otherwise. */
  pi: number;
  /** Vertex index. For `arc` it is the vertex the edge ARRIVES at, which is where the bulge lives. */
  vi: number;
  x: number;
  y: number;
}

/**
 * The handle nearest `p` within `radius` metres, or null.
 *
 * ORDER IS THE PRIORITY ORDER and it is not alphabetical: objects first, then
 * vertices, then arc handles. An arc handle sits in the middle of an edge and
 * the two things most likely to be near it are the apple you put in the dip and
 * the vertex at the end of the run — and of those three, the arc handle is the
 * one you can always reach by zooming in, because it is the only one whose
 * position you chose by dragging it there.
 */
export function pickHandle(doc: EditDoc, p: EditPoint, radius: number): Handle | null {
  const r2 = radius * radius;
  let best: Handle | null = null;
  let bestD = r2;

  const offer = (h: Handle): void => {
    const d = dist2(p.x, p.y, h.x, h.y);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  };

  offer({ kind: 'start', pi: -1, vi: -1, x: doc.start.x, y: doc.start.y });
  offer({ kind: 'flower', pi: -1, vi: -1, x: doc.flower.x, y: doc.flower.y });
  doc.apples.forEach((a, i) => offer({ kind: 'apple', pi: i, vi: -1, x: a.x, y: a.y }));
  if (best) return best;

  doc.polygons.forEach((poly, pi) => {
    poly.verts.forEach((v, vi) => offer({ kind: 'vertex', pi, vi, x: v.x, y: v.y }));
  });
  doc.draft?.verts.forEach((v, vi) => offer({ kind: 'draft', pi: -1, vi, x: v.x, y: v.y }));
  if (best) return best;

  doc.polygons.forEach((poly, pi) => {
    const n = poly.verts.length;
    for (let vi = 0; vi < n; vi++) {
      const prev = poly.verts[vi === 0 ? n - 1 : vi - 1];
      const cur = poly.verts[vi];
      const h = arcHandle(prev, cur, cur.bulge);
      offer({ kind: 'arc', pi, vi, x: h.x, y: h.y });
    }
  });
  return best;
}

export interface EdgeHit {
  pi: number;
  /** The vertex the edge arrives at — the one `insertVertex` splits before. */
  vi: number;
  dist: number;
  x: number;
  y: number;
}

/** Nearest polygon edge to `p`, as a straight chord. Used by insert-vertex. */
export function pickEdge(doc: EditDoc, p: EditPoint, radius: number): EdgeHit | null {
  let best: EdgeHit | null = null;
  doc.polygons.forEach((poly, pi) => {
    const n = poly.verts.length;
    for (let vi = 0; vi < n; vi++) {
      const a = poly.verts[vi === 0 ? n - 1 : vi - 1];
      const b = poly.verts[vi];
      const d = distToSegment(p, a, b);
      if (d <= radius && (best === null || d < best.dist)) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy || 1;
        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        best = { pi, vi, dist: d, x: a.x + t * dx, y: a.y + t * dy };
      }
    }
  });
  return best;
}

// --- how much room is there -------------------------------------------------

/**
 * Distance from (x, y) straight up (`dir` +1) or straight down (-1) to the
 * first collision edge, in metres. Infinity when the ray leaves the level.
 *
 * Every edge of every collidable polygon counts, whatever its kind: the first
 * boundary a vertical ray meets is where the free space the point sits in ends,
 * and a cave wall and a ground platform are equally solid to a head.
 *
 * The x-interval is half-open so a ray through a shared vertex is counted once.
 */
export function rayDist(polys: readonly CompiledPolygon[], x: number, y: number, dir: 1 | -1): number {
  let best = Infinity;
  for (const p of polys) {
    if (x < p.minX || x > p.maxX) continue;
    const n = p.vx.length;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const x0 = p.vx[i];
      const x1 = p.vx[j];
      if (x0 === x1) continue;
      const lo = x0 < x1 ? x0 : x1;
      const hi = x0 < x1 ? x1 : x0;
      if (x < lo || x >= hi) continue;
      const t = (x - x0) / (x1 - x0);
      const yy = p.vy[i] + t * (p.vy[j] - p.vy[i]);
      const d = (yy - y) * dir;
      if (d >= 0 && d < best) best = d;
    }
  }
  return best;
}

export interface FreeSpan {
  up: number;
  down: number;
  /** Floor to ceiling through this point. Infinity when either side is open. */
  height: number;
}

/**
 * The floor-to-ceiling height through a point — the gap probe.
 *
 * This is the editor's most-used instrument and it is deliberately the simplest
 * one that is exactly right: it answers "does the bike fit here" with the same
 * number the measured envelope is quoted in, live, wherever the pointer is.
 * 1.20 m is clean; 1.10 m kills.
 */
export function freeSpan(polys: readonly CompiledPolygon[], x: number, y: number): FreeSpan {
  const up = rayDist(polys, x, y, 1);
  const down = rayDist(polys, x, y, -1);
  return { up, down, height: up + down };
}

// --- what the geometry asks of the bike --------------------------------------

export type EnvelopeCode = 'climb' | 'step' | 'headroom';

export interface EnvelopeFinding {
  code: EnvelopeCode;
  x: number;
  y: number;
  /** Degrees for `climb`, metres for `step` and `headroom`. */
  value: number;
  message: string;
}

/**
 * Edges that ask the bike for something near or past what it can do.
 *
 * DELIBERATELY NARROW, because a warning that fires on every wall in a cave is
 * a warning nobody reads — and this tool already has one honest warning (sag)
 * that people do read. So:
 *
 *   climb  a FLOOR (the out-of-solid normal points up) steeper than the
 *          measured 34 deg sustained limit, and at least 1.5 m long. A short
 *          steep kick is a feature; a long one is a wall you did not mean.
 *   step   a near-VERTICAL face between STEP_LIMIT and 3 m tall. Under 0.35 m
 *          the bike rides up it; over 3 m nobody thought they were riding it.
 *          In between is the range where a level looks passable and is not.
 *
 * Both are warnings and neither is ever an error. A deliberate wall is
 * legitimate level design, in precisely the way bin/level-check says a
 * deliberate hard edge is.
 */
export function envelopeFindings(polys: readonly CompiledPolygon[]): EnvelopeFinding[] {
  const out: EnvelopeFinding[] = [];
  for (const p of polys) {
    const n = p.vx.length;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const dx = p.vx[j] - p.vx[i];
      const dy = p.vy[j] - p.vy[i];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-9) continue;
      const mx = (p.vx[i] + p.vx[j]) * 0.5;
      const my = (p.vy[i] + p.vy[j]) * 0.5;
      const ny = p.ny[i];
      const deg = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;

      if (ny > 0.25 && deg > CLIMB_LIMIT_DEG && deg <= 80 && len >= 1.5) {
        out.push({
          code: 'climb', x: mx, y: my, value: deg,
          message: `${deg.toFixed(0)}° climb over ${len.toFixed(1)} m — sustained climbs are rideable to about ${CLIMB_LIMIT_DEG}° with a run-up`,
        });
      } else if (Math.abs(ny) <= 0.25 && len >= STEP_LIMIT && len <= 3) {
        out.push({
          code: 'step', x: mx, y: my, value: len,
          message: `${len.toFixed(2)} m vertical face — a step over ${STEP_LIMIT} m stops the bike dead`,
        });
      }
    }
  }
  out.sort((a, b) => b.value - a.value);
  return out;
}

/**
 * Headroom over the things the player must reach. One vertical probe each, so
 * it costs nothing and it catches the mistake that is invisible on screen: a
 * ceiling that looks generous at overview zoom and is 1.05 m of actual gap.
 *
 * `19-low-roof` is a level whose whole lesson is riding a corridor near this
 * limit, so this warns and never rejects.
 */
export function headroomFindings(level: Level): EnvelopeFinding[] {
  const out: EnvelopeFinding[] = [];
  const probe = (what: string, x: number, y: number): void => {
    const s = freeSpan(level.polys, x, y);
    if (!Number.isFinite(s.height) || s.height >= GAP_CLEAN) return;
    out.push({
      code: 'headroom', x, y, value: s.height,
      message: `${what}: ${s.height.toFixed(2)} m floor to ceiling — ${GAP_CLEAN} m is clean, ${GAP_TIGHT} m kills`,
    });
  };
  probe('the start', level.start.x, level.start.y);
  level.apples.forEach((a, i) => probe(`apple ${i}`, a.x, a.y));
  probe('the flower', level.flower.x, level.flower.y);
  return out;
}
