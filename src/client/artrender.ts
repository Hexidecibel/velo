// The art renderer.
//
// Same contract as render.ts — same camera, same pose, same options — and the
// same exemption from the sim's Math.* ban. Nothing here is ever verified.
//
// THE BET THIS IS BUILT ON: solids are dark, air is light, and every collidable
// edge carries 5 px of ink plus a coloured lip just inside it. That inversion is
// what keeps the collision boundary the most legible line in a loud frame, and
// it is the acceptance criterion for the whole look — a frame that is beautiful
// and leaves you guessing where the floor is has failed.
//
// Everything expensive was baked into world-space Path2D at level load (see
// art/bake.ts). A frame here is a few dozen fills and strokes under the existing
// view transform, chunk-culled to the viewport. There is no pixel cache, so
// there is nothing to invalidate when the camera moves and nothing to pop in
// when it moves fast.
import { PICKUP_RADIUS } from '@/sim/consts.ts';
import { ticksToSeconds } from '@/sim/replay.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import type { SimState } from '@/sim/step.ts';
import type { World } from '@/sim/world.ts';
import { drawEdgeMarkers, edgeMarkers } from './markers.ts';
import type { MarkerTarget } from './markers.ts';
import type { Pose, RenderOpts, View } from './render.ts';
import { DEFAULT_CAMERA } from './camera.ts';
import { DEFAULT_SPEC } from '@/sim/spec.ts';
import type { BakedLevel, BakedPoly } from './art/bake.ts';
import type { ArtParams } from './art/params.ts';
import { artStrength } from './art/params.ts';
import type { Palette } from './art/palette.ts';
import { alpha } from './art/palette.ts';
import { chunkKey, chunkWindow, viewBounds } from './art/geom.ts';
import type { ChunkWindow } from './art/geom.ts';
import { drawStamp } from './art/stencils.ts';
import { rng } from './art/rng.ts';
import { solidFraction } from './art/space.ts';
import { chooseQuality, detailAt, loadOf, newAdapt, observe } from './art/adapt.ts';
import type { DetailLevels } from './art/adapt.ts';
import { drawProps } from './art/propdraw.ts';
import { textOutline } from './art/letters.ts';
import {
  bikeShape, bodyBox, headDrawRadius, helmetStyle, jacketCut, makeLook, scarfStyle,
} from './art/bikeart.ts';
import type { BikeColors, BikeLook, BikeShape, Pt } from './art/bikeart.ts';
import { DEFAULT_APPEARANCE } from '@/shared/appearance.ts';

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * Never finer than this on screen. The base pitch is per-level now — it lives
 * on the StyleVariant, because how coarsely the concrete is worked is one of
 * the non-colour cues that makes two levels read as two places — and it doubles
 * out from there until it clears this floor.
 */
const HATCH_MIN_PX = 26;

/** Scratch canvases for the bloom pass. Created once; resized as needed. */
let bloomA: HTMLCanvasElement | null = null;
let bloomB: HTMLCanvasElement | null = null;

export interface ArtRenderOpts extends RenderOpts {
  /** Seconds since boot. Animation only — the sim never sees it. */
  time: number;
  /**
   * False for a render that is not a frame the player sees — a level-chooser
   * thumbnail into an offscreen canvas.
   *
   * Its cost is real but it is not EVIDENCE about the frame budget: it is a
   * different canvas at a different size drawn while nobody is driving. Folding
   * it into the adaptive controller would mean opening the level chooser
   * quietly reduced the detail of the next second of play, which is a menu
   * degrading the game. Defaults to true, so every existing call site is
   * unchanged.
   */
  measure?: boolean;
  /**
   * False hides the DETAIL chip in the in-canvas HUD. That chip is the one
   * piece of the game HUD that is telemetry rather than presentation — the
   * level card, the clock and the apple counter are the game saying where you
   * are, and how much decoration the adaptive controller gave up is a
   * development instrument. So it follows the debug readout (the ` key) rather
   * than the art HUD. Defaults to true.
   */
  detailChip?: boolean;
  /**
   * THE PLAYER'S OWN LIVERY. Absent means the shipped bike, which is what every
   * offscreen caller (thumbnails, the smoke harness) wants: a thumbnail is a
   * picture of the LEVEL and must not change because somebody repainted their
   * bike, exactly as it is drawn on the shipped spec rather than a tuned one.
   */
  look?: BikeLook | null;
  /**
   * The leaderboard ghost's livery — THEIRS, never yours. Same argument as
   * `ghostFacing`: borrowing the player's would put somebody else's run in your
   * colours, which is the one thing this feature exists to stop.
   */
  ghostLook?: BikeLook | null;
}

/**
 * The adaptive detail controller's live state. Module scope for the same reason
 * the bike's detail latches are: the ghost and the player draw in the same
 * frame, rendering is outside the deterministic sim, and one controller is
 * correct for the whole canvas.
 */
const adapt = newAdapt();

