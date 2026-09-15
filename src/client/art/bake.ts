// Bake the level's art ONCE, into world-space Path2D objects, chunked.
//
// This is the answer to the only real risk in porting the mockup: the mockup
// draws one static frame into cached screen-space layers, and the game has a
// camera that moves. Screen-space caching dies the instant you pan, and the
// obvious replacement — a world-space TILE cache of rendered pixels — buys a
// hitch every time you cross a tile boundary, a memory budget, a zoom ladder
// and an invalidation policy.
//
// None of that is necessary, because the expensive thing was never the pixels.
// It was rebuilding the geometry: a few thousand seeded blotches, cracks,
// hatch lines, stains and stencil placements, reconstructed from the RNG every
// frame. Build them once as Path2D in WORLD coordinates and a frame becomes a
// few dozen fills under the existing view transform — no cache to invalidate,
// nothing to pop in, and the result is exact at every zoom instead of being a
// scaled bitmap.
//
// The chunking is what keeps that true on a 428 m level: geometry is filed into
// a 24 m grid and a frame fills only the chunks the viewport touches, so the
// cost is bounded by the screen rather than by the level.
//
// Line widths are the one thing NOT baked. Ink and lip are screen-pixel widths
// (`w * px`, px = 1/zoom) because the readability rule is about what the eye can
// resolve, not about metres; cel bands and drips are world widths because they
// are material.
import type { CompiledPolygon, Level } from '@/sim/level.ts';
import type { ArtParams } from './params.ts';
import { faceThreshold } from './params.ts';
import type { Palette } from './palette.ts';
import { alpha, HAZE, HAZE_A, wash } from './palette.ts';
import { rng, seedFrom, substream } from './rng.ts';
import type { Rng } from './rng.ts';
import { CHUNK, chunkKey, edgesOfPoly, hazardCorners, DEFAULT_HAZARD } from './geom.ts';
import type { ArtEdge, EdgeClass } from './geom.ts';
import { STENCIL_KEYS } from './stencils.ts';
import type { Stamp } from './stencils.ts';

/** A pipe run under a ceiling. Drawn live because it is four strokes. */
export interface PipeRun {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dia: number;
  /** Bracket spacing, metres. */
  clampEvery: number;
}

