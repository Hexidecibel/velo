// Where there is room, and where there is not.
//
// This is the half of the prop system that decides whether the art is allowed
// to lie. The Phase 1 report named the blocker precisely — "a rule for where a
// prop goes" — and it also recorded the way the first attempt went wrong:
// bracketed pipework slung under a ledge read as solid geometry and hung
// through 19-low-roof's corridor, the level whose entire lesson is head
// clearance. The fix was not a colour. It was measuring the playable space near
// a candidate site and refusing to place anything that could be mistaken for
// terrain.
//
// So: rasterise the level's solid into a grid once, run a distance transform
// over it, and every later question — "how much air is here", "is this a big
// open room", "is there a floor two metres under this ceiling" — is a lookup.
// Pure numbers, no canvas, testable in plain node, which is exactly what the
// clearance rule needs to be if it is to be asserted rather than eyeballed.
import type { Level } from '@/sim/level.ts';
import { pointInSolid } from '@/sim/level.ts';
import type { ArtEdge } from './geom.ts';
import { DEFAULT_HAZARD, edgesOfPoly, hazardCorners } from './geom.ts';

/**
 * Grid pitch, metres. Half a metre is a third of a wheel diameter: fine enough
 * that no wall in any of the twenty levels falls through it, coarse enough that
 * the biggest level is thirty-five thousand cells and the whole build is under
 * a millisecond.
 */
export const CELL = 0.5;

export interface SolidField {
  /** World position of the centre of cell (0, 0). */
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  cell: number;
  /** 1 where the cell is solid or an edge crosses it. */
  solid: Uint8Array;
  /** Metres from this cell to the nearest solid cell. 0 inside solid. */
  clear: Float32Array;
}

function idx(f: SolidField, cx: number, cy: number): number {
  return cy * f.cols + cx;
}

/**
 * Rasterise the level's solid, then measure the free air everywhere.
 *
 * Two passes make a cell solid: its centre is inside solid material, OR a
 * collision edge crosses it. The second is not redundant — a wall thinner than
 * the grid pitch has no cell centres inside it and would otherwise read as open
 * air, which is the one error that could put a prop inside a wall. Marking
 * every cell an edge passes through is conservative in the right direction: it
 * can only ever make the field think there is LESS room than there is, and
 * every rule below refuses placement when there is not enough room.
 */
export function buildField(level: Level, cell = CELL): SolidField {
  const pad = 2;
  const x0 = level.minX - pad;
  const y0 = level.minY - pad;
  const cols = Math.max(1, Math.ceil((level.maxX - level.minX + pad * 2) / cell));
  const rows = Math.max(1, Math.ceil((level.maxY - level.minY + pad * 2) / cell));
  const f: SolidField = {
    x0: x0 + cell / 2, y0: y0 + cell / 2, cols, rows, cell,
    solid: new Uint8Array(cols * rows),
    clear: new Float32Array(cols * rows),
  };

  for (let cy = 0; cy < rows; cy++) {
    const wy = f.y0 + cy * cell;
    for (let cx = 0; cx < cols; cx++) {
      const wx = f.x0 + cx * cell;
      let solid = false;
      for (const p of level.polys) {
        if (pointInSolid(p, wx, wy)) { solid = true; break; }
      }
      if (solid) f.solid[idx(f, cx, cy)] = 1;
    }
  }

  // Stamp every edge into the grid, so a thin wall cannot vanish between two
  // sample points.
  for (const p of level.polys) {
    const n = p.vx.length;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      stampSegment(f, p.vx[i], p.vy[i], p.vx[j], p.vy[j]);
    }
  }

  distanceTransform(f);
  return f;
}

function stampSegment(f: SolidField, ax: number, ay: number, bx: number, by: number): void {
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil((len / f.cell) * 2));
  for (let s = 0; s <= steps; s++) {
    const u = s / steps;
    const cx = Math.round((ax + (bx - ax) * u - f.x0) / f.cell);
    const cy = Math.round((ay + (by - ay) * u - f.y0) / f.cell);
    if (cx < 0 || cy < 0 || cx >= f.cols || cy >= f.rows) continue;
    f.solid[idx(f, cx, cy)] = 1;
  }
}