export function renderArt(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  cam: View,
  world: World,
  state: SimState,
  pose: Pose,
  spec: BikeSpec,
  opts: ArtRenderOpts,
  art: ArtParams,
  baked: BakedLevel,
): void {
  const t0 = performance.now();
  const P = baked.palette;
  const level = world.level;
  const px = 1 / cam.zoom;
  const s = artStrength(art, cam.zoom);
  const t = opts.time;

  ctx.save();
  ctx.fillStyle = baked.bands[baked.bands.length - 1].color;
  ctx.fillRect(0, 0, cssW, cssH);

  ctx.translate(cssW / 2, cssH / 2);
  ctx.scale(cam.zoom, -cam.zoom);
  ctx.translate(-cam.x, -cam.y);
  const b = viewBounds(cam.x, cam.y, cam.zoom, cssW, cssH, 1);

  // ADAPTIVE DETAIL. How much solid is about to be drawn is the cost predictor,
  // and it is known before anything is drawn — which is the point, because a
  // controller that only reads measured time is always a frame behind, and a
  // frame behind is the frame that drops. `art.quality` and the two beside it
  // are OUTPUTS: the renderer writes them so that `window.velo.art` carries the
  // diagnosis, and nothing reads them back as input.
  const frac = solidFraction(baked.field, b);
  const load = loadOf(frac);
  const q = art.adaptive > 0 ? chooseQuality(adapt, load, { target: art.adaptTarget, floor: art.adaptFloor }) : 1;
  const D = detailAt(q);
  art.quality = q;
  art.solidFrac = frac;
  art.artMs = adapt.worst;

  const cw = chunkWindow(b);
  drawWall(ctx, baked, b, cw, art, D, s, px, t, frac);
  drawUnderworks(ctx, baked, b, P, art, s, px);
  drawSolids(ctx, baked, b, cw, P, art, D, s, px);

  // PAINT props: road markings and stencilled signage. Drawn after the terrain
  // because they are pigment ON it, and unclipped because they do not need a
  // clip — the placement rule already proved every one of them lies entirely
  // inside solid material. That is the class a corridor too tight for anything
  // else still gets: pigment in the material cannot be mistaken for an object
  // in the air, whatever it is drawn like, which is what lets the art dress
  // 19-low-roof at all.
  if (art.props > 0 && s > 0 && baked.paint.length) {
    drawProps(ctx, baked.paint, b, s * art.props * 0.9, px, t, baked.paint.length);
  }

  // Bloom sits between the world and the actors, exactly as in the mockup: it
  // is the AIR getting brighter, not the bike glowing. Pulled out of the world
  // transform because it composites in screen space.
  ctx.restore();
  // Bloom goes FIRST when frames run long. It is the most expensive layer Phase
  // 1 measured, at 2.0-4.4 ms, and the most forgiving to lose — it is
  // atmosphere, not information.
  const bloom = art.bloom * D.bloom;
  if (bloom > 0.002 && s > 0) applyBloom(ctx, cssW, cssH, bloom * s, art.bloomRadius);

  ctx.save();
  ctx.translate(cssW / 2, cssH / 2);
  ctx.scale(cam.zoom, -cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  for (let i = 0; i < level.apples.length; i++) {
    if (state.applesTaken[i] !== 0) continue;
    drawApple(ctx, level.apples[i].x, level.apples[i].y, t + i, P, px);
  }
  drawFlower(ctx, level.flower.x, level.flower.y, state.applesLeft === 0, t, P, px);

  // THE MONTAGE, UNDER EVERYTHING ELSE. Every attempt of the session riding at
  // once, each at the alpha montage.ts chose for the size of the crowd, so the
  // winning line — the player's own sim, at full strength two lines below —
  // reads against the failures rather than being lost in them.
  const playerLook = opts.look ?? fallbackLook(P);
  if (opts.ghosts) {
    // A montage rider with no livery of its own is one of YOUR attempts, so it
    // wears your colours. See montageDraws in main.ts for why that is resolved
    // live rather than embedded per attempt.
    for (const g of opts.ghosts) {
      drawBike(ctx, g.pose, spec, px, P, g.facing, t, g.alpha, g.coarse ? 'coarse' : 'auto', g.look ?? playerLook);
    }
  }
  if (opts.ghost) drawBike(ctx, opts.ghost, spec, px, P, opts.ghostFacing ?? state.facing, t, 0.3, 'auto', opts.ghostLook);
  if (!state.dead && !state.finished) drawFX(ctx, pose, state, P, px, t, playerLook);
  drawBike(ctx, pose, spec, px, P, state.facing, t, 1, 'auto', playerLook);

  if (art.motes * D.motes > 0.5 && s > 0) drawMotes(ctx, b, P, t, art.motes * D.motes, s);
  if (opts.overview > 0) drawLocator(ctx, pose, px, opts.overview, P);

  // THE DEBUG OVERLAY GOES LAST AND UNDER NO ALPHA. It is the tool that catches
  // the art lying about the collision surface, so it has to win against the art
  // unconditionally — an overlay that the terrain can paint over is not a check.
  if (opts.debug) drawDebug(ctx, world, px);

  ctx.restore();

  if (art.hud > 0) drawHud(ctx, cssW, cssH, level.name, state, level.apples.length, P, opts.detailChip === false ? null : q);

  if (opts.markers) {
    const targets: MarkerTarget[] = [];
    for (let i = 0; i < level.apples.length; i++) {
      if (state.applesTaken[i] !== 0) continue;
      targets.push({ x: level.apples[i].x, y: level.apples[i].y, kind: 'apple' });
    }
    if (state.applesLeft === 0) targets.push({ x: level.flower.x, y: level.flower.y, kind: 'flower' });
    const list = edgeMarkers(targets, cam, cssW, cssH, { x: pose.px, y: pose.py }, opts.markers.inset);
    drawEdgeMarkers(ctx, list, opts.markers.alpha);
  }

  // What this frame actually cost, at the load and quality it was drawn at.
  // Canvas2D rasterises lazily, so this is a floor rather than the whole truth
  // — but it is measured on the same terms every frame, which is what a
  // controller needs.
  if (opts.measure !== false) observe(adapt, performance.now() - t0, load, q);
}

// --- background -------------------------------------------------------------

function forEachChunk(w: ChunkWindow, fn: (key: number) => void): void {
  for (let cy = w.cy0; cy <= w.cy1; cy++) {
    for (let cx = w.cx0; cx <= w.cx1; cx++) fn(chunkKey(cx, cy));
  }
}

/**
 * The visible wall chunks, merged per layer and memoised on the chunk window.
 * Same reasoning as the terrain merge in bake.ts: fewer, bigger draw calls beat
 * more, smaller ones by a wide margin on this rasteriser.
 */
let wallMerge: {
  src: BakedLevel;
  key: number;
  toneDark: Path2D; toneLight: Path2D; stains: Path2D; grid: Path2D; gridHi: Path2D;
  stamps: import('./art/stencils.ts').Stamp[];
} | null = null;

function mergedWall(baked: BakedLevel, w: ChunkWindow): NonNullable<typeof wallMerge> {
  if (wallMerge && wallMerge.src === baked && wallMerge.key === w.key) return wallMerge;
  const m = {
    src: baked, key: w.key,
    toneDark: new Path2D(), toneLight: new Path2D(), stains: new Path2D(),
    grid: new Path2D(), gridHi: new Path2D(),
    stamps: [] as import('./art/stencils.ts').Stamp[],
  };
  forEachChunk(w, (key) => {
    const c = baked.wall.get(key);
    if (!c) return;
    m.toneDark.addPath(c.toneDark);
    m.toneLight.addPath(c.toneLight);
    m.stains.addPath(c.stains);
    m.grid.addPath(c.grid);
    m.gridHi.addPath(c.gridHi);
    for (const st of c.stamps) m.stamps.push(st);
  });
  wallMerge = m;
  return m;
}

function mergedTex(bp: BakedPoly, w: ChunkWindow): NonNullable<BakedPoly['merged']> {
  if (bp.merged && bp.merged.key === w.key) return bp.merged;
  const m = { key: w.key, patchA: new Path2D(), patchB: new Path2D(), cracks: new Path2D() };
  forEachChunk(w, (key) => {
    const c = bp.tex.get(key);
    if (!c) return;
    m.patchA.addPath(c.patchA);
    m.patchB.addPath(c.patchB);
    m.cracks.addPath(c.cracks);
  });
  bp.merged = m;
  return m;
}

function drawWall(
  ctx: CanvasRenderingContext2D, baked: BakedLevel, b: Bounds, cw: ChunkWindow,
  art: ArtParams, D: DetailLevels, s: number, px: number, t: number, solidFrac: number,
): void {
  const P = baked.palette;
  // Stepped luminance: the light comes from above and it steps rather than
  // grades, because a gradient reads as fog and this is meant to read as a lit
  // room with hard shadows.
  for (const band of baked.bands) {
    if (band.maxY < b.minY || band.minY > b.maxY) continue;
    ctx.fillStyle = band.color;
    ctx.fill(band.path);
  }

  drawParallax(ctx, baked, b, art, s, solidFrac);

  if (art.wall * D.wall > 0.02 && s > 0) {
    const a = s * art.wall * D.wall;
    const m = mergedWall(baked, cw);
    ctx.save();
    ctx.globalAlpha = a;
    // Alphas are ~0.8 of the mockup's, because the mockup's haze pass used to
    // knock this detail back by the same fraction and no longer does.
    ctx.fillStyle = alpha(P.ink, 0.08);
    ctx.fill(m.toneDark);
    ctx.fillStyle = alpha(P.cream, 0.1);
    ctx.fill(m.toneLight);
    ctx.fillStyle = alpha(P.ink, 0.1);
    ctx.fill(m.stains);
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = alpha(P.ink, 0.22);
    ctx.stroke(m.grid);
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = alpha(P.cream, 0.16);
    ctx.stroke(m.gridHi);
    if (art.stamps > 0) {
      for (const st of m.stamps) {
        if (st.x < b.minX || st.x > b.maxX || st.y < b.minY || st.y > b.maxY) continue;
        drawStamp(ctx, st, a, px);
      }
    }
    ctx.restore();
  }

  // The hard light wedge. Hard-edged on purpose — it is the same cel logic as
  // everything else, and a soft cone would be the only blurred thing in frame.
  for (const w of baked.wedge) {
    if (w.maxX < b.minX || w.minX > b.maxX) continue;
    ctx.fillStyle = alpha(P.cream, w.alpha * (0.4 + 0.6 * s));
    ctx.fill(w.path);
  }

  // The haze that pushes the background behind the solids is NOT drawn here. It
  // is a constant wash over a constant colour, so bake.ts composites it into the
  // luminance bands instead — two full-viewport alpha fills a frame, for a
  // result that never changes, was the single cheapest thing to delete.

  // SET DRESSING, in the background pass, behind every solid.
  //
  // That draw order is half of what makes a prop visibly non-collidable: the
  // terrain paints over it, so a prop can never cover a collision edge, and a
  // lamp that overlaps a ledge on screen plainly reads as being behind it
  // rather than bolted to the front of it. The clearance rules in props.ts are
  // the other half. Props are also the FIRST decoration the adaptive detail
  // system gives up — they are the newest thing in the frame and the least
  // load-bearing.
  if (art.props > 0 && s > 0 && baked.props.length) {
    const limit = Math.ceil(baked.props.length * D.props);
    if (limit > 0) drawProps(ctx, baked.props, b, s * art.props, px, t, limit);
  }
}

/**
 * Parallax silhouettes of the level's OWN geometry, behind the play space.
 *
 * The user asked for backgrounds, and this is the version that earns its place:
 * it costs one fill per polygon per layer and no bake at all, because the
 * geometry already exists as a baked ring and the scale-about-centre plus the
 * parallax offset are a single canvas transform. It is also the only background
 * that cannot contradict the level, since it IS the level — a hand-drawn
 * backdrop of a different cave would be a lie about the place you are in.
 *
 * Flat, low contrast, no ink: it is depth, not information, and the standing
 * readability rule says nothing back there may compete with the edge.
 */
function drawParallax(
  ctx: CanvasRenderingContext2D, baked: BakedLevel, b: Bounds, art: ArtParams, s: number,
  solidFrac: number,
): void {
  const n = baked.variant.parallaxLayers;
  if (art.parallax <= 0 || n <= 0 || s <= 0) return;
  // A PARALLAX LAYER YOU CANNOT SEE IS NOT WORTH DRAWING. This is a background
  // pass, so every pixel of it under solid material is painted and then painted
  // over. On the levels where the solid fills most of the frame — 19 and 20,
  // the two with no headroom — that is almost all of it. Fading it out as the
  // frame fills up costs nothing visible and hands the budget back exactly
  // where it is needed. Measured at 1.4 ms on 20-close-quarters.
  const seen = Math.max(0, Math.min(1, (0.8 - solidFrac) / 0.35));
  if (seen <= 0.02) return;
  const P = baked.palette;
  const cx = (baked.minX + baked.maxX) / 2;
  const cy = (baked.minY + baked.maxY) / 2;
  const camX = (b.minX + b.maxX) / 2;
  const camY = (b.minY + b.maxY) / 2;
  for (let i = 1; i <= n; i++) {
    // Further back is smaller and moves less, which is the whole of parallax.
    const depth = 1 - (i / (n + 1)) * (1 - baked.variant.parallaxDepth);
    const k = 1 - depth;
    ctx.save();
    // Scale about the level centre, then hold the layer back by the camera's
    // own offset scaled by its depth.
    ctx.translate(cx * k + (camX - cx) * k, cy * k + (camY - cy) * k);
    ctx.scale(depth, depth);
    // QUIET. This is depth, not information, and the standing readability rule
    // says nothing back here may compete with the collision edge. The first
    // version came out at roughly a sixth opacity and read as a pale slab
    // floating over the room rather than as a space behind it.
    ctx.globalAlpha = art.parallax * s * seen * (0.2 - i * 0.05);
    for (const bp of baked.polys) {
      // A cave's ring is the CAVITY, so filling it reads as another shaft
      // behind this one; a ground polygon's ring is material, so it reads as a
      // distant mass. Two different colours, one fill each.
      ctx.fillStyle = bp.poly.solidInside ? alpha(P.ink, 0.45) : alpha(P.cream, 0.3);
      ctx.fill(bp.ring);
    }
    ctx.restore();
  }
}

function drawUnderworks(
  ctx: CanvasRenderingContext2D, baked: BakedLevel, b: Bounds, P: Palette,
  art: ArtParams, s: number, px: number,
): void {
  if (art.underworks <= 0 || s <= 0) return;
  ctx.save();
  ctx.globalAlpha = s * art.underworks;
  for (const bp of baked.polys) {
    if (!overlaps(bp, b)) continue;
    ctx.fillStyle = alpha(P.ink, 0.22);
    ctx.fill(bp.underShadow);
    for (const pipe of bp.pipes) {
      if (pipe.x1 < b.minX || pipe.x0 > b.maxX || pipe.y0 < b.minY - 1 || pipe.y0 > b.maxY + 1) continue;
      drawPipe(ctx, pipe.x0, pipe.y0, pipe.x1, pipe.y1, pipe.dia, '#6b5aa8', '#c7b6ff', pipe.clampEvery, P, px);
    }
  }
  ctx.restore();
}

function drawPipe(
  ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number,
  dia: number, color: string, hi: string, clampEvery: number, P: Palette, px: number,
): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len <= 0) return;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const nx = -uy;
  const ny = ux;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineWidth = dia + 5 * px;
  ctx.strokeStyle = P.ink;
  ctx.stroke();
  ctx.lineWidth = dia;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.lineWidth = dia * 0.32;
  ctx.strokeStyle = alpha(P.ink, 0.35);
  ctx.beginPath();
  ctx.moveTo(x0 - nx * dia * 0.3, y0 - ny * dia * 0.3);
  ctx.lineTo(x1 - nx * dia * 0.3, y1 - ny * dia * 0.3);
  ctx.stroke();
  ctx.lineWidth = Math.max(2 * px, dia * 0.14);
  ctx.strokeStyle = hi;
  ctx.beginPath();
  ctx.moveTo(x0 + nx * dia * 0.3, y0 + ny * dia * 0.3);
  ctx.lineTo(x1 + nx * dia * 0.3, y1 + ny * dia * 0.3);
  ctx.stroke();
  const n = Math.max(1, Math.floor(len / clampEvery));
  ctx.fillStyle = P.steel;
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 2.5 * px;
  for (let i = 1; i <= n; i++) {
    const u = (i - 0.5) / n;
    const cx = x0 + (x1 - x0) * u;
    const cy = y0 + (y1 - y0) * u;
    ctx.beginPath();
    ctx.rect(cx - dia * 0.22, cy - dia * 0.72, dia * 0.44, dia * 1.44);
    ctx.fill();
    ctx.stroke();
  }
}