/** A striped hazard block at a drop-off. */
export interface Chevron {
  quad: Path2D;
  stripes: Path2D;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Terrain texture for one 24 m chunk of one polygon. */
export interface TexChunk {
  patchA: Path2D;
  patchB: Path2D;
  cracks: Path2D;
}

/** Background wall content for one 24 m chunk. */
export interface WallChunk {
  toneDark: Path2D;
  toneLight: Path2D;
  stains: Path2D;
  grid: Path2D;
  gridHi: Path2D;
  stamps: Stamp[];
}

export interface BakedPoly {
  poly: CompiledPolygon;
  /** The ring itself. Also the ink stroke, and half of the solid clip. */
  ring: Path2D;
  /** Cel bands, by edge class. */
  bands: Record<EdgeClass, Path2D>;
  /** The coloured lip just inside the collision edge, by class. */
  lips: Record<EdgeClass, Path2D>;
  drips: Path2D;
  wear: Path2D;
  chevrons: Chevron[];
  /** Dark occlusion under every down-facing edge. */
  underShadow: Path2D;
  pipes: PipeRun[];
  stamps: Stamp[];
  tex: Map<number, TexChunk>;
  /**
   * The visible chunks' texture, merged into ONE path per layer.
   *
   * Not an optimisation of the bake but of the DRAW, and it is the difference
   * between this being affordable and not. Every texture layer is drawn inside a
   * clip to the solid, and a non-rectangular clip costs roughly a full-screen
   * mask PER DRAW CALL — so six visible chunks times three layers is eighteen of
   * them, and the pixels involved are nowhere near that. Merging collapses it to
   * three. Rebuilt only when the set of visible chunks changes, which at play
   * speed is a few times a second.
   */
  merged: { key: number; patchA: Path2D; patchB: Path2D; cracks: Path2D } | null;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface BakedLevel {
  /** What the bake was built for. A mismatch means rebake. */
  signature: string;
  palette: Palette;
  polys: BakedPoly[];
  /** Stepped luminance bands, lightest first. Strips, with bounds to cull by. */
  bands: { path: Path2D; color: string; minY: number; maxY: number }[];
  /** The hard light wedge, brightest last. */
  wedge: { path: Path2D; alpha: number; minX: number; maxX: number }[];
  wall: Map<number, WallChunk>;
  /** Region the wall and texture cover: level bounds plus a margin. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** For the haze: everything above this y gets the extra light wash. */
  brightY: number;
  /** Diagnostics, reported by bin/artbench. */
  stats: { subpaths: number; stamps: number; chevrons: number; pipes: number; ms: number };
}

/**
 * What the bake depends on. Everything else on ArtParams is a draw-time gate or
 * an alpha, on purpose: dragging a density slider must not rebuild a level's
 * geometry mid-drag, so `detail` scales opacity rather than count.
 */
export function bakeSignature(level: Level, p: ArtParams): string {
  return `${level.simHash}|${p.faceAngle}`;
}

// --- densities, in world units ----------------------------------------------
//
// Ported from the mockup at 90 px/m and then MEASURED DOWN. The mockup's 0.35 blotches per
// square metre and 0.156 m hatch pitch were free in a static frame and were
// together about half the cost of a moving one; at these numbers the surface
// still reads as worn concrete and the frame has headroom. `detail` on the panel
// takes them the rest of the way to flat.
// FEWER, BIGGER blotches for the same coverage. What costs on a canvas fill is
// the antialiased OUTLINE, not the interior, so halving the count and growing
// the radius keeps the grain and drops the price. Measured on 20-close-quarters,
// where the solid fills nine tenths of the screen and this layer was the single
// most expensive thing in the frame.
const PATCH_PER_M2 = 0.11;
const CRACK_PER_M2 = 0.035;
const PATCH_R_MIN = 0.4;
const PATCH_R_SPAN = 0.95;
const PANEL_W = 2.0;
const PANEL_H = 1.0;
const WALL_STAMP_PER_M2 = 0.012;
/**
 * Metres of free space a ceiling needs before anything gets hung under it.
 * Three and a half is about two bike-heights: enough that the pipework is
 * plainly above the line you ride and not something you have to read carefully.
 */
const PIPE_MIN_CLEARANCE = 3.5;
const REGION_MARGIN = 26;
const BAND_COUNT = 6;

export function bakeLevel(level: Level, params: ArtParams, palette: Palette): BakedLevel {
  const t0 = performance.now();
  const seed = seedFrom(level.simHash);
  const t = faceThreshold(params);

  const minX = level.minX - REGION_MARGIN;
  const minY = level.minY - REGION_MARGIN;
  const maxX = level.maxX + REGION_MARGIN;
  const maxY = level.maxY + REGION_MARGIN;

  const brightY = level.maxY - (level.maxY - level.minY) * 0.22;
  const out: BakedLevel = {
    signature: bakeSignature(level, params),
    palette,
    polys: [],
    bands: bakeLuminance(minX, minY, maxX, maxY, brightY, palette, substream(seed, 'lum')),
    wedge: bakeWedge(minX, minY, maxX, maxY, substream(seed, 'wedge')),
    wall: bakeWall(minX, minY, maxX, maxY, palette, seed),
    minX, minY, maxX, maxY,
    brightY,
    stats: { subpaths: 0, stamps: 0, chevrons: 0, pipes: 0, ms: 0 },
  };

  level.polys.forEach((poly, i) => {
    out.polys.push(bakePoly(poly, i, t, palette, seed, minX, minY, maxX, maxY, level.polys, out.stats));
  });

  for (const c of out.wall.values()) out.stats.stamps += c.stamps.length;
  out.stats.ms = performance.now() - t0;
  return out;
}

// --- terrain ----------------------------------------------------------------

function bakePoly(
  poly: CompiledPolygon,
  index: number,
  faceT: number,
  P: Palette,
  seed: number,
  rminX: number, rminY: number, rmaxX: number, rmaxY: number,
  all: readonly CompiledPolygon[],
  stats: BakedLevel['stats'],
): BakedPoly {
  const E = edgesOfPoly(poly, faceT);
  const ring = new Path2D();
  ring.moveTo(poly.vx[0], poly.vy[0]);
  for (let i = 1; i < poly.vx.length; i++) ring.lineTo(poly.vx[i], poly.vy[i]);
  ring.closePath();

  const bands: Record<EdgeClass, Path2D> = { top: new Path2D(), side: new Path2D(), under: new Path2D() };
  const lips: Record<EdgeClass, Path2D> = { top: new Path2D(), side: new Path2D(), under: new Path2D() };
  for (const e of E) {
    for (const p of [bands[e.cls], lips[e.cls]]) {
      p.moveTo(e.x0, e.y0);
      p.lineTo(e.x1, e.y1);
    }
  }

  // Drips off the underside bands, and the wear line under the top ones. Both
  // are what turn a flat cel band into a surface with a direction.
  const rd = substream(seed, `drip${index}`);
  const drips = new Path2D();
  const wear = new Path2D();
  const underShadow = new Path2D();
  const pipes: PipeRun[] = [];
  for (const e of E) {
    if (e.cls === 'under') {
      const n = Math.floor(e.len / 0.7);
      for (let i = 0; i < n; i++) {
        const u = (i + rd()) / n;
        const px = e.x0 + (e.x1 - e.x0) * u;
        const py = e.y0 + (e.y1 - e.y0) * u;
        const len = 0.1 + rd() * 0.35;
        const w = 0.08 + rd() * 0.08;
        roundRect(drips, px - w / 2, py - 0.38 - len, w, len + 0.38, w / 2);
      }
      // HOW MUCH ROOM IS ACTUALLY UNDER THIS CEILING. Everything below reads
      // it, and it is the difference between set dressing and a level the art
      // made unfair: a bracketed pipe slung under a ledge looks exactly like
      // collidable geometry, and hanging one inside a two-metre corridor — on
      // 19-low-roof, whose entire lesson is head clearance — would be the
      // renderer lying about where the ceiling is.
      // Only worth asking for an edge long enough to carry either treatment —
      // the query is O(every edge in the level) and a tessellated arc is
      // hundreds of centimetre-long undersides that get neither.
      const room = e.len > 1.2 ? clearanceUnder(all, e) : 0;

      // A hard dark band beneath a ceiling. Nothing about the geometry says
      // "there is no light under here", so the art has to. Clamped to under
      // half the free space, so a tight corridor does not go black.
      if (e.len > 1.2) {
        const depth = Math.min(2.4, room * 0.45);
        if (depth > 0.15) {
          underShadow.moveTo(e.x0, e.y0);
          underShadow.lineTo(e.x1, e.y1);
          underShadow.lineTo(e.x1, e.y1 - depth);
          underShadow.lineTo(e.x0, e.y0 - depth);
          underShadow.closePath();
        }
      }
      if (e.len > 4 && room > PIPE_MIN_CLEARANCE) {
        const inset = 0.6;
        const ax = Math.min(e.x0, e.x1) + inset;
        const bx = Math.max(e.x0, e.x1) - inset;
        pipes.push({ x0: ax, y0: Math.min(e.y0, e.y1) - 0.42, x1: bx, y1: Math.min(e.y0, e.y1) - 0.42, dia: 0.2, clampEvery: 2.2 });
      }
    } else if (e.cls === 'top') {
      wear.moveTo(e.x0 - e.nx * 0.3, e.y0 - e.ny * 0.3);
      wear.lineTo(e.x1 - e.nx * 0.3, e.y1 - e.ny * 0.3);
    }
  }

  // Stencils along long top edges, a metre into the solid. The library is
  // hand-drawn; where they land is not, which is the whole point.
  const rs = substream(seed, `stamp${index}`);
  const stamps: Stamp[] = [];
  const cols = [P.yellow, P.magenta, P.cyan, P.lime, P.orange, P.cream];
  for (const e of E) {
    if (e.cls !== 'top' || e.len <= 4) continue;
    // SPARSE AND QUIET. The mockup's spacing and opacity were tuned against a
    // single hand-framed slab; applied to every long top edge in twenty levels
    // they came out as a parade of metre-wide primary-coloured icons competing
    // with the collision edge — the exact failure the readability rule names.
    // They are meant to be marks somebody left on the concrete.
    const n = Math.floor(e.len / 5.5);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.3 + rs() * 0.5) / n;
      stamps.push({
        key: STENCIL_KEYS[Math.floor(rs() * STENCIL_KEYS.length)],
        x: e.x0 + (e.x1 - e.x0) * u - e.nx * 1.15,
        y: e.y0 + (e.y1 - e.y0) * u - e.ny * 1.15,
        size: 0.34 + rs() * 0.26,
        rot: Math.atan2(e.dy, e.dx) + (rs() - 0.5) * 0.3,
        color: cols[Math.floor(rs() * cols.length)],
        alpha: 0.16 + rs() * 0.16,
      });
    }
  }

