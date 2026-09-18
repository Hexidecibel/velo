// THE GUARDRAIL, AS ARITHMETIC.
//
// Hand someone a free colour wheel and they will pick dark grey on a dark
// level, make themselves invisible, and correctly report the game as unfair.
// The answer here is the one palette.ts already uses for the collision lip: the
// floor is not hoped for, it is solved for — and it is asserted across the
// whole product of what a player can pick and what a level can look like,
// rather than across the combinations somebody happened to try.
//
// Three families of assertion, and the second is the one that licenses the
// feature:
//
//   1. THE SHAPES stay inside the bike's own silhouette, so no bike type and no
//      accessory can mislead about where the collision is. This is the muffler
//      lesson — a pipe poking out behind the rear tyre — as a sweep rather than
//      as a comment.
//   2. THE COLOURS clear their floors for EVERY bike x accessory x colourway x
//      level palette. Level palettes are derived per level, so a livery that
//      reads on 03 may vanish on 11; the sweep is against the whole set plus
//      four hundred generated ones.
//   3. THE PHYSICS DO NOT MOVE. Six silhouettes, one specHash, one head radius.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseLevel } from '@/sim/level.ts';
import { DEFAULT_SPEC, cloneSpec, specHash } from '@/sim/spec.ts';
import { BIKES, DECALS, HELMETS, JACKETS, PAINTS, SCARVES } from '@/shared/appearance.ts';
import type { Appearance } from '@/shared/appearance.ts';
import { CONCRETE, derivePalette, levelPalette, paletteFaults } from './palette.ts';
import type { Palette } from './palette.ts';
import { contrast, hueDist, lum } from './color.ts';
import {
  ALL_HELMETS, ALL_JACKETS, ALL_SCARVES, ALL_SCHEMES, ALL_SHAPES,
  BIKE_MAX_LUM, BIKE_MIN_CONTRAST, DECOR_MIN_CONTRAST, FRAME_BOX, HEAD_HUE_APART,
  HEAD_MIN_CONTRAST, HEAD_MIN_LUM, HELMET_MAX_EXTENT, LEVEL_SLOTS, TYRE_MARGIN,
  bikeFaults, bikeShape, bodyBox, catalogueGaps, headDrawRadius, helmetStyle,
  jacketCut, makeLook, outsideSilhouette, plateNumber, resolveBikeColors,
  scarfStyle, schemeFaults, slotsUsed, worstTerrainLum,
} from './bikeart.ts';
import type { BikeColors, Pt } from './bikeart.ts';

const SPEC = cloneSpec(DEFAULT_SPEC);

/**
 * Every legal appearance: 6 x 10 x 4 x 3 x 3 x 4.
 *
 * The `engine` axis is pinned rather than swept, and that is the assertion
 * rather than a shortcut: an engine is a NOISE and draws nothing, so a sweep
 * over it here would multiply the work by four and could not fail.
 */
const ALL: Appearance[] = [];
for (const bike of BIKES) {
  for (const paint of PAINTS) {
    for (const helmet of HELMETS) {
      for (const jacket of JACKETS) {
        for (const scarf of SCARVES) {
          for (const decal of DECALS) {
            ALL.push({
              bike: bike.id, engine: 'road', paint: paint.id, helmet: helmet.id,
              jacket: jacket.id, scarf: scarf.id, decal: decal.id,
            });
          }
        }
      }
    }
  }
}

/**
 * THE PALETTES A BIKE CAN ACTUALLY BE RIDDEN ON.
 *
 * The twenty shipped levels, because those are the rooms that exist; CONCRETE,
 * because it is the hand-authored palette the whole look was designed around
 * and the floors must not have drifted away from it; and generated ones,
 * because levels 21 and up will have palettes nobody has looked at. The
 * generator's own guarantee is asserted in palette.test.ts — this file leans on
 * it and re-checks that the palettes it sweeps are legal, so a bike failure can
 * never be blamed on a palette that was already broken.
 */
