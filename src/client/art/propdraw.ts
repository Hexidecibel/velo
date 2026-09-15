// Drawing the props. Baked once into world-space Path2D, exactly like every
// other layer — a frame is a handful of fills under the existing view
// transform, and only for the props whose bounding box is on screen.
//
// One generator per prop KIND, parameterised by size, seed, colour and text.
// Not fixed drawings: the mockup's VELO piece is one call to `piece` with one
// word and one palette, and the same call with a different word, a different
// size and a different level's colours is a different piece. That is the whole
// point of porting them procedurally rather than tracing them.
//
// Everything here draws in the BACKGROUND pass, behind every solid. That is the
// structural half of "visibly non-collidable": terrain paints over a prop, so a
// prop can never cover a collision edge, and a lamp that overlaps a ledge on
// screen plainly reads as being behind it. `props.ts` holds the other half.
import type { Palette } from './palette.ts';
import { alpha } from './palette.ts';
import type { Prop } from './props.ts';
import { rng } from './rng.ts';
import type { Rng } from './rng.ts';
import { scrawl, textOutline } from './letters.ts';

/** One draw call. Widths are world metres unless `px` is set. */
export interface PropOp {
  path: Path2D;
  fill?: string;
  stroke?: string;
  w?: number;
  px?: boolean;
  alpha?: number;
  cap?: CanvasLineCap;
}

export interface BakedProp {
  prop: Prop;
  ops: PropOp[];
  /** A fan's blades. The one animated prop; four quads, drawn live. */
  spin?: { x: number; y: number; r: number; rate: number; fill: string; ink: string };
}

export function bakeProp(p: Prop, P: Palette): BakedProp {
  const r = rng(p.seed);
  const ops: PropOp[] = [];
  const out: BakedProp = { prop: p, ops };
  switch (p.kind) {
    case 'piece': piece(ops, p, r, P); break;
    case 'numeral': numeral(ops, p, P); break;
    case 'tag': tag(ops, p, r); break;
    case 'floorMark': floorMark(ops, p, r); break;
    case 'stencilText': stencilText(ops, p); break;
    case 'poster': posters(ops, p, r, P); break;
    case 'banner': banner(ops, p, P); break;
    case 'sign': sign(ops, p, P); break;
    case 'vent': out.spin = vent(ops, p, P); break;
    case 'ladder': ladder(ops, p, P); break;
    case 'box': hoseBox(ops, p, P); break;
    case 'lamp': lamp(ops, p, P); break;
    case 'conduit': conduit(ops, p, r, P); break;
    case 'cable': cable(ops, p, P); break;
  }
  return out;
}

/**
 * Draw the props whose bounding box is on screen.
 *
 * The cull is a bounding-box test per prop and the budget caps the count, so a
 * frame pays for what is in it. `limit` is the adaptive detail system's lever:
 * props are the first decoration to go when frames run long, because they are
 * the newest thing in the frame and the least load-bearing.
 */