  const chevrons = hazardCorners(poly, E, DEFAULT_HAZARD).map(bakeChevron);

  // Texture. A `ground` polygon textures its own bounds; a `cave` is solid
  // EVERYWHERE OUTSIDE its ring, so it textures the whole region — which is
  // exactly why this is chunked and clipped rather than filled whole.
  const bx0 = poly.solidInside ? Math.max(rminX, poly.minX) : rminX;
  const by0 = poly.solidInside ? Math.max(rminY, poly.minY) : rminY;
  const bx1 = poly.solidInside ? Math.min(rmaxX, poly.maxX) : rmaxX;
  const by1 = poly.solidInside ? Math.min(rmaxY, poly.maxY) : rmaxY;
  const tex = bakeTexture(bx0, by0, bx1, by1, substream(seed, `tex${index}`), stats);

  stats.stamps += stamps.length;
  stats.chevrons += chevrons.length;
  stats.pipes += pipes.length;

  return {
    poly, ring, bands, lips, drips, wear, chevrons, underShadow, pipes, stamps, tex,
    merged: null,
    minX: bx0, minY: by0, maxX: bx1, maxY: by1,
  };
}

function bakeChevron(c: ReturnType<typeof hazardCorners>[number]): Chevron {
  const hw = Math.min(1.0, c.runTop * 0.9);
  const hh = Math.min(1.3, c.runSide * 0.9);
  const sn = c.side;
  const tn = c.top;
  const p: [number, number][] = [
    [c.x, c.y],
    [c.x - sn.nx * hw, c.y - sn.ny * hw],
    [c.x - sn.nx * hw - tn.nx * hh, c.y - sn.ny * hw - tn.ny * hh],
    [c.x - tn.nx * hh, c.y - tn.ny * hh],
  ];
  const quad = new Path2D();
  quad.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < 4; i++) quad.lineTo(p[i][0], p[i][1]);
  quad.closePath();

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of p) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  // Diagonal ink bars over the block's bounds. They are clipped to the quad at
  // draw time, so overshooting the bounds is free and getting the coverage
  // right matters more than being tight.
  const stripes = new Path2D();
  const bar = 0.17;
  const gap = 0.33;
  const span = (maxX - minX) + (maxY - minY);
  for (let k = -Math.ceil(span / gap); k <= Math.ceil(span / gap); k++) {
    const x = minX + k * gap;
    stripes.moveTo(x, minY - 0.1);
    stripes.lineTo(x + bar, minY - 0.1);
    stripes.lineTo(x + bar + (maxY - minY) + 0.2, maxY + 0.1);
    stripes.lineTo(x + (maxY - minY) + 0.2, maxY + 0.1);
    stripes.closePath();
  }
  return { quad, stripes, minX, minY, maxX, maxY };
}

