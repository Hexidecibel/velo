// What the editor draws on top of the game.
//
// The game's own renderer draws the LEVEL — it is the same renderer, the same
// palette and the same art, because the whole point of editing in place is that
// you are looking at the thing you will ride. This file draws only the parts
// that are not the level: the handles, the grid, the warnings, and the bike.
//
// It runs after `render`/`renderArt` and sets up the identical world transform,
// so every path here is written in metres.
//
// TWO RULES, both inherited from the art direction and both load-bearing:
//
//   * THE COLLISION EDGE STAYS THE HIGHEST-CONTRAST THING ON SCREEN. Editor
//     chrome is drawn thin, in the palette's dim and accent colours, and never
//     fills. A handle that out-shouts the geometry makes the editor worse at
//     the only thing it is for.
//   * HANDLES ARE A FIXED SIZE IN PIXELS, not in metres. A vertex marker that
//     scales with the zoom is invisible when zoomed out and covers the level
//     when zoomed in, and the zoom is how you move between "where does this
//     ledge go" and "is that 1.2 m".
import type { BikeSpec } from '@/sim/spec.ts';
import type { Finding } from './check.ts';
import { arcHandle } from './geom.ts';
import { GAP_CLEAN, GAP_TIGHT } from './geom.ts';
import type { Handle } from './geom.ts';
import type { EditDoc, EditPolygon } from './doc.ts';
import type { Silhouette } from './silhouette.ts';

export interface View {
  x: number;
  y: number;
  zoom: number;
}

const COL_GRID = 'rgba(141, 133, 173, 0.16)';
const COL_GRID_AXIS = 'rgba(141, 133, 173, 0.38)';
const COL_CAVE = '#29d9f2';
const COL_GROUND = '#ffd21f';
const COL_DECOR = '#8d85ad';
const COL_ARC = '#c07bff';
const COL_SEL = '#ffffff';
const COL_BAD = '#ff3d3d';
const COL_WARN = '#ffd21f';
const COL_BIKE = 'rgba(230, 225, 245, 0.55)';
const COL_HEAD = 'rgba(255, 93, 93, 0.75)';

/** Half-size of a handle square, CSS px. Big enough to hit, small enough to see past. */
export const HANDLE_PX = 4;
/** How close the pointer has to be to grab something, CSS px. */
export const PICK_PX = 11;

export function kindColour(kind: EditPolygon['kind']): string {
  return kind === 'ground' ? COL_GROUND : kind === 'decor' ? COL_DECOR : COL_CAVE;
}

export interface OverlayOpts {
  doc: EditDoc;
  findings: Finding[];
  /** Which classes of finding to draw. The panel owns the toggles. */
  showWarnings: boolean;
  selection: Handle | null;
  hover: Handle | null;
  /** Pointer position in world metres, snapped as the editor would place it. */
  cursor: { x: number; y: number } | null;
  grid: number;
  gridOn: boolean;
  /** The resting bike, drawn at the cursor. Null hides it. */
  bike: Silhouette | null;
  /** Floor-to-ceiling height through the cursor, metres. Infinity is open sky. */
  gap: { up: number; down: number; height: number } | null;
  spec: BikeSpec;
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  view: View,
  o: OverlayOpts,
): void {
  const px = 1 / view.zoom;
  ctx.save();
  ctx.translate(cssW / 2, cssH / 2);
  ctx.scale(view.zoom, -view.zoom);
  ctx.translate(-view.x, -view.y);

  drawGrid(ctx, cssW, cssH, view, o);
  if (o.bike && o.cursor) drawBike(ctx, o.bike, o.cursor, px);
  if (o.gap && o.cursor) drawGap(ctx, o.cursor, o.gap, px);
  drawPolygons(ctx, o, px);
  drawDraft(ctx, o, px);
  drawObjects(ctx, o, px);
  if (o.showWarnings) drawFindings(ctx, o.findings, px);

  ctx.restore();
  drawLabels(ctx, cssW, cssH, view, o);
}

// --- the grid ----------------------------------------------------------------