export function drawProps(
  ctx: CanvasRenderingContext2D,
  list: BakedProp[],
  b: { minX: number; minY: number; maxX: number; maxY: number },
  a: number,
  px: number,
  t: number,
  limit: number,
): number {
  let drawn = 0;
  ctx.save();
  ctx.lineJoin = 'round';
  for (const bp of list) {
    if (drawn >= limit) break;
    const p = bp.prop;
    if (p.maxX < b.minX || p.minX > b.maxX || p.maxY < b.minY || p.minY > b.maxY) continue;
    drawn++;
    ctx.globalAlpha = p.alpha * a;
    for (const op of bp.ops) {
      if (op.alpha !== undefined) ctx.globalAlpha = p.alpha * a * op.alpha;
      ctx.lineCap = op.cap ?? 'round';
      if (op.fill) {
        ctx.fillStyle = op.fill;
        ctx.fill(op.path);
      }
      if (op.stroke) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.px ? (op.w ?? 2) * px : (op.w ?? 0.1);
        ctx.stroke(op.path);
      }
      if (op.alpha !== undefined) ctx.globalAlpha = p.alpha * a;
    }
    if (bp.spin) {
      const s = bp.spin;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(t * s.rate);
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(s.r * 0.9, -s.r * 0.5, s.r * 0.95, s.r * 0.1);
        ctx.quadraticCurveTo(s.r * 0.5, s.r * 0.4, 0, 0);
        ctx.fillStyle = s.fill;
        ctx.fill();
        ctx.lineWidth = 3 * px;
        ctx.strokeStyle = s.ink;
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  ctx.restore();
  return drawn;
}

// --- helpers ----------------------------------------------------------------

function poly(pts: [number, number][], close = false): Path2D {
  const p = new Path2D();
  if (!pts.length) return p;
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  if (close) p.closePath();
  return p;
}

function rect(x: number, y: number, w: number, h: number): Path2D {
  const p = new Path2D();
  p.rect(x, y, w, h);
  return p;
}

/** Rotate a point about a centre. Props are rotated at bake time, not at draw. */
function rot(x: number, y: number, cx: number, cy: number, a: number): [number, number] {
  if (a === 0) return [x, y];
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/** Text as world polylines, rotated into place. */
function textStrokes(
  text: string, cx: number, cy: number, size: number, a: number,
  vertical = false,
): [number, number][][] {
  const L = textOutline(text, cx, cy - size / 2, { size, align: 'center', vertical });
  if (a === 0) return L.strokes;
  return L.strokes.map((s) => s.map(([x, y]) => rot(x, y, cx, cy, a)));
}

function strokesPath(strokes: [number, number][][]): Path2D {
  const p = new Path2D();
  for (const s of strokes) {
    if (!s.length) continue;
    p.moveTo(s[0][0], s[0][1]);
    for (let i = 1; i < s.length; i++) p.lineTo(s[i][0], s[i][1]);
  }
  return p;
}

function offsetStrokes(strokes: [number, number][][], dx: number, dy: number): Path2D {
  return strokesPath(strokes.map((s) => s.map(([x, y]) => [x + dx, y + dy] as [number, number])));
}

// --- murals -----------------------------------------------------------------

/**
 * A graffiti piece: chunky letters with an extrusion, an ink outline, a two-tone
 * body, a highlight and drips.
 *
 * The mockup's version leaned on the Bungee web font; this one is the stroke
 * alphabet drawn fat with round caps and joins, which gets to the same place —
 * the extrusion and the outline are what make a piece read as a piece, not the
 * typeface.
 */
function piece(ops: PropOp[], p: Prop, r: Rng, P: Palette): void {
  const size = p.h * 0.7;
  const S = textStrokes(p.text ?? 'VELO', p.x, p.y, size, p.rot);
  const path = strokesPath(S);
  const [fill, fill2, ext] = p.colors;
  const depth = size * 0.14;
  // STROKE WIDTH IS A FRACTION OF CAP HEIGHT, and the fraction matters more
  // than it looks. The first version stroked the body at 0.4 of the height,
  // which on a 2 m word is a 0.8 m pen: the counters close up and every glyph
  // renders as a blob. Real piece lettering sits nearer a fifth.
  for (let i = 5; i >= 1; i--) {
    const u = i / 5;
    ops.push({
      path: offsetStrokes(S, depth * u, -depth * u),
      stroke: i > 2 ? ext : P.ink2,
      w: size * 0.22,
      alpha: 1,
    });
  }
  ops.push({ path, stroke: P.ink, w: size * 0.32 });
  ops.push({ path, stroke: fill, w: size * 0.21 });
  ops.push({ path: offsetStrokes(S, 0, -size * 0.06), stroke: fill2, w: size * 0.08, alpha: 0.7 });
  ops.push({ path: offsetStrokes(S, -size * 0.03, size * 0.035), stroke: p.colors[3], w: size * 0.03, alpha: 0.8 });

  // Drips off the baseline, seeded, alternating the two body tones.
  const drips = new Path2D();
  const n = 3 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const dx = p.x + (r() - 0.5) * p.w * 0.8;
    const dy = p.y - size * 0.4;
    const len = size * (0.1 + r() * 0.3);
    const w = size * (0.035 + r() * 0.035);
    drips.rect(dx - w / 2, dy - len, w, len);
  }
  ops.push({ path: drips, fill });
}

/** The level's own number, painted big and quiet on the back wall. */
function numeral(ops: PropOp[], p: Prop, P: Palette): void {
  const size = p.h;
  const S = textStrokes(p.text ?? '', p.x, p.y, size, p.rot);
  ops.push({ path: offsetStrokes(S, size * 0.05, -size * 0.05), stroke: P.ink, w: size * 0.15, alpha: 0.45 });
  ops.push({ path: strokesPath(S), stroke: p.colors[0], w: size * 0.11 });
}

/** A handstyle tag: a seeded scrawl, one colour, with an ink shadow under it. */
function tag(ops: PropOp[], p: Prop, r: Rng): void {
  const pts = scrawl(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, 3 + Math.floor(r() * 4), r)
    .map(([x, y]) => rot(x, y, p.x, p.y, p.rot));
  ops.push({ path: poly(pts), stroke: p.colors[0], w: p.h * 0.14 });
}

// --- paint, inside the solid ------------------------------------------------

/**
 * A road marking: an arrow along the surface, or a short word.
 *
 * Drawn INSIDE the solid and therefore clipped away wherever the material is
 * not — which is why it is allowed in a corridor too tight for anything else.
 */
function floorMark(ops: PropOp[], p: Prop, r: Rng): void {
  if (p.text) {
    ops.push({ path: strokesPath(textStrokes(p.text, p.x, p.y, p.h, p.rot)), stroke: p.colors[0], w: p.h * 0.16 });
    return;
  }
  // HAZARD BARS, NOT AN ARROW — and that is a readability decision rather than
  // an aesthetic one. The first version painted a big directional arrow whose
  // direction was a coin flip, and this is a game where CHOOSING THE ROUTE is
  // the whole depth: apples come in any order and the interesting levels have
  // genuinely different orders with different times. A two-metre arrow that
  // points somewhere for no reason is the art telling the player something the
  // level does not mean. Bars say "worked surface" and say nothing else.
  const bars = new Path2D();
  const L = p.w / 2;
  const H = p.h / 2;
  const n = 3 + Math.floor(r() * 4);
  const bw = p.w / (n * 2.1);
  for (let i = 0; i < n; i++) {
    const x = -L + (i + 0.25) * (p.w / n);
    const pts: [number, number][] = [
      [x, -H], [x + bw, -H], [x + bw + H * 0.7, H], [x + H * 0.7, H],
    ].map(([qx, qy]) => rot(p.x + qx, p.y + qy, p.x, p.y, p.rot));
    bars.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < 4; k++) bars.lineTo(pts[k][0], pts[k][1]);
    bars.closePath();
  }
  ops.push({ path: bars, fill: p.colors[0] });
}