function bakeTexture(
  x0: number, y0: number, x1: number, y1: number, r: Rng, stats: BakedLevel['stats'],
): Map<number, TexChunk> {
  const out = new Map<number, TexChunk>();
  const cx0 = Math.floor(x0 / CHUNK);
  const cy0 = Math.floor(y0 / CHUNK);
  const cx1 = Math.floor(x1 / CHUNK);
  const cy1 = Math.floor(y1 / CHUNK);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const ax = Math.max(x0, cx * CHUNK);
      const ay = Math.max(y0, cy * CHUNK);
      const bx = Math.min(x1, (cx + 1) * CHUNK);
      const by = Math.min(y1, (cy + 1) * CHUNK);
      const w = bx - ax;
      const h = by - ay;
      if (w <= 0 || h <= 0) continue;
      const area = w * h;
      const t: TexChunk = { patchA: new Path2D(), patchB: new Path2D(), cracks: new Path2D() };

      // Seeded blotches. Two tones so the surface has a grain rather than a
      // noise; both go into ONE path each, because a thousand separate fills is
      // the difference between free and not.
      const nb = Math.floor(area * PATCH_PER_M2);
      for (let i = 0; i < nb; i++) {
        const px = ax + r() * w;
        const py = ay + r() * h;
        const rad = PATCH_R_MIN + r() * PATCH_R_SPAN;
        const k = 6 + Math.floor(r() * 4);
        const into = r() < 0.55 ? t.patchA : t.patchB;
        for (let j = 0; j < k; j++) {
          const a = (j / k) * Math.PI * 2;
          const rr = rad * (0.7 + r() * 0.6);
          const qx = px + Math.cos(a) * rr;
          const qy = py + Math.sin(a) * rr * 0.7;
          if (j === 0) into.moveTo(qx, qy); else into.lineTo(qx, qy);
        }
        into.closePath();
        stats.subpaths++;
      }

      const nc = Math.floor(area * CRACK_PER_M2);
      for (let i = 0; i < nc; i++) {
        let px = ax + r() * w;
        let py = ay + r() * h;
        t.cracks.moveTo(px, py);
        for (let j = 0; j < 4; j++) {
          px += (r() - 0.5) * 0.8;
          py -= (r() - 0.7) * 0.6;
          t.cracks.lineTo(px, py);
        }
        stats.subpaths++;
      }

      out.set(chunkKey(cx, cy), t);
    }
  }
  return out;
}

