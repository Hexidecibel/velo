// canvas2d renderer.
//
// Explicitly EXEMPT from the sim's Math.* ban: it may use atan2, sin and cos
// freely, because nothing downstream of rendering is ever verified. Nothing in
// this file may be imported by src/sim, and isolation.test.ts enforces that.
//
// The world is y-UP; the canvas is y-down, so the view transform carries a
// negative y scale and every path below is written in world coordinates.
import { PICKUP_RADIUS } from '@/sim/consts.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import type { SimState } from '@/sim/step.ts';
import type { World } from '@/sim/world.ts';
import { drawEdgeMarkers, edgeMarkers } from './markers.ts';
import type { MarkerTarget } from './markers.ts';

const COL_SOLID = '#1b2029';
const COL_FREE = '#0b0d11';
const COL_EDGE = '#7fd4ff';
const COL_DECOR = '#161b23';
const COL_BIKE = '#e8eef7';
const COL_RIM = '#9fb3c8';
const COL_HEAD = '#ff5d5d';
const COL_APPLE = '#5ddb8a';
const COL_FLOWER = '#ffd166';
const COL_DEBUG = '#ff9f43';

/**
 * What the renderer needs off the camera, and nothing else. camera.ts's Camera
 * satisfies this structurally; keeping the renderer's requirement this small is
 * what lets the camera gain parameters without the renderer caring.
 */
export interface View {
  x: number;
  y: number;
  /** Pixels per metre. */
  zoom: number;
}

/** The interpolated pose the renderer draws — never the sim's live state. */
export interface Pose {
  px: number;
  py: number;
  ox: number;
  oy: number;
  wx: [number, number];
  wy: [number, number];
  wspin: [number, number];
  ax: number;
  ay: number;
}

/**
 * Interpolate between the two most recent sim states. Positions lerp, rotors
 * nlerp and renormalise, and DISCRETE STATE NEVER INTERPOLATES — apple counts,
 * death and facing all snap, because a half-collected apple is not a thing.
 */
export function interpolate(prev: SimState, cur: SimState, a: number): Pose {
  const l = (p: number, c: number): number => p + (c - p) * a;
  const nx = l(prev.ox, cur.ox);
  const ny = l(prev.oy, cur.oy);
  const nm = Math.sqrt(nx * nx + ny * ny) || 1;
  const ax = l(prev.ax, cur.ax);
  const ay = l(prev.ay, cur.ay);
  const am = Math.sqrt(ax * ax + ay * ay) || 1;
  return {
    px: l(prev.px, cur.px),
    py: l(prev.py, cur.py),
    ox: nx / nm,
    oy: ny / nm,
    wx: [l(prev.wx[0], cur.wx[0]), l(prev.wx[1], cur.wx[1])],
    wy: [l(prev.wy[0], cur.wy[0]), l(prev.wy[1], cur.wy[1])],
    wspin: [l(prev.wspin[0], cur.wspin[0]), l(prev.wspin[1], cur.wspin[1])],
    ax: ax / am,
    ay: ay / am,
  };
}

export interface RenderOpts {
  debug: boolean;
  ghost: Pose | null;
  /**
   * Which way the GHOST'S bike is facing. Its own, never the player's: facing
   * decides which wheel is drawn as the driven one and which way the rider
   * leans, so borrowing the player's would draw a ghost that flips whenever the
   * player presses space. Undefined falls back to the player's facing, which is
   * what every call site did before ghosts came from a leaderboard.
   */
  ghostFacing?: number;
  /**
   * 0..1 — how far the camera is into the wide overview framing. Drives the
   * bike locator, because at 9 px/m the bike is fifteen pixels of thin line in
   * a screenful of cave and "show the bike's position clearly" is not optional.
   */
  overview: number;
  /** Off-screen indicators for the uncollected apples and the flower. */
  markers: { inset: number; alpha: number } | null;
}