/** Stencilled signage painted into the material. Ink, low alpha, no outline. */
function stencilText(ops: PropOp[], p: Prop): void {
  ops.push({
    path: strokesPath(textStrokes(p.text ?? '', p.x, p.y, p.h, p.rot)),
    stroke: p.colors[0],
    w: p.h * 0.16,
  });
}

// --- fixtures ---------------------------------------------------------------

/** A cluster of stapled posters: header bar, diagonal stripes, a word. */
function posters(ops: PropOp[], p: Prop, r: Rng, P: Palette): void {
  const n = Math.max(1, parseInt(p.text ?? '1', 10) || 1);
  const pw = (p.w - (n - 1) * 0.1) / n;
  const ph = p.h;
  for (let i = 0; i < n; i++) {
    const x = p.minX + i * (pw + 0.1);
    const y = p.y - ph / 2 + (r() - 0.5) * 0.12;
    ops.push({ path: rect(x, y, pw, ph), fill: p.colors[i % 2], stroke: P.ink, w: 3, px: true, cap: 'butt' });
    ops.push({ path: rect(x, y + ph * 0.78, pw, ph * 0.22), fill: P.ink });
    // Diagonal stripes over the body, the mockup's poster texture.
    const st = new Path2D();
    for (let k = -1; k < 6; k++) {
      const sx = x + k * pw * 0.28;
      st.moveTo(sx, y);
      st.lineTo(sx + pw * 0.1, y);
      st.lineTo(sx + pw * 0.1 + ph * 0.7, y + ph * 0.74);
      st.lineTo(sx + ph * 0.7, y + ph * 0.74);
      st.closePath();
    }
    ops.push({ path: st, fill: alpha(P.ink, 0.22) });
    ops.push({
      path: strokesPath(textStrokes('VELO', x + pw / 2, y + ph * 0.89, ph * 0.13, 0)),
      stroke: p.colors[2], w: ph * 0.028,
    });
  }
}

