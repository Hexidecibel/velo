// The geometry the art is derived from: edges classified by which way they face
// the air, and the convex corners where a floor stops being a floor.
//
// Pure — no canvas, no DOM, no Path2D. That is deliberate: this is the half of
// the art that can be unit-tested in plain node, and it is also the half that
// decides whether the art tells the truth about the collision surface. A
// mis-classified edge paints a ceiling like a floor, which is a lie the player
// pays for.
//
// `CompiledPolygon.nx/ny` is already the normal pointing OUT OF THE SOLID,
// which is the same thing as the air-facing normal. No flip is needed here and
// none must be added: the sim and the art must agree about which side the
// material is on, and the single shared array is what guarantees they do.
import type { CompiledPolygon } from '@/sim/level.ts';

export type EdgeClass = 'top' | 'side' | 'under';

export interface ArtEdge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Air-facing unit normal. */
  nx: number;
  ny: number;
  /** Unit direction along the edge. */
  dx: number;
  dy: number;
  len: number;
  cls: EdgeClass;
}

/**
 * Up-facing, down-facing, or neither.
 *
 * 0.6 is roughly 53 degrees off horizontal, and it is the right number because
 * it matches what the bike can actually use: a surface you can land and ride on
 * gets the lit treatment, a surface that will drop you gets the side treatment.
 * Tuning it moves where "ramp" turns into "wall" in the player's reading of the
 * frame, so it belongs on the panel and not in a literal.
 */
export function classify(ny: number, t = 0.6): EdgeClass {
  return ny > t ? 'top' : ny < -t ? 'under' : 'side';
}

export function edgesOfPoly(p: CompiledPolygon, t = 0.6): ArtEdge[] {
  const n = p.vx.length;
  const out: ArtEdge[] = new Array<ArtEdge>(n);
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const ex = p.vx[j] - p.vx[i];
    const ey = p.vy[j] - p.vy[i];
    const len = Math.sqrt(ex * ex + ey * ey);
    const inv = len > 0 ? 1 / len : 0;
    out[i] = {
      x0: p.vx[i], y0: p.vy[i], x1: p.vx[j], y1: p.vy[j],
      nx: p.nx[i], ny: p.ny[i],
      dx: ex * inv, dy: ey * inv,
      len,
      cls: classify(p.ny[i], t),
    };
  }
  return out;
}

/** A drop-off: a top edge meeting a side edge at a corner convex in the SOLID. */
export interface HazardCorner {
  /** The shared vertex. */
  x: number;
  y: number;
  top: ArtEdge;
  side: ArtEdge;
  /** Metres of top edge available for the block, before clipping. */
  runTop: number;
  /** Metres of side edge available. */
  runSide: number;
}

export interface HazardOpts {
  /** Minimum turn (sine of the corner angle) to count as a corner and not as arc tessellation. */
  minTurn: number;
  /** The side edge must fall at least this far below the corner. */
  minDrop: number;
  /** Both edges must be at least this long. */
  minRun: number;
}

export const DEFAULT_HAZARD: HazardOpts = { minTurn: 0.2, minDrop: 0.45, minRun: 0.35 };

/**
 * Every convex top-to-side corner in a polygon — which is to say, every ledge
 * you can ride off. Marking them all is the whole value: it costs nothing per
 * level and it means a generated level warns you about its drop-offs without
 * anybody having looked at it.
 *
 * THE SIGN OF "CONVEX" DEPENDS ON WHICH SIDE THE SOLID IS. Both kinds of ring
 * are normalised to counter-clockwise by the loader, so on a `ground` polygon
 * the solid is on the LEFT of the direction of travel and a convex corner is a
 * left turn; on a `cave` the solid is on the RIGHT and it is a right turn. The
 * mockup only ever ran on ground polygons and so only needed one sign — most of
 * our levels are a single cave, so getting this wrong would put chevrons on
 * every inside corner of a room and none on any actual ledge.
 *
 * `minTurn` is what keeps a tessellated arc from sprouting chevrons along its
 * whole length: a curve compiled at the level's sag tolerance turns by a small
 * angle per segment, and a real ledge turns by something near a right angle.
 */
