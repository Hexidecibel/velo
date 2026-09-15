import { describe, it, expect } from 'vitest';
import {
  alpha, CONCRETE, DEFAULT_PALETTE, derivePalette, HAZE, HAZE_A, INVERSION_MIN_CONTRAST,
  levelPalette, LIP_MIN_CONTRAST, LIP_TOP_MIN_CONTRAST, PALETTES, paletteFaults, resolvePalette, wash,
} from './palette.ts';
import { contrast, hsl, hueDist, liftUntil, lum, mixHex, wrapHue } from './color.ts';
import { artStrength, cloneArt, DEFAULT_ART, faceThreshold } from './params.ts';
import { rng, seedFrom, substream } from './rng.ts';

describe('palette', () => {
  it('resolves a named palette and refuses to invent one', () => {
    // A level authored against a palette this build has never heard of must
    // still load and still be playable — but it must NOT silently collapse onto
    // the one hand-authored look, because then an unknown name and the default
    // name produce the same room and twenty levels look alike again. Unknown
    // means "no named palette", and the caller derives one instead.
    expect(resolvePalette(undefined)).toBe(null);
    expect(resolvePalette('concrete')).toBe(CONCRETE);
    expect(resolvePalette('no-such-palette')).toBe(null);
    expect(PALETTES[DEFAULT_PALETTE]).toBe(CONCRETE);
  });

  it('keeps solids dark and air light — the inversion the whole look rests on', () => {
    // If this ever flips, the collision edge stops being the highest-contrast
    // line in the frame and the readability rule is broken at the palette
    // level, where no amount of ink can rescue it.
    const lum = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };
    expect(lum(CONCRETE.solid)).toBeLessThan(lum(CONCRETE.wall[CONCRETE.wall.length - 1]));
    expect(lum(CONCRETE.wall[0])).toBeGreaterThan(lum(CONCRETE.wall[CONCRETE.wall.length - 1]));
    // And the three lips are distinguishable from each other and from the ink.
    const lips = [CONCRETE.lipTop, CONCRETE.lipSide, CONCRETE.lipUnder];
    expect(new Set(lips).size).toBe(3);
    for (const l of lips) expect(lum(l)).toBeGreaterThan(lum(CONCRETE.ink) + 40);
  });

  it('alpha() emits a valid rgba from a hex', () => {
    expect(alpha('#0d0b1a', 0.5)).toBe('rgba(13,11,26,0.5)');
    expect(alpha('#ffffff', 1)).toBe('rgba(255,255,255,1)');
  });

  it('wash() is the haze, done once instead of twice a frame', () => {
    // It has to be arithmetically the same as painting the overlay, because it
    // replaced exactly that: two full-viewport alpha fills per frame over a
    // colour that never changes.
    expect(wash('#000000', [255, 255, 255], 0)).toBe('#000000');
    expect(wash('#000000', [255, 255, 255], 1)).toBe('#ffffff');
    expect(wash('#000000', [100, 200, 40], 0.5)).toBe('#326414');
    // A real one: the haze always darkens and cools the wall ramp.
    const washed = wash(CONCRETE.wall[0], HAZE, HAZE_A);
    expect(washed).toMatch(/^#[0-9a-f]{6}$/);
    expect(washed).not.toBe(CONCRETE.wall[0]);
  });
});