export function render(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  cam: View,
  world: World,
  state: SimState,
  pose: Pose,
  spec: BikeSpec,
  opts: RenderOpts,
): void {
  const level = world.level;

  ctx.save();
  ctx.fillStyle = COL_SOLID;
  ctx.fillRect(0, 0, cssW, cssH);

  // World transform: metres -> pixels, y flipped.
  ctx.translate(cssW / 2, cssH / 2);
  ctx.scale(cam.zoom, -cam.zoom);
  ctx.translate(-cam.x, -cam.y);
  const px = 1 / cam.zoom;

  // Free space. Caves carve it out of the solid backdrop; ground polygons put
  // solid back. Painted in that order so overlapping shapes composite the way
  // the collision actually reads them.
  ctx.fillStyle = COL_FREE;
  for (const p of level.polys) {
    if (p.solidInside) continue;
    tracePoly(ctx, p.vx, p.vy);
    ctx.fill();
  }
  ctx.fillStyle = COL_SOLID;
  for (const p of level.polys) {
    if (!p.solidInside) continue;
    tracePoly(ctx, p.vx, p.vy);
    ctx.fill();
  }

  // Decor: drawn, never collided, deliberately almost invisible.
  ctx.fillStyle = COL_DECOR;
  for (const d of level.decor) {
    ctx.beginPath();
    d.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }

  // The collision edge, at the highest contrast on screen after the bike.
  ctx.strokeStyle = COL_EDGE;
  ctx.lineWidth = 2 * px;
  ctx.lineJoin = 'round';
  for (const p of level.polys) {
    tracePoly(ctx, p.vx, p.vy);
    ctx.stroke();
  }

  if (opts.debug) drawNormals(ctx, world, px);

  // Objects.
  for (let i = 0; i < level.apples.length; i++) {
    if (state.applesTaken[i] !== 0) continue;
    const a = level.apples[i];
    ctx.fillStyle = COL_APPLE;
    // A pixel FLOOR on the radius, not a fixed size in metres. Zoomed out to
    // frame a 176 m level an apple is a third of a pixel and simply is not
    // there — which would make the overview useless for the one question it
    // most needs to answer. Above the floor this is exactly the old size.
    circle(ctx, a.x, a.y, Math.max(0.16, 3.5 * px));
    ctx.fill();
    ctx.strokeStyle = COL_APPLE;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = px;
    circle(ctx, a.x, a.y, Math.max(PICKUP_RADIUS, 7 * px));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const fl = level.flower;
  const flr = Math.max(0.22, 5 * px);
  ctx.strokeStyle = COL_FLOWER;
  ctx.lineWidth = 2 * px;
  ctx.globalAlpha = state.applesLeft === 0 ? 1 : 0.35;
  circle(ctx, fl.x, fl.y, flr);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(fl.x, fl.y - flr);
  ctx.lineTo(fl.x, fl.y - flr * 2.5);
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (opts.ghost) drawBike(ctx, opts.ghost, spec, px, 0.25, opts.ghostFacing ?? state.facing);
  drawBike(ctx, pose, spec, px, 1, state.facing);

  if (opts.overview > 0) drawLocator(ctx, pose, px, opts.overview);

  if (opts.debug) drawContacts(ctx, world, px);

  ctx.restore();

  // Screen space from here down: the world transform is gone, so these are in
  // CSS pixels and do not scale with the zoom. That is the point — an edge
  // indicator that shrank as you zoomed out would vanish exactly when it
  // started being useful.
  if (opts.markers) {
    const targets: MarkerTarget[] = [];
    for (let i = 0; i < level.apples.length; i++) {
      if (state.applesTaken[i] !== 0) continue;
      targets.push({ x: level.apples[i].x, y: level.apples[i].y, kind: 'apple' });
    }
    // The flower only points the way once it is actually the thing to go to.
    // Before that it is a spoiler at best and a wrong answer at worst.
    if (state.applesLeft === 0) targets.push({ x: fl.x, y: fl.y, kind: 'flower' });
    const list = edgeMarkers(targets, cam, cssW, cssH, { x: pose.px, y: pose.py }, opts.markers.inset);
    drawEdgeMarkers(ctx, list, opts.markers.alpha);
  }
}

/**
 * Where the bike is, in SCREEN-sized pixels, so it stays findable at any zoom.
 *
 * A ring plus four ticks rather than a dot: a dot at this scale is
 * indistinguishable from an apple, and the one thing this must never do is make
 * you look in the wrong place.
 */
function drawLocator(ctx: CanvasRenderingContext2D, p: Pose, px: number, alpha: number): void {
  const r = 16 * px;
  ctx.save();
  ctx.globalAlpha = alpha * 0.85;
  ctx.strokeStyle = COL_HEAD;
  ctx.lineWidth = 1.5 * px;
  circle(ctx, p.px, p.py, r);
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.5;
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    ctx.moveTo(p.px + dx * r * 1.35, p.py + dy * r * 1.35);
    ctx.lineTo(p.px + dx * r * 2.2, p.py + dy * r * 2.2);
  }
  ctx.stroke();
  ctx.restore();
}

