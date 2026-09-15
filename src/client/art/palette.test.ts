import { describe, it, expect } from 'vitest';
import { alpha, CONCRETE, DEFAULT_PALETTE, HAZE, HAZE_A, PALETTES, resolvePalette, wash } from './palette.ts';
import { artStrength, cloneArt, DEFAULT_ART, faceThreshold } from './params.ts';
import { rng, seedFrom, substream } from './rng.ts';

describe('palette', () => {
  it('falls back to the default rather than failing', () => {
    // A level authored against a palette this build has never heard of must
    // still load and still be playable. An art hint is not a dependency.
    expect(resolvePalette(undefined)).toBe(CONCRETE);
    expect(resolvePalette('concrete')).toBe(CONCRETE);
    expect(resolvePalette('no-such-palette')).toBe(CONCRETE);
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