/**
 * Chamfer distance transform, two sweeps.
 *
 * 1 and sqrt(2) weights, which over-estimates true Euclidean distance by at
 * most about 8 per cent on a diagonal. That error is in the SAFE direction for
 * everything here: it reports slightly more room than there is only along
 * diagonals, and every clearance rule carries a margin larger than the error.
 * Outside the grid counts as solid, so a prop cannot be placed hanging off the
 * edge of the world.
 */
function distanceTransform(f: SolidField): void {
  const BIG = 1e9;
  const D = f.clear;
  const d1 = f.cell;
  const d2 = f.cell * Math.SQRT2;
  for (let i = 0; i < D.length; i++) D[i] = f.solid[i] ? 0 : BIG;

  const at = (cx: number, cy: number): number =>
    cx < 0 || cy < 0 || cx >= f.cols || cy >= f.rows ? 0 : D[cy * f.cols + cx];

  for (let cy = 0; cy < f.rows; cy++) {
    for (let cx = 0; cx < f.cols; cx++) {
      const i = cy * f.cols + cx;
      if (D[i] === 0) continue;
      let v = D[i];
      v = Math.min(v, at(cx - 1, cy) + d1, at(cx, cy - 1) + d1);
      v = Math.min(v, at(cx - 1, cy - 1) + d2, at(cx + 1, cy - 1) + d2);
      D[i] = v;
    }
  }
  for (let cy = f.rows - 1; cy >= 0; cy--) {
    for (let cx = f.cols - 1; cx >= 0; cx--) {
      const i = cy * f.cols + cx;
      if (D[i] === 0) continue;
      let v = D[i];
      v = Math.min(v, at(cx + 1, cy) + d1, at(cx, cy + 1) + d1);
      v = Math.min(v, at(cx + 1, cy + 1) + d2, at(cx - 1, cy + 1) + d2);
      D[i] = v;
    }
  }
}

/** Metres of free air at a world point. 0 inside solid, 0 outside the grid. */
export function clearanceAt(f: SolidField, x: number, y: number): number {
  const cx = Math.round((x - f.x0) / f.cell);
  const cy = Math.round((y - f.y0) / f.cell);
  if (cx < 0 || cy < 0 || cx >= f.cols || cy >= f.rows) return 0;
  return f.clear[cy * f.cols + cx];
}

export function isSolidAt(f: SolidField, x: number, y: number): boolean {
  const cx = Math.round((x - f.x0) / f.cell);
  const cy = Math.round((y - f.y0) / f.cell);
  if (cx < 0 || cy < 0 || cx >= f.cols || cy >= f.rows) return true;
  return f.solid[cy * f.cols + cx] === 1;
}

/**
 * The worst clearance anywhere in an axis-aligned box.
 *
 * THE FUNCTION THE WHOLE CLEARANCE RULE IS BUILT ON. A prop is not a point; the
 * question is never "is there room where I want to put it" but "is there room
 * for all of it, plus the margin that keeps a player from having to look
 * carefully". Sampling the box rather than the anchor is what stops a lamp
 * being mounted in a corridor whose ceiling is a metre above the anchor.
 */
export function worstClearance(
  f: SolidField, minX: number, minY: number, maxX: number, maxY: number,
): number {
  let worst = Infinity;
  const step = f.cell;
  for (let y = minY; y <= maxY + 1e-9; y += step) {
    for (let x = minX; x <= maxX + 1e-9; x += step) {
      const c = clearanceAt(f, x, y);
      if (c < worst) worst = c;
    }
    if (worst === 0) break;
  }
  // Corners explicitly: the loop above steps from the minimum and can stop just
  // short of the maximum.
  for (const [x, y] of [[minX, maxY], [maxX, minY], [maxX, maxY]] as const) {
    const c = clearanceAt(f, x, y);
    if (c < worst) worst = c;
  }
  return worst === Infinity ? 0 : worst;
}

