// Uniform grid over polygon edges, built once at level compile.
//
// The benchmark says this is not needed for framerate — 1000 edges brute-forced
// against three circles costs 8.76 us/tick, 0.88% of real time at 1000 Hz. It
// ships in M1 anyway, because adding it later would change candidate ORDERING
// and therefore results, forcing a physics-version bump and invalidating every
// replay recorded before it.
//
// Its invariant is that it must be CONSERVATIVE AND EXACT, never approximate. A
// broadphase that misses a contact on one machine and not another is a desync
// nobody will ever find. Concretely:
//
//  * an edge is inserted into every cell its AABB touches (over-inclusive, fine);
//  * a query returns every edge in every cell the query AABB touches;
//  * therefore every edge within the query radius is returned, always.
//
// The one thing it does NOT return is an edge further than the query radius
// away, which is why the narrowphase must never need a far-away edge to decide
// inside-ness. It does not: it uses per-edge and per-vertex pseudo-normals, so
// the sign of the SDF is a purely local question. The remaining hole is a
// circle buried so deep in solid that no edge is within its radius — i.e. a
// tunnelled body — and at 512 Hz with 0.5 m colliders that cannot happen.
import { BASE_CELL, MAX_GRID_CELLS } from './consts.ts';
import type { CompiledPolygon } from './level.ts';

export interface Grid {
  cell: number;
  invCell: number;
  /** Cell index of the grid origin, in cell units. */
  cx0: number;
  cy0: number;
  w: number;
  h: number;
  /** CSR row starts, length w*h + 1. */
  starts: Int32Array;
  itemPoly: Int32Array;
  itemEdge: Int32Array;
  /** Flat edge id of the first edge of polygon p; length polys.length + 1. */
  edgeBase: Int32Array;
  totalEdges: number;
}

export function buildGrid(polys: readonly CompiledPolygon[]): Grid {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let totalEdges = 0;
  const edgeBase = new Int32Array(polys.length + 1);
  for (let p = 0; p < polys.length; p++) {
    edgeBase[p] = totalEdges;
    totalEdges += polys[p].vx.length;
    if (polys[p].minX < minX) minX = polys[p].minX;
    if (polys[p].minY < minY) minY = polys[p].minY;
    if (polys[p].maxX > maxX) maxX = polys[p].maxX;
    if (polys[p].maxY > maxY) maxY = polys[p].maxY;
  }
  edgeBase[polys.length] = totalEdges;

  // Grow the cell size by doubling until the grid fits the cap. Doubling (not
  // a computed ratio) keeps the cell size a power-of-two multiple of BASE_CELL,
  // so the same level produces the same grid everywhere.
  let cell = BASE_CELL;
  let w = 0;
  let h = 0;
  let cx0 = 0;
  let cy0 = 0;
  for (;;) {
    const inv = 1 / cell;
    cx0 = Math.floor(minX * inv);
    cy0 = Math.floor(minY * inv);
    w = Math.floor(maxX * inv) - cx0 + 1;
    h = Math.floor(maxY * inv) - cy0 + 1;
    if (w * h <= MAX_GRID_CELLS) break;
    cell = cell * 2;
  }
  const invCell = 1 / cell;

  const counts = new Int32Array(w * h);
  const forEachCell = (fn: (ci: number, pi: number, ei: number) => void): void => {
    for (let p = 0; p < polys.length; p++) {
      const poly = polys[p];
      const n = poly.vx.length;
      for (let e = 0; e < n; e++) {
        const j = e + 1 === n ? 0 : e + 1;
        const ax = poly.vx[e];
        const ay = poly.vy[e];
        const bx = poly.vx[j];
        const by = poly.vy[j];
        const lo = Math.floor((ax < bx ? ax : bx) * invCell) - cx0;
        const hi = Math.floor((ax > bx ? ax : bx) * invCell) - cx0;
        const lv = Math.floor((ay < by ? ay : by) * invCell) - cy0;
        const hv = Math.floor((ay > by ? ay : by) * invCell) - cy0;
        for (let gy = lv; gy <= hv; gy++) {
          for (let gx = lo; gx <= hi; gx++) {
            fn(gy * w + gx, p, e);
          }
        }
      }
    }
  };

  forEachCell((ci) => {
    counts[ci]++;
  });

  const starts = new Int32Array(w * h + 1);
  let acc = 0;
  for (let i = 0; i < counts.length; i++) {
    starts[i] = acc;
    acc += counts[i];
  }
  starts[counts.length] = acc;

  const cursor = starts.slice(0, counts.length);
  const itemPoly = new Int32Array(acc);
  const itemEdge = new Int32Array(acc);
  // Filling in polygon-then-edge order leaves every cell's slice sorted
  // ascending by (poly, edge). Nothing downstream relies on that — contacts are
  // sorted explicitly — but it makes the grid dump readable when debugging a
  // desync, which is when you need it most.
  forEachCell((ci, pi, ei) => {
    const at = cursor[ci]++;
    itemPoly[at] = pi;
    itemEdge[at] = ei;
  });

  return {
    cell,
    invCell,
    cx0,
    cy0,
    w,
    h,
    starts,
    itemPoly,
    itemEdge,
    edgeBase,
    totalEdges,
  };
}

/**
 * Candidate edges for a circle, written into `outPoly` / `outEdge`. Returns the
 * count. Each edge appears at most once.
 *
 * `stamp` is per-WORLD, not per-grid: two sims sharing one compiled level must
 * not share a dedupe buffer, or interleaving their steps drops contacts in one
 * of them. `queryId` must strictly increase; World handles the int32 wrap.
 *
 * `outPoly`/`outEdge` are sized to the total edge count by the caller, so the
 * capacity guard below can never actually fire. It is there because a
 * silently-truncated candidate list is a missed contact, which is the one
 * failure mode this file exists to make impossible.
 */
export function queryCircle(
  g: Grid,
  x: number,
  y: number,
  r: number,
  queryId: number,
  stamp: Int32Array,
  outPoly: Int32Array,
  outEdge: Int32Array,
): number {
  let lo = Math.floor((x - r) * g.invCell) - g.cx0;
  let hi = Math.floor((x + r) * g.invCell) - g.cx0;
  let lv = Math.floor((y - r) * g.invCell) - g.cy0;
  let hv = Math.floor((y + r) * g.invCell) - g.cy0;
  if (hi < 0 || lo >= g.w || hv < 0 || lv >= g.h) return 0;
  if (lo < 0) lo = 0;
  if (lv < 0) lv = 0;
  if (hi >= g.w) hi = g.w - 1;
  if (hv >= g.h) hv = g.h - 1;

  const cap = outPoly.length;
  let n = 0;
  for (let gy = lv; gy <= hv; gy++) {
    const row = gy * g.w;
    for (let gx = lo; gx <= hi; gx++) {
      const ci = row + gx;
      const s = g.starts[ci];
      const e = g.starts[ci + 1];
      for (let k = s; k < e; k++) {
        const pi = g.itemPoly[k];
        const ei = g.itemEdge[k];
        const flat = g.edgeBase[pi] + ei;
        if (stamp[flat] === queryId) continue;
        stamp[flat] = queryId;
        if (n < cap) {
          outPoly[n] = pi;
          outEdge[n] = ei;
          n++;
        }
      }
    }
  }
  return n;
}