// --- terrain ----------------------------------------------------------------

function overlaps(bp: BakedPoly, b: Bounds): boolean {
  const p = bp.poly;
  if (!p.solidInside) return true; // a cave is solid everywhere outside its ring
  return !(p.maxX < b.minX || p.minX > b.maxX || p.maxY < b.minY || p.minY > b.maxY);
}

function drawSolids(
  ctx: CanvasRenderingContext2D, baked: BakedLevel, b: Bounds, cw: ChunkWindow, P: Palette,
  art: ArtParams, D: DetailLevels, s: number, px: number,
): void {
  // THE INK SCALE IS NOT TOUCHED BY THE ADAPTIVE SYSTEM, and neither is the lip
  // or the cel bands below. They are the one thing the whole look exists to
  // serve and they are nearly free; degrading them to save a millisecond would
  // be trading the point of the art for the cost of the cheapest part of it.
  const inkScale = Math.max(art.inkMinScale, Math.min(1, 1 / (art.inkFullZoom * px)));

  for (const bp of baked.polys) {
    if (!overlaps(bp, b)) continue;
    const rule: CanvasFillRule = bp.poly.solidInside ? 'nonzero' : 'evenodd';
    // A cave's solid is EVERYTHING OUTSIDE its ring, so its fill path is the
    // viewport with the ring punched out. Built per frame because it depends on
    // the viewport; it is four points plus a reference to a baked path.
    const solid = new Path2D();
    if (!bp.poly.solidInside) solid.rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    solid.addPath(bp.ring);

    ctx.fillStyle = P.solid;
    ctx.fill(solid, rule);

    ctx.save();
    ctx.clip(solid, rule);

    if (s * art.detail * D.detail > 0.04) {
      const m = mergedTex(bp, cw);
      ctx.save();
      ctx.globalAlpha = s * art.detail * D.detail;
      ctx.fillStyle = P.patchA;
      ctx.fill(m.patchA);
      ctx.fillStyle = P.patchB;
      ctx.fill(m.patchB);
      ctx.lineCap = 'round';
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = alpha(P.ink, 0.45);
      ctx.stroke(m.cracks);
      // Hatch is generated LIVE over the viewport rather than baked per chunk.
      // Baking it meant walking a few thousand line subpaths, most of them
      // offscreen, to draw the two hundred that are on it — the one layer where
      // "build it once" loses to "build exactly what is needed". Anchored to a
      // world grid so it does not swim when the camera moves.
      if (art.hatch * D.hatch > 0.02) {
        ctx.globalAlpha = s * art.detail * art.hatch * D.hatch;
        ctx.lineWidth = 1.2 * px;
        ctx.strokeStyle = alpha(P.cream, 0.055);
        const h = b.maxY - b.minY;
        // The PITCH IS BOUNDED IN SCREEN PIXELS, doubling as you zoom out. A
        // world-fixed pitch is right at the base camera and catastrophic in the
        // overview, where a screenful is a whole level and the same 0.26 m
        // spacing asks for thousands of lines to draw a five per cent wash.
        // Doubling rather than scaling continuously keeps it from swimming.
        // Widening the pitch is the real saving when frames run long: it is
        // the line COUNT that costs, not the opacity.
        let pitch = baked.variant.hatchPitch * D.hatchPitch;
        while (pitch < HATCH_MIN_PX * px) pitch *= 2;
        ctx.beginPath();
        // The RUN of the hatch is per-level too: 1 is 45 degrees, flatter
        // reads as a different material worked in a different direction.
        const run = h * baked.variant.hatchSlope;
        const first = Math.ceil((b.minX - Math.max(run, 0)) / pitch) * pitch;
        for (let x = first; x < b.maxX; x += pitch) {
          ctx.moveTo(x, b.minY);
          ctx.lineTo(x + run, b.maxY);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // Cel bands, classified by which way the edge faces the air. Widths are in
    // METRES, not pixels: a band is the material catching the light and it has
    // to scale with the world, unlike the ink.
    if (art.bandScale > 0) {
      ctx.lineCap = 'square';
      ctx.strokeStyle = P.bandSide;
      ctx.lineWidth = 0.48 * art.bandScale;
      ctx.stroke(bp.bands.side);
      ctx.strokeStyle = P.bandUnder;
      ctx.lineWidth = 0.76 * art.bandScale;
      ctx.stroke(bp.bands.under);
      ctx.strokeStyle = P.bandTop;
      ctx.lineWidth = 0.6 * art.bandScale;
      ctx.stroke(bp.bands.top);
    }

    if (s > 0) {
      ctx.save();
      ctx.globalAlpha = s;
      ctx.fillStyle = P.bandUnder;
      ctx.fill(bp.drips);
      ctx.lineWidth = 3 * px;
      ctx.strokeStyle = alpha(P.cream, 0.14);
      ctx.stroke(bp.wear);
      ctx.restore();
    }

    // Hazard chevrons: every convex top-to-side corner, which is every ledge
    // you can ride off. This is the cheapest safety feature in the game — it
    // marks the drop-offs of a level nobody has ever looked at.
    if (art.chevrons > 0) {
      for (const ch of bp.chevrons) {
        if (ch.maxX < b.minX || ch.minX > b.maxX || ch.maxY < b.minY || ch.minY > b.maxY) continue;
        ctx.save();
        ctx.globalAlpha = art.chevrons;
        ctx.clip(ch.quad);
        ctx.fillStyle = P.yellow;
        ctx.fillRect(ch.minX - 0.5, ch.minY - 0.5, ch.maxX - ch.minX + 1, ch.maxY - ch.minY + 1);
        ctx.fillStyle = P.ink;
        ctx.fill(ch.stripes);
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = art.chevrons;
        ctx.lineWidth = 3 * px;
        ctx.strokeStyle = P.ink;
        ctx.stroke(ch.quad);
        ctx.restore();
      }
    }

    if (art.stamps > 0 && s > 0) {
      for (const st of bp.stamps) {
        if (st.x < b.minX - 1 || st.x > b.maxX + 1 || st.y < b.minY - 1 || st.y > b.maxY + 1) continue;
        drawStamp(ctx, st, s * art.stamps, px);
      }
    }

    // THE LIP — and it has to be WIDE ENOUGH TO SURVIVE THE INK.
    if (art.lipWidth > 0) {
      // It is stroked centred on the edge and clipped to the solid, so half of
      // it lands inside; the ink then covers inkWidth/2 of that from the
      // boundary inwards. A lip stroked at 2*lipWidth is therefore entirely
      // hidden — which is what the first pass shipped, and the screenshots came
      // out with no lip anywhere. inkWidth + 2*lipWidth leaves exactly lipWidth
      // pixels of colour showing.
      ctx.lineCap = 'round';
      ctx.lineWidth = (art.inkWidth + art.lipWidth * 2) * px * inkScale;
      ctx.strokeStyle = P.lipTop;
      ctx.stroke(bp.lips.top);
      ctx.strokeStyle = P.lipSide;
      ctx.stroke(bp.lips.side);
      ctx.strokeStyle = P.lipUnder;
      ctx.stroke(bp.lips.under);
    }

    ctx.restore();

    // THE INK. Last, unclipped, centred on the true collision boundary. This
    // single stroke is the readability rule.
    if (art.inkWidth > 0) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = art.inkWidth * px * inkScale;
      ctx.strokeStyle = P.ink;
      ctx.stroke(bp.ring);
    }
  }
}

// --- bloom ------------------------------------------------------------------

/**
 * Quarter-resolution bloom. A full-res blur of a 1920x1080 frame is several
 * milliseconds and this is atmosphere, not a feature: downscale, blur small,
 * screen-blend back up. Cost is roughly a sixteenth of the honest version and
 * the difference is invisible at a blur radius this wide.
 */
function applyBloom(
  ctx: CanvasRenderingContext2D, cssW: number, cssH: number, amount: number, radius: number,
): void {
  // An EIGHTH, not a quarter. The blur radius that reads as bloom is wide
  // enough that the extra resolution is invisible, and on a CPU-rasterised
  // canvas a quarter-res round trip over a 1600x900 frame was measurably the
  // single most expensive thing in this file.
  const w = Math.max(1, Math.round(cssW / 8));
  const h = Math.max(1, Math.round(cssH / 8));
  if (!bloomA) bloomA = document.createElement('canvas');
  if (!bloomB) bloomB = document.createElement('canvas');
  if (bloomA.width !== w || bloomA.height !== h) {
    bloomA.width = w; bloomA.height = h;
    bloomB.width = w; bloomB.height = h;
  }
  const a = bloomA.getContext('2d');
  const bb = bloomB.getContext('2d');
  if (!a || !bb) return;
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.clearRect(0, 0, w, h);
  a.drawImage(ctx.canvas, 0, 0, w, h);
  bb.setTransform(1, 0, 0, 1, 0, 0);
  bb.clearRect(0, 0, w, h);
  bb.filter = `blur(${radius * 0.5}px) saturate(1.7) brightness(1.2)`;
  bb.drawImage(bloomA, 0, 0);
  bb.filter = 'none';
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = amount;
  ctx.drawImage(bloomB, 0, 0, cssW, cssH);
  ctx.restore();
}

// --- HUD --------------------------------------------------------------------

/**
 * The GAME hud: which level, how long, how many apples. Screen space, drawn on
 * the canvas rather than in the DOM so it shares the palette and the ink
 * treatment with everything else.
 *
 * It is deliberately NOT the readout in the top-left corner. That one is a
 * development instrument — sim rev, both hashes, contact counts, live-tune
 * state — and merging the two would mean either a player reading hex digests or
 * somebody tuning losing the numbers they tune by. Two audiences, two panels.
 *
 * No web fonts anywhere in this file. A canvas only sees a font once it has
 * actually loaded, and a HUD that silently falls back to the wrong face on a
 * cold load is worse than one that was always going to be system-ui.
 */
const HUD_FONT = 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

function drawHud(
  ctx: CanvasRenderingContext2D, cssW: number, cssH: number,
  name: string, state: SimState, appleCount: number, P: Palette, quality: number | null,
): void {
  // "10 — Cathedral" is an index and a title. Both are content, so both are
  // read off the level rather than configured.
  const m = /^\s*(\d+)\s*[—-]\s*(.*)$/.exec(name);
  const index = m ? m[1] : '';
  const title = (m ? m[2] : name).toUpperCase();
  const secs = ticksToSeconds(state.finished || state.dead ? state.endTick : state.tick);
  const clock = `${Math.floor(secs / 60)}:${(secs % 60).toFixed(2).padStart(5, '0')}`;
  const taken = appleCount - state.applesLeft;

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  // Skewed cel panels with a hard drop shadow, exactly as the terrain is
  // treated: fill, ink, and no gradients anywhere.
  const panel = (x: number, y: number, w: number, h: number, fill: string): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.transform(1, 0, -0.18, 1, 0, 0);
    ctx.fillStyle = P.ink;
    ctx.fillRect(4, 4, w, h);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 3;
    ctx.strokeStyle = P.ink;
    ctx.strokeRect(0, 0, w, h);
    ctx.restore();
  };

  ctx.font = `700 13px ${HUD_FONT}`;
  const titleW = Math.min(320, ctx.measureText(title).width + 26);
  const cardW = index ? 44 : 0;
  const total = cardW + titleW + 10;
  const x0 = Math.round(cssW / 2 - total / 2);
  const y0 = 12;

  if (index) {
    panel(x0, y0, cardW, 34, P.yellow);
    ctx.fillStyle = P.ink;
    ctx.font = `800 19px ${HUD_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(index, x0 + cardW / 2 - 3, y0 + 18);
  }
  panel(x0 + cardW + 10, y0, titleW, 34, P.cream);
  ctx.fillStyle = P.ink;
  ctx.font = `700 13px ${HUD_FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(title, x0 + cardW + 22, y0 + 18);

  // Clock and apples, right-aligned above the play area.
  const rx = Math.round(cssW / 2 + total / 2) + 24;
  panel(rx, y0, 104, 34, P.cream);
  ctx.fillStyle = state.dead ? P.red : state.finished ? P.lime : P.ink;
  ctx.font = `800 17px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = 'right';
  ctx.fillText(clock, rx + 92, y0 + 18);

  if (appleCount > 0) {
    panel(rx + 114, y0, 74, 34, taken === appleCount ? P.lime : P.magenta);
    ctx.fillStyle = taken === appleCount ? P.ink : P.cream;
    ctx.font = `700 14px ${HUD_FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${taken}/${appleCount}`, rx + 176, y0 + 18);
    ctx.save();
    ctx.translate(rx + 122, y0 + 17);
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fillStyle = P.red;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = P.ink;
    ctx.stroke();
    ctx.restore();
  }

  // THE DETAIL READOUT. Shown only when the adaptive system has actually given
  // something up, because "DETAIL 100%" on every frame of every level is noise,
  // and not at all when the debug readout is off: it is the one thing in this
  // HUD that is an instrument rather than the game talking.
  // Its absence is informative too: a dropped-frame report with no chip on
  // screen means the art was at full detail and the frame was long anyway,
  // which points somewhere else entirely.
  if (quality !== null && quality < 0.97) {
    panel(rx + 196, y0, 92, 34, P.steelD);
    ctx.fillStyle = P.cream;
    ctx.font = `700 12px ${HUD_FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`DETAIL ${Math.round(quality * 100)}%`, rx + 278, y0 + 18);
  }

  if (state.dead || state.finished) {
    const msg = state.finished ? 'FINISHED' : 'DEAD — R TO RESTART';
    ctx.font = `800 22px ${HUD_FONT}`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 6;
    ctx.strokeStyle = P.ink;
    ctx.strokeText(msg, cssW / 2, cssH * 0.22);
    ctx.fillStyle = state.finished ? P.lime : P.red;
    ctx.fillText(msg, cssW / 2, cssH * 0.22);
  }
  ctx.restore();
}

// --- objects ----------------------------------------------------------------

function drawApple(
  ctx: CanvasRenderingContext2D, x: number, y: number, t: number, P: Palette, px: number,
): void {
  // A pixel FLOOR on the radius, kept from the old renderer: zoomed out to frame
  // a 300 m level an apple is a third of a pixel and simply is not there, which
  // would make the overview useless for the one question it most needs to
  // answer. Below the floor it degrades to a dot rather than to a smear.
  const R = Math.max(0.3, 4.5 * px);
  if (R > 8 * px) {
    ctx.fillStyle = alpha(P.red, 0.16);
    ctx.beginPath();
    ctx.arc(x, y, R * 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 1.3);
    ctx.scale(1, 0.32);
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = P.cyan;
    // The orbit ring is the PICKUP RADIUS, not a decorative halo. It is the one
    // piece of apple art that has to be true: it says exactly how close is
    // close enough.
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(PICKUP_RADIUS, 7 * px) / 0.32, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.moveTo(x, y + R * 0.55);
  ctx.bezierCurveTo(x + R * 0.3, y + R * 1.1, x + R * 1.2, y + R * 0.6, x + R * 0.95, y - R * 0.2);
  ctx.bezierCurveTo(x + R * 0.8, y - R * 0.95, x + R * 0.2, y - R * 1.05, x, y - R * 0.8);
  ctx.bezierCurveTo(x - R * 0.2, y - R * 1.05, x - R * 0.8, y - R * 0.95, x - R * 0.95, y - R * 0.2);
  ctx.bezierCurveTo(x - R * 1.2, y + R * 0.6, x - R * 0.3, y + R * 1.1, x, y + R * 0.55);
  ctx.closePath();
  ctx.fillStyle = P.red;
  ctx.fill();
  ctx.lineWidth = 4 * px;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = P.ink;
  ctx.stroke();
  if (R > 6 * px) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#c0173a';
    ctx.fillRect(x - R * 1.3, y - R * 1.4, R * 2.6, R * 1.3);
    ctx.restore();
    ctx.lineWidth = 4 * px;
    ctx.strokeStyle = P.ink;
    ctx.beginPath();
    ctx.moveTo(x, y + R * 0.55);
    ctx.lineTo(x + R * 0.12, y + R * 1.0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + R * 0.1, y + R * 0.8);
    ctx.quadraticCurveTo(x + R * 0.5, y + R * 1.35, x + R * 0.8, y + R * 0.8);
    ctx.quadraticCurveTo(x + R * 0.45, y + R * 0.6, x + R * 0.1, y + R * 0.8);
    ctx.fillStyle = P.lime;
    ctx.fill();
    ctx.lineWidth = 3 * px;
    ctx.stroke();
  }
}

function drawFlower(
  ctx: CanvasRenderingContext2D, x: number, y: number, live: boolean, t: number, P: Palette, px: number,
): void {
  const R = Math.max(0.26, 5 * px);
  ctx.save();
  ctx.globalAlpha = live ? 1 : 0.4;
  ctx.translate(x, y);
  ctx.rotate(live ? t * 0.9 : 0);
  ctx.lineWidth = 4 * px;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = P.ink;
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.ellipse(R * 0.95, 0, R * 0.62, R * 0.36, 0, 0, Math.PI * 2);
    ctx.fillStyle = live ? P.yellow : P.lilac;
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.52, 0, Math.PI * 2);
  ctx.fillStyle = live ? P.magenta : P.steelD;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// --- the bike ---------------------------------------------------------------

/**
 * Bike detail tier, with HYSTERESIS — and the hysteresis is the whole point.
 *
 * A wheel is 0.25 m, so at the base camera of 62 px/m it is 15.5 px. The first
 * version cut fine detail at a hard `> 14`, which put the switch one and a half
 * pixels from where the bike sits at rest. The camera zooms out with speed, so
 * ordinary riding crossed that line several times a second and the rider's
 * helmet and scarf strobed on and off. Reported from play, not from a test:
 * "why does the helmet/scarf disappear and show up?"
 *
 * Two fixes, both needed. Each boundary latches, so a camera hovering on one
 * holds whatever it already had — and, after the user reported the same symptom
 * a SECOND time, the bands were moved entirely below the play range and derived
 * from the camera's own zoom floor. See the note on the constants below: a
 * latch whose dead band straddles the operating range does not stop strobing,
 * it gets stuck.
 *
 * The helmet and scarf are worth biasing toward: they are what makes the rider
 * read as a rider rather than as three pale circles, so they should survive far
 * longer than incidental detail.
 *
 * Latched at module scope on purpose. The ghost and the player draw in the same
 * frame at the same zoom, so one latch is correct for both — and rendering is
 * outside the deterministic sim, so carrying state here cannot affect a replay.
 */
/**
 * THE THRESHOLDS ARE DERIVED, NOT TYPED IN, and that is the actual fix.
 *
 * The first hysteresis attempt latched at ON above 12 px and OFF below 8 px.
 * The camera's play range is `minZoom` 38 to `maxZoom` 110, and a wheel is
 * 0.25 m, so riding happens between 9.5 and 27.5 px — which puts 12 px INSIDE
 * the range, at about 48 px/m. Sequence the user found twice: hold TAB, the
 * latch drops to OFF in the overview, release, ride fast. The zoom sits between
 * 38 and 48, the latch cannot re-arm, and the rider has no helmet until they
 * slow down. Hysteresis turned "strobes" into "can get stuck off".
 *
 * THE GENERAL RULE, worth naming because it is easy to get wrong again: a
 * hysteresis band must sit entirely OUTSIDE the range the value normally
 * occupies. A band that straddles a boundary of the operating range is not a
 * latch, it is a trap.
 *
 * So the bands come from the camera's own floor rather than from constants: the
 * fine band sits at a fraction of the smallest wheel the play camera can show,
 * and the blob band below that again. Raising the readability floor later
 * cannot silently re-introduce the bug, because the thresholds move with it.
 */
const PLAY_MIN_PX = DEFAULT_CAMERA.minZoom * DEFAULT_SPEC.wheel.radius;
/** Fine detail re-arms at 3/4 of the smallest riding wheel, and drops at half. */
const FINE_ON = PLAY_MIN_PX * 0.74;
const FINE_OFF = PLAY_MIN_PX * 0.53;
/** The blob tier engages well under that: the overview reaches about 1.75 px. */
const BLOB_ON = PLAY_MIN_PX * 0.42;
const BLOB_OFF = PLAY_MIN_PX * 0.63;

/**
 * The bike's look when nobody has said what it should be.
 *
 * Memoised on the PALETTE OBJECT, not deep-compared: `bakeLevel` builds one
 * palette per level and hands the same object to every frame, so identity is
 * exactly the right key and a level change is exactly when it should be
 * recomputed. Resolving a colourway is a dozen bisections, which is nothing
 * once a level, and would be silly sixty times a second.
 */
let fallbackCache: { p: Palette; look: BikeLook } | null = null;
function fallbackLook(P: Palette): BikeLook {
  if (!fallbackCache || fallbackCache.p !== P) fallbackCache = { p: P, look: makeLook(DEFAULT_APPEARANCE, P) };
  return fallbackCache.look;
}

/**
 * Where the exhaust smoke comes out, in chassis-local metres.
 *
 * SHARED BY THE DRAWING AND THE FX EMITTER, deliberately, and the reason is a
 * bug that has already been fixed once here: they were two hardcoded copies of
 * `-0.9`, which is the same shape of mistake that put the exhaust smoke on the
 * wrong end of the bike when it was flipped — two places holding one fact, and
 * only one of them getting fixed. With six bike types there are now six pipes
 * and one of them is not a pipe at all, so it is one function.
 *
 * The muffler lesson that produced the original constant lives on as an
 * assertion rather than a comment: see `outsideSilhouette` in bikeart.ts, which
 * every type's pipe is swept against.
 */
function exhaustPoint(shape: BikeShape): Pt {
  if (shape.pipe) return shape.pipe.tip;
  if (shape.vent) {
    let x = 0;
    let y = 0;
    for (const v of shape.vent) {
      x += v[0];
      y += v[1];
    }
    return [x / shape.vent.length, y / shape.vent.length];
  }
  return [-0.82, -0.14];
}

let fineLatched = true;
export function fineTier(detailPx: number): boolean {
  fineLatched = fineLatched ? detailPx > FINE_OFF : detailPx > FINE_ON;
  return fineLatched;
}

export let blobLatched = false;
export function blobTier(detailPx: number): boolean {
  blobLatched = blobLatched ? detailPx < BLOB_OFF : detailPx < BLOB_ON;
  return blobLatched;
}

/** Exported so the test can assert the bands sit clear of the play range. */
export const TIERS = { playMinPx: PLAY_MIN_PX, fineOn: FINE_ON, fineOff: FINE_OFF, blobOn: BLOB_ON, blobOff: BLOB_OFF };

/**
 * Ported from the mockup, and it fits the real spec exactly because the mockup
 * was drawn on the spec's own numbers: wheels r 0.25 on anchors at (+-0.6,
 * -0.15), head r 0.16 at 0.55 along the arm. The head is the death sphere, so
 * it is drawn at its TRUE radius and never a pixel larger — a helmet drawn
 * generously would be a lie about what kills you. That is now `headDrawRadius`,
 * a function with a test on it, rather than a habit.
 *
 * It has to read at the full camera range: 110 px/m where every panel line
 * shows, 62 at the base framing, and about 7 in the overview where the whole
 * bike is a dozen pixels. The detail tiers below are that, and the coarsest tier
 * is deliberately a chunky silhouette rather than a faithful miniature.
 *
 * EVERYTHING COSMETIC COMES IN THROUGH `look`, AND NOTHING ELSE DOES. The shape
 * data, the colours and the accessories are all read off it; `spec` is read only
 * for the numbers the SIM uses — wheel radius, arm length, head radius, the
 * suspension anchors — so a bike type cannot move a collider even by accident.
 * Six types, ten liveries, and one `specHash`.
 */
/**
 * Which detail tier to draw at.
 *
 *   'auto'    the hysteresis latches decide, which is what play wants.
 *   'coarse'  the silhouette, asked for explicitly — the montage.
 *   'fine'    full detail WITHOUT TOUCHING THE LATCHES, which is what an
 *             offscreen portrait wants. The latches are module scope and shared
 *             by every bike on the canvas on purpose; a leaderboard row drawing
 *             forty little avatars through them would flip the PLAYER'S bike to
 *             blobs and back, which is exactly the shimmer they exist to stop.
 */
export type BikeTier = 'auto' | 'coarse' | 'fine';

function drawBike(
  ctx: CanvasRenderingContext2D, p: Pose, spec: BikeSpec, px: number, P: Palette,
  facing: number, t: number, a: number, tier: BikeTier = 'auto', look?: BikeLook | null,
): void {
  const L = look ?? fallbackLook(P);
  const C = L.colors;
  const shape = bikeShape(L.app.bike);
  const TAU = Math.PI * 2;
  const wr = spec.wheel.radius;
  const hr = headDrawRadius(spec, L.app.helmet);
  const hx = p.px + spec.rider.armLength * p.ax;
  const hy = p.py + spec.rider.armLength * p.ay;
  const detail = wr / px; // wheel radius in screen pixels

  ctx.save();
  ctx.globalAlpha = a;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // `coarse` forces the silhouette tier, and it BYPASSES `blobTier` rather than
  // faking a small `detail` into it. That function is a hysteresis LATCH shared
  // by every bike in the frame — one controller for the whole canvas, on
  // purpose — so forty montage riders driving it would flip the PLAYER'S bike
  // to blobs and back, which is exactly the shimmer the latch exists to stop.
  if (tier === 'coarse' || (tier === 'auto' && blobTier(detail))) {
    // Overview tier. Three ink-outlined blobs and a link: at this size anything
    // finer is mush, and the only question the frame has to answer is "where am
    // I and which way up".
    //
    // THE LIVERY STILL SHOWS HERE, and it has to. A montage is forty bikes at
    // this tier and a leaderboard ghost drops to it whenever the camera pulls
    // back; drawing all of them in one colour would make the crowd a texture
    // rather than a crowd, which is the whole thing the feature exists to
    // avoid.
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 3 * px;
    ctx.beginPath();
    ctx.moveTo(p.wx[0], p.wy[0]);
    ctx.lineTo(p.px, p.py);
    ctx.lineTo(p.wx[1], p.wy[1]);
    ctx.stroke();
    ctx.strokeStyle = C.frame;
    ctx.lineWidth = 1.5 * px;
    ctx.stroke();
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(p.wx[i], p.wy[i], Math.max(wr, 2.5 * px), 0, TAU);
      ctx.fillStyle = C.wheel;
      ctx.fill();
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = C.ink;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(hx, hy, Math.max(hr, 2.5 * px), 0, TAU);
    ctx.fillStyle = C.head;
    ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    ctx.restore();
    return;
  }

  const fine = tier === 'fine' || (tier === 'auto' && fineTier(detail));
  const local = (): void => {
    ctx.translate(p.px, p.py);
    ctx.transform(p.ox, p.oy, -p.oy, p.ox, 0, 0);
    ctx.scale(facing, 1);
  };
  const ink = (w: number, col: string, pts: [number, number][]): void => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineWidth = w + 6 * px;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    ctx.lineWidth = w;
    ctx.strokeStyle = col;
    ctx.stroke();
  };
  const poly = (pts: readonly Pt[]): void => {
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.closePath();
  };

  // 1. Behind the wheels: exhaust, swingarm, fork. All three come off the bike
  //    type, and the swingarm and fork END AT THE SIM'S OWN SUSPENSION ANCHORS
  //    rather than at literals, so a frame cannot draw a wheel somewhere the
  //    physics does not put one.
  ctx.save();
  local();
  const pipe = shape.pipe;
  if (pipe) {
    ctx.beginPath();
    ctx.moveTo(pipe.from[0], pipe.from[1]);
    ctx.quadraticCurveTo(pipe.ctrl[0], pipe.ctrl[1], pipe.mid[0], pipe.mid[1]);
    ctx.lineTo(pipe.tip[0], pipe.tip[1]);
    ctx.lineWidth = pipe.w + 6 * px;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    ctx.lineWidth = pipe.w;
    ctx.strokeStyle = C.metal;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pipe.tip[0], pipe.tip[1], pipe.tipR, 0, TAU);
    ctx.fillStyle = C.ink;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pipe.tip[0], pipe.tip[1], pipe.tipR * 0.5, 0, TAU);
    ctx.fillStyle = C.panel;
    ctx.fill();
  }
  const a0 = spec.wheel.anchors[0];
  const a1 = spec.wheel.anchors[1];
  ink(shape.swingW, C.dark, [[shape.swing[0], shape.swing[1]], [a0.x, a0.y]]);
  ink(shape.forkW, C.panel, [[shape.fork[0], shape.fork[1]], [a1.x, a1.y]]);
  ctx.restore();

  // 2. Wheels, in world space, spinning on the sim's own spin scalar.
  const ws = shape.wheel;
  for (let i = 0; i < 2; i++) {
    ctx.save();
    ctx.translate(p.wx[i], p.wy[i]);
    ctx.beginPath();
    ctx.arc(0, 0, wr, 0, TAU);
    ctx.fillStyle = C.ink;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, wr * 0.82, 0, TAU);
    ctx.fillStyle = C.tyre;
    ctx.fill();
    ctx.save();
    ctx.rotate(p.wspin[i]);
    if (fine && ws.treads > 0) {
      ctx.fillStyle = C.ink;
      const step = TAU / ws.treads;
      for (let k = 0; k < ws.treads; k++) {
        ctx.rotate(step);
        ctx.fillRect(wr * 0.8, -wr * 0.112, wr * 0.2, wr * 0.224);
      }
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 0, wr * ws.rim, 0, TAU);
    ctx.fillStyle = C.wheel;
    ctx.fill();
    ctx.lineWidth = 3.5 * px;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    // SPIN HAS TO STAY VISIBLE ON EVERY TYPE. It is a real state variable and
    // traction cannot be tuned — or read — without seeing it, so every wheel
    // style carries something that turns: spokes, or the disc's own mark.
    // bikeart.test.ts asserts no style has neither.
    ctx.save();
    ctx.rotate(p.wspin[i]);
    ctx.fillStyle = C.ink;
    for (let k = 0; k < ws.spokes; k++) {
      ctx.rotate(TAU / ws.spokes);
      ctx.beginPath();
      ctx.moveTo(0, -wr * 0.16);
      ctx.lineTo(wr * ws.rim * 0.93, -wr * 0.1);
      ctx.lineTo(wr * ws.rim * 0.93, wr * 0.1);
      ctx.lineTo(0, wr * 0.16);
      ctx.closePath();
      ctx.fill();
    }
    if (ws.disc) {
      ctx.beginPath();
      ctx.arc(0, 0, wr * ws.rim * 0.62, 0, TAU);
      ctx.fillStyle = C.panel;
      ctx.fill();
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.moveTo(wr * ws.rim * 0.18, -wr * 0.09);
      ctx.lineTo(wr * ws.rim * 0.58, -wr * 0.05);
      ctx.lineTo(wr * ws.rim * 0.58, wr * 0.05);
      ctx.lineTo(wr * ws.rim * 0.18, wr * 0.09);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // Hub in INK, not in the helmet colour. The head is the death sphere and a
    // pale dot on each wheel makes three matching circles out of the one thing
    // that must never be mistaken for anything — which is also why every
    // colourway puts its helmet hue at least 45 degrees off its wheel hue.
    ctx.beginPath();
    ctx.arc(0, 0, wr * ws.hub, 0, TAU);
    ctx.fillStyle = C.ink;
    ctx.fill();
    ctx.restore();
  }

  // 3. Chassis. The outline is what says which bike this is; everything inside
  //    it is drawn UNDER A CLIP ON THAT OUTLINE, which is what makes a tank
  //    band, a seat wedge and a decal structurally incapable of adding a pixel
  //    to the bike's silhouette.
  ctx.save();
  local();
  poly(shape.body);
  ctx.fillStyle = C.frame;
  ctx.fill();
  ctx.lineWidth = 6 * px;
  ctx.strokeStyle = C.ink;
  ctx.stroke();
  if (fine) {
    ctx.save();
    poly(shape.body);
    ctx.clip();
    poly(shape.tank);
    ctx.fillStyle = C.panel;
    ctx.fill();
    poly(shape.seat);
    ctx.fillStyle = C.ink;
    ctx.fill();
    if (shape.vent) {
      poly(shape.vent);
      ctx.fillStyle = C.ink;
      ctx.fill();
    }
    drawDecal(ctx, shape, L, px);
    ctx.restore();
    poly(shape.body);
    ctx.lineWidth = 4 * px;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    if (shape.lamp) {
      ctx.beginPath();
      ctx.arc(shape.lamp.x, shape.lamp.y, shape.lamp.r, 0, TAU);
      ctx.fillStyle = C.trim;
      ctx.fill();
      ctx.stroke();
    }
  }

  // 4. The rider — a chunky kid on the sim's driven pendulum. Everything that
  // moves here is read off the pose; nothing is animated on a timer except the
  // scarf, which is wind.
  const al = spec.rider.armLength;
  // The arm direction in CHASSIS-LOCAL space, un-rotated from world and
  // un-mirrored, so the rider leans where the sim says and not where a
  // hand-posed mockup said.
  const lax = (p.ox * p.ax + p.oy * p.ay) * facing;
  const lay = p.ox * p.ay - p.oy * p.ax;
  const hd = { x: lax * al, y: lay * al };
  const sh = { x: hd.x + 0.08, y: hd.y - 0.21 };
  const hip = { x: -0.22, y: 0.22 };
  const knee = { x: 0.17, y: 0.16 };
  const foot = { x: 0.05, y: -0.1 };
  const grip = { x: 0.27, y: 0.46 };
  const elb = { x: 0.07, y: 0.4 };
  const cut = jacketCut(L.app.jacket);
  const scarf = scarfStyle(L.app.scarf);

  if (fine && scarf.segments > 0) {
    ctx.beginPath();
    ctx.moveTo(sh.x - 0.02, sh.y + 0.05);
    const lift = scarf.length / 0.62;
    for (let i = 1; i <= scarf.segments; i++) {
      const u = i / scarf.segments;
      ctx.lineTo(
        sh.x - 0.04 - u * scarf.length,
        sh.y + 0.06 + Math.sin(t * 9 + u * 6) * scarf.sway * u + u * 0.16 * lift,
      );
    }
    ctx.lineWidth = scarf.w + 5 * px;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    ctx.lineWidth = scarf.w;
    ctx.strokeStyle = C.scarf;
    ctx.stroke();
  }
  ink(0.12, C.dark, [[hip.x, hip.y], [knee.x, knee.y], [foot.x, foot.y]]);
  const [j0, j1, j2] = cut.torso;
  ctx.beginPath();
  ctx.moveTo(hip.x - 0.11, hip.y - 0.05);
  ctx.lineTo(sh.x + j0[0], sh.y + j0[1]);
  ctx.lineTo(sh.x + j1[0], sh.y + j1[1]);
  ctx.lineTo(sh.x + j2[0], sh.y + j2[1]);
  ctx.lineTo(hip.x + 0.15, hip.y - 0.03);
  ctx.closePath();
  ctx.fillStyle = C.jacket;
  ctx.fill();
  ctx.lineWidth = 6 * px;
  ctx.strokeStyle = C.ink;
  ctx.stroke();
  if (fine && cut.open) {
    // A sleeveless cut reads by the shirt showing down the front, not by a
    // thinner outline — at this size a thinner outline is not a difference.
    ctx.beginPath();
    ctx.moveTo(sh.x + j2[0], sh.y + j2[1]);
    ctx.lineTo(hip.x + 0.15, hip.y - 0.03);
    ctx.lineTo(hip.x + 0.02, hip.y - 0.02);
    ctx.lineTo(sh.x + j1[0] * 0.5, sh.y + j1[1] * 0.6);
    ctx.closePath();
    ctx.fillStyle = C.head;
    ctx.fill();
  }
  if (fine && cut.flash) {
    ctx.beginPath();
    cut.flash.forEach((q, i) => (i ? ctx.lineTo(sh.x + q[0], sh.y + q[1]) : ctx.moveTo(sh.x + q[0], sh.y + q[1])));
    ctx.closePath();
    ctx.fillStyle = C.trim;
    ctx.fill();
  }
  ink(cut.arm, C.jacket, [[sh.x, sh.y + 0.02], [elb.x, elb.y], [grip.x, grip.y]]);
  if (fine) {
    ctx.beginPath();
    ctx.arc(grip.x, grip.y, 0.06, 0, TAU);
    ctx.fillStyle = C.trim;
    ctx.fill();
    ctx.lineWidth = 4 * px;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
  }
  ctx.restore();

  // 5. The head, in WORLD space at its TRUE radius. Drawn outside the chassis
  // frame so that no accumulated local transform can move it off the sphere the
  // sim actually tests — and every helmet is drawn UNDER A CLIP ON THAT SAME
  // CIRCLE, so no accessory can make the kill volume look bigger than it is.
  ctx.beginPath();
  ctx.arc(hx, hy, hr, 0, TAU);
  ctx.fillStyle = C.head;
  ctx.fill();
  ctx.lineWidth = 5 * px;
  ctx.strokeStyle = C.ink;
  ctx.stroke();
  if (fine) {
    const hs = helmetStyle(L.app.helmet);
    ctx.save();
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, TAU);
    ctx.clip();
    // Drawn in the chassis frame so the helmet sweeps round with the bike and
    // tells you which way the rider is looking, which at the base camera is
    // most of what says "upright" or "upside down".
    ctx.translate(hx, hy);
    ctx.transform(p.ox, p.oy, -p.oy, p.ox, 0, 0);
    ctx.scale(facing, 1);
    ctx.fillStyle = C.frame;
    for (const [bx, by, bw, bh] of hs.band) ctx.fillRect(bx * hr, by * hr, bw * hr, bh * hr);
    ctx.fillStyle = C.visor;
    for (const [vx, vy, vw, vh] of hs.lens) ctx.fillRect(vx * hr, vy * hr, vw * hr, vh * hr);
    ctx.fillStyle = C.trim;
    for (const [sx, sy, sr] of hs.studs) {
      ctx.beginPath();
      ctx.arc(sx * hr, sy * hr, sr * hr, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = alpha(P.ink, 0.22);
    ctx.fillRect(-hr * 1.3, hs.shadeY * hr, hr * 2.6, hr * 1.3);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, TAU);
    ctx.lineWidth = 4 * px;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Bodywork markings, drawn INSIDE the caller's clip on the body path.
 *
 * Placed from the body's own bounding box rather than authored per bike, so one
 * set of numbers lands sensibly on all six shapes and a seventh bike cannot
 * forget to place them.
 *
 * The number plate is pale — it is drawn in the helmet colour, which is the
 * brightest colour the livery has — with the digits in the decal colour. That
 * gets its contrast for free: the decal is floored against the FRAME, the head
 * is brighter than the frame by construction, so a digit that clears the
 * bodywork clears the plate by more.
 */
function drawDecal(ctx: CanvasRenderingContext2D, shape: BikeShape, L: BikeLook, px: number): void {
  const id = L.app.decal;
  if (id === 'none') return;
  const C: BikeColors = L.colors;
  const bb = bodyBox(shape);
  const w = bb.maxX - bb.minX;
  const h = bb.maxY - bb.minY;
  const midY = bb.minY + h * 0.5;

  if (id === 'stripe') {
    ctx.fillStyle = C.decal;
    ctx.beginPath();
    ctx.moveTo(bb.minX - 0.1, midY - h * 0.12);
    ctx.lineTo(bb.maxX + 0.1, midY + h * 0.02);
    ctx.lineTo(bb.maxX + 0.1, midY + h * 0.22);
    ctx.lineTo(bb.minX - 0.1, midY + h * 0.08);
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (id === 'checks') {
    const n = 9;
    const cw = (w + 0.2) / n;
    const ch = h * 0.17;
    ctx.fillStyle = C.decal;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 2; j++) {
        if ((i + j) % 2 !== 0) continue;
        ctx.fillRect(bb.minX - 0.1 + i * cw, midY - ch + j * ch, cw, ch);
      }
    }
    return;
  }

  // id === 'number'
  const pw = Math.min(0.26, w * 0.38);
  const ph = Math.min(0.2, h * 0.62);
  const cx = bb.minX + w * 0.24;
  const cy = midY + h * 0.02;
  ctx.fillStyle = C.head;
  ctx.fillRect(cx - pw / 2, cy - ph / 2, pw, ph);
  ctx.lineWidth = 4 * px;
  ctx.strokeStyle = C.ink;
  ctx.strokeRect(cx - pw / 2, cy - ph / 2, pw, ph);
  const lay = textOutline(L.plate, cx, cy - ph * 0.3, { size: ph * 0.6, align: 'center' });
  ctx.strokeStyle = C.decal;
  ctx.lineWidth = ph * 0.15;
  for (const stroke of lay.strokes) {
    ctx.beginPath();
    stroke.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.stroke();
  }
}

// --- fx ---------------------------------------------------------------------

function drawFX(
  ctx: CanvasRenderingContext2D, p: Pose, state: SimState, P: Palette, px: number, t: number, look: BikeLook,
): void {
  const speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);

  // EVERYTHING HERE MUST MIRROR WITH `facing`.
  //
  // drawBike mirrors the whole bike with ctx.scale(facing, 1), so the drawn
  // exhaust pipe swaps ends on a flip. These effects are emitted in world space
  // instead, so they did not — reported from play: "exhaust doesn't follow when
  // i switch directions". The pipe was on the right of the bike and the smoke
  // was still coming out of the left.
  //
  // Three separate places had the same assumption baked in, which is why the
  // fix is a single `f` threaded through all of them rather than one sign flip.
  const f = state.facing;

  // Exhaust from this BIKE TYPE'S pipe tip, chassis-local — the x mirrors. One
  // of the six vents instead of piping, and `exhaustPoint` answers for it too,
  // so smoke never comes out of a place the bike has no hole in.
  const tip = exhaustPoint(bikeShape(look.app.bike));
  const lx = tip[0] * f;
  const ly = tip[1];
  const tipX = p.px + p.ox * lx - p.oy * ly;
  const tipY = p.py + p.oy * lx + p.ox * ly;
  for (let k = 0; k < 4; k++) {
    const u = (t * 1.1 + k * 0.6) % 2.4;
    // Puffs trail BEHIND, and behind is whichever way the bike is not facing.
    const x = tipX - u * 0.8 * f;
    const y = tipY + u * 0.28;
    const R = 0.07 + u * 0.11;
    const a = Math.max(0, 1 - u / 2.4) * 0.5;
    if (a <= 0.02) continue;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fillStyle = P.cream;
    ctx.fill();
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = P.ink;
    ctx.stroke();
    ctx.restore();
  }

  // Dust behind a driven wheel, and speed lines once it is worth mentioning.
  // Both read the sim: no contact, no dust.
  if (state.grounded !== 0 && speed > 3) {
    // The DRIVEN wheel, which swaps on a flip — step.ts picks the rear the same
    // way. Hardcoding wheel 0 threw dust off the front wheel when facing -x.
    const rear = f > 0 ? 0 : 1;
    const gx = p.wx[rear];
    const gy = p.wy[rear] - 0.25;
    for (let k = 0; k < 5; k++) {
      const u = (t * 2 + k * 0.37) % 1;
      const x = gx - (u * 1.2 + k * 0.1) * f;
      const y = gy + u * 0.45;
      const R = 0.07 + u * 0.15 + k * 0.012;
      ctx.save();
      ctx.globalAlpha = (1 - u) * Math.min(1, (speed - 3) / 6) * 0.8;
      ctx.beginPath();
      ctx.arc(x, y, R, 0, Math.PI * 2);
      ctx.arc(x - R * 0.8, y - R * 0.3, R * 0.75, 0, Math.PI * 2);
      ctx.fillStyle = P.cream;
      ctx.fill();
      ctx.lineWidth = 3 * px;
      ctx.strokeStyle = P.ink;
      ctx.stroke();
      ctx.restore();
    }
  }
  if (speed > 12) {
    const r = rng(Math.floor(t * 12));
    ctx.save();
    ctx.strokeStyle = P.ink;
    ctx.lineCap = 'round';
    const dx = state.vx / (speed || 1);
    const dy = state.vy / (speed || 1);
    for (let i = 0; i < 6; i++) {
      const off = (r() - 0.5) * 1.6;
      const x0 = p.px - dx * (0.9 + r() * 0.5) - dy * off;
      const y0 = p.py - dy * (0.9 + r() * 0.5) + dx * off;
      const len = 0.5 + r() * 1.3;
      ctx.globalAlpha = (0.25 + r() * 0.3) * Math.min(1, (speed - 12) / 8);
      ctx.lineWidth = (2 + r() * 3) * px;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 - dx * len, y0 - dy * len);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * Dust in the light. WORLD space, tiled around the camera — the mockup's motes
 * lived in screen space, which is invisible in a still frame and very obvious
 * the moment the camera pans, because the dust would slide with the window
 * instead of staying in the room.
 */
function drawMotes(
  ctx: CanvasRenderingContext2D, b: Bounds, P: Palette, t: number, count: number, s: number,
): void {
  const TILE = 12;
  const x0 = Math.floor(b.minX / TILE);
  const y0 = Math.floor(b.minY / TILE);
  const x1 = Math.floor(b.maxX / TILE);
  const y1 = Math.floor(b.maxY / TILE);
  const per = Math.max(1, Math.round(count / 12));
  ctx.save();
  ctx.fillStyle = P.cream;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const r = rng(((cx * 73856093) ^ (cy * 19349663)) >>> 0);
      for (let i = 0; i < per; i++) {
        const bx = cx * TILE + r() * TILE;
        const rise = 0.35 + r() * 0.9;
        const ph = r() * 7;
        const by = cy * TILE + ((r() * TILE + t * rise) % TILE);
        ctx.globalAlpha = (0.25 + r() * 0.4) * s;
        ctx.beginPath();
        ctx.arc(bx + Math.sin(t * 0.7 + ph) * 0.2, by, 0.03 + r() * 0.03, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawLocator(
  ctx: CanvasRenderingContext2D, p: Pose, px: number, a: number, P: Palette,
): void {
  const r = 16 * px;
  ctx.save();
  ctx.globalAlpha = a * 0.85;
  ctx.strokeStyle = P.magenta;
  ctx.lineWidth = 1.5 * px;
  ctx.beginPath();
  ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = a * 0.5;
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    ctx.moveTo(p.px + dx * r * 1.35, p.py + dy * r * 1.35);
    ctx.lineTo(p.px + dx * r * 2.2, p.py + dy * r * 2.2);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * G. The true collision boundary, its normals and the live contacts, drawn OVER
 * the art in a colour the palette does not contain.
 *
 * This is the regression check for the whole look: if the ink is ever off the
 * real edge, or a cel band paints a ceiling as a floor, this is what shows it.
 * It must therefore not be styled, not be faded, and not be drawn underneath
 * anything.
 */
function drawDebug(ctx: CanvasRenderingContext2D, world: World, px: number): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#00ff9c';
  ctx.lineWidth = 1.5 * px;
  for (const p of world.level.polys) {
    const n = p.vx.length;
    ctx.beginPath();
    ctx.moveTo(p.vx[0], p.vy[0]);
    for (let i = 1; i < n; i++) ctx.lineTo(p.vx[i], p.vy[i]);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.strokeStyle = '#ff9f43';
  ctx.lineWidth = px;
  for (const p of world.level.polys) {
    const n = p.vx.length;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const mx = (p.vx[i] + p.vx[j]) / 2;
      const my = (p.vy[i] + p.vy[j]) / 2;
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + p.nx[i] * 0.25, my + p.ny[i] * 0.25);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = '#ff9f43';
  ctx.lineWidth = 2 * px;
  for (let i = 0; i < world.contactCount; i++) {
    const c = world.contacts[i];
    ctx.beginPath();
    ctx.moveTo(c.px, c.py);
    ctx.lineTo(c.px + c.nx * (0.2 + c.depth * 4), c.py + c.ny * (0.2 + c.depth * 4));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c.px, c.py, 0.04, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// --- the bike as a portrait --------------------------------------------------

/**
 * ONE PERSON'S BIKE, STANDING STILL, IN WHATEVER CANVAS YOU HAND IT.
 *
 * This is what turns a board row from a name and a number into somebody. It is
 * not a second drawing of the bike — it is `drawBike`, at a small scale, on a
 * synthetic level pose, which is the same argument thumbs.ts makes about level
 * pictures: a portrait cannot drift from the game because it IS the game.
 *
 * `tier: 'fine'` rather than letting the latches decide, for the reason spelled
 * out on `BikeTier`: an avatar must never be able to change what the player's
 * own bike is drawn at.
 */
export function drawBikePortrait(
  ctx: CanvasRenderingContext2D, spec: BikeSpec, P: Palette, look: BikeLook, zoom: number,
): void {
  const a0 = spec.wheel.anchors[0];
  const a1 = spec.wheel.anchors[1];
  const pose: Pose = {
    px: 0,
    py: 0,
    ox: 1,
    oy: 0,
    wx: [a0.x, a1.x],
    wy: [a0.y, a1.y],
    // A quarter turn of spin, so the spokes read as spokes rather than as a
    // cross that happens to line up with the axes on every single avatar.
    wspin: [0.4, 0.4],
    ax: 0,
    ay: 1,
  };
  drawBike(ctx, pose, spec, 1 / zoom, P, 1, 0, 1, 'fine', look);
}

/**
 * The bike's extent in metres, for framing a portrait. Derived from the SPEC —
 * the wheels and the head sphere — rather than from the art, because the art is
 * required to stay inside them and framing on the art would let a bike type
 * quietly change how big everyone's avatar is.
 */
export function portraitExtent(spec: BikeSpec): { w: number; h: number; cy: number } {
  const wr = spec.wheel.radius;
  const ax = Math.max(Math.abs(spec.wheel.anchors[0].x), Math.abs(spec.wheel.anchors[1].x));
  const top = spec.rider.armLength + spec.rider.headRadius;
  const bottom = spec.wheel.anchors[0].y - wr;
  return { w: 2 * (ax + wr), h: top - bottom, cy: (top + bottom) / 2 };
}