function tracePoly(ctx: CanvasRenderingContext2D, vx: Float64Array, vy: Float64Array): void {
  ctx.beginPath();
  ctx.moveTo(vx[0], vy[0]);
  for (let i = 1; i < vx.length; i++) ctx.lineTo(vx[i], vy[i]);
  ctx.closePath();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function drawBike(
  ctx: CanvasRenderingContext2D,
  p: Pose,
  spec: BikeSpec,
  px: number,
  alpha: number,
  facing: number,
): void {
  const rx = (lx: number, ly: number): number => p.px + (p.ox * lx - p.oy * ly);
  const ry = (lx: number, ly: number): number => p.py + (p.oy * lx + p.ox * ly);
  ctx.globalAlpha = alpha;

  // Frame colliders — faint, because they are not what you aim with.
  ctx.strokeStyle = COL_RIM;
  ctx.globalAlpha = alpha * 0.28;
  ctx.lineWidth = px;
  for (const c of spec.chassis.colliders) {
    circle(ctx, rx(c.x, c.y), ry(c.x, c.y), c.r);
    ctx.stroke();
  }
  ctx.globalAlpha = alpha;

  // Suspension links, anchor to hub.
  ctx.strokeStyle = COL_RIM;
  ctx.lineWidth = 2.5 * px;
  for (let i = 0; i < 2; i++) {
    const a = spec.wheel.anchors[i];
    ctx.beginPath();
    ctx.moveTo(rx(a.x, a.y), ry(a.x, a.y));
    ctx.lineTo(p.wx[i], p.wy[i]);
    ctx.stroke();
  }

  // Frame spine.
  ctx.strokeStyle = COL_BIKE;
  ctx.lineWidth = 3.5 * px;
  const a0 = spec.wheel.anchors[0];
  const a1 = spec.wheel.anchors[1];
  ctx.beginPath();
  ctx.moveTo(rx(a0.x, a0.y), ry(a0.x, a0.y));
  ctx.lineTo(rx(0, 0.05), ry(0, 0.05));
  ctx.lineTo(rx(a1.x, a1.y), ry(a1.x, a1.y));
  ctx.stroke();

  // Facing tick: a short nose in the direction the drive wheel is chosen for.
  ctx.strokeStyle = COL_FLOWER;
  ctx.lineWidth = 2 * px;
  ctx.beginPath();
  ctx.moveTo(rx(0, 0.05), ry(0, 0.05));
  ctx.lineTo(rx(0.45 * facing, 0.18), ry(0.45 * facing, 0.18));
  ctx.stroke();

  // Wheels, with a spoke so that spin is visible — it is a real state variable
  // and you cannot tune traction without seeing it.
  ctx.lineWidth = 2.5 * px;
  for (let i = 0; i < 2; i++) {
    ctx.strokeStyle = COL_BIKE;
    circle(ctx, p.wx[i], p.wy[i], spec.wheel.radius);
    ctx.stroke();
    const th = p.wspin[i];
    ctx.strokeStyle = COL_RIM;
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.moveTo(p.wx[i], p.wy[i]);
    ctx.lineTo(
      p.wx[i] + Math.cos(th) * spec.wheel.radius,
      p.wy[i] + Math.sin(th) * spec.wheel.radius,
    );
    ctx.stroke();
    ctx.lineWidth = 2.5 * px;
  }

  // The rider: a massless arm and a head that kills.
  const hx = p.px + spec.rider.armLength * p.ax;
  const hy = p.py + spec.rider.armLength * p.ay;
  ctx.strokeStyle = COL_BIKE;
  ctx.lineWidth = 3 * px;
  ctx.beginPath();
  ctx.moveTo(p.px, p.py);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.fillStyle = COL_HEAD;
  circle(ctx, hx, hy, spec.rider.headRadius);
  ctx.fill();

  ctx.globalAlpha = 1;
}

function drawNormals(ctx: CanvasRenderingContext2D, world: World, px: number): void {
  ctx.strokeStyle = COL_DEBUG;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = px;
  for (const p of world.level.polys) {
    const n = p.vx.length;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const mx = (p.vx[i] + p.vx[j]) / 2;
      const my = (p.vy[i] + p.vy[j]) / 2;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + p.nx[i] * 0.25, my + p.ny[i] * 0.25);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawContacts(ctx: CanvasRenderingContext2D, world: World, px: number): void {
  // Left over from the last tick of the last frame stepped — good enough to see
  // which features the solver actually picked, which is what you want when a
  // wheel is behaving oddly on a corner.
  ctx.strokeStyle = COL_DEBUG;
  ctx.lineWidth = 2 * px;
  for (let i = 0; i < world.contactCount; i++) {
    const c = world.contacts[i];
    ctx.beginPath();
    ctx.moveTo(c.px, c.py);
    ctx.lineTo(c.px + c.nx * (0.2 + c.depth * 4), c.py + c.ny * (0.2 + c.depth * 4));
    ctx.stroke();
    circle(ctx, c.px, c.py, 0.04);
    ctx.stroke();
  }
}