/**
 * Free space directly under a down-facing edge: the drop from the edge to the
 * highest up-facing surface beneath it, sampled across the edge and taking the
 * WORST case. Infinity when there is nothing below at all.
 */
function clearanceUnder(all: readonly CompiledPolygon[], e: ArtEdge): number {
  let worst = Infinity;
  for (let k = 0; k <= 4; k++) {
    const u = k / 4;
    const x = e.x0 + (e.x1 - e.x0) * u;
    const y = e.y0 + (e.y1 - e.y0) * u;
    let floor = -Infinity;
    for (const q of all) {
      const n = q.vx.length;
      for (let i = 0; i < n; i++) {
        if (q.ny[i] < 0.5) continue;
        const j = i + 1 === n ? 0 : i + 1;
        const lo = Math.min(q.vx[i], q.vx[j]);
        const hi = Math.max(q.vx[i], q.vx[j]);
        if (x < lo || x > hi) continue;
        const t = hi - lo < 1e-9 ? 0 : (x - lo) / (hi - lo);
        const fy = q.vx[i] <= q.vx[j]
          ? q.vy[i] + (q.vy[j] - q.vy[i]) * t
          : q.vy[j] + (q.vy[i] - q.vy[j]) * t;
        if (fy < y - 0.05 && fy > floor) floor = fy;
      }
    }
    const gap = floor === -Infinity ? Infinity : y - floor;
    if (gap < worst) worst = gap;
  }
  return worst;
}