/** A vertical banner hung from a ceiling, with a word running down it. */
function banner(ops: PropOp[], p: Prop, P: Palette): void {
  const w = p.w;
  const h = p.h;
  const x = p.x - w / 2;
  const y = p.y - h / 2;
  ops.push({ path: rect(x, y, w, h), fill: p.colors[0], stroke: P.ink, w: 4, px: true, cap: 'butt' });
  const text = (p.text ?? 'VELO').replace(/[^A-Z0-9]/gi, '').slice(0, Math.max(1, Math.floor(h / (w * 1.4))));
  ops.push({
    path: strokesPath(textStrokes(text, p.x, y + h * 0.94 - (text.length * w * 1.05) / 2, w * 0.52, 0, true)),
    stroke: p.colors[1], w: w * 0.1,
  });
  ops.push({ path: rect(x + w * 0.12, y + h * 0.03, w * 0.76, h * 0.03), fill: p.colors[1] });
}

/** An arrow sign on a stub arm, pointing away from whatever it is bolted to. */
function sign(ops: PropOp[], p: Prop, P: Palette): void {
  const s = Math.min(p.w, p.h);
  // The arm goes back to the mount.
  ops.push({
    path: poly([[p.x - p.nx * s * 0.6, p.y - p.ny * s * 0.6], [p.x, p.y]]),
    stroke: P.ink, w: 6, px: true,
  });
  ops.push({
    path: poly([[p.x - p.nx * s * 0.6, p.y - p.ny * s * 0.6], [p.x, p.y]]),
    stroke: p.colors[2], w: 3, px: true,
  });
  ops.push({ path: rect(p.x - s / 2, p.y - s / 2, s, s), fill: p.colors[0], stroke: P.ink, w: 4, px: true, cap: 'butt' });
  // A down arrow: the route, which on a ledge is the thing worth pointing at.
  const a: [number, number][] = [
    [-0.13, 0.32], [0.13, 0.32], [0.13, -0.1], [0.34, -0.1], [0, -0.44], [-0.34, -0.1], [-0.13, -0.1],
  ].map(([x, y]) => [p.x + x * s, p.y + y * s]);
  ops.push({ path: poly(a, true), fill: P.ink });
}

/** A wall fan: a plate, a housing ring, and blades that turn. */
function vent(ops: PropOp[], p: Prop, P: Palette): BakedProp['spin'] {
  const s = Math.min(p.w, p.h);
  ops.push({ path: rect(p.x - s / 2, p.y - s / 2, s, s), fill: p.colors[0], stroke: P.ink, w: 4, px: true, cap: 'butt' });
  const ring = new Path2D();
  ring.arc(p.x, p.y, s * 0.4, 0, Math.PI * 2);
  ops.push({ path: ring, fill: P.ink2, stroke: P.ink, w: 4, px: true });
  return { x: p.x, y: p.y, r: s * 0.36, rate: 4, fill: p.colors[1], ink: P.ink };
}

