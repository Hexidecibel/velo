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
  GRIP_Y, HUD_BAND_PX, MIN_PAD_MM, MM, PINCH_DEAD, PINCH_MIN_SPREAD, PX_PER_MM, TABLET_MIN_PX,
  TABLET_PX_PER_MM, gripFor, hitZone, pinchPair, pinchScale, playAreaPointers, pxPerMmFor,
  slideZone, smallestPadMm, spread, thumbInsetPx, touchZones, wantsTouch, zoneMask, zoomLabel,
} from './touch.ts';
import type { Pointer, Viewport, Zone, ZoneId } from './touch.ts';
import { DRIVE, PLAY } from './keys.ts';

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
const PHONES: Array<{ name: string; w: number; h: number }> = [
  { name: 'land-chrome', w: 915, h: 348 },
  { name: 'land-full', w: 915, h: 412 },
  { name: 'land-iphone', w: 844, h: 390 },
  { name: 'land-small', w: 736, h: 280 },
  { name: 'portrait', w: 412, h: 800 },
  { name: 'portrait-narrow', w: 360, h: 640 },
];

/**
 * AND THE TABLETS, WHICH ARE A DIFFERENT GRIP AND NOT A BIGGER PHONE.
 *
 * Real devices in CSS px, in both orientations, because portrait is a way
 * people actually hold a tablet in a way it barely is for phone gaming — and
 * because an iPad portrait at 0.70 is further from the reference aspect than
 * any landscape phone is.
 *
 * `tablet` used to be 1180 x 820 in this list, which is a size nobody owns; it
 * is kept because the shot harness has always had it and because it is the one
 * entry that is NOT a 264-ppi Apple panel, so it proves the layout is decided
 * by the glass rather than by a device table.
 */
const TABLETS: Array<{ name: string; w: number; h: number }> = [
  { name: 'tablet', w: 1180, h: 820 },
  { name: 'ipad11-land', w: 1194, h: 834 },
  { name: 'ipad11-port', w: 834, h: 1194 },
  { name: 'ipad13-land', w: 1366, h: 1024 },
  { name: 'ipad13-port', w: 1024, h: 1366 },
];