// --- background wall --------------------------------------------------------

function bakeLuminance(
  x0: number, y0: number, x1: number, y1: number, brightY: number, P: Palette, r: Rng,
): { path: Path2D; color: string; minY: number; maxY: number }[] {
  // Stepped, hard-edged, staggered: light spills from above, and a gradient
  // would read as fog rather than as a lit shaft.
  //
  // STRIPS, not stacked half-planes. The obvious way to write this is "each band
  // fills from its own jagged line down to the bottom of the world", letting the
  // later ones paint over the earlier ones — which is six full-viewport fills
  // every frame for a result you can only see two of. Cutting each band to its
  // own strip and giving it bounds means a frame fills the two or three that are
  // actually on screen. It measured as most of the background's cost.
  const out: { path: Path2D; color: string; minY: number; maxY: number }[] = [];
  const span = y1 - y0;
  const jag = (i: number): number[] => {
    const steps = 4;
    const ys: number[] = [];
    const yTop = y1 - (i / BAND_COUNT) * span;
    for (let k = 0; k <= steps; k++) ys.push(yTop + (r() - 0.5) * span * 0.04);
    return ys;
  };
  let upper = [y1, y1, y1, y1, y1];
  for (let i = 1; i <= BAND_COUNT; i++) {
    const lower = i === BAND_COUNT ? [y0, y0, y0, y0, y0] : jag(i);
    const p = new Path2D();
    const steps = upper.length - 1;
    p.moveTo(x0, upper[0]);
    for (let k = 1; k <= steps; k++) p.lineTo(x0 + ((x1 - x0) * k) / steps, upper[k]);
    for (let k = steps; k >= 0; k--) p.lineTo(x0 + ((x1 - x0) * k) / steps, lower[k]);
    p.closePath();
    const lo = Math.min(...lower);
    const hi = Math.max(...upper);
    // The haze, and the warmer wash near the light, composited into the colour
    // rather than painted over the frame. The warm half is weighted by how much
    // of this strip is above the bright line, which is what the two overlapping
    // fills used to work out per pixel.
    const warm = Math.max(0, Math.min(1, (hi - brightY) / Math.max(hi - lo, 1e-6)));
    let col = wash(P.wall[Math.min(i - 1, P.wall.length - 1)], HAZE, HAZE_A);
    if (warm > 0) col = wash(col, [255, 246, 232], 0.09 * warm);
    out.push({ path: p, color: col, minY: lo, maxY: hi });
    upper = lower;
  }
  return out;
}

function bakeWedge(
  x0: number, y0: number, x1: number, y1: number, r: Rng,
): { path: Path2D; alpha: number; minX: number; maxX: number }[] {
  // A hard-edged shaft of light. Where it falls is seeded rather than authored:
  // it is atmosphere, and the one thing it must not do is look identical on
  // every level.
  const cx = x0 + (0.25 + r() * 0.5) * (x1 - x0);
  const slant = (r() - 0.5) * 0.5;
  const mk = (halfTop: number, halfBottom: number, a: number): { path: Path2D; alpha: number; minX: number; maxX: number } => {
    const p = new Path2D();
    const drop = (y1 - y0) * slant;
    p.moveTo(cx - halfTop, y1);
    p.lineTo(cx + halfTop, y1);
    p.lineTo(cx + halfBottom + drop, y0);
    p.lineTo(cx - halfBottom + drop, y0);
    p.closePath();
    return {
      path: p, alpha: a,
      minX: Math.min(cx - halfTop, cx - halfBottom + drop),
      maxX: Math.max(cx + halfTop, cx + halfBottom + drop),
    };
  };
  return [mk(3.5, 8, 0.14), mk(1.5, 4, 0.1)];
}

