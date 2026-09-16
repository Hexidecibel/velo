// The level, seen as a map rather than as physics.
//
// The search needs one thing the sim cannot give it: an honest answer to "how
// far is it from HERE to THERE, going round the walls". Straight-line distance
// is worse than useless in a cave — an apple three metres away through a metre
// of rock reads as nearly reached, and a heuristic that says so drives the
// whole search into the rock and keeps it there.
//
// So: a uniform occupancy grid over the level, a clearance value per cell, and
// a Dijkstra distance field per goal over the cells a bike could physically
// occupy. That is the heuristic the search is steered by, and it is also what
// makes a FAILURE legible — "reached the cell 4 m short of apple 3 and never
// got past it" is actionable in a way that "search exhausted" is not.
//
// Nothing here is part of the sim or affects a result. It reads the compiled
// level's vertices and nothing else, so it may use whatever maths it likes;
// the sim's Math.* ban applies to src/sim and stops at its door.
import type { CompiledPolygon, Level } from '@/sim/level.ts';
import { pointInSolid } from '@/sim/level.ts';
import { Heap } from './heap.ts';

export interface Field {
  /** Cell size, metres. */
  cell: number;
  /** World coordinate of the centre of cell (0, 0). */
  ox: number;
  oy: number;
  w: number;
  h: number;
  /**
   * Distance from each cell centre to the nearest solid surface, metres.
   * Negative inside solid. Approximate only in that it is sampled at cell
   * centres — it is exact for the point it is sampled at.
   */
  clear: Float32Array;
  /** 1 where `clear` is at least the traversability radius. */
  free: Uint8Array;
  /** The radius `free` was computed against. */
  minClear: number;
}

const INF = Infinity;

/** Exact distance from a point to a segment. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey;
  let t = len2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = px - (ax + ex * t);
  const dy = py - (ay + ey * t);
  return Math.sqrt(dx * dx + dy * dy);
}

function solidAt(polys: readonly CompiledPolygon[], x: number, y: number): boolean {
  for (const p of polys) if (pointInSolid(p, x, y)) return true;
  return false;
}

/**
 * Every collidable edge, bucketed by world column, plus an exact
 * nearest-surface query over it.
 *
 * The bike's head is a death sphere and "how close did the winning line come to
 * dying" is one of the difficulty measures, so that query has to be EXACT, not
 * a grid sample. The sim's own broadphase would do it, but it is indexed for
 * "which edges overlap this circle" and answering "how far to the nearest edge"
 * through it means guessing a radius and growing it. A column bucket is simpler
 * and this is not on the sim's hot path.
 */
export interface EdgeIndex {
  ax: Float64Array;
  ay: Float64Array;
  bx: Float64Array;
  by: Float64Array;
  cols: Int32Array[];
  x0: number;
  col: number;
  n: number;
  /** Edges beyond this from a column are not indexed into it. */
  reach: number;
}

export function buildEdgeIndex(level: Level, col = 2, reach = 6): EdgeIndex {
  const ax: number[] = [];
  const ay: number[] = [];
  const bx: number[] = [];
  const by: number[] = [];
  for (const p of level.polys) {
    const n = p.vx.length;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      ax.push(p.vx[i]);
      ay.push(p.vy[i]);
      bx.push(p.vx[j]);
      by.push(p.vy[j]);
    }
  }
  const x0 = level.minX - reach - col;
  const n = Math.max(1, Math.ceil((level.maxX - level.minX + (reach + col) * 2) / col));
  const lists: number[][] = [];
  for (let i = 0; i < n; i++) lists.push([]);
  for (let e = 0; e < ax.length; e++) {
    const lo = Math.max(0, Math.floor((Math.min(ax[e], bx[e]) - reach - x0) / col));
    const hi = Math.min(n - 1, Math.ceil((Math.max(ax[e], bx[e]) + reach - x0) / col));
    for (let c = lo; c <= hi; c++) lists[c].push(e);
  }
  return {
    ax: Float64Array.from(ax),
    ay: Float64Array.from(ay),
    bx: Float64Array.from(bx),
    by: Float64Array.from(by),
    cols: lists.map((l) => Int32Array.from(l)),
    x0,
    col,
    n,
    reach,
  };
}

/**
 * Distance from a point to the nearest collidable surface, metres. Returns
 * `reach` when nothing is indexed nearby — a saturating "plenty of room", which
 * is all any caller here wants.
 */