/** Rails and rungs, running along the face it is bolted to. */
function ladder(ops: PropOp[], p: Prop, P: Palette): void {
  // Along the surface, offset either side of the mount by half the rail gap.
  const ax = p.dx;
  const ay = p.dy;
  const bx = p.nx;
  const by = p.ny;
  const len = Math.abs(ax) * p.w + Math.abs(ay) * p.h;
  const gap = 0.26;
  const rails = new Path2D();
  for (const o of [-gap / 2, gap / 2]) {
    rails.moveTo(p.x + ax * (-len / 2) + bx * o, p.y + ay * (-len / 2) + by * o);
    rails.lineTo(p.x + ax * (len / 2) + bx * o, p.y + ay * (len / 2) + by * o);
  }
  const n = Math.max(2, Math.floor(len / 0.42));
  for (let i = 0; i <= n; i++) {
    const u = -len / 2 + (i / n) * len;
    rails.moveTo(p.x + ax * u - bx * gap / 2, p.y + ay * u - by * gap / 2);
    rails.lineTo(p.x + ax * u + bx * gap / 2, p.y + ay * u + by * gap / 2);
  }
  ops.push({ path: rails, stroke: P.ink, w: 7, px: true });
  ops.push({ path: rails, stroke: p.colors[0], w: 3.5, px: true });
}

/** A hose box: a small bright cabinet with a letter on it. */
function hoseBox(ops: PropOp[], p: Prop, P: Palette): void {
  const w = p.w;
  const h = p.h;
  const x = p.x - w / 2;
  const y = p.y - h / 2;
  ops.push({ path: rect(x, y, w, h), fill: p.colors[0], stroke: P.ink, w: 4, px: true, cap: 'butt' });
  ops.push({ path: rect(x, y, w, h * 0.3), fill: alpha(P.ink, 0.35) });
  ops.push({
    path: strokesPath(textStrokes(p.text ?? 'H', p.x, p.y + h * 0.16, h * 0.44, 0)),
    stroke: p.colors[1], w: h * 0.09,
  });
}

/** A wall lamp: stem, shade, bulb, and a hard-edged cone of light. */
function lamp(ops: PropOp[], p: Prop, P: Palette): void {
  const h = p.h;
  // The stem runs back to the mount along the surface normal.
  const sx = p.x - p.nx * h * 0.45;
  const sy = p.y - p.ny * h * 0.45;
  ops.push({ path: poly([[sx, sy], [p.x, p.y]]), stroke: P.ink, w: 6, px: true });
  ops.push({ path: poly([[sx, sy], [p.x, p.y]]), stroke: P.steel, w: 2.5, px: true });
  // Shade: a trapezium pointing down, because a lamp lights the floor.
  const sh: [number, number][] = [
    [p.x - h * 0.3, p.y + h * 0.16], [p.x + h * 0.3, p.y + h * 0.16],
    [p.x + h * 0.18, p.y - h * 0.1], [p.x - h * 0.18, p.y - h * 0.1],
  ];
  ops.push({ path: poly(sh, true), fill: p.colors[0], stroke: P.ink, w: 4, px: true, cap: 'butt' });
  const bulb = new Path2D();
  bulb.arc(p.x, p.y - h * 0.1, h * 0.1, 0, Math.PI * 2);
  ops.push({ path: bulb, fill: p.colors[1], stroke: P.ink, w: 3, px: true });
  // The cone. HARD-EDGED, like every other light in this look — a soft one
  // would be the only blurred thing in frame — and low enough alpha that it
  // never competes with the lip on the surface it lands on.
  //
  // Sized from the DOWNWARD clearance, measured at plan time. `p.clear` is the
  // gap along the mount normal, which on a wall lamp is a horizontal distance:
  // using it here made the cone reach seven metres down through a floor two
  // metres below.
  const reach = Math.max(1, Math.min(p.drop, 8));
  for (const [spread, a] of [[2.4, 0.12], [1.2, 0.09]] as const) {
    ops.push({
      path: poly([
        [p.x - h * 0.16, p.y - h * 0.1], [p.x + h * 0.16, p.y - h * 0.1],
        [p.x + spread, p.y - reach], [p.x - spread, p.y - reach],
      ], true),
      fill: p.colors[1],
      alpha: a,
    });
  }
}