/** Every screen the layout has to be right on, whichever grip it is held in. */
const VIEWPORTS = [...PHONES, ...TABLETS];

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
const shortMm = (z: Zone, mm = PX_PER_MM): number => Math.min(z.w, z.h) / mm;

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
      // THE VIEWPORT'S OWN SCALE, which is the tablet half of this claim. A
      // 21 mm gas pad laid out at the phone's 6 px/mm and then shown on a
      // 5.2 px/mm iPad is 24 mm of glass, not 21 — the pad did not get bigger,
      // the millimetre did. `pxPerMmFor` is what makes the mm in this test a
      // real mm on both kinds of device.
      const mm = pxPerMmFor(vp);
      for (const auto of [false, true]) {
        const z = zonesAt(vp, auto);
        expect(smallestPadMm(z, mm), `${vp.name} auto=${auto}`).toBeGreaterThanOrEqual(MIN_PAD_MM - 1e-9);
        for (const q of z.filter((x) => !x.command)) {
          expect(shortMm(q, mm), `${vp.name} ${q.id} is huge`).toBeLessThanOrEqual(22);
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
      expect(strip / pxPerMmFor(vp), `${vp.name}`).toBeGreaterThan(1.5);
      // And the strip is dead: a thumb that drifts into it keeps the throttle.
      expect(slideZone(z, 'throttle', gas.x + 4, gas.y - strip / 2)).toBe('throttle');
    }
    expect(at()(0.92, 0.45)).toBe('flip');
  });

  it('gives permanent glass ONLY to what is pressed during a run', () => {
    // FIVE PERMANENT PADS FOR FIVE OCCASIONAL ACTIONS was the trade that went
    // wrong. Levels, full screen, gas-mode and zoom-reset are pressed between
    // runs and never during one, and paying for them with a row of buttons
    // across the band the bike rides through is not a price worth paying.
    //
    // The two exceptions earn it on exactly that test. RESTART: no R key on a
    // phone, and this is a die-and-retry game. OVERVIEW: route planning is the
    // depth of this game, you do it mid-run, and it was bound to TAB — a key
    // that does not exist on the device this whole file is about.
    const z = zonesAt();
    expect(z.filter((q) => q.command).map((q) => q.id).sort())
      .toEqual(['menu', 'overview', 'restart']);
    expect(openAt().filter((q) => q.command).map((q) => q.id).sort())
      .toEqual(['auto', 'full', 'help', 'levels', 'look', 'menu', 'overview', 'restart', 'zoom']);
    // And the pads say which way they go, because a state you cannot see is a
    // state you press twice.
    expect(find(z, 'menu').label).toBe('more');
    expect(find(openAt(), 'menu').label).toBe('close');
    expect(find(z, 'overview').label).toBe('overview');
    expect(find(touchZones(PHONE, { autoThrottle: false, overview: true }), 'overview').label)
      .toBe('ride');
  });

  it('keeps the overview pad in the gutter on every landscape phone', () => {
    // THE REASON `cmdW` IS 12 MM AND NOT 13. Three permanent pads at 13 want
    // 252 px and the gutter on the smallest phone in the table is 250 — two
    // millimetres over, and the whole block falls back to the portrait branch at
    // the top-left, straight back into the band the bike rides through. This is
    // the test that would have caught that, and it is about the third pad rather
    // than about the constant.
    for (const vp of PHONES.filter((v) => v.w > v.h)) {
      const z = zonesAt(vp);
      const ov = find(z, 'overview');
      const lean = find(z, 'leanR');
      const brake = find(z, 'brake');
      expect(ov.y, `${vp.name}`).toBeGreaterThanOrEqual(lean.y);
      expect(ov.x, `${vp.name}`).toBeGreaterThanOrEqual(lean.x + lean.w);
      expect(ov.x + ov.w, `${vp.name}`).toBeLessThanOrEqual(brake.x);
      // All three on ONE row, which is what "in the gutter" is worth.
      expect(ov.y, `${vp.name}`).toBe(find(z, 'restart').y);
    }
  });

  it('does not let the overview pad tile against restart', () => {
    // A mis-press on the pad you reach for mid-run must not be the one that ends
    // the run. `more` is the harmless thing to have between them.
    const z = zonesAt();
    const order = z.filter((q) => q.command).sort((a, b) => a.x - b.x).map((q) => q.id);
    expect(order).toEqual(['restart', 'menu', 'overview']);
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
    for (const vp of PHONES.filter((v) => v.w > v.h)) {
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
    for (const vp of [...PHONES, { name: 'land-short', w: 915, h: 310 }].filter((v) => v.w > v.h)) {
      const z = zonesAt(vp);
      const band = find(z, 'leanL').y - HUD_BAND_PX;
      expect(band, `${vp.name}`).toBeGreaterThan(find(z, 'leanL').h);
    }
  });
});

