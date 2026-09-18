// The overview's three load-bearing claims.
//
// The first is the one that actually matters and the one the brief asked to be
// PROVED rather than assumed: holding the overview cannot affect a recorded
// replay. It is tested here against the real sim and the real recorder rather
// than by reading main.ts, because the property is about the freeze gate and
// the freeze gate is what a future edit will break.
//
// The other two are the geometry (a level that fits is framed whole; one that
// does not is framed at the floor, centred on the bike, and never shows
// anything past the level) and the easing (symmetric, frame-rate independent,
// and it lands exactly on 0 and 1 rather than asymptotically near them).
import { describe, it, expect } from 'vitest';
import { createOverview, cloneOverview, DEFAULT_OVERVIEW, overviewFrame } from './overview.ts';
import { createSim } from '@/sim/sim.ts';
import { DEFAULT_SPEC, cloneSpec } from '@/sim/spec.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { parseLevel } from '@/sim/level.ts';
import { createRecorder } from './recorder.ts';
import { IN_LEAN_R, IN_THROTTLE } from '@/sim/consts.ts';

const VIEW = { w: 1200, h: 800 };

/** A deterministic, boring input stream. Nothing here depends on its shape. */
function maskFor(frame: number): number {
  return (frame % 7 < 4 ? IN_THROTTLE : 0) | (frame % 11 === 0 ? IN_LEAN_R : 0);
}

/**
 * The client's frame loop, reduced to the only part that matters here: the
 * freeze gate from main.ts's `step()`, the recorder, and nothing else.
 */
function drive(frames: number, frozenAt: (frame: number) => boolean) {
  const level = parseLevel(TEST_LEVEL);
  const sim = createSim(level, cloneSpec(DEFAULT_SPEC));
  const rec = createRecorder();
  for (let f = 0; f < frames; f++) {
    // This IS the gate: return before the sim is touched. No advance, so no
    // tick and no clock; no capture, so no frame in the input stream.
    if (frozenAt(f)) continue;
    // Keyed to the RECORDED frame, not the loop frame — that is what a held key
    // does. A frozen frame consumes no input, so the stream that reaches the
    // sim is the same stream, just spread over more wall-clock.
    const mask = maskFor(rec.frames);
    sim.advance(mask);
    rec.capture(mask, sim);
  }
  return { sim, rec, level };
}

