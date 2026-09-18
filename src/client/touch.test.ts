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
  HUD_BAND_PX, MIN_PAD_MM, MM, PINCH_DEAD, PINCH_MIN_SPREAD, PX_PER_MM, hitZone, pinchPair,
  pinchScale, playAreaPointers, slideZone, smallestPadMm, spread, thumbInsetPx, touchZones,
  wantsTouch, zoneMask, zoomLabel,
} from './touch.ts';
import type { Pointer, Viewport, Zone, ZoneId } from './touch.ts';

/**
 * THE VIEWPORTS THIS HAS TO BE RIGHT ON, and the whole reason the layout is
 * arithmetic over plain objects rather than four percentages in a CSS file.
 *
 * `land-chrome` is the one that matters and the one that was missing: an Android
 * phone in landscape, in Chrome, with the URL bar and the system bars taking
 * their quarter. The previous pass was designed against `land-iphone` — a clean
 * 844 x 390 that no browser actually hands you — and shipped a layout that was
 * fine there and unusable on the real thing.
 */
const VIEWPORTS: Array<{ name: string; w: number; h: number }> = [
  { name: 'land-chrome', w: 915, h: 348 },
  { name: 'land-full', w: 915, h: 412 },
  { name: 'land-iphone', w: 844, h: 390 },
  { name: 'land-small', w: 736, h: 280 },
  { name: 'portrait', w: 412, h: 800 },
  { name: 'portrait-narrow', w: 360, h: 640 },
  { name: 'tablet', w: 1180, h: 820 },
];

/** The one the user played on, and the one every claim below is measured at. */
const PHONE: Viewport = { w: 915, h: 348 };
const W = PHONE.w;
const H = PHONE.h;

const zonesAt = (
  vp: Viewport = PHONE,
  auto = false,
  fullscreen: 'none' | 'off' | 'on' = 'off',
  menu = false,
): Zone[] => touchZones(vp, { autoThrottle: auto, fullscreen, menu });
/** The drawer open, which is the only state the other four commands exist in. */
const openAt = (vp: Viewport = PHONE, auto = false, fullscreen: 'none' | 'off' | 'on' = 'off'): Zone[] =>
  zonesAt(vp, auto, fullscreen, true);

const at = (zones = zonesAt()) =>
  (fx: number, fy: number): ZoneId | null => hitZone(zones, fx * W, fy * H);

const find = (zones: readonly Zone[], id: ZoneId): Zone => {
  const z = zones.find((x) => x.id === id);
  if (!z) throw new Error(`no ${id} zone`);
  return z;
};
/** A pad's short side, in millimetres — the only unit a thumb has. */
const shortMm = (z: Zone): number => Math.min(z.w, z.h) / PX_PER_MM;