describe('a TABLET is a different grip, not a bigger phone', () => {
  // THE ARGUMENT, because every number below is it.
  //
  // A phone in landscape is 150 x 60 mm and two thumbs on the bottom corners.
  // The hand wraps the corner, the whole of the glass is inside the thumb's
  // arc, and the bottom corners are where the thumbs already are.
  //
  // A 13" iPad in landscape is 263 x 197 mm and weighs 680 g. Its bottom
  // corners are a foot apart and nobody holds it by them — the slab cantilevers
  // out of your hands — and this game wants gas, lean and flip held at once, so
  // the hands cannot leave to press anything. What people do with a tablet is
  // grip the two SIDE EDGES, fingers behind, thumbs forward. That is the grip
  // this layout serves, and the flat-on-a-table grip comes to the same place:
  // hands arrive at a flat tablet from its left and right, around the middle of
  // the height, and find bottom-corner pads awkward for the same reason.
  //
  // THE BEFORE STATE, which is what this block is a fix for: a tablet got the
  // phone layout, so on a 13" iPad the clusters were 1366 px apart in the
  // bottom corners, and `restart / more / overview` — correctly in the cheap
  // gutter on a phone — sat in the exact horizontal centre of the screen, which
  // on a tablet is the middle of the picture and the line the bike is framed on.

  const mmOf = (vp: { w: number; h: number }): number => pxPerMmFor(vp);

  it('calls a tablet a tablet and a phone a phone, with nothing in between', () => {
    for (const vp of PHONES) expect(gripFor(vp), vp.name).toBe('corner');
    for (const vp of TABLETS) expect(gripFor(vp), vp.name).toBe('edge');
    // THE THRESHOLD IS IN A GAP NOTHING LIVES IN, which is why one number does
    // the job in both orientations. The widest phone hands the page 430 px on
    // its short side (an iPhone Pro Max is 430 x 932); the smallest tablet
    // hands it 744 (an iPad mini is 744 x 1133).
    expect(gripFor({ w: 932, h: 430 })).toBe('corner');
    expect(gripFor({ w: 430, h: 932 })).toBe('corner');
    expect(gripFor({ w: 1133, h: 744 })).toBe('edge');
    expect(TABLET_MIN_PX).toBeGreaterThan(430);
    expect(TABLET_MIN_PX).toBeLessThan(744);
  });

  it('keeps a pad the same PHYSICAL size on a tablet as on a phone', () => {
    // THE WHOLE POINT OF `PX_PER_MM`, and the thing a tablet pass is most
    // tempted to break: the screen is twice the size, so make everything
    // bigger. A thumb is not twice the size. A 21 x 15 mm gas pad is 21 x 15 mm
    // on an iPad too — it just costs 3% of that screen instead of 19%.
    const phone = find(zonesAt({ w: 915, h: 348 }), 'throttle');
    for (const vp of TABLETS) {
      const t = find(zonesAt(vp), 'throttle');
      expect(t.w / mmOf(vp), `${vp.name} w`).toBeCloseTo(phone.w / PX_PER_MM, 6);
      expect(t.h / mmOf(vp), `${vp.name} h`).toBeCloseTo(phone.h / PX_PER_MM, 6);
      // And in PIXELS it is smaller than the phone's, which is the sentence
      // "the millimetre got bigger, not the pad" said as a number: an iPad is
      // 5.2 CSS px per mm against a phone's 6.
      expect(t.w, `${vp.name}`).toBeLessThan(phone.w);
    }
    expect(TABLET_PX_PER_MM).toBeLessThan(PX_PER_MM);
  });

  it('lifts the thumb clusters OFF the bottom, to the grip line up the edge', () => {
    for (const vp of TABLETS) {
      const z = zonesAt(vp);
      const mm = mmOf(vp);
      for (const id of ['leanL', 'leanR', 'brake', 'throttle'] as const) {
        const q = find(z, id);
        // Well clear of the bottom: more than its own height of glass below it,
        // which is exactly the test `thumbInsetPx` uses to decide there is no
        // hand down there.
        expect(vp.h - (q.y + q.h), `${vp.name} ${id}`).toBeGreaterThan(q.h);
        // And still HARD AGAINST THE SIDE EDGE, which is the one thing both
        // grips agree on: that is where the hand is in either of them.
        expect(shortMm(q, mm), `${vp.name} ${id}`).toBeGreaterThanOrEqual(MIN_PAD_MM);
      }
      expect(find(z, 'leanL').x).toBeCloseTo(MM.edge * mm, 6);
      expect(find(z, 'throttle').x + find(z, 'throttle').w).toBeCloseTo(vp.w - MM.edge * mm, 6);
      // The grip line is where the constant says, not wherever the arithmetic
      // drifted to.
      const top0 = Math.max(HUD_BAND_PX, MM.edge * mm);
      const bottom0 = vp.h - MM.edge * mm;
      expect(find(z, 'leanL').y, `${vp.name}`).toBeCloseTo(top0 + (bottom0 - top0) * GRIP_Y, 6);
    }
  });

  it('fits the whole control stack inside ONE THUMB REACH of the grip', () => {
    // The reason the tablet layout does not simply spread to fill a screen that
    // has room for anything. A hand gripping the middle of a 197 mm edge puts
    // its thumb on the glass within about 45 mm; past that is a regrip, and a
    // regrip in this game is a dead run. flip sits one dead strip above the
    // cluster and the commands one clear strip below, and the three together
    // have to come to less than the reach.
    for (const vp of TABLETS) {
      const z = zonesAt(vp);
      const mm = mmOf(vp);
      const top = Math.min(...z.map((q) => q.y));
      const bot = Math.max(...z.map((q) => q.y + q.h));
      expect((bot - top) / mm, `${vp.name}`).toBeLessThanOrEqual(MM.gripReach);
    }
  });

  it('puts the commands UNDER THE LEFT HAND, never in the middle of the screen', () => {
    // On a phone the strip between the clusters is the cheapest glass there is.
    // On a tablet the same strip is 900 px wide and its centre is the middle of
    // the picture — and 130 mm from either hand, which is a regrip rather than
    // a reach. So they hang off the left cluster, against the edge the left
    // hand is already holding. The right thumb never leaves the gas to press
    // `overview`, which is the one command pressed during a run.
    for (const vp of TABLETS) {
      const z = zonesAt(vp);
      const lean = find(z, 'leanL');
      const gas = find(z, 'throttle');
      for (const c of z.filter((q) => q.command)) {
        // Below the cluster, by the same clear margin a phone keeps.
        expect(c.y, `${vp.name} ${c.id}`).toBeGreaterThanOrEqual(lean.y + lean.h);
        // Left-aligned with it, and nowhere near the middle or the right hand.
        expect(c.x, `${vp.name} ${c.id}`).toBeGreaterThanOrEqual(lean.x - 1e-9);
        expect(c.x + c.w, `${vp.name} ${c.id}`).toBeLessThan(vp.w * 0.5);
        expect(c.x + c.w, `${vp.name} ${c.id}`).toBeLessThan(gas.x);
      }
      // The first row starts at the edge rather than centring on it — the hand
      // is the datum, so a short last row centred under a full one would read
      // as a mistake.
      expect(find(z, 'restart').x).toBeCloseTo(lean.x, 6);
    }
  });

  it('leaves the band the bike is framed in completely alone', () => {
    // THE SCREENSHOT THAT MOVED `GRIP_Y` FROM 0.5 TO 0.6. At the middle of the
    // edge the clusters landed exactly on the line the camera rests the bike on
    // — the lean pads and the gas were sitting ON the road it was driving down.
    // The camera puts the bike at 50% of the height on a tablet (`screenBiasFor`
    // returns 0 there, same as a desktop), so 50% of the height is the line
    // nothing may be on.
    for (const vp of TABLETS) {
      for (const menu of [false, true]) {
        const z = zonesAt(vp, false, 'off', menu);
        expect(hitZone(z, vp.w * 0.5, vp.h * 0.5), `${vp.name} menu=${menu}`).toBe(null);
        for (const q of z) {
          if (q.id === 'flip') continue;
          expect(q.y, `${vp.name} ${q.id}`).toBeGreaterThan(vp.h * 0.5);
        }
      }
    }
  });

  it('gives the tablet the SAME layout in portrait as in landscape', () => {
    // A layout that rearranges itself on rotation is two layouts to learn, and
    // a tablet is rotated far more often than a phone playing a game is. The
    // phone cannot keep this promise — portrait there has no gutter, so the
    // commands reflow to a corner — and the tablet can, because the grip does
    // not change when the slab turns: the hands are still on the two side edges.
    for (const [a, b] of [['ipad13-land', 'ipad13-port'], ['ipad11-land', 'ipad11-port']]) {
      const la = TABLETS.find((v) => v.name === a)!;
      const po = TABLETS.find((v) => v.name === b)!;
      const za = zonesAt(la);
      const zp = zonesAt(po);
      expect(zp.map((q) => q.id)).toEqual(za.map((q) => q.id));
      for (const q of za) {
        const r = find(zp, q.id);
        expect(r.w, `${a}->${b} ${q.id} w`).toBeCloseTo(q.w, 6);
        expect(r.h, `${a}->${b} ${q.id} h`).toBeCloseTo(q.h, 6);
        // Same distance in from the edge the hand is on.
        const inA = q.x < la.w / 2 ? q.x : la.w - (q.x + q.w);
        const inB = r.x < po.w / 2 ? r.x : po.w - (r.x + r.w);
        expect(inB, `${a}->${b} ${q.id} x`).toBeCloseTo(inA, 6);
      }
    }
  });

  it('costs the level almost nothing, because the screen got bigger and the thumb did not', () => {
    for (const vp of TABLETS) {
      const covered = zonesAt(vp).reduce((n, q) => n + q.w * q.h, 0) / (vp.w * vp.h);
      expect(covered, `${vp.name}`).toBeLessThan(0.06);
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
    const tall = thumbInsetPx(zonesAt({ w: 915, h: 412 }), 412) / 412;
    expect(tall).toBeLessThan(short);
  });

  it('is ZERO on a tablet, because no hand is anywhere near the bottom', () => {
    // THE CAMERA MUST NOT BE TOLD ABOUT A HAND THAT IS NOT THERE. Under the
    // edge grip the clusters are lifted to the grip line, so the bottom of the
    // glass is clear and the hands are two narrow strips at the far left and
    // right of a screen whose middle the bike is framed in. The old
    // `vpH - min(z.y)` would have answered ~450 px on a 13" iPad — "the bottom
    // half is under a hand" — and `screenBiasFor` would have shoved the bike up
    // under the HUD to dodge it.
    for (const vp of TABLETS) {
      expect(thumbInsetPx(zonesAt(vp), vp.h), vp.name).toBe(0);
    }
    // And it is still the real number on every phone, in both orientations and
    // under a home indicator — that is the half of this that must not move.
    for (const vp of PHONES) {
      const z = zonesAt(vp);
      expect(thumbInsetPx(z, vp.h), vp.name).toBeCloseTo(vp.h - find(z, 'leanL').y, 6);
    }
    const cover: Viewport = { w: 844, h: 390, bottom: 21 };
    const zc = zonesAt(cover);
    expect(thumbInsetPx(zc, 390)).toBeCloseTo(390 - find(zc, 'leanL').y, 6);
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

  it('puts the customiser behind `more`, because a phone had NO way to it', () => {
    // THE BUG THIS PAD FIXES, and it is worth stating as a fact rather than as
    // a feature: the customiser was bound to `Y` and to a button on the
    // leaderboard panel, and `body.touch #board { display: none }` hides that
    // panel. So on a phone there was no way — not a hard way, NONE — to change
    // the paint, the helmet or the engine, and no way to type a name either,
    // because the name lives on that same screen.
    //
    // It is in the drawer rather than on permanent glass by the same test every
    // other command here passes or fails: nobody presses `your bike` during a
    // run.
    for (const vp of VIEWPORTS) {
      const shut = zonesAt(vp);
      const open = openAt(vp);
      expect(shut.some((z) => z.id === 'look'), `${vp.name} shut`).toBe(false);
      const look = open.find((z) => z.id === 'look');
      expect(look, `${vp.name} open`).toBeDefined();
      expect(look?.command).toBe(true);
      expect(look?.label).toBe('your bike');
      // It says what it is in the player's words, it is a command so it
      // contributes no sim bit, and a thumb cannot slide into it on its way
      // somewhere else — a customiser that opened under a sliding thumb would
      // eat a run.
      expect(zoneMask(['look'], false)).toBe(0);
      expect(slideZone(open, 'leanL', (look?.x ?? 0) + 2, (look?.y ?? 0) + 2)).toBe('leanL');
    }
  });

  it('keeps the open drawer to ONE row, which is what keeps it on cheap glass', () => {
    // THE INVARIANT A SIXTH DRAWER ITEM NEARLY BROKE. The drawer is placed in
    // the one strip of a landscape phone that costs nothing — the bottom gutter
    // on a wide one, the band above the clusters on a narrow one — and both of
    // those are ONE PAD TALL. A second row does not make a slightly taller
    // menu: on the 915 x 348 phone it climbs out of the gutter into the band
    // the bike is framed in, and on the 736 x 280 phone it climbs up into the
    // in-canvas HUD, which is the two-HUDs-on-top-of-each-other screenshot this
    // whole file was rewritten from. Adding `your bike` put six 12 mm pads into
    // 429 px of gutter that holds five, so the row shrinks instead of wrapping.
    for (const vp of PHONES.filter((v) => v.w > v.h)) {
      const open = openAt(vp);
      const drawerIds: ZoneId[] = ['levels', 'look', 'full', 'auto', 'zoom', 'help'];
      const rows = new Set(open.filter((z) => drawerIds.includes(z.id)).map((z) => z.y));
      expect(rows.size, `${vp.name} drawer rows`).toBe(1);
      // And it never buys that by going below a deliberate press. 8 mm is the
      // floor for a command; a hold pad's floor is 9 and is a different number
      // for a different reason (a thumb RESTS on those).
      for (const z of open.filter((q) => drawerIds.includes(q.id))) {
        expect(z.w / pxPerMmFor(vp), `${vp.name} ${z.id}`).toBeGreaterThanOrEqual(8 - 1e-9);
      }
    }
  });

  it('has a real pad behind every pad the legend advertises, and advertises every pad', () => {
    // THE SAME BUG AS `A` FOR THE MONTAGE, IN THE OTHER CURRENCY. `keys.ts`
    // exists because an advertised KEY that reaches nothing has now happened
    // three times; its `pad` field is the same claim about a thumb, and until
    // this test there was nothing keeping the two lists in step. It failed the
    // day it was written: `touch.ts` had grown a `your bike` pad and `keys.ts`
    // did not know, so `chrome.ts` — which skips a padless PLAY row on touch —
    // left the newest pad off the one screen whose entire job is teaching the
    // pads.
    //
    // Both directions, because the drift goes both ways: a legend row for a pad
    // that does not exist, and a pad the legend never mentions.
    const labels = new Set<string>();
    for (const vp of VIEWPORTS) {
      for (const menu of [false, true]) {
        for (const overview of [false, true]) {
          for (const auto of [false, true]) {
            for (const fullscreen of ['none', 'off', 'on'] as const) {
              for (const z of touchZones(vp, { autoThrottle: auto, fullscreen, menu, overview })) {
                labels.add(z.label);
              }
            }
          }
        }
      }
    }
    // Forwards: everything `keys.ts` says is a pad is a label some reachable
    // state actually produces. The zoom pad prints its CURRENT value, so it is
    // matched by prefix against `zoomLabel` rather than by a literal that would
    // break the first time the format moved.
    for (const c of [...DRIVE, ...PLAY]) {
      if (!c.pad) continue;
      const hit = labels.has(c.pad) || [...labels].some((l) => l.startsWith(c.pad + ' '));
      expect(hit, `keys.ts advertises a "${c.pad}" pad that no layout produces`).toBe(true);
    }
    // Backwards: every COMMAND a thumb can press is either something `keys.ts`
    // advertises or one of the touch-only commands that has no key to be in
    // that list with. Hold pads are covered by the forward direction; this half
    // is about the drawer, which is where a new pad actually gets added.
    const touchOnly = new Set([
      'more', 'close', 'ride', 'gas: auto', 'gas: held', 'full screen', 'exit full',
    ]);
    const advertised = new Set([...DRIVE, ...PLAY].map((c) => c.pad).filter(Boolean) as string[]);
    for (const vp of VIEWPORTS) {
      for (const z of openAt(vp).filter((q) => q.command)) {
        if (touchOnly.has(z.label) || z.label.startsWith(zoomLabel(1).split(' ')[0] + ' ')) continue;
        expect(advertised, `the ${z.label} pad is not in keys.ts, so the touch legend omits it`)
          .toContain(z.label);
      }
    }
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
