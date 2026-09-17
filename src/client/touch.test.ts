// Touch controls, in plain node. No DOM and no jsdom, by house rule — and the
// DOM is not what could be wrong here anyway.
//
// What could be wrong is all geometry and bitmasks: a dead strip between the
// two lean zones that eats the input you gave, a flip zone extending under the
// restart button, a multi-touch model that releases the throttle when the OTHER
// finger lifts, an auto-throttle that fights its own brake — and, the one that
// would be worst and quietest, a touch-played run that does not verify like a
// keyboard one. Every one of those is decidable from plain objects.
import { describe, expect, it } from 'vitest';
import { createSim } from '@/sim/sim.ts';
import { buildReplay, verifyReplay } from '@/sim/replay.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { parseLevel } from '@/sim/level.ts';
import { cloneSpec, DEFAULT_SPEC } from '@/sim/spec.ts';
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_MASK, IN_THROTTLE } from '@/sim/consts.ts';
import { createInput } from './input.ts';
import {
  PINCH_DEAD, PINCH_MIN_SPREAD, hitZone, pinchPair, pinchScale, playAreaPointers, slideZone,
  spread, touchZones, wantsTouch, zoneMask, zoomLabel,
} from './touch.ts';
import type { Pointer, ZoneId } from './touch.ts';

/** A landscape phone, in CSS pixels. */
const W = 844;
const H = 390;

const at = (zones = touchZones(false)) =>
  (fx: number, fy: number): ZoneId | null => hitZone(zones, fx * W, fy * H, W, H);