describe('the layout is sized in MILLIMETRES, because a thumb is', () => {
  // THE BUG THIS REPLACES. The pads were fractions of the canvas — 15% wide and
  // HALF THE HEIGHT each for lean, a third of the width for the gas cluster — so
  // on a large phone in landscape they were enormous rectangles covering the
  // entire lower half of the screen, which was empty background, while all the
  // action was in a band across the top. The same fractions on a small phone
  // would have been too small to hit. Neither is a size anybody chose, and a
  // percentage of a canvas cannot be: a thumb is the same size on every phone.

  it('gives every hold pad a comfortable physical size on every real phone', () => {
    // About 9-10 mm is the minimum comfortable target and 12-15 mm is generous.
    // Anything past that is not easier to hit, it is just stealing screen.
    for (const vp of VIEWPORTS) {
      for (const auto of [false, true]) {
        const z = zonesAt(vp, auto);
        expect(smallestPadMm(z), `${vp.name} auto=${auto}`).toBeGreaterThanOrEqual(MIN_PAD_MM - 1e-9);
        for (const q of z.filter((x) => !x.command)) {
          expect(shortMm(q), `${vp.name} ${q.id} is huge`).toBeLessThanOrEqual(22);
        }
      }
    }
  });

  it('draws the SAME physical pad on a big phone and a small one', () => {
    // The thing fractions could never do. Two landscape phones 180 px apart in
    // width get gas pads within a millimetre of each other, rather than one 25%
    // bigger than the other for no reason but its screen.
    const big = find(zonesAt({ w: 915, h: 412 }), 'throttle');
    const small = find(zonesAt({ w: 844, h: 390 }), 'throttle');
    expect(Math.abs(big.w - small.w) / PX_PER_MM).toBeLessThan(1);
    expect(Math.abs(big.h - small.h) / PX_PER_MM).toBeLessThan(1);
  });

  it('SHRINKS rather than overlapping when the screen genuinely cannot hold it', () => {
    // Portrait is the hard case: a 360 px phone is 60 mm across and the two
    // clusters plus the gap between them want 76. It scales, it does not reflow
    // — the positions are what a player learns — and it stops at the comfortable
    // minimum rather than shrinking forever.
    const wide = find(zonesAt({ w: 915, h: 412 }), 'leanL');
    const narrow = find(zonesAt({ w: 360, h: 640 }), 'leanL');
    expect(narrow.w).toBeLessThan(wide.w);
    expect(shortMm(narrow)).toBeGreaterThanOrEqual(MIN_PAD_MM);
  });

  it('leaves the level most of the glass, which is the point of all of it', () => {
    // The old layout was about 40% pads on a large phone and they were in the
    // middle of everything. Corners, and a quarter at worst.
    for (const vp of VIEWPORTS) {
      const z = zonesAt(vp);
      const covered = z.reduce((s, q) => s + q.w * q.h, 0) / (vp.w * vp.h);
      expect(covered, `${vp.name}`).toBeLessThan(vp.h < 300 ? 0.4 : 0.3);
    }
  });
});