// --- candidate sites --------------------------------------------------------

export type SiteKind = 'pocket' | 'wall' | 'ceiling' | 'ledge' | 'floor';

export interface Site {
  kind: SiteKind;
  /** Anchor, in AIR for a surface site and at the centre for a pocket. */
  x: number;
  y: number;
  /** Unit direction from the surface into the air. (0, 0) for a pocket. */
  nx: number;
  ny: number;
  /** Direction ALONG the surface, and how many metres of it there are. */
  dx: number;
  dy: number;
  run: number;
  /**
   * FREE DISTANCE ALONG THE NORMAL: how far you can travel straight out from
   * this surface before hitting something. For a ceiling that is the head
   * clearance under it, which is the number 19-low-roof's whole lesson is about
   * and the number Phase 1's pipework did not consult.
   *
   * Emphatically NOT the clearance field sampled a metre out — that was the
   * first version and it is wrong in a way that quietly disables the entire
   * rule: the field measures distance to the NEAREST solid, and a point one
   * metre off a wall is one metre from that wall, so every surface site in
   * every level reported about 1.0 and every fixture was refused.
   */
  clear: number;
  /** Radius of the largest open space this surface faces. Used for sizing. */
  room: number;
  /** Deterministic ordering key, so the site list never depends on iteration luck. */
  rank: number;
}

export interface SiteOpts {
  /** A pocket must have at least this much air around its centre. */
  pocketClear: number;
  /** Surfaces shorter than this carry nothing. */
  minRun: number;
  /** A wall or ceiling site needs at least this much air in front of it. */
  minClear: number;
}

export const DEFAULT_SITES: SiteOpts = { pocketClear: 3.2, minRun: 2.6, minClear: 2.2 };

/**
 * Every place in the level worth dressing, in a stable order.
 *
 * The rules are the ones the Phase 1 author sketched, refined against what the
 * twenty real levels actually contain:
 *
 *  - **pocket** — a local maximum of the clearance field. These are the rooms:
 *    the cathedral's nave, the chimney's shaft, the open half of a drop. Big
 *    flat art goes here because it is the only place with room for it, and
 *    because it is the one kind of site where nothing is near enough to a
 *    collision edge to be misread as part of one.
 *  - **wall** — a long near-vertical face with air in front. Ladders, conduit,
 *    lamps, posters. This is where most set dressing in a real place lives.
 *  - **ceiling** — a long down-facing edge with real height beneath it. The
 *    site that has to be hardest to earn, because it is the one that went wrong.
 *  - **ledge** — the convex corner where a top edge meets a side edge: the
 *    thing you ride off. Already computed for the hazard chevrons; a ladder or
 *    a sign belongs at exactly the same place a warning does.
 *  - **floor** — a long up-facing edge. Only ever carries paint, never an
 *    object, so it cannot be mistaken for something to hit.
 */