function bakeWall(
  x0: number, y0: number, x1: number, y1: number, P: Palette, seed: number,
): Map<number, WallChunk> {
  const out = new Map<number, WallChunk>();
  const cx0 = Math.floor(x0 / CHUNK);
  const cy0 = Math.floor(y0 / CHUNK);
  const cx1 = Math.floor(x1 / CHUNK);
  const cy1 = Math.floor(y1 / CHUNK);
  const cols = [P.yellow, P.magenta, P.cyan, P.lime, P.orange, P.cream];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      // Seeded per CHUNK, not per level, so that a chunk's panels are the same
      // whichever direction you arrive from and however many chunks got baked.
      const r = rng((seed ^ chunkKey(cx, cy) ^ 0x9e3779b9) >>> 0);
      const c: WallChunk = {
        toneDark: new Path2D(), toneLight: new Path2D(), stains: new Path2D(),
        grid: new Path2D(), gridHi: new Path2D(), stamps: [],
      };
      const ax = cx * CHUNK;
      const ay = cy * CHUNK;
      const rows = Math.ceil(CHUNK / PANEL_H);
      const colsN = Math.ceil(CHUNK / PANEL_W) + 1;
      for (let row = 0; row < rows; row++) {
        const py = ay + row * PANEL_H;
        const off = (row % 2) * PANEL_W * 0.5;
        c.grid.moveTo(ax, py);
        c.grid.lineTo(ax + CHUNK, py);
        c.gridHi.moveTo(ax, py + 0.035);
        c.gridHi.lineTo(ax + CHUNK, py + 0.035);
        for (let col = 0; col < colsN; col++) {
          const px = ax + col * PANEL_W - off;
          c.grid.moveTo(px, py);
          c.grid.lineTo(px, py + PANEL_H);
          const v = r();
          if (v < 0.16) c.toneDark.rect(px, py, PANEL_W, PANEL_H);
          else if (v > 0.9) c.toneLight.rect(px, py, PANEL_W, PANEL_H);
          if (r() < 0.12) {
            const sx = px + r() * PANEL_W;
            const sy = py + PANEL_H - r() * PANEL_H * 0.5;
            c.stains.moveTo(sx - 0.2, sy);
            c.stains.quadraticCurveTo(sx, sy + 0.16, sx + 0.24, sy);
            c.stains.lineTo(sx + 0.11, sy - 0.44 - r() * 0.66);
            c.stains.lineTo(sx - 0.07, sy - 0.33 - r() * 0.44);
            c.stains.closePath();
          }
        }
      }
      const ns = Math.floor(CHUNK * CHUNK * WALL_STAMP_PER_M2);
      for (let i = 0; i < ns; i++) {
        c.stamps.push({
          key: STENCIL_KEYS[Math.floor(r() * STENCIL_KEYS.length)],
          x: ax + r() * CHUNK,
          y: ay + r() * CHUNK,
          size: 0.3 + r() * 0.55,
          rot: (r() - 0.5) * 0.8,
          color: cols[Math.floor(r() * cols.length)],
          alpha: 0.13 + r() * 0.13,
        });
      }
      out.set(chunkKey(cx, cy), c);
    }
  }
  return out;
}

// --- helpers ----------------------------------------------------------------

/**
 * Path2D.roundRect is not everywhere yet and a drip is not worth a feature
 * detection at draw time, so this is written by hand once.
 */
function roundRect(p: Path2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  p.moveTo(x + rr, y);
  p.lineTo(x + w - rr, y);
  p.quadraticCurveTo(x + w, y, x + w, y + rr);
  p.lineTo(x + w, y + h - rr);
  p.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  p.lineTo(x + rr, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - rr);
  p.lineTo(x, y + rr);
  p.quadraticCurveTo(x, y, x + rr, y);
  p.closePath();
}

/** Re-exported so the renderer keeps its colour literals in the palette. */
export { alpha };
export type { ArtEdge };