export function hazardCorners(
  p: CompiledPolygon,
  edges: ArtEdge[],
  o: HazardOpts = DEFAULT_HAZARD,
): HazardCorner[] {
  const out: HazardCorner[] = [];
  const s = p.solidInside ? 1 : -1;
  const n = edges.length;
  for (let i = 0; i < n; i++) {
    const a = edges[i];
    const b = edges[i + 1 === n ? 0 : i + 1];
    if (a.cls === b.cls) continue;
    const top = a.cls === 'top' ? a : b.cls === 'top' ? b : null;
    const side = a.cls === 'side' ? a : b.cls === 'side' ? b : null;
    if (!top || !side) continue;
    if ((a.dx * b.dy - a.dy * b.dx) * s <= o.minTurn) continue;
    if (top.len < o.minRun || side.len < o.minRun) continue;
    // The far end of the side edge has to be BELOW the corner. A top meeting a
    // side that rises out of it is an inside wall, not a ledge, and putting
    // hazard stripes on it would cry wolf.
    const cy = a.y1;
    const otherY = side === a ? a.y0 : b.y1;
    if (otherY > cy - o.minDrop) continue;
    out.push({ x: a.x1, y: cy, top, side, runTop: top.len, runSide: side.len });
  }
  return out;
}

// --- spatial chunking -------------------------------------------------------
//
// Baked art geometry is split into a world grid so that a frame pays for what is
// on screen and not for the level. A 428 m level holds a few thousand blotches;
// asking the rasteriser to walk all of them 60 times a second to show 30 m of
// them is the difference between this being free and this being the frame
// budget.

// 12 m. Big enough that the per-chunk draw calls stay in the dozens, small
// enough that a chunk is not several times the viewport — which is what decides
// how much baked texture gets rasterised only to be clipped away. Measured: 24 m
// chunks cost roughly a third more on a level whose solid fills the screen.
export const CHUNK = 12;

export interface ChunkRange {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function chunkKey(cx: number, cy: number): number {
  // Chunk indices are small signed integers; this packs them into one number so
  // the map key is a number and not a string built 60 times a second.
  return ((cx + 4096) << 13) | (cy + 4096);
}

export function chunkRange(minX: number, minY: number, maxX: number, maxY: number): ChunkRange {
  return {
    x0: Math.floor(minX / CHUNK),
    y0: Math.floor(minY / CHUNK),
    x1: Math.floor(maxX / CHUNK),
    y1: Math.floor(maxY / CHUNK),
  };
}

/** A rectangle of chunk indices, and a key that changes when it does. */
export interface ChunkWindow {
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  key: number;
}

export function chunkWindow(b: { minX: number; minY: number; maxX: number; maxY: number }): ChunkWindow {
  const cx0 = Math.floor(b.minX / CHUNK);
  const cy0 = Math.floor(b.minY / CHUNK);
  const cx1 = Math.floor(b.maxX / CHUNK);
  const cy1 = Math.floor(b.maxY / CHUNK);
  return { cx0, cy0, cx1, cy1, key: (((cx0 + 2048) * 4096 + (cy0 + 2048)) * 64 + (cx1 - cx0)) * 64 + (cy1 - cy0) };
}

/** World bounds of the viewport, in metres, padded. */
export function viewBounds(
  camX: number, camY: number, zoom: number, cssW: number, cssH: number, pad = 0,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const hw = cssW / 2 / zoom + pad;
  const hh = cssH / 2 / zoom + pad;
  return { minX: camX - hw, minY: camY - hh, maxX: camX + hw, maxY: camY + hh };
}

export function segInView(
  x0: number, y0: number, x1: number, y1: number,
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
  if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
  return !(x1 < b.minX || x0 > b.maxX || y1 < b.minY || y0 > b.maxY);
}
