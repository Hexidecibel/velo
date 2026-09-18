// THE LEGEND'S PICTURES ARE THE GAME'S OWN RENDERER.
//
// The control legend used to be eighteen lines of text in a box, and the user's
// verdict on it was the brief for this file: "no just like text on a
// background". What replaced it is the bike — the actual bike, the player's
// livery, drawn by `artrender.ts` at a small scale — in the pose the control
// puts it in. BRAKE is the nose diving. LEAN is the rider's weight moved. FLIP
// is the same bike facing the other way.
//
// WHY THAT IS NOT DECORATION. Every pose below is built out of numbers the sim
// already owns and names: the chassis orientation, `spec.rider.leanL` and
// `leanR` (which ARE the servo's target arm directions, not an artist's
// approximation of them), the per-wheel spin scalar, and the suspension anchors
// the wheels are hung from. So a legend tile cannot drift from the game for the
// same reason an avatar cannot and a level thumbnail cannot: it is not a
// picture OF the game, it is the game, small.
//
// THE RULES THAT KEEP IT OFF THE HOT PATH are avatar.ts's, copied because they
// are the same rules:
//
//   * Nothing renders until the legend asks.
//   * Results are cached for the session, keyed by palette, livery and size.
//   * Drawn at tier 'fine', which BYPASSES the shared detail latches. A picture
//     in a panel must never be able to change what the player's own bike is
//     drawn at — that is exactly the shimmer the latches exist to stop.
//   * The SHIPPED spec, never the tuned one. The legend is a picture of the
//     controls, and it must not change because a slider moved.
import { cloneSpec } from '@/sim/spec.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import type { Pose } from './render.ts';
import type { Palette } from './art/palette.ts';
import type { BikeLook } from './art/bikeart.ts';
import { FRAME_BOX, headDrawRadius } from './art/bikeart.ts';
import { drawBikePose } from './artrender.ts';
import { BOOT_PRESET } from './presets.ts';
import type { PoseId } from './keys.ts';

/** See avatar.ts: the shipped bike, so no slider can move the legend. */
const SPEC: BikeSpec = cloneSpec(BOOT_PRESET.spec);

/** Ink outlines a few pixels wide alias badly this small. Drawn 2x, shown 1x. */
const SUPERSAMPLE = 2;

/**
 * THE POSES, and every number in one is a state the sim can really be in.
 *
 * `theta` is the chassis rotation in radians, positive being nose-up when the
 * bike faces +x, which is the sign convention the sim's own `ox, oy` uses.
 * `arm` names one of the three arm targets IN THE SPEC — the legend does not
 * get to invent a fourth. `spin` is the wheel spin scalar the art turns spokes
 * with, rear first.
 *
 * These are deliberately near the EDGE of what each input does rather than at
 * the middle of it. A brake tile at two degrees of dive is a picture of a bike
 * standing still; the tile has to be legible at 52 px tall, and the thing it is
 * teaching is which way the bike MOVES when you press the key.
 */
export interface PosePreset {
  theta: number;
  arm: 'rest' | 'leanL' | 'leanR';
  spin: readonly [number, number];
  facing: 1 | -1;
}

const D = Math.PI / 180;

export const POSES: Record<PoseId, PosePreset> = {
  // Standing on the line. The quarter turn of spin is avatar.ts's, and for its
  // reason: spokes that line up with the axes on every single picture read as a
  // cross rather than as a wheel.
  still: { theta: 0, arm: 'rest', spin: [0.4, 0.4], facing: 1 },
  // A wheelie. Gas spins the driven wheel up and the torque reaction picks the
  // front off the floor, which is the first thing the throttle teaches anybody.
  // Also measured: 200 ticks of throttle from rest ends at +104 degrees with
  // the rear wheel at -80 rad/s. The tile is that, early.
  gas: { theta: 20 * D, arm: 'leanL', spin: [-2.6, -0.35], facing: 1 },
  // The nose dives and the rider goes over the bars. Front wheel stopped, which
  // is what the brake actually does to it.
  brake: { theta: -16 * D, arm: 'leanR', spin: [-0.9, 0], facing: 1 },
  // Measured, not guessed: 200 ticks of IN_LEAN_L on a flat level takes the
  // chassis to +147 degrees and IN_LEAN_R to -147. So lean-left is the
  // anticlockwise one, and these two signs are the sim's and not a preference.
  leanL: { theta: 30 * D, arm: 'leanL', spin: [-1.1, -1.1], facing: 1 },
  leanR: { theta: -30 * D, arm: 'leanR', spin: [-1.1, -1.1], facing: 1 },
  // THE FLIP TILE'S POSE, drawn twice at facing +1 and -1. Riding rather than
  // standing, and that is the whole reason it is a separate entry: two upright
  // bikes side by side read as two bikes, and two bikes LEANT INTO THE
  // DIRECTION THEY ARE DRIVING read as one bike going two ways, which is what
  // the flip does and what the tile has to say without a sentence.
  ride: { theta: 11 * D, arm: 'rest', spin: [-2.2, -2.2], facing: 1 },
};

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * A preset turned into the same `Pose` the renderer gets from the sim.
 *
 * Pure: no canvas, no DOM, no palette. `legendart.test.ts` checks the poses are
 * finite, distinct, and that the arm really is the spec's own lean vector —
 * which is the one thing that would silently rot if somebody retuned the bike.
 */