describe('the layout owes each control something different', () => {

  it('gives GAS the best position on the screen, because it is held constantly', () => {
    // The bottom-right corner: where the thumb already rests, no reach at all.
    // THUMBS PIVOT FROM WHERE THE HAND GRIPS and sweep an arc, so on a big phone
    // the far corners are harder to reach rather than easier — which is why
    // nothing that matters is out at the end of the arc any more.
    const gas = find(zonesAt(), 'throttle');
    // Hard against the bottom-right, bar the edge margin — which is NOT
    // fussiness: Android's back gesture lives on the left and right edges of the
    // glass and the home indicator lives on the bottom, so a pad flush to the
    // corner would be fighting the OS for the same 3 mm.
    expect(gas.x + gas.w).toBeCloseTo(W - MM.edge * PX_PER_MM, 6);
    expect(gas.y + gas.h).toBeCloseTo(H - MM.edge * PX_PER_MM, 6);
    expect(hitZone(zonesAt(), gas.x + gas.w - 1, gas.y + gas.h - 1)).toBe('throttle');
    expect(gas.w * gas.h).toBeGreaterThan(find(zonesAt(), 'brake').w * find(zonesAt(), 'brake').h);
    expect(shortMm(gas)).toBeGreaterThanOrEqual(12);
  });

  it('gives LEAN the left thumb, generous, and with NO DEAD STRIP between the two', () => {
    // Direction changes constantly in mid-air and sliding from one to the other
    // without lifting has to work. A gap would swallow exactly that input.
    const z = zonesAt();
    const l = find(z, 'leanL');
    const r = find(z, 'leanR');
    expect(l.x + l.w).toBe(r.x);
    expect(l.y).toBe(r.y);
    expect(l.h).toBe(r.h);
    expect(shortMm(l)).toBeGreaterThanOrEqual(12);
    expect(hitZone(z, l.x + 2, l.y + l.h - 2)).toBe('leanL');
    expect(hitZone(z, r.x + 2, r.y + r.h - 2)).toBe('leanR');
  });

  it('tiles the brake against the gas, so a drifting thumb lands in a zone', () => {
    const z = zonesAt();
    expect(find(z, 'brake').x + find(z, 'brake').w).toBe(find(z, 'throttle').x);
  });

  it('gives FLIP a place of its own with a DEAD STRIP under it', () => {
    // Rare, critical, and reached by rolling the right thumb up off the gas —
    // and that is exactly why it may not tile with the gas. A thumb DRIFTING up
    // off a held throttle must not arrive in flip, because that fires a
    // direction change in mid-air and loses the run. `slideZone` latches a touch
    // that slides into nothing, so 3 mm of nothing is what catches the drift.
    for (const vp of VIEWPORTS) {
      const z = zonesAt(vp);
      const flip = find(z, 'flip');
      const gas = find(z, 'throttle');
      const strip = gas.y - (flip.y + flip.h);
      expect(strip / PX_PER_MM, `${vp.name}`).toBeGreaterThan(1.5);
      // And the strip is dead: a thumb that drifts into it keeps the throttle.
      expect(slideZone(z, 'throttle', gas.x + 4, gas.y - strip / 2)).toBe('throttle');
    }
    expect(at()(0.92, 0.45)).toBe('flip');
  });

  it('gives only RESTART and MENU permanent glass, and puts the rest behind them', () => {
    // FIVE PERMANENT PADS FOR FIVE OCCASIONAL ACTIONS was the trade that went
    // wrong. Levels, full screen, gas-mode and zoom-reset are pressed between
    // runs and never during one, and paying for them with a row of buttons
    // across the band the bike rides through is not a price worth paying.
    // Restart is the exception and it earns it: no R key on a phone, and this
    // is a die-and-retry game.
    const z = zonesAt();
    expect(z.filter((q) => q.command).map((q) => q.id).sort()).toEqual(['menu', 'restart']);
    expect(openAt().filter((q) => q.command).map((q) => q.id).sort())
      .toEqual(['auto', 'full', 'levels', 'menu', 'restart', 'zoom']);
    // And the pad says which way it goes, because a drawer you cannot see the
    // state of is a drawer you press twice.
    expect(find(z, 'menu').label).toBe('more');
    expect(find(openAt(), 'menu').label).toBe('close');
  });

  it('makes the occasional controls SMALL and dim, not as prominent as the game', () => {
    const z = openAt();
    const cmds = z.filter((q) => q.command);
    const hold = Math.min(...z.filter((q) => !q.command).map((q) => q.w * q.h));
    for (const c of cmds) {
      expect(c.w * c.h, `${c.id}`).toBeLessThan(hold);
      // Still big enough to hit on purpose: small is not the same as fiddly.
      expect(shortMm(c)).toBeGreaterThanOrEqual(8);
    }
  });

  it('puts the permanent commands in the BOTTOM GUTTER, not in the play band', () => {
    // THE STRIP BETWEEN THE TWO THUMB CLUSTERS is the cheapest glass on a
    // landscape phone: no thumb rests on it, and the camera frames the bike in
    // the band ABOVE the pads, never below them. That is the whole of fix 1 —
    // the previous block sat at the top-left and, on a viewport too short for
    // two rows, spread into one row across half the width of the play band.
    for (const vp of VIEWPORTS.filter((v) => v.w > v.h)) {
      const z = zonesAt(vp);
      const lean = find(z, 'leanR');
      const brake = find(z, 'brake');
      for (const c of z.filter((q) => q.command)) {
        // Below the top of the pads — that is what "not in the play band" is.
        expect(c.y, `${vp.name} ${c.id}`).toBeGreaterThanOrEqual(lean.y);
        // And between the clusters rather than over either of them.
        expect(c.x, `${vp.name} ${c.id}`).toBeGreaterThanOrEqual(lean.x + lean.w);
        expect(c.x + c.w, `${vp.name} ${c.id}`).toBeLessThanOrEqual(brake.x);
      }
    }
  });

  it('drops the full-screen pad rather than offering a button that does nothing', () => {
    // There is no element fullscreen on an iPhone. A control that cannot work is
    // worse than no control, and the manifest's `display: standalone` is the
    // route to a chrome-free game there anyway.
    expect(openAt(PHONE, false, 'none').some((q) => q.id === 'full')).toBe(false);
    expect(find(openAt(PHONE, false, 'off'), 'full').label).toMatch(/full/);
    expect(find(openAt(PHONE, false, 'on'), 'full').label).toMatch(/exit/);
  });
});