const LEVEL_DIR = new URL('../../../levels/', import.meta.url).pathname;
const SHIPPED: { id: string; palette: Palette }[] = readdirSync(LEVEL_DIR)
  .filter((f) => /^\d\d-.*\.json$/.test(f))
  .sort()
  .map((f) => {
    const level = parseLevel(JSON.parse(readFileSync(join(LEVEL_DIR, f), 'utf8')));
    return { id: f.slice(0, 2), palette: levelPalette(level.style, level.simHash) };
  });

const DERIVED: { id: string; palette: Palette }[] = [];
for (let i = 0; i < 400; i++) DERIVED.push({ id: `seed${i}`, palette: derivePalette(i * 2654435761 + 7) });

/** What the full-product sweep runs against: the real rooms plus extremes. */
const SWEEP_PALETTES = [
  { id: 'concrete', palette: CONCRETE },
  ...SHIPPED,
  ...DERIVED.slice(0, 24),
];

/** Resolving a livery is a dozen bisections, and the product is thousands wide. */
const memo = new Map<string, BikeColors>();
function colorsFor(app: Appearance, paletteId: string, P: Palette): BikeColors {
  // Colour depends only on the COLOURWAY and the palette — the shape axes pick
  // which slots get drawn, never what colour they are — so the cache key is
  // those two. The product sweep below is still a real product: every
  // appearance is walked, and each one's OWN used slots are checked.
  const key = `${app.paint}|${paletteId}`;
  let hit = memo.get(key);
  if (!hit) {
    hit = resolveBikeColors(app, P);
    memo.set(key, hit);
  }
  return hit;
}