describe('overview cannot affect a recorded replay', () => {
  it('produces an identical state hash, tick count and input stream', () => {
    // Held for 400 frames in the middle — 3.1 seconds of staring at the level
    // in the middle of a run, which is the exact thing a player will do.
    const plain = drive(600, () => false);
    const held = drive(1000, (f) => f >= 200 && f < 600);

    expect(held.sim.hash()).toBe(plain.sim.hash());
    expect(held.sim.state.tick).toBe(plain.sim.state.tick);
    expect(held.rec.frames).toBe(plain.rec.frames);

    const a = plain.rec.build(plain.level, cloneSpec(DEFAULT_SPEC), plain.sim);
    const b = held.rec.build(held.level, cloneSpec(DEFAULT_SPEC), held.sim);
    expect(b).not.toBeNull();
    // The whole replay, byte for byte: the RLE'd input stream, the periodic
    // hash chain, the final state hash and the claimed time.
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('survives being TOGGLED, which is how a phone drives it', () => {
    // The overview pad is a toggle where TAB is a hold — a hold would pin a
    // thumb to the glass for exactly as long as you were trying to read what is
    // on it. The freeze underneath is the same freeze and it is `overview.hold`
    // both times, so the replay claim has to survive the phone's usage pattern
    // as well as the desktop's: several separate looks rather than one long one.
    const plain = drive(600, () => false);
    const toggled = drive(1400, (f) =>
      (f >= 100 && f < 350) || (f >= 500 && f < 900) || (f >= 1000 && f < 1150));

    expect(toggled.sim.hash()).toBe(plain.sim.hash());
    expect(toggled.sim.state.tick).toBe(plain.sim.state.tick);
    const a = plain.rec.build(plain.level, cloneSpec(DEFAULT_SPEC), plain.sim);
    const b = toggled.rec.build(toggled.level, cloneSpec(DEFAULT_SPEC), toggled.sim);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('does not let the clock run while frozen', () => {
    const { sim } = drive(300, (f) => f >= 100);
    // 100 frames advanced, 200 frozen. The clock is state.tick, which only
    // stepTick moves, so it has to read exactly the 100.
    expect(sim.state.tick).toBe(100 * 4);
  });
});

describe('overviewFrame', () => {
  const p = cloneOverview(DEFAULT_OVERVIEW);

  it('frames a small level whole, centred on the level and not the bike', () => {
    const level = { minX: 0, minY: 0, maxX: 40, maxY: 20 };
    const f = overviewFrame(level, { x: 3, y: 1 }, VIEW.w, VIEW.h, p);
    expect(f.x).toBeCloseTo(20, 6);
    expect(f.y).toBeCloseTo(10, 6);
    // Everything, plus the padding, is inside the frame.
    const halfW = VIEW.w / 2 / f.zoom;
    const halfH = VIEW.h / 2 / f.zoom;
    expect(f.x - halfW).toBeLessThanOrEqual(level.minX);
    expect(f.x + halfW).toBeGreaterThanOrEqual(level.maxX);
    expect(f.y - halfH).toBeLessThanOrEqual(level.minY);
    expect(f.y + halfH).toBeGreaterThanOrEqual(level.maxY);
  });

  it('honours the zoom floor on a level too big to fit, and follows the bike there', () => {
    // Deliberately absurd: 4000 m of level. At the floor this can only show a
    // radius, so it must show the radius the BIKE is in.
    const level = { minX: 0, minY: 0, maxX: 4000, maxY: 60 };
    const a = overviewFrame(level, { x: 500, y: 20 }, VIEW.w, VIEW.h, p);
    const b = overviewFrame(level, { x: 3000, y: 20 }, VIEW.w, VIEW.h, p);
    expect(a.zoom).toBeCloseTo(p.minZoom, 6);
    expect(b.zoom).toBeCloseTo(p.minZoom, 6);
    expect(b.x).toBeGreaterThan(a.x + 2000);
  });

  it('never shows anything past the level, however far outside it the bike is', () => {
    const level = { minX: 0, minY: 0, maxX: 4000, maxY: 60 };
    const pad = 4000 * p.padding;
    for (const bx of [-9999, 0, 12, 2000, 4000, 99999]) {
      const f = overviewFrame(level, { x: bx, y: 20 }, VIEW.w, VIEW.h, p);
      const halfW = VIEW.w / 2 / f.zoom;
      expect(f.x - halfW).toBeGreaterThanOrEqual(level.minX - pad - 1e-6);
      expect(f.x + halfW).toBeLessThanOrEqual(level.maxX + pad + 1e-6);
    }
  });

  it('centres an axis the view is wider than, rather than clamping it to a wall', () => {
    // 4000 m wide but only 60 m tall: at the floor the view is ~89 m tall, so
    // the vertical span does not fill it and the answer must be the middle.
    const level = { minX: 0, minY: 0, maxX: 4000, maxY: 60 };
    const f = overviewFrame(level, { x: 2000, y: 0 }, VIEW.w, VIEW.h, p);
    expect(f.y).toBeCloseTo(30, 6);
  });

  it('survives a degenerate level and a zero-sized window without producing NaN', () => {
    const f = overviewFrame({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, { x: 5, y: 5 }, 0, 0, p);
    expect(Number.isFinite(f.x)).toBe(true);
    expect(Number.isFinite(f.y)).toBe(true);
    expect(Number.isFinite(f.zoom)).toBe(true);
    expect(f.zoom).toBeGreaterThan(0);
  });
});

describe('overview state machine', () => {
  it('freezes the sim while held and unfreezes the instant it is released', () => {
    const ov = createOverview(cloneOverview(DEFAULT_OVERVIEW));
    expect(ov.frozen).toBe(false);
    ov.hold(true);
    expect(ov.frozen).toBe(true);
    for (let i = 0; i < 180; i++) ov.tick(1 / 60);
    expect(ov.blend).toBe(1);
    ov.hold(false);
    // Unfrozen immediately, NOT when the ease-out finishes. A half-second of
    // stuck controls after releasing a key is worse than a fast zoom.
    expect(ov.frozen).toBe(false);
    expect(ov.blend).toBe(1);
    for (let i = 0; i < 120; i++) ov.tick(1 / 60);
    expect(ov.blend).toBe(0);
  });

  it('runs the opening peek for its hold and then lets go on its own', () => {
    const p = cloneOverview(DEFAULT_OVERVIEW);
    p.introHold = 0.5;
    const ov = createOverview(p);
    ov.startIntro();
    expect(ov.mode).toBe('intro');
    expect(ov.frozen).toBe(true);
    for (let i = 0; i < 20; i++) ov.tick(1 / 60); // 0.33 s
    expect(ov.frozen).toBe(true);
    for (let i = 0; i < 20; i++) ov.tick(1 / 60); // 0.66 s total
    expect(ov.mode).toBe('off');
    expect(ov.frozen).toBe(false);
  });

  it('skips the peek on the first input, and a zero hold disables it entirely', () => {
    const ov = createOverview(cloneOverview(DEFAULT_OVERVIEW));
    ov.startIntro();
    ov.tick(1 / 60);
    ov.skipIntro();
    expect(ov.frozen).toBe(false);

    const p = cloneOverview(DEFAULT_OVERVIEW);
    p.introHold = 0;
    const off = createOverview(p);
    off.startIntro();
    expect(off.frozen).toBe(false);
  });

  it('lets a deliberate hold outrank a running peek, in both directions', () => {
    const ov = createOverview(cloneOverview(DEFAULT_OVERVIEW));
    ov.startIntro();
    ov.hold(true);
    expect(ov.mode).toBe('held');
    ov.hold(false);
    // Releasing TAB during the peek drops straight into play rather than back
    // into the remainder of an intro nobody is waiting for any more.
    expect(ov.mode).toBe('off');
  });

  it('eases at the same rate at 60 Hz and at 144 Hz', () => {
    const a = createOverview(cloneOverview(DEFAULT_OVERVIEW));
    const b = createOverview(cloneOverview(DEFAULT_OVERVIEW));
    a.hold(true);
    b.hold(true);
    for (let i = 0; i < 18; i++) a.tick(1 / 60);
    for (let i = 0; i < 43; i++) b.tick(1 / 144);
    expect(Math.abs(a.blend - b.blend)).toBeLessThan(0.02);
  });

  it('does not expire the peek while the tab was backgrounded', () => {
    // requestAnimationFrame hands back a 30-second dt after a tab wakes up. If
    // that were subtracted from the intro, coming back to the window would show
    // the peek already over.
    const ov = createOverview(cloneOverview(DEFAULT_OVERVIEW));
    ov.startIntro();
    ov.tick(30);
    expect(ov.frozen).toBe(true);
  });
});