describe('the layout', () => {
  const hit = at();

  it('gives the right thumb the throttle in the bottom corner', () => {
    // The biggest, lowest, most comfortable target on the screen, because it is
    // held almost constantly and everything else is occasional.
    expect(hit(0.98, 0.98)).toBe('throttle');
    expect(hit(0.85, 0.75)).toBe('throttle');
  });

  it('puts the brake beside the throttle rather than under a different thumb', () => {
    expect(hit(0.70, 0.98)).toBe('brake');
  });

  it('gives the throttle more room than the brake', () => {
    const z = touchZones(false);
    const gas = z.find((x) => x.id === 'throttle')!;
    const brake = z.find((x) => x.id === 'brake')!;
    expect(gas.w * gas.h).toBeGreaterThan(brake.w * brake.h);
  });

  it('splits the left thumb into two lean zones WITH NO DEAD STRIP between them', () => {
    // Direction changes constantly in mid-air, and sliding from one to the other
    // without lifting has to work. A gap between them would swallow exactly the
    // input the slide exists to give.
    const z = touchZones(false);
    const l = z.find((x) => x.id === 'leanL')!;
    const r = z.find((x) => x.id === 'leanR')!;
    expect(l.x + l.w).toBe(r.x);
    expect(l.y).toBe(r.y);
    expect(l.h).toBe(r.h);
    expect(hit(0.05, 0.9)).toBe('leanL');
    expect(hit(0.25, 0.9)).toBe('leanR');
  });

  it('gives FLIP a home of its own, up and inboard of the right cluster', () => {
    // Rare, critical, and both thumbs are busy. It is a place, not a gesture:
    // a double-tap or a swipe that fails does so silently, and this game
    // punishes a missed input immediately.
    expect(hit(0.80, 0.35)).toBe('flip');
  });

  it('leaves the middle and the top of the screen alone — that is the game', () => {
    expect(hit(0.5, 0.5)).toBe(null);
    expect(hit(0.5, 0.9)).toBe(null);
    expect(hit(0.3, 0.2)).toBe(null);
  });

  it('keeps the commands clear of the in-canvas HUD and the level picker', () => {
    // The art renderer draws the level name, the clock and the apple count
    // across the TOP-CENTRE of the canvas, and the level picker sits top-right.
    // Neither is in the DOM beside these pads, so only a screenshot catches an
    // overlap — and one did: "RESTART" printed through "20 CLOSE QUARTERS".
    for (const z of touchZones(false).filter((x) => x.command)) {
      expect(z.x + z.w, `${z.id} reaches the HUD`).toBeLessThan(0.3);
    }
    expect(hit(0.5, 0.04)).toBe(null);
    expect(hit(0.95, 0.04)).toBe(null);
  });

  it('never overlaps two HOLD zones, whatever the mode', () => {
    // Overlap would make "which input did I give" depend on list order, which
    // is not a thing a player can see.
    for (const auto of [false, true]) {
      const holds = touchZones(auto).filter((z) => !z.command);
      for (let i = 0; i < holds.length; i++) {
        for (let j = i + 1; j < holds.length; j++) {
          const a = holds[i];
          const b = holds[j];
          const apart =
            a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
          expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
        }
      }
    }
  });

  it('keeps every zone on the screen', () => {
    for (const auto of [false, true]) {
      for (const z of touchZones(auto)) {
        expect(z.x).toBeGreaterThanOrEqual(0);
        expect(z.y).toBeGreaterThanOrEqual(0);
        expect(z.x + z.w).toBeLessThanOrEqual(1);
        expect(z.y + z.h).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is resolution-independent — the same fractions on any phone', () => {
    const z = touchZones(false);
    for (const [w, h] of [[844, 390], [667, 375], [1180, 820]]) {
      expect(hitZone(z, w * 0.98, h * 0.98, w, h)).toBe('throttle');
      expect(hitZone(z, w * 0.02, h * 0.98, w, h)).toBe('leanL');
    }
  });
});

describe('auto-throttle', () => {
  it('collapses the right cluster to ONE target and frees the thumb', () => {
    const hit = at(touchZones(true));
    expect(touchZones(true).some((z) => z.id === 'throttle')).toBe(false);
    expect(hit(0.98, 0.98)).toBe('brake');
    expect(hit(0.70, 0.98)).toBe('brake');
  });

  it('holds the gas with nothing pressed at all', () => {
    expect(zoneMask([], true)).toBe(IN_THROTTLE);
    expect(zoneMask([], false)).toBe(0);
  });

  it('CUTS the gas while the brake is held rather than fighting it', () => {
    // Throttle and brake are additive torques on the wheel, so holding both
    // makes the bike fight itself: the brake caps the spin at zero and the
    // drive re-spins it. Under auto-throttle, "brake" means "stop".
    expect(zoneMask(['brake'], true)).toBe(IN_BRAKE);
    // On the keyboard a player asking for both still gets both — this rule
    // only governs the bit the client adds on their behalf.
    expect(zoneMask(['brake', 'throttle'], false)).toBe(IN_BRAKE | IN_THROTTLE);
  });

  it('leaves lean and flip exactly where they were, so the mode is not a relearn', () => {
    const off = touchZones(false);
    const on = touchZones(true);
    for (const id of ['leanL', 'leanR', 'flip'] as const) {
      expect(on.find((z) => z.id === id)).toEqual(off.find((z) => z.id === id));
    }
  });
});

describe('zoneMask', () => {
  it('MULTI-TOUCH IS THE NORMAL CASE — nothing here is exclusive', () => {
    // Throttle plus lean is most of the game; throttle plus lean plus flip —
    // three fingers — is how you save a landing.
    expect(zoneMask(['throttle', 'leanR'], false)).toBe(IN_THROTTLE | IN_LEAN_R);
    expect(zoneMask(['throttle', 'leanL', 'flip'], false)).toBe(IN_THROTTLE | IN_LEAN_L | IN_FLIP);
    expect(zoneMask(['throttle', 'brake', 'leanL', 'leanR', 'flip'], false)).toBe(IN_MASK);
  });

  it('emits NOTHING BUT the sim\'s own bits', () => {
    // The compatibility claim in one assertion: whatever the pads produce is a
    // mask the sim already understands, so the recorder cannot tell a touch run
    // from a keyboard one.
    const ids: ZoneId[] = ['throttle', 'brake', 'leanL', 'leanR', 'flip', 'restart', 'auto'];
    for (const auto of [false, true]) {
      for (const id of ids) {
        expect(zoneMask([id], auto) & ~IN_MASK).toBe(0);
      }
    }
  });

  it('gives the command zones no bit at all', () => {
    expect(zoneMask(['restart'], false)).toBe(0);
    expect(zoneMask(['auto'], false)).toBe(0);
  });
});

describe('sliding', () => {
  const z = touchZones(false);

  it('slides between the lean zones without lifting', () => {
    expect(slideZone(z, 'leanL', W * 0.25, H * 0.9, W, H)).toBe('leanR');
    expect(slideZone(z, 'leanR', W * 0.05, H * 0.9, W, H)).toBe('leanL');
  });

  it('LATCHES rather than releasing when a thumb drifts into the play area', () => {
    // The throttle is held for most of a run and a thumb drifts while it is
    // held. Four millimetres past the top edge must not cut the engine with
    // nothing on screen to say why; only lifting the finger releases.
    expect(slideZone(z, 'throttle', W * 0.9, H * 0.2, W, H)).toBe('throttle');
    expect(slideZone(z, 'leanL', W * 0.5, H * 0.1, W, H)).toBe('leanL');
  });

  it('is never slid INTO a command — restart is pressed, never brushed', () => {
    // A thumb crossing the restart button on its way somewhere must not end the
    // run. Commands fire on the press and on nothing else. The coordinates are
    // the restart button's own, so this cannot pass by landing in dead space.
    expect(hitZone(z, W * 0.05, H * 0.08, W, H)).toBe('restart');
    expect(slideZone(z, 'leanL', W * 0.05, H * 0.08, W, H)).toBe('leanL');
  });
});

describe('wantsTouch', () => {
  it('asks whether the pointer is a FINGER, not whether the screen could be touched', () => {
    // `maxTouchPoints` is true of every laptop with a touchscreen. A desktop
    // that sprouted thumb pads because a monitor happens to be touchable is a
    // worse first impression than a phone without them.
    expect(wantsTouch('', (q) => q === '(pointer: coarse)')).toBe(true);
    expect(wantsTouch('', () => false)).toBe(false);
  });

  it('lets ?touch= override it in both directions, for testing from a desktop', () => {
    expect(wantsTouch('?touch=1', () => false)).toBe(true);
    expect(wantsTouch('?level=03&touch=0', () => true)).toBe(false);
  });
});

describe('a touch run is the same kind of thing as a keyboard run', () => {
  const LEVEL = parseLevel(TEST_LEVEL);
  const SPEC = cloneSpec(DEFAULT_SPEC);

  /** Zones held over time, as a phone would report them. */
  const script: ZoneId[][] = [
    ...Array.from({ length: 60 }, () => ['throttle'] as ZoneId[]),
    ...Array.from({ length: 20 }, () => ['throttle', 'leanR'] as ZoneId[]),
    ...Array.from({ length: 10 }, () => ['throttle', 'leanR', 'flip'] as ZoneId[]),
    ...Array.from({ length: 40 }, () => ['throttle', 'leanL'] as ZoneId[]),
    ...Array.from({ length: 20 }, () => ['brake'] as ZoneId[]),
  ];

  it('VERIFIES IDENTICALLY — the recorder cannot tell where a bit came from', () => {
    // The whole compatibility argument, run rather than asserted: a stream
    // produced by thumbs goes through the same sim, the same recorder and the
    // same verifier the server runs, and comes out valid.
    const sim = createSim(LEVEL, SPEC);
    const masks: number[] = [];
    const hashes: string[] = [];
    for (const held of script) {
      const m = zoneMask(held, false);
      sim.advance(m);
      masks.push(m);
      if (masks.length % 32 === 0) hashes.push(sim.hash());
    }
    const replay = buildReplay({ level: LEVEL, spec: SPEC, masks, hashEvery: 32, hashes, state: sim.state });
    expect(verifyReplay(LEVEL, SPEC, replay).ok).toBe(true);
  });

  it('produces byte-identical bytes to the same buttons typed', () => {
    // Two runs of the same buttons, one arrived at through the pads and one
    // written as raw bits. If these ever diverge, a phone leaderboard entry is
    // a different sport.
    const byThumb = script.map((held) => zoneMask(held, false));
    const byKey = script.map((held) => {
      let m = 0;
      if (held.includes('throttle')) m |= IN_THROTTLE;
      if (held.includes('brake')) m |= IN_BRAKE;
      if (held.includes('leanL')) m |= IN_LEAN_L;
      if (held.includes('leanR')) m |= IN_LEAN_R;
      if (held.includes('flip')) m |= IN_FLIP;
      return m;
    });
    expect(byThumb).toEqual(byKey);
  });

  it('reaches the sim through input.mask(), not around it', () => {
    // `addSource` exists so there is ONE place the mask is assembled. A second
    // mask OR-ed in at the call site would work until somebody added a third
    // call site, and the one they missed would be the one the recorder reads.
    // `createInput` binds a `blur` handler on the global window so an alt-tab
    // cannot leave the throttle latched. There is no window in node, so it gets
    // the smallest one that satisfies that — no jsdom, same as every other test
    // in this repo.
    const fake = { addEventListener: () => {}, removeEventListener: () => {} };
    const g = globalThis as unknown as { window?: unknown };
    const had = 'window' in g;
    g.window = fake;
    let pads = 0;
    const input = createInput(fake as unknown as Window);
    input.addSource(() => pads);
    expect(input.mask()).toBe(0);
    pads = IN_THROTTLE | IN_LEAN_R;
    expect(input.mask()).toBe(IN_THROTTLE | IN_LEAN_R);
    pads = 0;
    expect(input.mask()).toBe(0);
    input.detach();
    if (!had) delete g.window;
  });
});


describe('the pinch, against a game where two fingers is the normal case', () => {
  // THE HARD PART HERE IS NOT THE ARITHMETIC. Gas and lean is most of the game
  // and gas, lean and flip is three fingers, so a recogniser that watched raw
  // touch points would fire constantly while driving. The rule is structural:
  // a pointer that LANDED ON A PAD is a control for as long as it is down, so
  // controls and gesture fingers are disjoint sets and neither can take the
  // other's input away. All of that is decidable from plain objects, which is
  // the half that would actually have gone wrong.
  const Z = touchZones(false);
  const at = (id: number, fx: number, fy: number): Pointer => ({ id, x: fx * W, y: fy * H });
  const free = (pts: Pointer[]) => playAreaPointers(Z, pts, W, H);

  // Where the thumbs actually are, in ordinary play.
  const GAS = at(1, 0.92, 0.80);
  const LEAN_L = at(2, 0.05, 0.80);
  const LEAN_R = at(3, 0.22, 0.80);
  const FLIP = at(4, 0.80, 0.35);

  it('is NOT two thumbs on the pads — which is how this game is played', () => {
    expect(free([GAS, LEAN_L])).toEqual([]);
    expect(free([GAS, LEAN_R])).toEqual([]);
    expect(free([GAS, LEAN_L, FLIP])).toEqual([]);
    expect(pinchPair(free([GAS, LEAN_L]))).toBe(null);
    expect(pinchPair(free([GAS, LEAN_L, FLIP]))).toBe(null);
  });

  it('is NOT a thumb on the gas plus one stray touch in the play area', () => {
    // One free finger is not a gesture, however far it moves.
    const stray = at(5, 0.5, 0.5);
    expect(free([GAS, stray])).toEqual([stray]);
    expect(pinchPair(free([GAS, stray]))).toBe(null);
  });

  it('is NOT two fingers that happen to land next to each other', () => {
    // A hand resting, a palm edge, or the two-finger tap somebody uses to skip
    // the opening peek. Dividing by a tiny starting spread is also what makes a
    // jittery gesture multiply the zoom by ten.
    const a: Pointer = { id: 6, x: 400, y: 200 };
    const b: Pointer = { id: 7, x: 400 + PINCH_MIN_SPREAD - 1, y: 200 };
    expect(pinchPair(free([a, b]))).toBe(null);
    b.x = 400 + PINCH_MIN_SPREAD + 1;
    expect(pinchPair(free([a, b]))).not.toBe(null);
  });

  it('IS two fingers that both started in the play area, and nothing else', () => {
    const a = at(8, 0.35, 0.30);
    const b = at(9, 0.60, 0.30);
    const pair = pinchPair(free([a, b]));
    expect(pair).not.toBe(null);
    expect(pair!.map((p) => p.id)).toEqual([8, 9]);
  });

  it('cannot be started by a thumb that slid OFF a pad into the play area', () => {
    // The latch: a drifting thumb keeps the throttle, which means it is still a
    // control and still not a pinch finger. It never enters the free set at
    // all, because that is decided once, where the finger landed.
    const drifted = at(10, 0.5, 0.2);
    expect(slideZone(Z, 'throttle', drifted.x, drifted.y, W, H)).toBe('throttle');
    const other = at(11, 0.3, 0.2);
    // Only the one that landed in the play area is a candidate; the drifted
    // thumb is held by the pad, not by this list.
    expect(pinchPair(free([other]))).toBe(null);
  });

  it('is not disturbed by a third finger arriving, on a pad or off one', () => {
    // A gesture that died because of a knuckle would be the same silent failure
    // the pads were designed to avoid. `pinchPair` is consulted at the START
    // and never again; the pair is tracked by id from there.
    const a = at(12, 0.35, 0.30);
    const b = at(13, 0.60, 0.30);
    const pair = pinchPair(free([a, b]))!;
    expect(pair).not.toBe(null);
    // and the pads keep working meanwhile: the mask is over held ZONES, which
    // the gesture never touches.
    expect(zoneMask(['throttle', 'leanR'], false)).toBe(IN_THROTTLE | IN_LEAN_R);
  });

  it('does nothing until the fingers have actually moved, and then moves smoothly', () => {
    // A RUBBER BAND, not a threshold that arms: the scale is continuous across
    // the edge of the dead band, so the picture cannot jump at the moment the
    // gesture is recognised.
    const d0 = 200;
    expect(pinchScale(d0, d0)).toBe(1);
    expect(pinchScale(d0, d0 * (1 + PINCH_DEAD))).toBe(1);
    expect(pinchScale(d0, d0 * (1 - PINCH_DEAD))).toBe(1);
    expect(pinchScale(d0, d0 * (1 + PINCH_DEAD + 1e-9))).toBeCloseTo(1, 6);
    expect(pinchScale(d0, d0 * (1 - PINCH_DEAD - 1e-9))).toBeCloseTo(1, 6);
    // Spread to zoom in, pinch to zoom out — the universal direction.
    expect(pinchScale(d0, d0 * 2)).toBeGreaterThan(1.7);
    expect(pinchScale(d0, d0 * 0.5)).toBeLessThan(0.6);
    // Monotone, so the picture tracks the fingers rather than lagging them.
    let prev = 0;
    for (let d = 40; d < 600; d += 10) {
      const k = pinchScale(d0, d);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
  });

  it('survives nonsense without producing nonsense', () => {
    // Two pointers reported at the same place, a zero spread, a lifted finger
    // still in the list: none of these may produce a NaN zoom.
    expect(pinchScale(0, 100)).toBe(1);
    expect(pinchScale(100, 0)).toBe(1);
    expect(spread({ id: 0, x: 3, y: 4 }, { id: 1, x: 0, y: 0 })).toBe(5);
  });

  it('prints what it is doing, and the pad that undoes it is always there', () => {
    // A gesture that goes wrong mid-run needs a way back that is not another
    // gesture — and the pad is also the only thing on the screen that says
    // pinch exists at all.
    const z = touchZones(false, 1.4);
    const pad = z.find((x) => x.id === 'zoom')!;
    expect(pad.command).toBe(true);
    expect(pad.label).toBe('zoom 1.4\u00d7');
    expect(zoomLabel(1)).toBe('zoom 1.0\u00d7');
    // Present in both modes, because it is never rebuilt: rebuilding the
    // overlay mid-run drops pointer capture and would release a held throttle.
    expect(touchZones(true).some((x) => x.id === 'zoom')).toBe(true);
    // A command, so it cannot be slid into by a thumb on its way somewhere and
    // it contributes no sim bit.
    expect(slideZone(z, 'leanL', pad.x * W + 4, pad.y * H + 4, W, H)).toBe('leanL');
    expect(zoneMask(['zoom'], false)).toBe(0);
    // And it is out of the play area, so it cannot be half of a pinch.
    expect(hitZone(z, (pad.x + pad.w / 2) * W, (pad.y + pad.h / 2) * H, W, H)).toBe('zoom');
  });
});