export function nearestSurface(ix: EdgeIndex, x: number, y: number): number {
  let c = Math.floor((x - ix.x0) / ix.col);
  if (c < 0) c = 0;
  else if (c >= ix.n) c = ix.n - 1;
  const list = ix.cols[c];
  let best = ix.reach;
  for (let k = 0; k < list.length; k++) {
    const e = list[k];
    const d = segDist(x, y, ix.ax[e], ix.ay[e], ix.bx[e], ix.by[e]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Build the occupancy grid.
 *
 * `minClear` is the radius of the disc that has to fit, and it is deliberately
 * a little under what the bike really needs: the field is a HEURISTIC, and one
 * that declares a passable gap impassable would hide a real route, which is the
 * exact failure mode the whole solver exists to stop repeating. Optimistic here
 * costs search time; pessimistic costs correctness.
 */
export function buildField(level: Level, cell = 0.5, minClear = 0.3): Field {
  const pad = 2;
  const ox = level.minX - pad;
  const oy = level.minY - pad;
  const w = Math.max(1, Math.ceil((level.maxX - level.minX + pad * 2) / cell));
  const h = Math.max(1, Math.ceil((level.maxY - level.minY + pad * 2) / cell));
  const clear = new Float32Array(w * h);
  const free = new Uint8Array(w * h);
  const ix = buildEdgeIndex(level, Math.max(1, cell * 4), 4);

  for (let cx = 0; cx < w; cx++) {
    const x = ox + cx * cell;
    for (let cy = 0; cy < h; cy++) {
      const y = oy + cy * cell;
      const best = nearestSurface(ix, x, y);
      const idx = cy * w + cx;
      const inside = solidAt(level.polys, x, y);
      clear[idx] = inside ? -best : best;
      free[idx] = !inside && best >= minClear ? 1 : 0;
    }
  }
  return { cell, ox, oy, w, h, clear, free, minClear };
}

export function cellOf(f: Field, x: number, y: number): number {
  const cx = Math.round((x - f.ox) / f.cell);
  const cy = Math.round((y - f.oy) / f.cell);
  if (cx < 0 || cy < 0 || cx >= f.w || cy >= f.h) return -1;
  return cy * f.w + cx;
}

/** Nearest free cell to a world point, searching outward. -1 if none within `rings`. */
export function nearestFree(f: Field, x: number, y: number, rings = 8): number {
  const cx = Math.round((x - f.ox) / f.cell);
  const cy = Math.round((y - f.oy) / f.cell);
  for (let r = 0; r <= rings; r++) {
    let best = -1;
    let bestD = INF;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const gx = cx + dx;
        const gy = cy + dy;
        if (gx < 0 || gy < 0 || gx >= f.w || gy >= f.h) continue;
        const i = gy * f.w + gx;
        if (f.free[i] === 0) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

const NEIGH = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

/**
 * Geodesic distance in metres from every free cell to (tx, ty), through free
 * cells only. Infinity where the goal cannot be reached at all — which is a
 * real answer and the caller must treat it as one.
 *
 * `blocked` masks cells out on top of `free`. It exists because the grid is
 * OPTIMISTIC by design: it knows whether a disc fits, not whether a bike could
 * get there, so it will happily route a route straight up a three-metre wall.
 * When the search proves it wrong by stalling at the same spot under every
 * strategy, the solver blocks that spot and asks again — see `solve.ts`.
 */
export function geodesic(f: Field, tx: number, ty: number, blocked?: Uint8Array): Float64Array {
  // Float64 and not Float32, and this is a bug that already happened: a float32
  // store rounds the distance, the next comparison is done in float64 against
  // the rounded value, and when the rounding went UP the same cell improves on
  // itself forever. The Dijkstra still terminated — it just took 8.8 seconds on
  // a nine-thousand-cell grid instead of four milliseconds.
  const d = new Float64Array(f.w * f.h).fill(INF);
  const open = (i: number): boolean => f.free[i] !== 0 && (blocked === undefined || blocked[i] === 0);
  let start = nearestFree(f, tx, ty);
  if (start >= 0 && !open(start)) start = -1;
  if (start < 0) return d;
  const heap = new Heap();
  d[start] = 0;
  heap.push(0, start);
  while (heap.size > 0) {
    const i = heap.pop();
    const di = d[i];
    // Lazy deletion: this entry was superseded before it came up.
    if (di === INF) continue;
    const cx = i % f.w;
    const cy = (i - cx) / f.w;
    for (const [dx, dy, cost] of NEIGH) {
      const gx = cx + dx;
      const gy = cy + dy;
      if (gx < 0 || gy < 0 || gx >= f.w || gy >= f.h) continue;
      const j = gy * f.w + gx;
      if (!open(j)) continue;
      const nd = di + cost * f.cell;
      if (nd < d[j]) {
        d[j] = nd;
        heap.push(nd, j);
      }
    }
  }
  return d;
}

/**
 * Read a distance field at a world point, tolerating a bike that is standing
 * somewhere the field calls solid — which happens constantly, because the field
 * samples cell centres and a wheel legitimately sits within a wheel radius of
 * the floor. Falls back outward, then to a straight line, so the heuristic
 * degrades rather than returning Infinity and stalling the search.
 */
export function distAt(f: Field, d: Float64Array, x: number, y: number, tx: number, ty: number): number {
  const cx = Math.round((x - f.ox) / f.cell);
  const cy = Math.round((y - f.oy) / f.cell);
  let best = INF;
  for (let r = 0; r <= 4 && best === INF; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const gx = cx + dx;
        const gy = cy + dy;
        if (gx < 0 || gy < 0 || gx >= f.w || gy >= f.h) continue;
        const v = d[gy * f.w + gx];
        if (v < best) best = v;
      }
    }
  }
  if (best === INF) {
    const ddx = tx - x;
    const ddy = ty - y;
    // 1.6x a straight line: unreachable-through-the-grid but obviously not
    // infinitely far. Optimistic enough to keep the node ordered sensibly.
    return Math.sqrt(ddx * ddx + ddy * ddy) * 1.6;
  }
  return best;
}