function drawGrid(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, view: View, o: OverlayOpts): void {
  if (!o.gridOn || !(o.grid > 0)) return;
  // Step UP the grid until the lines are at least 6 px apart. Drawing a 0.1 m
  // grid at overview zoom is thousands of lines that render as grey fog, and
  // the fog is exactly over the geometry you are trying to read.
  let step = o.grid;
  while (step * view.zoom < 6) step *= 5;
  const halfW = cssW / 2 / view.zoom;
  const halfH = cssH / 2 / view.zoom;
  const x0 = Math.floor((view.x - halfW) / step) * step;
  const x1 = view.x + halfW;
  const y0 = Math.floor((view.y - halfH) / step) * step;
  const y1 = view.y + halfH;
  ctx.lineWidth = 1 / view.zoom;
  ctx.strokeStyle = COL_GRID;
  ctx.beginPath();
  for (let x = x0; x <= x1; x += step) {
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
  }
  for (let y = y0; y <= y1; y += step) {
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.stroke();
  // The origin, so "where am I" always has an answer.
  ctx.strokeStyle = COL_GRID_AXIS;
  ctx.beginPath();
  ctx.moveTo(0, y0);
  ctx.lineTo(0, y1);
  ctx.moveTo(x0, 0);
  ctx.lineTo(x1, 0);
  ctx.stroke();
}

// --- handles -----------------------------------------------------------------

function square(ctx: CanvasRenderingContext2D, x: number, y: number, half: number): void {
  ctx.beginPath();
  ctx.rect(x - half, y - half, half * 2, half * 2);
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, half: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + half);
  ctx.lineTo(x + half, y);
  ctx.lineTo(x, y - half);
  ctx.lineTo(x - half, y);
  ctx.closePath();
}

