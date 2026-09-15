// The stencil library. Hand-drawn shapes; placement is procedural.
//
// Drawn in a LOCAL Y-UP frame, because everything downstream of the world
// transform is y-up and a stencil defined y-down would render mirrored. Each
// takes a size `s` in world metres and draws centred on the origin.
//
// Deliberately no text stencils. The mockup used web fonts for a few of them
// and the game has no web fonts — pulling Google Fonts in would make the art a
// network dependency, and a stamp that silently falls back to Arial is worse
// than one more chevron.
export type StencilKey = keyof typeof STENCILS;

type Draw = (ctx: CanvasRenderingContext2D, s: number, lw: number) => void;

export const STENCILS = {
  arrow(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, -s * 0.18); ctx.lineTo(s * 0.1, -s * 0.18); ctx.lineTo(s * 0.1, -s * 0.45);
    ctx.lineTo(s * 0.55, 0); ctx.lineTo(s * 0.1, s * 0.45); ctx.lineTo(s * 0.1, s * 0.18);
    ctx.lineTo(-s * 0.5, s * 0.18); ctx.closePath(); ctx.fill();
  },
  star(ctx, s) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? s * 0.22 : s * 0.52;
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
  },
  xmark(ctx, s, lw) {
    ctx.lineWidth = Math.max(s * 0.2, lw); ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(-s * 0.4, -s * 0.4); ctx.lineTo(s * 0.4, s * 0.4);
    ctx.moveTo(s * 0.4, -s * 0.4); ctx.lineTo(-s * 0.4, s * 0.4);
    ctx.stroke();
  },
  ring(ctx, s, lw) {
    ctx.lineWidth = Math.max(s * 0.16, lw);
    ctx.beginPath(); ctx.arc(0, 0, s * 0.4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 0.3); ctx.lineTo(s * 0.3, s * 0.3); ctx.stroke();
  },
  bolt(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(s * 0.1, s * 0.55); ctx.lineTo(-s * 0.3, -s * 0.05); ctx.lineTo(0, -s * 0.05);
    ctx.lineTo(-s * 0.12, -s * 0.55); ctx.lineTo(s * 0.32, s * 0.1); ctx.lineTo(s * 0.04, s * 0.1);
    ctx.closePath(); ctx.fill();
  },
  eye(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, 0); ctx.quadraticCurveTo(0, s * 0.55, s * 0.55, 0);
    ctx.quadraticCurveTo(0, -s * 0.55, -s * 0.55, 0);
    ctx.closePath(); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(0, 0, s * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
  tri(ctx, s, lw) {
    ctx.lineWidth = Math.max(s * 0.12, lw); ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, s * 0.5); ctx.lineTo(s * 0.46, -s * 0.34); ctx.lineTo(-s * 0.46, -s * 0.34);
    ctx.closePath(); ctx.stroke();
  },
  drop(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.55);
    ctx.quadraticCurveTo(s * 0.42, -s * 0.05, 0, -s * 0.5);
    ctx.quadraticCurveTo(-s * 0.42, -s * 0.05, 0, s * 0.55);
    ctx.closePath(); ctx.fill();
  },
} satisfies Record<string, Draw>;

export const STENCIL_KEYS = Object.keys(STENCILS) as StencilKey[];

/** A placement. Baked once; drawn only when it is on screen. */
export interface Stamp {
  key: StencilKey;
  x: number;
  y: number;
  /** Metres. */
  size: number;
  rot: number;
  color: string;
  alpha: number;
}

export function drawStamp(ctx: CanvasRenderingContext2D, st: Stamp, a: number, px: number): void {
  ctx.save();
  ctx.translate(st.x, st.y);
  ctx.rotate(st.rot);
  ctx.globalAlpha = st.alpha * a;
  ctx.fillStyle = st.color;
  ctx.strokeStyle = st.color;
  STENCILS[st.key](ctx, st.size, px);
  ctx.restore();
}