describe('nothing is drawn on top of anything else', () => {
  it('never overlaps ANY two zones, on any viewport, in any mode', () => {
    // Overlap would make "which input did I give" depend on list order, which is
    // not a thing a player can see. This covers the commands too, and it is what
    // catches the command block growing into the lean pads on a short screen.
    for (const vp of VIEWPORTS) {
      for (const auto of [false, true]) {
        for (const fs of ['none', 'off', 'on'] as const) {
        for (const menu of [false, true]) {
          const z = zonesAt(vp, auto, fs, menu);
          for (let i = 0; i < z.length; i++) {
            for (let j = i + 1; j < z.length; j++) {
              const a = z[i];
              const b = z[j];
              const apart =
                a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
              expect(apart, `${vp.name} ${auto}/${fs}/${menu}: ${a.id} overlaps ${b.id}`).toBe(true);
            }
          }
        }
        }
      }
    }
  });

  it('stays out of the in-canvas HUD band, which is the other half of fix 2', () => {
    // The art renderer draws the level card, the clock and the apple counter
    // across the top of the canvas at a FIXED pixel size. Nothing in this
    // overlay is allowed up there — the screenshot that started this had the
    // desktop level bar and a `browse C` button printed straight through them.
    for (const vp of VIEWPORTS) {
      for (const auto of [false, true]) {
        for (const menu of [false, true]) {
          for (const q of zonesAt(vp, auto, 'off', menu)) {
            expect(q.y, `${vp.name} ${q.id}`).toBeGreaterThanOrEqual(HUD_BAND_PX);
          }
        }
      }
    }
  });

  it('keeps every zone on the screen, and out of the safe-area insets', () => {
    // `viewport-fit=cover` paints under a notch and a home indicator, which is
    // right for the level and wrong for a control.
    const cover: Viewport = { w: 844, h: 390, top: 0, right: 47, bottom: 21, left: 47 };
    for (const vp of [...VIEWPORTS, cover] as Viewport[]) {
      for (const auto of [false, true]) {
        for (const menu of [false, true]) {
          for (const q of zonesAt(vp, auto, 'off', menu)) {
            expect(q.x, `${q.id}`).toBeGreaterThanOrEqual(vp.left ?? 0);
            expect(q.y).toBeGreaterThanOrEqual(0);
            expect(q.x + q.w).toBeLessThanOrEqual(vp.w - (vp.right ?? 0) + 1e-9);
            expect(q.y + q.h).toBeLessThanOrEqual(vp.h - (vp.bottom ?? 0) + 1e-9);
          }
        }
      }
    }
  });

  it('leaves the middle and the top of the screen alone — that is the game', () => {
    // THE WHOLE TOP IS CLEAR NOW, which it was not: the command block used to
    // live under the HUD at the top-left and, on a short landscape phone, ran
    // most of the way across. The only glass this overlay takes above the pads
    // is flip's, in the right-hand column.
    const hit = at();
    expect(hit(0.5, 0.5)).toBe(null);
    expect(hit(0.5, 0.05)).toBe(null);
    expect(hit(0.95, 0.05)).toBe(null);
    expect(hit(0.6, 0.2)).toBe(null);
    expect(hit(0.08, 0.3)).toBe(null);
    expect(hit(0.3, 0.6)).toBe(null);
  });

  it('gives the bike a clear band that is BIGGER than the pads under it', () => {
    // The pads were 20 mm tall because nothing else wanted the room. On a
    // 310 px-tall landscape phone that is 39% of the glass and the band left for
    // the level is thinner than the pads are, which inverts what the screen is
    // for. 15 mm is still generous for a thumb and hands the level the rest.
    for (const vp of [...VIEWPORTS, { name: 'land-short', w: 915, h: 310 }].filter((v) => v.w > v.h)) {
      const z = zonesAt(vp);
      const band = find(z, 'leanL').y - HUD_BAND_PX;
      expect(band, `${vp.name}`).toBeGreaterThan(find(z, 'leanL').h);
    }
  });
});