function drawPolygons(ctx: CanvasRenderingContext2D, o: OverlayOpts, px: number): void {
  const h = HANDLE_PX * px;
  o.doc.polygons.forEach((poly, pi) => {
    const col = kindColour(poly.kind);
    const n = poly.verts.length;
    // Arc handles first, so a vertex on top of one is still grabbable by eye.
    ctx.strokeStyle = COL_ARC;
    ctx.lineWidth = px;
    for (let vi = 0; vi < n; vi++) {
      const a = poly.verts[vi === 0 ? n - 1 : vi - 1];
      const b = poly.verts[vi];
      const hd = arcHandle(a, b, b.bulge);
      if (b.bulge !== 0) {
        // The chord the sagitta is measured off. This is the one piece of
        // geometry that makes `bulge` legible rather than a number in a box.
        ctx.setLineDash([3 * px, 3 * px]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
        ctx.lineTo(hd.x, hd.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      diamond(ctx, hd.x, hd.y, h * 0.9);
      ctx.stroke();
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5 * px;
    for (let vi = 0; vi < n; vi++) {
      const v = poly.verts[vi];
      const selected = o.selection?.kind === 'vertex' && o.selection.pi === pi && o.selection.vi === vi;
      square(ctx, v.x, v.y, selected ? h * 1.6 : h);
      ctx.strokeStyle = selected ? COL_SEL : col;
      ctx.stroke();
    }
  });
}

function drawDraft(ctx: CanvasRenderingContext2D, o: OverlayOpts, px: number): void {
  const d = o.doc.draft;
  if (!d || d.verts.length === 0) return;
  const col = kindColour(d.kind);
  ctx.strokeStyle = col;
  ctx.lineWidth = 2 * px;
  ctx.beginPath();
  d.verts.forEach((v, i) => (i === 0 ? ctx.moveTo(v.x, v.y) : ctx.lineTo(v.x, v.y)));
  ctx.stroke();
  if (o.cursor) {
    // The rubber band, plus the closing edge, so the shape you are about to
    // commit is the shape on screen rather than the shape you are imagining.
    ctx.setLineDash([4 * px, 4 * px]);
    ctx.beginPath();
    const last = d.verts[d.verts.length - 1];
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(o.cursor.x, o.cursor.y);
    if (d.verts.length >= 2) ctx.lineTo(d.verts[0].x, d.verts[0].y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const h = HANDLE_PX * px;
  ctx.lineWidth = 1.5 * px;
  for (const v of d.verts) {
    square(ctx, v.x, v.y, h);
    ctx.stroke();
  }
}

function drawObjects(ctx: CanvasRenderingContext2D, o: OverlayOpts, px: number): void {
  const h = HANDLE_PX * px * 1.4;
  const ring = (x: number, y: number, col: string, sel: boolean): void => {
    ctx.strokeStyle = sel ? COL_SEL : col;
    ctx.lineWidth = (sel ? 2.5 : 1.5) * px;
    ctx.beginPath();
    ctx.arc(x, y, h, 0, Math.PI * 2);
    ctx.stroke();
  };
  const s = o.selection;
  ring(o.doc.start.x, o.doc.start.y, '#9dff3d', s?.kind === 'start');
  ring(o.doc.flower.x, o.doc.flower.y, '#ffd21f', s?.kind === 'flower');
  o.doc.apples.forEach((a, i) => ring(a.x, a.y, '#5ddb8a', s?.kind === 'apple' && s.pi === i));
}

function drawFindings(ctx: CanvasRenderingContext2D, findings: Finding[], px: number): void {
  for (const f of findings) {
    if (!f.at) continue;
    ctx.strokeStyle = f.severity === 'error' ? COL_BAD : COL_WARN;
    ctx.lineWidth = 1.5 * px;
    const r = 9 * px;
    ctx.beginPath();
    ctx.arc(f.at.x, f.at.y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (f.severity === 'error') {
      ctx.beginPath();
      ctx.moveTo(f.at.x - r * 0.6, f.at.y - r * 0.6);
      ctx.lineTo(f.at.x + r * 0.6, f.at.y + r * 0.6);
      ctx.moveTo(f.at.x - r * 0.6, f.at.y + r * 0.6);
      ctx.lineTo(f.at.x + r * 0.6, f.at.y - r * 0.6);
      ctx.stroke();
    }
  }
}

// --- the ruler ---------------------------------------------------------------

function drawBike(ctx: CanvasRenderingContext2D, bike: Silhouette, at: { x: number; y: number }, px: number): void {
  // Placed with its WHEELS on the cursor's height, because that is how a bike
  // meets a floor: you put the pointer where the ground is and the picture
  // answers "and how much room is above it".
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.lineWidth = 1.5 * px;
  ctx.strokeStyle = COL_BIKE;
  for (const c of [...bike.wheels, ...bike.chassis]) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, bike.chassis[0]?.y ?? 0.4);
  ctx.lineTo(bike.head.x, bike.head.y);
  ctx.stroke();
  ctx.strokeStyle = COL_HEAD;
  ctx.beginPath();
  ctx.arc(bike.head.x, bike.head.y, bike.head.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawGap(
  ctx: CanvasRenderingContext2D,
  at: { x: number; y: number },
  gap: { up: number; down: number; height: number },
  px: number,
): void {
  if (!Number.isFinite(gap.height)) return;
  ctx.strokeStyle = gap.height < GAP_TIGHT ? COL_BAD : gap.height < GAP_CLEAN ? COL_WARN : 'rgba(157, 255, 61, 0.7)';
  ctx.lineWidth = 1.5 * px;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y - gap.down);
  ctx.lineTo(at.x, at.y + gap.up);
  const t = 4 * px;
  ctx.moveTo(at.x - t, at.y - gap.down);
  ctx.lineTo(at.x + t, at.y - gap.down);
  ctx.moveTo(at.x - t, at.y + gap.up);
  ctx.lineTo(at.x + t, at.y + gap.up);
  ctx.stroke();
}

// --- screen-space text -------------------------------------------------------

/** Where a world point lands in CSS pixels. Also what the pointer maths inverts. */
export function worldToScreen(view: View, cssW: number, cssH: number, x: number, y: number): { x: number; y: number } {
  return { x: cssW / 2 + (x - view.x) * view.zoom, y: cssH / 2 - (y - view.y) * view.zoom };
}

export function screenToWorld(view: View, cssW: number, cssH: number, sx: number, sy: number): { x: number; y: number } {
  return { x: view.x + (sx - cssW / 2) / view.zoom, y: view.y - (sy - cssH / 2) / view.zoom };
}

function drawLabels(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, view: View, o: OverlayOpts): void {
  if (!o.cursor) return;
  const s = worldToScreen(view, cssW, cssH, o.cursor.x, o.cursor.y);
  const lines: string[] = [`${o.cursor.x.toFixed(2)}, ${o.cursor.y.toFixed(2)} m`];
  if (o.gap && Number.isFinite(o.gap.height)) {
    lines.push(`gap ${o.gap.height.toFixed(2)} m${o.gap.height < GAP_TIGHT ? '  KILLS' : o.gap.height < GAP_CLEAN ? '  tight' : ''}`);
  }
  const sel = o.selection;
  if (sel?.kind === 'arc') {
    const poly = o.doc.polygons[sel.pi];
    const v = poly?.verts[sel.vi];
    if (v) lines.push(`bulge ${v.bulge.toFixed(3)} m`);
  }
  ctx.save();
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textBaseline = 'top';
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  const bx = Math.min(s.x + 12, cssW - w - 14);
  const by = Math.min(s.y + 12, cssH - lines.length * 14 - 8);
  ctx.fillStyle = 'rgba(13, 11, 26, 0.82)';
  ctx.fillRect(bx - 4, by - 3, w + 10, lines.length * 14 + 6);
  ctx.fillStyle = '#e6e1f5';
  lines.forEach((l, i) => ctx.fillText(l, bx, by + i * 14));
  ctx.restore();
}