describe('art params', () => {
  it('fades texture out below the play camera, not inside it', () => {
    // The two thresholds sit under the camera's 38 px/m floor on purpose, so
    // the fade only ever fires in the overview. If they crept above it, texture
    // would start dissolving while somebody was driving.
    expect(DEFAULT_ART.artFadeZoom).toBeLessThanOrEqual(38);
    expect(DEFAULT_ART.artOffZoom).toBeLessThan(DEFAULT_ART.artFadeZoom);
    expect(artStrength(DEFAULT_ART, 62)).toBe(1);
    expect(artStrength(DEFAULT_ART, 110)).toBe(1);
    expect(artStrength(DEFAULT_ART, 7)).toBe(0);
    const mid = artStrength(DEFAULT_ART, (DEFAULT_ART.artOffZoom + DEFAULT_ART.artFadeZoom) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('face angle converts to the |ny| a floor needs', () => {
    expect(faceThreshold({ ...DEFAULT_ART, faceAngle: 90 })).toBeCloseTo(1);
    expect(faceThreshold({ ...DEFAULT_ART, faceAngle: 0 })).toBeCloseTo(0);
    expect(faceThreshold({ ...DEFAULT_ART, faceAngle: 30 })).toBeCloseTo(0.5);
  });

  it('clones rather than aliases, so the panel cannot edit the default', () => {
    const c = cloneArt(DEFAULT_ART);
    c.bloom = 0.99;
    expect(DEFAULT_ART.bloom).not.toBe(0.99);
  });
});

describe('seeded rng', () => {
  it('is reproducible, which is the only property that matters here', () => {
    // A level that grew a different set of cracks on every reload would be
    // unreadable as a place.
    const a = rng(1234);
    const b = rng(1234);
    for (let i = 0; i < 64; i++) expect(a()).toBe(b());
  });

  it('stays in [0, 1)', () => {
    const r = rng(9);
    for (let i = 0; i < 4096; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds give different streams', () => {
    const a = rng(1);
    const b = rng(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it('seedFrom is stable across calls and sensitive to the whole string', () => {
    expect(seedFrom('6e559edfc280798c')).toBe(seedFrom('6e559edfc280798c'));
    expect(seedFrom('6e559edfc280798c')).not.toBe(seedFrom('6e559edfc280798d'));
    expect(seedFrom('')).toBeGreaterThanOrEqual(0);
  });

  it('substreams are independent, so adding a layer does not move the others', () => {
    // Layers draw from tagged sub-streams rather than one shared one. If they
    // shared, inserting a new layer would shift every blotch in every level.
    const cracks = substream(42, 'cracks');
    const stains = substream(42, 'stains');
    expect([cracks(), cracks()]).not.toEqual([stains(), stains()]);
    expect(substream(42, 'cracks')()).toBe(substream(42, 'cracks')());
  });
});

describe('colour arithmetic', () => {
  it('hsl round-trips the obvious colours', () => {
    expect(hsl(0, 0, 0)).toBe('#000000');
    expect(hsl(0, 0, 1)).toBe('#ffffff');
    expect(hsl(0, 1, 0.5)).toBe('#ff0000');
    expect(hsl(120, 1, 0.5)).toBe('#00ff00');
    expect(hsl(240, 1, 0.5)).toBe('#0000ff');
    // Hue wraps rather than clamps, which is what lets the generator add
    // offsets without ever normalising.
    expect(hsl(360, 1, 0.5)).toBe(hsl(0, 1, 0.5));
    expect(hsl(-120, 1, 0.5)).toBe(hsl(240, 1, 0.5));
  });

  it('contrast matches the published anchors', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
    expect(lum('#ffffff')).toBeCloseTo(1, 5);
    expect(lum('#000000')).toBeCloseTo(0, 5);
  });

  it('hueDist is the shortest way round', () => {
    expect(hueDist(10, 350)).toBe(20);
    expect(hueDist(0, 180)).toBe(180);
    expect(hueDist(200, 200)).toBe(0);
    expect(wrapHue(-10)).toBe(350);
  });

  it('mixHex interpolates', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('liftUntil reaches the floor from any hue, including the dark ones', () => {
    // Blue is the hard case: fully saturated it tops out at a luminance a
    // saturated yellow passes without trying. If lifting lightness alone were
    // the only lever this would never terminate at a high floor.
    for (const h of [0, 40, 90, 140, 200, 240, 280, 320]) {
      const { hex } = liftUntil(h, 1, 0.3, '#151030', 6);
      expect(contrast(hex, '#151030')).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('derived palettes', () => {
  // The whole point of Phase 2's first half: a level with no style block still
  // gets its own room. That is only safe if the generator CANNOT produce a
  // palette that breaks the readability rule, so this is the assertion that
  // licenses the feature.
  const SAMPLES = 400;

  it('every derived palette keeps the collision lip legible', () => {
    const worst = { lip: Infinity, inv: Infinity };
    for (let i = 0; i < SAMPLES; i++) {
      const p = derivePalette(i * 2654435761 + 7);
      const faults = paletteFaults(p);
      expect(faults, `seed ${i}: ${faults.join('; ')}`).toEqual([]);
      // Against the brightest tone THAT CLASS of lip can sit on: the fill, both
      // patch tones, and its own cel band.
      const worstFor = (band: string): string => {
        let m = p.solid;
        for (const c of [p.patchA, p.patchB, band]) if (lum(c) > lum(m)) m = c;
        return m;
      };
      worst.lip = Math.min(
        worst.lip,
        contrast(p.lipTop, worstFor(p.bandTop)),
        contrast(p.lipSide, worstFor(p.bandSide)),
        contrast(p.lipUnder, worstFor(p.bandUnder)),
      );
      worst.inv = Math.min(worst.inv, contrast(p.solid, wash(p.wall[p.wall.length - 1], HAZE, HAZE_A)));
    }
    expect(worst.lip).toBeGreaterThanOrEqual(LIP_MIN_CONTRAST);
    expect(worst.inv).toBeGreaterThanOrEqual(INVERSION_MIN_CONTRAST);
  });

  it('keeps the three edge classes distinguishable from each other', () => {
    // Not by rejection sampling but BY CONSTRUCTION: the three lip hues are
    // placed at fixed minimum separations. A palette where a ceiling lip and a
    // floor lip read as the same colour would tell the player the wrong thing
    // about which way a surface faces, which is worse than a dull palette.
    for (let i = 0; i < SAMPLES; i++) {
      const p = derivePalette(i * 40503 + 11);
      const hues = [p.lipTop, p.lipSide, p.lipUnder].map(hueOf);
      expect(hueDist(hues[0], hues[1])).toBeGreaterThanOrEqual(40);
      expect(hueDist(hues[1], hues[2])).toBeGreaterThanOrEqual(40);
      expect(hueDist(hues[0], hues[2])).toBeGreaterThanOrEqual(40);
    }
  });

  it('the lit lip is the brightest of the three', () => {
    // The top lip marks rideable ground. It gets the highest floor and it
    // should also simply be the loudest, because that is the surface the player
    // is looking for.
    for (let i = 0; i < 120; i++) {
      const p = derivePalette(i * 97 + 3);
      expect(lum(p.lipTop)).toBeGreaterThan(lum(p.lipUnder));
      let terrainMax = p.solid;
      for (const c of [p.patchA, p.bandTop]) if (lum(c) > lum(terrainMax)) terrainMax = c;
      expect(contrast(p.lipTop, terrainMax)).toBeGreaterThanOrEqual(LIP_TOP_MIN_CONTRAST);
    }
  });

  it('is stable for a seed and different between seeds', () => {
    expect(derivePalette(12345)).toEqual(derivePalette(12345));
    expect(derivePalette(12345).solid).not.toBe(derivePalette(12346).solid);
  });

  it('actually spreads across the hue wheel', () => {
    // A generator that technically varies but lands every level in the same
    // quadrant has not solved the problem it exists to solve. Twelve buckets,
    // and at least eight of them have to be hit by forty samples.
    const buckets = new Set<number>();
    for (let i = 0; i < 40; i++) buckets.add(Math.floor(hueOf(derivePalette(i * 2654435761 + 7).wall[0]) / 30));
    expect(buckets.size).toBeGreaterThanOrEqual(8);
  });

  it('the shipped concrete palette meets the same bar it imposes', () => {
    // The generator's floors are not allowed to be stricter than the palette
    // the whole look was designed around. If this ever fails, the floors drifted
    // away from the thing they were calibrated on.
    expect(paletteFaults(CONCRETE)).toEqual([]);
  });
});

describe('levelPalette', () => {
  it('derives from simHash when the level says nothing', () => {
    const a = levelPalette(null, 'aaaaaaaaaaaaaaaa');
    const b = levelPalette(null, 'bbbbbbbbbbbbbbbb');
    expect(a).toEqual(levelPalette(null, 'aaaaaaaaaaaaaaaa'));
    expect(a.solid).not.toBe(b.solid);
    expect(paletteFaults(a)).toEqual([]);
  });

  it('honours a named palette over the derivation', () => {
    expect(levelPalette({ palette: 'concrete' }, 'aaaa')).toEqual(CONCRETE);
  });

  it('falls back to the derivation for a name it does not know', () => {
    expect(levelPalette({ palette: 'chartreuse-dream' }, 'aaaa')).toEqual(levelPalette(null, 'aaaa'));
  });

  it('applies explicit colour overrides on top of either', () => {
    const p = levelPalette({ palette: 'concrete', colors: { solid: '#123456', lipTop: '#ABCDEF' } }, 'aaaa');
    expect(p.solid).toBe('#123456');
    expect(p.lipTop).toBe('#abcdef');
    expect(p.ink).toBe(CONCRETE.ink);
    // And it must not have mutated the shipped palette in place.
    expect(CONCRETE.solid).toBe('#26214d');
  });

  it('ignores a malformed override rather than refusing to load', () => {
    // A cosmetic hint must never be able to stop a level loading. Somebody
    // typing "blue" instead of "#0000ff" gets the derived colour, not a crash.
    const p = levelPalette({ colors: { solid: 'blue', lipTop: 42, wall: 'x' } } as never, 'aaaa');
    expect(p.solid).toBe(levelPalette(null, 'aaaa').solid);
  });

  it('takes a whole wall ramp override', () => {
    const p = levelPalette({ colors: { wall: ['#ffffff', '#000000'] } } as never, 'aaaa');
    expect(p.wall).toEqual(['#ffffff', '#000000']);
  });
});

/** Hue of a hex, for the spread and separation assertions. */
function hueOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d === 0) return 0;
  let h: number;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return wrapHue(h * 60);
}
