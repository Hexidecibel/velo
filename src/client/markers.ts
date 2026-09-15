// Off-screen indicators: small arrows at the edge of the window pointing at the
// apples you have not collected yet, and at the flower.
//
// This is the cheap half of the navigation problem and it needs no map at all.
// "Where is the last one" is a question about ONE object, and an arrow that
// points at it plus a distance in metres answers it completely — whereas a
// minimap answers it badly, by asking you to locate the same object twice, once
// on a diagram and once in the world.
//
// The standing readability rule applies with full force: the player and the
// collision edge are the highest-contrast things on screen, so these are small,
// low-alpha and drawn without fill. They are peripheral information and they
// look like it.
//
// The placement maths is pure and lives here rather than in render.ts so it can
// be tested in plain node — projection and a ray/rect intersection are exactly
// the kind of thing that is wrong by a factor of two in a way nobody notices.
import type { View } from './render.ts';

export type MarkerKind = 'apple' | 'flower';

export interface MarkerTarget {
  x: number;
  y: number;
  kind: MarkerKind;
}

export interface EdgeMarker {
  /** Where to draw it, in CSS pixels. Always on the inset rectangle. */
  sx: number;
  sy: number;
  /** Unit direction from the screen centre toward the target. */
  dx: number;
  dy: number;
  /** Distance from the bike to the target, in metres. Not screen distance. */
  dist: number;
  kind: MarkerKind;
}

/**
 * Smallest gap between two markers on the rectangle, in px. Derived, not
 * tasted: the distance label is 10 px tall and the chevron spans 12 px, so two
 * markers closer than this have their labels on top of each other — which is
 * what several apples at nearly the same bearing look like, and it reads as a
 * smudge rather than as information.
 */
const MIN_SPACING = 22;

/**
 * One marker per target that is off-screen, placed on the rectangle inset by
 * `inset` px. A target already visible gets nothing — an arrow pointing at
 * something you can see is noise.
 *
 * The inset rectangle, not the window edge: an arrow drawn hard against the
 * edge loses half of itself to the bezel and reads as a smudge.
 *
 * Coincident markers are thinned to the nearest — see the loop at the bottom.
 */
export function edgeMarkers(
  targets: readonly MarkerTarget[],
  view: View,
  cssW: number,
  cssH: number,
  from: { x: number; y: number },
  inset: number,
): EdgeMarker[] {
  const out: EdgeMarker[] = [];
  const halfW = cssW / 2 - inset;
  const halfH = cssH / 2 - inset;
  // A window smaller than twice the inset has no rectangle to place anything
  // on. Draw nothing rather than something inside-out.
  if (halfW <= 0 || halfH <= 0 || view.zoom <= 0) return out;

  for (const t of targets) {
    // World -> screen, relative to the centre. The canvas is y-down and the
    // world is y-up, hence the negated y.
    const dx = (t.x - view.x) * view.zoom;
    const dy = -(t.y - view.y) * view.zoom;
    if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) continue;

    // Ray from the centre to the target, intersected with the inset rectangle:
    // scale the ray by whichever axis reaches its bound first.
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const sx = ax > 1e-9 ? halfW / ax : Infinity;
    const sy = ay > 1e-9 ? halfH / ay : Infinity;
    const s = Math.min(sx, sy);
    if (!Number.isFinite(s)) continue;

    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const wdx = t.x - from.x;
    const wdy = t.y - from.y;
    out.push({
      sx: cssW / 2 + dx * s,
      sy: cssH / 2 + dy * s,
      dx: dx / len,
      dy: dy / len,
      dist: Math.sqrt(wdx * wdx + wdy * wdy),
      kind: t.kind,
    });
  }

  // Thin out the pile-ups. Nearest first, then keep a marker only if nothing
  // already kept is sitting on top of it — so several apples at the same
  // bearing collapse to the one you would reach first, which is both the
  // legible answer and the useful one. The flower is never dropped: there is
  // one of it and it is the exit.
  out.sort((a, b) => (a.kind === b.kind ? a.dist - b.dist : a.kind === 'flower' ? -1 : 1));
  const kept: EdgeMarker[] = [];
  for (const m of out) {
    if (m.kind !== 'flower' && kept.some((k) => Math.hypot(k.sx - m.sx, k.sy - m.sy) < MIN_SPACING)) continue;
    kept.push(m);
  }
  return kept;
}

const COL_APPLE = '#5ddb8a';
const COL_FLOWER = '#ffd166';

/**
 * Draw them, in SCREEN space — the caller must have restored the world
 * transform first. A hollow chevron pointing outward plus the distance, which
 * is the smallest thing that answers "which way and how far".
 */
export function drawEdgeMarkers(
  ctx: CanvasRenderingContext2D,
  markers: readonly EdgeMarker[],
  alpha: number,
): void {
  if (markers.length === 0 || alpha <= 0) return;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textBaseline = 'middle';

  for (const m of markers) {
    const col = m.kind === 'flower' ? COL_FLOWER : COL_APPLE;
    // The flower is the exit and there is exactly one of it, so it reads a
    // little louder than the apples without breaking the subtlety rule.
    ctx.globalAlpha = alpha * (m.kind === 'flower' ? 1 : 0.85);
    ctx.strokeStyle = col;
    ctx.fillStyle = col;

    // A chevron: the tip on the rectangle, the two tails swept back along the
    // perpendicular. Drawn from the direction vector so there is no atan2 and
    // no rotate/restore per marker.
    const px = -m.dy;
    const py = m.dx;
    const tipX = m.sx;
    const tipY = m.sy;
    const backX = tipX - m.dx * 9;
    const backY = tipY - m.dy * 9;
    ctx.beginPath();
    ctx.moveTo(backX + px * 6, backY + py * 6);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(backX - px * 6, backY - py * 6);
    ctx.stroke();

    // Distance, placed further back along the same ray so it never lands off
    // the window on a corner marker.
    const label = `${m.dist < 10 ? m.dist.toFixed(1) : Math.round(m.dist)}m`;
    ctx.globalAlpha = alpha * 0.7;
    ctx.textAlign = m.dx > 0.4 ? 'right' : m.dx < -0.4 ? 'left' : 'center';
    ctx.fillText(label, tipX - m.dx * 15, tipY - m.dy * 15);
  }
  ctx.restore();
}
