// The legend's poses, asserted without a canvas.
//
// The claim this file defends is the one that makes the legend worth building:
// a legend tile is the GAME, small, and not a picture somebody drew of it. That
// claim lives entirely in `legendPose` — if the arm target stops being the
// spec's own `leanL`, or the chassis rotation stops being a real orientation,
// the tiles become decoration with no guarantee behind them and nothing on
// screen would say so.
import { describe, it, expect } from 'vitest';
import { cloneSpec } from '@/sim/spec.ts';
import { BOOT_PRESET } from './presets.ts';
import { POSES, legendPose, poseBounds } from './legendart.ts';
import type { PoseId } from './keys.ts';
import { DRIVE } from './keys.ts';

const SPEC = cloneSpec(BOOT_PRESET.spec);
const IDS = Object.keys(POSES) as PoseId[];

describe('the legend poses', () => {
  it('covers every pose the legend asks for', () => {
    for (const c of DRIVE) if (c.pose) expect(POSES[c.pose]).toBeDefined();
  });

  it.each(IDS)('%s is a finite pose with a unit orientation and a unit arm', (id) => {
    const p = legendPose(SPEC, POSES[id]);
    for (const v of [p.px, p.py, p.ox, p.oy, p.ax, p.ay, ...p.wx, ...p.wy, ...p.wspin]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(Math.hypot(p.ox, p.oy)).toBeCloseTo(1, 12);
    expect(Math.hypot(p.ax, p.ay)).toBeCloseTo(1, 12);
  });

  it('hangs the wheels on the SPEC\'s own suspension anchors, rotated', () => {
    // The distance between the two wheels is a property of the bike and must
    // not depend on which control is being illustrated. A tile that quietly
    // stretched the wheelbase would be teaching a bike that does not exist.
    const a = SPEC.wheel.anchors;
    const want = Math.hypot(a[1].x - a[0].x, a[1].y - a[0].y);
    for (const id of IDS) {
      const p = legendPose(SPEC, POSES[id]);
      expect(Math.hypot(p.wx[1] - p.wx[0], p.wy[1] - p.wy[0])).toBeCloseTo(want, 9);
    }
  });

  it('takes the arm direction from the spec and nowhere else', () => {
    // Every pose's arm is one of the three PRE-BAKED targets in `spec.rider`,
    // rotated by the chassis. Asserted by rotating it back: the result has to
    // be one of the three, to twelve places.
    for (const id of IDS) {
      const preset = POSES[id];
      const p = legendPose(SPEC, preset);
      const c = Math.cos(-preset.theta);
      const s = Math.sin(-preset.theta);
      const lx = (p.ax * c - p.ay * s) * preset.facing;
      const ly = p.ax * s + p.ay * c;
      const t = SPEC.rider[preset.arm];
      const m = Math.hypot(t.x, t.y);
      expect(lx).toBeCloseTo(t.x / m, 12);
      expect(ly).toBeCloseTo(t.y / m, 12);
    }
  });

  it('draws four visibly different things for the four drive controls', () => {
    // The whole point of a picture is that it is not the same picture. Compared
    // on the two numbers the eye actually reads at 46 px tall: how far the
    // chassis is turned, and where the rider's weight is.
    const seen = new Set<string>();
    for (const c of DRIVE) {
      if (!c.pose) continue;
      const p = legendPose(SPEC, POSES[c.pose]);
      seen.add(`${Math.round(Math.atan2(p.oy, p.ox) * 40)}|${Math.round(p.ax * 10)}`);
    }
    expect(seen.size).toBe(DRIVE.filter((c) => c.pose).length);
  });

  it('mirrors, and mirrors exactly — the flip tile is one bike twice', () => {
    const r = legendPose(SPEC, { ...POSES.still, facing: 1 });
    const l = legendPose(SPEC, { ...POSES.still, facing: -1 });
    expect(l.ax).toBeCloseTo(-r.ax, 12);
    expect(l.ay).toBeCloseTo(r.ay, 12);
    for (let i = 0; i < 2; i++) {
      expect(l.wx[i]).toBeCloseTo(-r.wx[i], 12);
      expect(l.wy[i]).toBeCloseTo(r.wy[i], 12);
    }
  });

  it('bounds every pose, and always around something with area', () => {
    const headR = SPEC.rider.headRadius;
    for (const id of IDS) {
      const b = poseBounds(SPEC, legendPose(SPEC, POSES[id]), headR);
      expect(b.maxX - b.minX).toBeGreaterThan(SPEC.wheel.radius);
      expect(b.maxY - b.minY).toBeGreaterThan(SPEC.wheel.radius);
      for (const v of [b.minX, b.minY, b.maxX, b.maxY]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('never crops the head, which is the part that kills you', () => {
    // `poseBounds` is what the tile is framed on, so a head outside it would be
    // a head drawn outside the canvas — and head clearance is the one thing
    // these levels are about.
    const headR = SPEC.rider.headRadius;
    for (const id of IDS) {
      const p = legendPose(SPEC, POSES[id]);
      const b = poseBounds(SPEC, p, headR);
      const hx = p.px + SPEC.rider.armLength * p.ax;
      const hy = p.py + SPEC.rider.armLength * p.ay;
      expect(hx - headR).toBeGreaterThanOrEqual(b.minX - 1e-9);
      expect(hx + headR).toBeLessThanOrEqual(b.maxX + 1e-9);
      expect(hy - headR).toBeGreaterThanOrEqual(b.minY - 1e-9);
      expect(hy + headR).toBeLessThanOrEqual(b.maxY + 1e-9);
    }
  });
});