describe('the shapes stay inside the bike', () => {
  it('has six bike types to check, so the sweep is not vacuous', () => {
    expect(ALL_SHAPES.length).toBe(BIKES.length);
    expect(ALL_SHAPES.length).toBeGreaterThanOrEqual(6);
    expect(ALL.length).toBeGreaterThan(1000);
  });

  it('the catalogue and the art cover each other exactly', () => {
    // A list you have to remember to update is a list that is wrong. Adding an
    // option without its art — or art nobody is offered — fails here rather
    // than silently drawing the default and looking like it worked.
    expect(catalogueGaps()).toEqual([]);
    expect(ALL_HELMETS.length).toBe(HELMETS.length);
    expect(ALL_JACKETS.length).toBe(JACKETS.length);
    expect(ALL_SCARVES.length).toBe(SCARVES.length);
    expect(ALL_SCHEMES.length).toBe(PAINTS.length);
  });

  it('NO drawn point of any bike type overhangs the collision shape', () => {
    // THE MUFFLER LESSON, AS A SWEEP. The exhaust tip used to sit at x = -0.90
    // while the rear tyre's back edge is at -0.85, so the pipe stuck out behind
    // the wheel and it was the only part of the bike that did — reported from
    // play as "why does the bike have a weird long muffler?". With six types
    // there are six ways to do that again, and this is what stops them.
    const bad: string[] = [];
    const check = (id: string, what: string, x: number, y: number, r = 0): void => {
      if (outsideSilhouette(SPEC, x, y, r)) bad.push(`${id} ${what} (${x.toFixed(2)}, ${y.toFixed(2)}) r${r}`);
    };
    const line = (id: string, what: string, a: Pt, b: Pt, w: number): void => {
      // Sampled along its length, not just at the ends: a run between two legal
      // points can still bulge out of the box in between.
      for (let i = 0; i <= 12; i++) {
        const u = i / 12;
        check(id, what, a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, w / 2);
      }
    };
    const a0 = SPEC.wheel.anchors[0];
    const a1 = SPEC.wheel.anchors[1];
    for (const s of ALL_SHAPES) {
      for (const [x, y] of s.body) check(s.id, 'body', x, y);
      line(s.id, 'swingarm', s.swing, [a0.x, a0.y], s.swingW);
      line(s.id, 'fork', s.fork, [a1.x, a1.y], s.forkW);
      if (s.lamp) check(s.id, 'lamp', s.lamp.x, s.lamp.y, s.lamp.r);
      if (s.pipe) {
        const p = s.pipe;
        // The quadratic, sampled, then the straight run to the tip.
        for (let i = 0; i <= 12; i++) {
          const u = i / 12;
          const iv = 1 - u;
          const x = iv * iv * p.from[0] + 2 * iv * u * p.ctrl[0] + u * u * p.mid[0];
          const y = iv * iv * p.from[1] + 2 * iv * u * p.ctrl[1] + u * u * p.mid[1];
          check(s.id, 'pipe', x, y, p.w / 2);
        }
        line(s.id, 'pipe-run', p.mid, p.tip, p.w);
        check(s.id, 'pipe-tip', p.tip[0], p.tip[1], p.tipR);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the silhouette rule actually refuses something', () => {
    // Guards the sweep above against passing because the predicate says yes to
    // everything — which is how a check like this rots.
    expect(outsideSilhouette(SPEC, 0, 0.2)).toBe(false);
    expect(outsideSilhouette(SPEC, -0.6, -0.15)).toBe(false); // inside the rear tyre
    expect(outsideSilhouette(SPEC, -1.2, -0.14)).toBe(true); // the old -0.9 muffler, worse
    expect(outsideSilhouette(SPEC, 0, 0.9)).toBe(true); // a spire above the frame
    expect(outsideSilhouette(SPEC, -0.6, -0.15, SPEC.wheel.radius + TYRE_MARGIN + 0.01)).toBe(true);
  });

  it('every bodywork accent stays behind the clip that makes it safe', () => {
    // Tank, seat, vent and decals are drawn under a clip on the body path, so
    // they are exempt from the silhouette sweep BY CONSTRUCTION — a clipped
    // fill cannot add a pixel to an outline. What is asserted instead is that
    // they are in the right ballpark, which catches a nonsense entry that a
    // clip would silently swallow.
    for (const s of ALL_SHAPES) {
      const bb = bodyBox(s);
      expect(bb.maxX).toBeGreaterThan(bb.minX);
      expect(bb.maxY).toBeGreaterThan(bb.minY);
      expect(bb.minX).toBeGreaterThanOrEqual(FRAME_BOX.minX);
      expect(bb.maxX).toBeLessThanOrEqual(FRAME_BOX.maxX);
      for (const shape of [s.tank, s.seat, s.vent ?? []]) {
        for (const [x, y] of shape) {
          expect(Math.abs(x)).toBeLessThan(1.2);
          expect(Math.abs(y)).toBeLessThan(1.2);
        }
      }
    }
  });

  it('every wheel style keeps SPIN visible', () => {
    // Spin is a real state variable and traction cannot be tuned, or read,
    // without seeing it. A style with neither spokes nor a disc mark would draw
    // a wheel that looks identical however fast it is turning.
    for (const s of ALL_SHAPES) {
      expect(s.wheel.spokes > 0 || s.wheel.disc, `${s.id} has nothing that turns`).toBe(true);
      expect(s.wheel.rim).toBeGreaterThan(s.wheel.hub);
      expect(s.wheel.rim).toBeLessThan(1);
    }
  });

  it('helmet art is declared inside the head, and the head never grows', () => {
    // THE ONE LIE THIS RENDERER IS NOT ALLOWED TO TELL. The head is the death
    // sphere; a helmet that looked generous would misrepresent the kill volume.
    // Every helmet is drawn under a clip on the circle at `headDrawRadius`, and
    // `headDrawRadius` is a function precisely so that a per-helmet outset is a
    // failing test rather than a code review.
    for (const h of HELMETS) {
      expect(headDrawRadius(SPEC, h.id)).toBe(SPEC.rider.headRadius);
    }
    expect(headDrawRadius(SPEC, 'a-helmet-from-the-future')).toBe(SPEC.rider.headRadius);
    for (const h of ALL_HELMETS) {
      const pts: number[] = [];
      for (const [x, y, w, hh] of h.lens) pts.push(Math.hypot(x, y), Math.hypot(x + w, y + hh));
      for (const [x, y, w, hh] of h.band) pts.push(Math.hypot(x, y), Math.hypot(x + w, y + hh));
      for (const [x, y, r] of h.studs) pts.push(Math.hypot(x, y) + r);
      for (const d of pts) expect(d, `${h.id} declares art ${d.toFixed(2)} head radii out`).toBeLessThanOrEqual(HELMET_MAX_EXTENT);
      expect(Math.abs(h.shadeY)).toBeLessThanOrEqual(1);
    }
  });

  it('falls back to a real shape for an id it has never heard of', () => {
    // A newer client's livery must draw SOMETHING rather than throwing inside a
    // leaderboard, for the same reason parseAppearance is not fatal.
    expect(bikeShape('from-the-future').id).toBe(ALL_SHAPES[0].id);
    expect(helmetStyle('x').id).toBe(ALL_HELMETS[0].id);
    expect(jacketCut('x').id).toBe(ALL_JACKETS[0].id);
    expect(scarfStyle('x').id).toBe(ALL_SCARVES[0].id);
  });
});

describe('the colourways, by construction', () => {
  it('place the helmet hue clear of the wheel and the frame', () => {
    // Contrast ratio is luminance-only and would call a yellow and a blue at the
    // same luminance identical, which is exactly wrong for "is that a third
    // wheel or the rider's head". So the separation is a HUE rule, satisfied by
    // construction rather than by rejection sampling — the same move palette.ts
    // makes for the three lip hues.
    const faults = ALL_SCHEMES.flatMap(schemeFaults);
    expect(faults).toEqual([]);
    for (const s of ALL_SCHEMES) {
      expect(hueDist(s.head.h, s.wheel.h)).toBeGreaterThanOrEqual(HEAD_HUE_APART);
      expect(hueDist(s.head.h, s.frame.h)).toBeGreaterThanOrEqual(HEAD_HUE_APART);
    }
  });

  it('are ten visibly different liveries rather than ten samples of one', () => {
    const hues = ALL_SCHEMES.map((s) => s.frame.h);
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        expect(hueDist(hues[i], hues[j]), `${ALL_SCHEMES[i].id}/${ALL_SCHEMES[j].id}`).toBeGreaterThan(8);
      }
    }
  });
});