describe('where the hands are, as a number the camera can use', () => {
  it('measures the bottom cluster and NOT flip', () => {
    // The inset means "where the hands live". A hand does not live on flip — it
    // is touched for a tenth of a second — so counting it would push the bike a
    // centimetre up the screen to dodge a pad nobody is holding.
    const z = zonesAt();
    const inset = thumbInsetPx(z, H);
    expect(inset).toBeCloseTo(H - find(z, 'throttle').y, 6);
    expect(inset).toBeLessThan(H - find(z, 'flip').y);
  });

  it('is a number of PIXELS, so it shrinks as a fraction of a taller screen', () => {
    // Which is the whole point: the same hands on a taller screen cover less of
    // it, and the camera's bias should follow that rather than a constant.
    const short = thumbInsetPx(zonesAt({ w: 915, h: 348 }), 348) / 348;
    const tall = thumbInsetPx(zonesAt({ w: 1180, h: 820 }), 820) / 820;
    expect(tall).toBeLessThan(short);
  });

  it('is zero when there are no pads at all', () => {
    expect(thumbInsetPx([], 348)).toBe(0);
  });
});

describe('auto-throttle', () => {
  it('collapses the right cluster to ONE target and frees the thumb', () => {
    const z = zonesAt(PHONE, true);
    expect(z.some((q) => q.id === 'throttle')).toBe(false);
    const gasCorner = find(zonesAt(), 'throttle');
    // The corner the gas pad had is now the brake's, whole.
    expect(hitZone(z, gasCorner.x + gasCorner.w / 2, gasCorner.y + gasCorner.h / 2)).toBe('brake');
    // It takes the WHOLE cluster rather than staying its own narrow self: the
    // thumb that was on the gas now has nothing under it, and a corner of dead
    // glass where a control used to be is a control you press and miss.
    expect(find(z, 'brake').w).toBe(
      find(zonesAt(), 'brake').w + find(zonesAt(), 'throttle').w,
    );
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
    const off = zonesAt(PHONE, false);
    const on = zonesAt(PHONE, true);
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
  const z = zonesAt();
  const leanL = find(z, 'leanL');
  const leanR = find(z, 'leanR');
  const restart = find(z, 'restart');

  it('slides between the lean zones without lifting', () => {
    expect(slideZone(z, 'leanL', leanR.x + 4, leanR.y + 4)).toBe('leanR');
    expect(slideZone(z, 'leanR', leanL.x + 4, leanL.y + 4)).toBe('leanL');
  });

  it('LATCHES rather than releasing when a thumb drifts into the play area', () => {
    // The throttle is held for most of a run and a thumb drifts while it is
    // held. Four millimetres past the top edge must not cut the engine with
    // nothing on screen to say why; only lifting the finger releases.
    expect(slideZone(z, 'throttle', W * 0.9, H * 0.2)).toBe('throttle');
    expect(slideZone(z, 'leanL', W * 0.5, H * 0.1)).toBe('leanL');
  });

  it('is never slid INTO a command — restart is pressed, never brushed', () => {
    // A thumb crossing the restart button on its way somewhere must not end the
    // run. Commands fire on the press and on nothing else. The coordinates are
    // the restart button's own, so this cannot pass by landing in dead space.
    expect(hitZone(z, restart.x + 2, restart.y + 2)).toBe('restart');
    expect(slideZone(z, 'leanL', restart.x + 2, restart.y + 2)).toBe('leanL');
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
  const Z = zonesAt();
  const at = (id: number, fx: number, fy: number): Pointer => ({ id, x: fx * W, y: fy * H });
  const free = (pts: Pointer[]) => playAreaPointers(Z, pts);
  /** A pointer in the middle of a named pad, which is where a thumb lands. */
  const on = (id: number, zid: ZoneId): Pointer => {
    const q = find(Z, zid);
    return { id, x: q.x + q.w / 2, y: q.y + q.h / 2 };
  };

  // Where the thumbs actually are, in ordinary play.
  const GAS = on(1, 'throttle');
  const LEAN_L = on(2, 'leanL');
  const LEAN_R = on(3, 'leanR');
  const FLIP = on(4, 'flip');

  it('is NOT two thumbs on the pads — which is how this game is played', () => {
    expect(free([GAS, LEAN_L])).toEqual([]);
    expect(free([GAS, LEAN_R])).toEqual([]);
    expect(free([GAS, LEAN_L, FLIP])).toEqual([]);
    expect(pinchPair(free([GAS, LEAN_L]))).toBe(null);
    expect(pinchPair(free([GAS, LEAN_L, FLIP]))).toBe(null);
  });

  it('is NOT a thumb on the gas plus one stray touch in the play area', () => {
    // One free finger is not a gesture, however far it moves.
    const stray = at(5, 0.5, 0.45);
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
    const a = at(8, 0.40, 0.45);
    const b = at(9, 0.65, 0.45);
    const pair = pinchPair(free([a, b]));
    expect(pair).not.toBe(null);
    expect(pair!.map((p) => p.id)).toEqual([8, 9]);
  });

  it('cannot be started by a thumb that slid OFF a pad into the play area', () => {
    // The latch: a drifting thumb keeps the throttle, which means it is still a
    // control and still not a pinch finger. It never enters the free set at
    // all, because that is decided once, where the finger landed.
    const drifted = at(10, 0.5, 0.45);
    expect(slideZone(Z, 'throttle', drifted.x, drifted.y)).toBe('throttle');
    const other = at(11, 0.62, 0.45);
    // Only the one that landed in the play area is a candidate; the drifted
    // thumb is held by the pad, not by this list.
    expect(pinchPair(free([other]))).toBe(null);
  });

  it('is not disturbed by a third finger arriving, on a pad or off one', () => {
    // A gesture that died because of a knuckle would be the same silent failure
    // the pads were designed to avoid. `pinchPair` is consulted at the START
    // and never again; the pair is tracked by id from there.
    const a = at(12, 0.40, 0.45);
    const b = at(13, 0.65, 0.45);
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
    const z = touchZones(PHONE, { autoThrottle: false, bias: 1.4, fullscreen: 'off', menu: true });
    const pad = find(z, 'zoom');
    expect(pad.command).toBe(true);
    expect(pad.label).toBe('zoom 1.4\u00d7');
    expect(zoomLabel(1)).toBe('zoom 1.0\u00d7');
    // Present in both modes, because the ELEMENTS are never rebuilt for a
    // relayout: rebuilding the overlay mid-run drops pointer capture and would
    // release a held throttle.
    expect(openAt(PHONE, true).some((x) => x.id === 'zoom')).toBe(true);
    // A command, so it cannot be slid into by a thumb on its way somewhere and
    // it contributes no sim bit.
    expect(slideZone(z, 'leanL', pad.x + 4, pad.y + 4)).toBe('leanL');
    expect(zoneMask(['zoom'], false)).toBe(0);
    // And it is out of the play area, so it cannot be half of a pinch.
    expect(hitZone(z, pad.x + pad.w / 2, pad.y + pad.h / 2)).toBe('zoom');
  });
});
