// The camera's two load-bearing claims, which are the ones a person cannot
// check by looking at it: that it is frame-rate independent, and that the
// bike can never leave the frame however hard the smoothing lags.
//
// Everything else about a camera is feel and belongs on the panel. These two
// are correctness, and both are silently broken by the obvious implementation
// (a fixed per-frame lerp with no clamp).
import { describe, it, expect } from 'vitest';
import { DEFAULT_CAMERA, cloneCamera, createCamera } from './camera.ts';

const VIEW = { w: 1200, h: 800 };

function run(steps: number, dt: number, target: { x: number; y: number; vx: number; vy: number }) {
  const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
  cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
  for (let i = 0; i < steps; i++) cam.update(target, dt, VIEW.w, VIEW.h);
  return cam;
}

describe('camera', () => {
  it('lands in the same place at 60 Hz and at 144 Hz', () => {
    // A fixed per-frame lerp does NOT: it moves 2.4x faster on the faster
    // display, so the game feels different depending on the monitor. The
    // half-life formulation is the fix and this is what checks it.
    const t = { x: 10, y: 4, vx: 0, vy: 0 };
    const a = run(60, 1 / 60, t);
    const b = run(144, 1 / 144, t);
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.02);
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.02);
    expect(Math.abs(a.zoom - b.zoom)).toBeLessThan(0.5);
  });

  it('never lets the bike outside the safe box, however fast it reverses', () => {
    // The adversarial case: teleport the target every frame, which is worse
    // than anything a bike can do, and check the guarantee holds on every one.
    const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    const box = cam.params.safeBox;
    for (let i = 0; i < 400; i++) {
      const t = { x: Math.sin(i) * 40, y: Math.cos(i * 0.7) * 25, vx: Math.cos(i) * 30, vy: -Math.sin(i) * 20 };
      cam.update(t, 1 / 60, VIEW.w, VIEW.h);
      const halfW = VIEW.w / 2 / cam.zoom;
      const halfH = VIEW.h / 2 / cam.zoom;
      expect(Math.abs(t.x - cam.x)).toBeLessThanOrEqual(halfW * box + 1e-9);
      expect(Math.abs(t.y - cam.y)).toBeLessThanOrEqual(halfH * box + 1e-9);
    }
  });

  it('never zooms out past the readability floor', () => {
    // The rule that outranks framing. At any speed, including absurd ones.
    const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    for (let i = 0; i < 600; i++) {
      cam.update({ x: i, y: 0, vx: 60, vy: 40 }, 1 / 60, VIEW.w, VIEW.h);
      expect(cam.zoom).toBeGreaterThanOrEqual(cam.params.minZoom - 1e-9);
      expect(cam.zoom).toBeLessThanOrEqual(cam.params.maxZoom + 1e-9);
    }
  });

  it('leads in the direction of travel, and eases across a reversal', () => {
    const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    for (let i = 0; i < 120; i++) cam.update({ x: 0, y: 0, vx: 12, vy: 0 }, 1 / 60, VIEW.w, VIEW.h);
    expect(cam.x).toBeGreaterThan(1);

    // Reverse. One frame later the camera must have moved only a little — a
    // lead that reads `facing` instead of velocity jumps the full lead width
    // here, which is exactly what a flip must not do.
    const before = cam.x;
    cam.update({ x: 0, y: 0, vx: -12, vy: 0 }, 1 / 60, VIEW.w, VIEW.h);
    expect(Math.abs(cam.x - before)).toBeLessThan(0.3);

    for (let i = 0; i < 120; i++) cam.update({ x: 0, y: 0, vx: -12, vy: 0 }, 1 / 60, VIEW.w, VIEW.h);
    expect(cam.x).toBeLessThan(-1);
  });

  it('blends to the overview framing, and only the overview may break the zoom floor', () => {
    // The floor is the rule that outranks framing WHILE DRIVING. Overview is
    // the one thing allowed past it, and only because the sim is frozen.
    const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    const t = { x: 0, y: 0, vx: 0, vy: 0 };
    const frame = { x: 88, y: -40, zoom: 9 };

    cam.update(t, 1 / 60, VIEW.w, VIEW.h, { ...frame, blend: 1 });
    expect(cam.x).toBeCloseTo(frame.x, 6);
    expect(cam.y).toBeCloseTo(frame.y, 6);
    expect(cam.zoom).toBeCloseTo(frame.zoom, 6);
    expect(cam.zoom).toBeLessThan(cam.params.minZoom);

    // Half-way is half-way in POSITION and the geometric mean in ZOOM: a
    // linear zoom blend spends most of its travel in the high numbers and then
    // lurches, which is the thing "smooth both ways" is asking to avoid. The
    // play framing to compare against comes from an identically driven camera
    // that was never handed an overview.
    const a = createCamera(cloneCamera(DEFAULT_CAMERA));
    const b = createCamera(cloneCamera(DEFAULT_CAMERA));
    a.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    b.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    for (let i = 0; i < 30; i++) {
      a.update(t, 1 / 60, VIEW.w, VIEW.h, { ...frame, blend: 0.5 });
      b.update(t, 1 / 60, VIEW.w, VIEW.h);
    }
    expect(a.zoom).toBeCloseTo(Math.sqrt(b.zoom * frame.zoom), 6);
    expect(a.x).toBeCloseTo(b.x + (frame.x - b.x) * 0.5, 6);
    expect(a.y).toBeCloseTo(b.y + (frame.y - b.y) * 0.5, 6);
  });

  it('does not let the overview disturb the play framing underneath it', () => {
    // The follow keeps smoothing while the wide view is up, so releasing the
    // key returns to where following had got to — not to a stale position and
    // not with a lurch. Equivalently: a frame spent in overview must leave the
    // published view identical to one that never entered it.
    const held = createCamera(cloneCamera(DEFAULT_CAMERA));
    const plain = createCamera(cloneCamera(DEFAULT_CAMERA));
    held.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    plain.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    const t = { x: 25, y: 9, vx: 4, vy: 1 };
    const frame = { x: -300, y: 400, zoom: 6 };
    for (let i = 0; i < 90; i++) {
      held.update(t, 1 / 60, VIEW.w, VIEW.h, { ...frame, blend: 1 });
      plain.update(t, 1 / 60, VIEW.w, VIEW.h);
    }
    // Now let go: blend 0 on the very next frame.
    held.update(t, 1 / 60, VIEW.w, VIEW.h, { ...frame, blend: 0 });
    plain.update(t, 1 / 60, VIEW.w, VIEW.h);
    expect(held.x).toBeCloseTo(plain.x, 9);
    expect(held.y).toBeCloseTo(plain.y, 9);
    expect(held.zoom).toBeCloseTo(plain.zoom, 9);
  });

  it('snaps without leaving a stale lead behind', () => {
    const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    for (let i = 0; i < 120; i++) cam.update({ x: 0, y: 0, vx: 12, vy: 0 }, 1 / 60, VIEW.w, VIEW.h);
    cam.snap({ x: 99, y: -5, vx: 0, vy: 0 });
    expect(cam.x).toBe(99);
    expect(cam.y).toBe(-5);
    // And the next frame does not lurch back toward the old lead.
    cam.update({ x: 99, y: -5, vx: 0, vy: 0 }, 1 / 60, VIEW.w, VIEW.h);
    expect(Math.abs(cam.x - 99)).toBeLessThan(0.01);
  });
});