export function findSites(
  level: Level, f: SolidField, faceT: number, o: SiteOpts = DEFAULT_SITES,
): Site[] {
  const out: Site[] = [];

  for (const p of level.polys) {
    const E = edgesOfPoly(p, faceT);
    const n = E.length;
    // Merge runs of consecutive edges that face the same way and lie nearly
    // straight, so a tessellated arc offers ONE site rather than eighty. A wall
    // is a wall whether the author drew it as one segment or as a curve.
    let i = 0;
    while (i < n) {
      const start = E[i];
      let j = i;
      let len = 0;
      while (j < n && E[j].cls === start.cls && Math.abs(E[j].dx * start.dx + E[j].dy * start.dy) > 0.985) {
        len += E[j].len;
        j++;
      }
      if (len >= o.minRun) addSite(out, f, start, E[j - 1], len, o);
      i = j > i ? j : i + 1;
    }

    // Ledge ends. The same corners the hazard chevrons mark, which is the point:
    // a ladder or a sign belongs exactly where a warning does, and reusing the
    // detector means the two can never disagree about where the drop is.
    for (const c of hazardCorners(p, E, DEFAULT_HAZARD)) {
      // Measured from the middle of the side face, out into the drop.
      const mx = (c.side.x0 + c.side.x1) / 2;
      const my = (c.side.y0 + c.side.y1) / 2;
      const { gap, room } = rayGap(f, mx, my, c.side.nx, c.side.ny);
      if (gap < o.minClear) continue;
      out.push({
        kind: 'ledge',
        x: mx + c.side.nx * 0.02, y: my + c.side.ny * 0.02,
        nx: c.side.nx, ny: c.side.ny,
        dx: c.side.dx, dy: c.side.dy,
        run: c.runSide,
        clear: gap,
        room,
        rank: rankOf(c.x, c.y, 'ledge'),
      });
    }
  }

  pockets(level, f, out, o);

  // Stable order. Placement then walks this list, so a level's dressing must
  // not depend on the order polygons happen to be listed in.
  out.sort((a, b) => a.rank - b.rank);
  return out;
}

function addSite(out: Site[], f: SolidField, a: ArtEdge, b: ArtEdge, run: number, o: SiteOpts): void {
  const mx = (a.x0 + b.x1) / 2;
  const my = (a.y0 + b.y1) / 2;
  const nx = a.nx;
  const ny = a.ny;
  const { gap, room } = rayGap(f, mx, my, nx, ny);
  const kind: SiteKind = a.cls === 'top' ? 'floor' : a.cls === 'under' ? 'ceiling' : 'wall';
  if (kind !== 'floor' && gap < o.minClear) return;
  out.push({
    kind,
    x: mx + nx * 0.02, y: my + ny * 0.02,
    nx, ny,
    dx: a.dx, dy: a.dy,
    run,
    clear: gap,
    room,
    rank: rankOf(mx, my, kind),
  });
}

/**
 * March out from a surface along its normal.
 *
 * Returns how far you get before hitting solid, and the widest the space gets
 * on the way. Capped at `max` because "there is nothing above this ledge for
 * three hundred metres" and "there is nothing above this ledge for twenty" mean
 * the same thing to a prop.
 */
export function rayGap(
  f: SolidField, x: number, y: number, nx: number, ny: number, max = 20,
): { gap: number; room: number } {
  let room = 0;
  const step = f.cell;
  for (let d = step; d <= max; d += step) {
    const px = x + nx * d;
    const py = y + ny * d;
    if (isSolidAt(f, px, py)) return { gap: d - step, room };
    const c = clearanceAt(f, px, py);
    if (c > room) room = c;
  }
  return { gap: max, room };
}

/**
 * Local maxima of the clearance field: the open rooms.
 *
 * Non-maximum suppression by a radius proportional to the clearance itself, so
 * one big room contributes one pocket rather than a cluster of near-identical
 * ones. Scanned in a fixed order and suppressed greedily from the most open
 * cell down, which makes the result a function of the level and nothing else.
 */