export function legendPose(spec: BikeSpec, p: PosePreset): Pose {
  // FACING -1 IS A TRUE MIRROR, which means the rotation flips sign too.
  // `drawBike` maps a chassis-local point to `R(theta) * (facing*x, y)`, and
  // reflecting that whole drawing about the vertical axis is
  // `R(-theta) * (-x, y)` — the identity `M R(t) = R(-t) M`. Without the sign
  // the mirrored bike leans the same way as the original instead of the
  // opposite way, and the flip tile stops being one bike drawn twice.
  const th = p.theta * p.facing;
  const c = Math.cos(th);
  const s = Math.sin(th);
  // `facing` mirrors the chassis-local frame, so the anchors and the arm target
  // have to be mirrored in the same space BEFORE the rotation — exactly what
  // `drawBike`'s `ctx.scale(facing, 1)` does to everything it draws locally.
  const rot = (x: number, y: number): [number, number] => [p.facing * x * c - y * s, p.facing * x * s + y * c];
  const a0 = rot(spec.wheel.anchors[0].x, spec.wheel.anchors[0].y);
  const a1 = rot(spec.wheel.anchors[1].x, spec.wheel.anchors[1].y);
  const t = spec.rider[p.arm];
  const [ax, ay] = rot(t.x, t.y);
  const m = Math.sqrt(ax * ax + ay * ay) || 1;
  return {
    px: 0,
    py: 0,
    ox: c,
    oy: s,
    wx: [a0[0], a1[0]],
    wy: [a0[1], a1[1]],
    wspin: [p.spin[0], p.spin[1]],
    ax: ax / m,
    ay: ay / m,
  };
}

/**
 * What the pose occupies, in metres.
 *
 * Derived from the SPEC — the two wheel circles, the head sphere and the
 * chassis frame box — and never from the art, for `portraitExtent`'s reason:
 * the art is required to stay inside these, and framing on the art would let a
 * bike type quietly change how big every legend tile is.
 */
export function poseBounds(spec: BikeSpec, pose: Pose, headR: number): Bounds {
  const wr = spec.wheel.radius;
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const circle = (x: number, y: number, r: number): void => {
    if (x - r < b.minX) b.minX = x - r;
    if (x + r > b.maxX) b.maxX = x + r;
    if (y - r < b.minY) b.minY = y - r;
    if (y + r > b.maxY) b.maxY = y + r;
  };
  circle(pose.wx[0], pose.wy[0], wr);
  circle(pose.wx[1], pose.wy[1], wr);
  circle(pose.px + spec.rider.armLength * pose.ax, pose.py + spec.rider.armLength * pose.ay, headR);
  for (const [x, y] of [
    [FRAME_BOX.minX, FRAME_BOX.minY], [FRAME_BOX.maxX, FRAME_BOX.minY],
    [FRAME_BOX.maxX, FRAME_BOX.maxY], [FRAME_BOX.minX, FRAME_BOX.maxY],
  ]) circle(pose.px + x * pose.ox - y * pose.oy, pose.py + x * pose.oy + y * pose.ox, 0);
  return b;
}

/** Session cache: palette -> "livery|pose|w|h" -> data URL. */
const cache = new WeakMap<Palette, Map<string, string>>();

/**
 * One pose, as a data URL, ready to drop into an `<img>`.
 *
 * Returns '' when there is no 2d context to be had — a real state in a headless
 * or memory-pressured browser — because a missing picture must degrade to no
 * picture and never to a thrown exception inside the control legend.
 */
export function poseUrl(
  id: PoseId, P: Palette, look: BikeLook, w: number, h: number, facing: 1 | -1 = 1,
): string {
  const key = `${look.plate}|${id}|${facing}|${w}x${h}`;
  let byKey = cache.get(P);
  if (!byKey) {
    byKey = new Map();
    cache.set(P, byKey);
  }
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;

  const c = document.createElement('canvas');
  c.width = w * SUPERSAMPLE;
  c.height = h * SUPERSAMPLE;
  const ctx = c.getContext('2d');
  if (!ctx) return '';

  const preset = { ...POSES[id], facing };
  const pose = legendPose(SPEC, preset);
  const headR = headDrawRadius(SPEC, look.app.helmet);
  const b = poseBounds(SPEC, pose, headR);
  // A little air, and the TIGHTER axis wins so nothing is ever cropped. A
  // legend tile with the rider's head cut off would be teaching the wrong
  // lesson about head clearance, which is the thing that kills you here.
  const pad = 1.18;
  const zoom = Math.min(c.width / ((b.maxX - b.minX) * pad), c.height / ((b.maxY - b.minY) * pad));

  ctx.save();
  ctx.translate(c.width / 2, c.height / 2);
  // Negative y: the sim's world is y-up and a canvas is y-down. Same transform
  // the real frame uses, which is why `facing` and `theta` mean what they mean.
  ctx.scale(zoom, -zoom);
  ctx.translate(-(b.minX + b.maxX) / 2, -(b.minY + b.maxY) / 2);
  drawBikePose(ctx, pose, SPEC, P, look, zoom, preset.facing);
  ctx.restore();

  const url = c.toDataURL('image/png');
  byKey.set(key, url);
  return url;
}

/** An `<img>` of one pose. Alt text is empty: the tile names the control. */
export function poseImg(
  id: PoseId, P: Palette, look: BikeLook, w: number, h: number, facing: 1 | -1 = 1,
): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'lg-bike';
  img.width = w;
  img.height = h;
  img.alt = '';
  const url = poseUrl(id, P, look, w, h, facing);
  if (url) img.src = url;
  return img;
}