describe('the contrast floor holds across the whole product', () => {
  it('sweeps palettes that are themselves legal', () => {
    // If a palette were already broken, a bike failure on it would be somebody
    // else's bug. This makes the premise explicit.
    for (const { id, palette } of SWEEP_PALETTES) {
      expect(paletteFaults(palette), `palette ${id}`).toEqual([]);
      expect(worstTerrainLum(palette)).toBeLessThan(0.2);
    }
    expect(SWEEP_PALETTES.length).toBeGreaterThanOrEqual(20);
  });

  it('EVERY bike x accessory x livery x level palette is legible', () => {
    // The sweep the whole feature rests on. Not a sample: every one of the
    // thousands of appearances, against every shipped room and a set of
    // generated ones, and each appearance is checked on the slots IT draws.
    const bad: string[] = [];
    let checked = 0;
    for (const { id, palette } of SWEEP_PALETTES) {
      for (const app of ALL) {
        const c = colorsFor(app, id, palette);
        const faults = bikeFaults(c, palette);
        if (faults.length) bad.push(`${id} ${app.bike}/${app.paint}: ${faults.join('; ')}`);
        // And the slots this particular combination actually puts on screen are
        // all slots the floors cover — which is what makes the shape axes part
        // of the guarantee rather than decoration next to it.
        for (const slot of slotsUsed(app)) {
          if (!(slot in c)) bad.push(`${id} ${app.bike}: draws "${slot}", which has no resolved colour`);
        }
        checked++;
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
    expect(checked).toBe(SWEEP_PALETTES.length * ALL.length);
  });

  it('holds on four hundred generated palettes, for the levels not written yet', () => {
    // Level palettes are DERIVED per level, so levels 21 and up will have rooms
    // nobody has looked at. Colour depends on the colourway and the palette, so
    // this axis is swept exhaustively rather than sampled.
    const bad: string[] = [];
    for (const { id, palette } of DERIVED) {
      for (const paint of PAINTS) {
        const app: Appearance = { bike: 'scrambler', engine: 'road', paint: paint.id, helmet: 'visor', jacket: 'bomber', scarf: 'trail', decal: 'stripe' };
        const faults = bikeFaults(resolveBikeColors(app, palette), palette);
        if (faults.length) bad.push(`${id} ${paint.id}: ${faults.join('; ')}`);
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it('reports the measured worst case, so a regression shows as a number falling', () => {
    let worstPart = Infinity;
    let worstHead = Infinity;
    let worstVisor = Infinity;
    for (const { id, palette } of SWEEP_PALETTES) {
      for (const paint of PAINTS) {
        const app: Appearance = { bike: 'scrambler', engine: 'road', paint: paint.id, helmet: 'visor', jacket: 'bomber', scarf: 'trail', decal: 'number' };
        const c = colorsFor(app, id, palette);
        const worstHex = [palette.solid, palette.patchA, palette.patchB, palette.bandTop, palette.bandSide, palette.bandUnder]
          .reduce((m, x) => (lum(x) > lum(m) ? x : m), palette.solid);
        for (const slot of LEVEL_SLOTS) worstPart = Math.min(worstPart, contrast(c[slot], worstHex));
        worstHead = Math.min(worstHead, contrast(c.head, worstHex));
        worstVisor = Math.min(worstVisor, contrast(c.visor, c.head));
      }
    }
    expect(worstPart).toBeGreaterThanOrEqual(BIKE_MIN_CONTRAST);
    expect(worstHead).toBeGreaterThanOrEqual(HEAD_MIN_CONTRAST);
    expect(worstVisor).toBeGreaterThanOrEqual(DECOR_MIN_CONTRAST);
  });

  it('keeps the death sphere the brightest thing on the bike, always', () => {
    // The shipped art already made this call when it put the wheel hubs in ink
    // rather than cream — "three identical pale circles out of the one thing
    // that must never be mistaken for anything". A helmet colour is a new way
    // to undo it, so it is a law rather than a preference.
    for (const { id, palette } of SWEEP_PALETTES) {
      for (const paint of PAINTS) {
        const app: Appearance = { bike: 'mono', engine: 'road', paint: paint.id, helmet: 'bucket', jacket: 'vest', scarf: 'none', decal: 'checks' };
        const c = colorsFor(app, id, palette);
        expect(lum(c.head), `${id}/${paint.id}`).toBeGreaterThanOrEqual(HEAD_MIN_LUM);
        for (const slot of LEVEL_SLOTS) {
          expect(lum(c[slot]), `${id}/${paint.id} ${slot}`).toBeLessThan(lum(c.head));
          // A hair of slack: `atLum` bisects to the nearest reachable 8-bit
          // triple, which can land a thousandth the wrong side of an exact
          // ceiling. The floor above it is the rule; this is the preference.
          expect(lum(c[slot])).toBeLessThanOrEqual(BIKE_MAX_LUM + 0.01);
        }
      }
    }
  });

  it('a bike colour never merges into its own ink outline', () => {
    // The ink outline is what separates the bike from the LIGHT half of the
    // frame — air is light by law, so the pale wall is what a bike is usually
    // drawn against and the shipped cream bodywork reads there at contrast 1.3.
    // That only works while the outline is darker than the part it outlines.
    for (const { id, palette } of SWEEP_PALETTES) {
      for (const paint of PAINTS) {
        const app: Appearance = { bike: 'cafe', engine: 'road', paint: paint.id, helmet: 'goggles', jacket: 'racer', scarf: 'short', decal: 'none' };
        const c = colorsFor(app, id, palette);
        for (const slot of LEVEL_SLOTS) {
          expect(contrast(c[slot], c.ink), `${id}/${paint.id} ${slot}`).toBeGreaterThanOrEqual(BIKE_MIN_CONTRAST);
        }
        expect(contrast(c.head, c.ink)).toBeGreaterThanOrEqual(HEAD_MIN_CONTRAST);
      }
    }
  });

  it('bikeFaults actually refuses something', () => {
    // Guards every sweep above against passing because the predicate says yes
    // to everything.
    const c = resolveBikeColors({ bike: 'scrambler', engine: 'road', paint: 'ember', helmet: 'visor', jacket: 'bomber', scarf: 'trail', decal: 'none' }, CONCRETE);
    expect(bikeFaults(c, CONCRETE)).toEqual([]);
    const grey: BikeColors = { ...c, frame: '#201c33' };
    expect(bikeFaults(grey, CONCRETE).join(' ')).toMatch(/frame/);
    const paleWheel: BikeColors = { ...c, wheel: '#ffffff' };
    expect(bikeFaults(paleWheel, CONCRETE).join(' ')).toMatch(/death sphere/);
  });

  it('resolves deterministically, so two machines draw the same bike', () => {
    for (const paint of PAINTS) {
      const app: Appearance = { bike: 'trials', engine: 'road', paint: paint.id, helmet: 'halfshell', jacket: 'vest', scarf: 'trail', decal: 'stripe' };
      expect(resolveBikeColors(app, CONCRETE)).toEqual(resolveBikeColors(app, CONCRETE));
    }
  });

  it('the same livery differs between levels, which is the point of solving it per level', () => {
    const app: Appearance = { bike: 'moto', engine: 'road', paint: 'ice', helmet: 'visor', jacket: 'bomber', scarf: 'trail', decal: 'none' };
    const a = resolveBikeColors(app, SHIPPED[0].palette);
    const b = resolveBikeColors(app, SHIPPED[SHIPPED.length - 1].palette);
    // The tyre and the ink come straight off the palette, so those must differ;
    // the player-chosen slots may or may not, because they are lifted to a floor
    // that many palettes share.
    expect(a.ink).not.toBe(b.ink);
    expect(a.tyre).not.toBe(b.tyre);
  });
});

describe('the physics do not move', () => {
  it('EVERY bike type resolves to the same specHash', () => {
    // The structural version of "nothing that will impact gameplay". A future
    // contributor who thinks a bobber should have a longer wheelbase gets a
    // failing test rather than a leaderboard full of refused runs.
    const base = specHash(DEFAULT_SPEC);
    for (const app of ALL) {
      const spec = cloneSpec(DEFAULT_SPEC);
      // Everything the renderer does with a spec, for this appearance.
      makeLook(app, CONCRETE, 'someplayerid');
      bikeShape(app.bike);
      headDrawRadius(spec, app.helmet);
      outsideSilhouette(spec, 0, 0, 0);
      expect(specHash(spec)).toBe(base);
    }
  });

  it('the art reads the spec and can never construct or mutate one', () => {
    // bikeart.ts may know the SHAPE of a BikeSpec — it needs the wheel radius
    // and the anchors to frame a portrait and to sweep the silhouette — but it
    // must never import a way to build or edit one. A type-only import cannot.
    // Comments stripped first, exactly as purity.test.ts does over src/sim, so
    // prose ABOUT specHash does not fail a test about reaching it.
    const src = readFileSync(new URL('./bikeart.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const specImports = src.match(/^import.*'@\/sim\/spec\.ts';$/gm) ?? [];
    expect(specImports.length).toBeGreaterThan(0);
    for (const line of specImports) expect(line.startsWith('import type ')).toBe(true);
    for (const banned of ['cloneSpec', 'parseSpec', 'setSpecPath', 'specHash', 'DEFAULT_SPEC']) {
      expect(src).not.toContain(banned);
    }
  });

  it('the number plate is cosmetic and stable', () => {
    expect(plateNumber('k3jf83nd8sl2mfk1')).toBe(plateNumber('k3jf83nd8sl2mfk1'));
    expect(Number(plateNumber('abcdefgh'))).toBeGreaterThanOrEqual(1);
    expect(Number(plateNumber('abcdefgh'))).toBeLessThanOrEqual(99);
    const look = makeLook({ bike: 'moto', engine: 'road', paint: 'acid', helmet: 'visor', jacket: 'bomber', scarf: 'none', decal: 'number' }, CONCRETE, 'abcdefgh');
    expect(look.plate).toBe(plateNumber('abcdefgh'));
    const plain = makeLook({ bike: 'moto', engine: 'road', paint: 'acid', helmet: 'visor', jacket: 'bomber', scarf: 'none', decal: 'none' }, CONCRETE, 'abcdefgh');
    expect(plain.plate).toBe('');
  });
});