function pockets(level: Level, f: SolidField, out: Site[], o: SiteOpts): void {
  const cand: { x: number; y: number; c: number }[] = [];
  for (let cy = 1; cy < f.rows - 1; cy++) {
    for (let cx = 1; cx < f.cols - 1; cx++) {
      const c = f.clear[cy * f.cols + cx];
      if (c < o.pocketClear) continue;
      const x = f.x0 + cx * f.cell;
      const y = f.y0 + cy * f.cell;
      // Only inside the level's own bounds: the region the wall covers extends
      // well past the geometry, and the open air out there is not a room.
      if (x < level.minX || x > level.maxX || y < level.minY || y > level.maxY) continue;
      let isMax = true;
      for (let k = -1; k <= 1 && isMax; k++) {
        for (let l = -1; l <= 1; l++) {
          if (f.clear[(cy + k) * f.cols + (cx + l)] > c) { isMax = false; break; }
        }
      }
      if (isMax) cand.push({ x, y, c });
    }
  }
  cand.sort((a, b) => b.c - a.c || a.x - b.x || a.y - b.y);
  const taken: { x: number; y: number; r: number }[] = [];
  for (const p of cand) {
    let hit = false;
    for (const t of taken) {
      if ((p.x - t.x) ** 2 + (p.y - t.y) ** 2 < t.r * t.r) { hit = true; break; }
    }
    if (hit) continue;
    taken.push({ x: p.x, y: p.y, r: Math.max(6, p.c * 1.8) });
    out.push({
      kind: 'pocket',
      x: p.x, y: p.y,
      nx: 0, ny: 1,
      dx: 1, dy: 0,
      run: p.c * 2,
      clear: p.c,
      room: p.c,
      rank: rankOf(p.x, p.y, 'pocket'),
    });
  }
}

/** Position-derived ordering. Left to right, then bottom to top, then by kind. */
function rankOf(x: number, y: number, kind: SiteKind): number {
  const k = ['pocket', 'wall', 'ceiling', 'ledge', 'floor'].indexOf(kind);
  return Math.round(x * 1000) * 100000 + Math.round(y * 100) * 10 + k;
}

/**
 * What fraction of a viewport is solid.
 *
 * The cheap honest predictor of what a frame will cost, and the reason the
 * field is kept past the bake. Phase 1's measurements say art cost tracks
 * VISIBLE SOLID AREA rather than level size — which is why 20-close-quarters,
 * the shortest level in the set, is the most expensive: its whole 17 m height
 * is on screen and the solid fills nine tenths of the frame.
 *
 * Ninety-six lookups at the default resolution, which is nothing, and unlike
 * measured frame time it is knowable BEFORE the frame is drawn. That matters:
 * reacting only to measurement means quality is always one frame behind, and
 * one frame behind is exactly the frame that drops.
 */
export function solidFraction(
  f: SolidField,
  b: { minX: number; minY: number; maxX: number; maxY: number },
  nx = 12, ny = 8,
): number {
  let hit = 0;
  for (let j = 0; j < ny; j++) {
    const y = b.minY + ((j + 0.5) / ny) * (b.maxY - b.minY);
    for (let i = 0; i < nx; i++) {
      const x = b.minX + ((i + 0.5) / nx) * (b.maxX - b.minX);
      if (isSolidAt(f, x, y)) hit++;
    }
  }
  return hit / (nx * ny);
}

/**
 * How solid a typical FRAME of this level is, while somebody is driving it.
 *
 * Averaged over screen-sized windows centred on air the player can actually
 * occupy — not over the level's bounding box, which on a 290 x 11 m level is
 * mostly the margin above and below and says nothing about what is on screen.
 *
 * This is what makes the prop budget level-aware. Cost tracks visible solid
 * area, so the levels with the least headroom are the ones whose frames are
 * mostly material, and those are exactly the levels where new decoration has
 * to justify itself hardest.
 */
export function playSolidFraction(
  f: SolidField, level: { minX: number; minY: number; maxX: number; maxY: number },
  winW = 26, winH = 15,
): number {
  let sum = 0;
  let n = 0;
  const stepX = Math.max(f.cell * 8, (level.maxX - level.minX) / 40);
  const stepY = Math.max(f.cell * 6, (level.maxY - level.minY) / 24);
  for (let x = level.minX; x <= level.maxX; x += stepX) {
    for (let y = level.minY; y <= level.maxY; y += stepY) {
      if (clearanceAt(f, x, y) < 0.8) continue;
      sum += solidFraction(f, { minX: x - winW / 2, minY: y - winH / 2, maxX: x + winW / 2, maxY: y + winH / 2 }, 10, 7);
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}