/** A conduit run with junction boxes, along the face it is clipped to. */
function conduit(ops: PropOp[], p: Prop, r: Rng, P: Palette): void {
  const ax = p.dx;
  const ay = p.dy;
  const len = Math.abs(ax) * p.w + Math.abs(ay) * p.h;
  const x0 = p.x - ax * len / 2;
  const y0 = p.y - ay * len / 2;
  const x1 = p.x + ax * len / 2;
  const y1 = p.y + ay * len / 2;
  const line = poly([[x0, y0], [x1, y1]]);
  ops.push({ path: line, stroke: P.ink, w: 7, px: true, cap: 'butt' });
  ops.push({ path: line, stroke: p.colors[0], w: 4, px: true, cap: 'butt' });
  ops.push({
    path: poly([[x0 - p.nx * 0.04, y0 - p.ny * 0.04], [x1 - p.nx * 0.04, y1 - p.ny * 0.04]]),
    stroke: p.colors[1], w: 1.5, px: true, cap: 'butt',
  });
  const boxes = new Path2D();
  const marks = new Path2D();
  const n = Math.max(1, Math.floor(len / 3.4));
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5 + (r() - 0.5) * 0.3) / n;
    const cx = x0 + (x1 - x0) * u;
    const cy = y0 + (y1 - y0) * u;
    boxes.rect(cx - 0.22, cy - 0.22, 0.44, 0.44);
    marks.rect(cx - 0.1, cy - 0.1, 0.2, 0.2);
  }
  ops.push({ path: boxes, fill: P.steelD, stroke: P.ink, w: 3, px: true, cap: 'butt' });
  ops.push({ path: marks, fill: p.colors[2] });
}

/** A slung cable with a sag and a couple of tags clipped to it. */
function cable(ops: PropOp[], p: Prop, P: Palette): void {
  const ax = p.dx;
  const ay = p.dy;
  const len = Math.abs(ax) * p.w + Math.abs(ay) * p.h;
  // The ends hang from the TOP of the box and the sag is bounded by its height,
  // so the drawn cable stays inside the box the clearance test measured. The
  // first version derived the sag from the box height and then multiplied it,
  // which let the lowest point of a cable hang about half a metre below the
  // volume anything had checked.
  const top = p.y + p.h / 2;
  const x0 = p.x - ax * len / 2;
  const x1 = p.x + ax * len / 2;
  const mk = (drop: number): Path2D => {
    const q = new Path2D();
    q.moveTo(x0, top);
    // A quadratic's midpoint sits halfway to its control point, so the control
    // goes twice as far down as the sag we want.
    q.quadraticCurveTo((x0 + x1) / 2, top - drop * 2, x1, top);
    return q;
  };
  const sag = p.h * 0.42;
  ops.push({ path: mk(sag), stroke: P.ink, w: 5, px: true });
  ops.push({ path: mk(sag), stroke: p.colors[0], w: 3, px: true });
  ops.push({ path: mk(sag * 1.45), stroke: P.ink, w: 3.5, px: true, alpha: 0.8 });
  ops.push({ path: mk(sag * 1.45), stroke: p.colors[1], w: 1.8, px: true, alpha: 0.8 });
}
