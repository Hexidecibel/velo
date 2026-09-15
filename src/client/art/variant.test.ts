// Per-level look parameters, and the stroke alphabet the signage is drawn with.
import { describe, it, expect } from 'vitest';
import { deriveVariant, MID_VARIANT, variantKey } from './variant.ts';
import type { StyleVariant } from './variant.ts';
import { ALPHABET, scrawl, textOutline } from './letters.ts';
import { rng } from './rng.ts';

const KEYS = Object.keys(MID_VARIANT) as (keyof StyleVariant)[];

describe('style variant', () => {
  it('at variety 0 every level is identical — which is Phase 1, exactly', () => {
    // The A/B for the whole feature. If this ever drifts, "did per-level
    // variety earn its place" stops being answerable by flipping one slider.
    for (const h of ['aaaa', 'bbbb', 'cccc', 'deadbeefdeadbeef']) {
      expect(deriveVariant(h, 0)).toEqual(MID_VARIANT);
    }
  });

  it('is stable for a level and different between levels', () => {
    expect(deriveVariant('aaaa', 1)).toEqual(deriveVariant('aaaa', 1));
    expect(deriveVariant('aaaa', 1)).not.toEqual(deriveVariant('bbbb', 1));
  });

  it('variety scales the SPREAD rather than the value', () => {
    // Which is what makes the dial honest: half variety is half as far from the
    // midpoint, not a different random draw.
    const half = deriveVariant('aaaa', 0.5);
    const full = deriveVariant('aaaa', 1);
    for (const k of KEYS) {
      if (k === 'lumBands' || k === 'wedgeCount' || k === 'parallaxLayers') continue; // rounded
      const dh = Math.abs(half[k] - MID_VARIANT[k]);
      const df = Math.abs(full[k] - MID_VARIANT[k]);
      expect(dh, k).toBeLessThanOrEqual(df + 1e-9);
    }
  });

  it('stays inside its limits at any variety, and for any seed', () => {
    // The limits are not taste, they are the numbers that keep the generator
    // from being unfair or expensive: a panel grid finer than about 0.9 m is
    // noise at play zoom, and a hatch pitch below 0.14 m doubles a per-frame
    // stroke count on the level that can least afford it.
    for (let i = 0; i < 300; i++) {
      const v = deriveVariant(`level-${i}`, 1);
      expect(v.panelW).toBeGreaterThanOrEqual(0.9);
      expect(v.hatchPitch).toBeGreaterThanOrEqual(0.14);
      expect(v.lumBands).toBeGreaterThanOrEqual(4);
      expect(v.wedgeCount).toBeGreaterThanOrEqual(0);
      expect(v.propDensity).toBeGreaterThan(0);
      for (const k of KEYS) expect(Number.isFinite(v[k]), `${k} on ${i}`).toBe(true);
    }
  });

  it('actually varies more than hue would: the non-colour axes move', () => {
    // A palette swap alone still reads as the same room repainted. This is the
    // assertion that the OTHER half exists.
    const panels = new Set<number>();
    const hatches = new Set<number>();
    const bands = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const v = deriveVariant(`level-${i}`, 1);
      panels.add(Math.round(v.panelW * 8));
      hatches.add(Math.round(v.hatchPitch * 30));
      bands.add(v.lumBands);
    }
    // Not a huge range on purpose — the panel-pitch floor is a frame-budget
    // number — but twenty levels still land on a dozen different coursings.
    expect(panels.size).toBeGreaterThan(8);
    expect(hatches.size).toBeGreaterThan(6);
    expect(bands.size).toBeGreaterThan(2);
  });

  it('bounds the expensive half of every density range by what the level can afford', () => {
    // The variant's point is that some rooms are grainier than others, and the
    // grain is what was asked for. But render cost tracks visible solid area,
    // so the same "denser" draw costs almost nothing on a level whose frames
    // are a tenth solid and the entire remaining budget on one whose frames are
    // half solid — and the second is the level the choppiness was reported on.
    //
    // So a busy level can still be SPARSER than its neighbour, which is where
    // the variety lives, but it cannot be denser.
    for (let i = 0; i < 200; i++) {
      const open = deriveVariant(`level-${i}`, 1, null, 0.1);
      const busy = deriveVariant(`level-${i}`, 1, null, 0.6);
      // Same seed, so any difference is the affordability clamp and nothing else.
      expect(busy.patchPerM2, `${i}`).toBeLessThanOrEqual(open.patchPerM2 + 1e-9);
      expect(busy.crackPerM2, `${i}`).toBeLessThanOrEqual(open.crackPerM2 + 1e-9);
      expect(busy.stampPerM2, `${i}`).toBeLessThanOrEqual(open.stampPerM2 + 1e-9);
      // Pitch is the other way round: finer is dearer, so a busy level's pitch
      // can only be coarser.
      expect(busy.panelW, `${i}`).toBeGreaterThanOrEqual(open.panelW - 1e-9);
      expect(busy.hatchPitch, `${i}`).toBeGreaterThanOrEqual(open.hatchPitch - 1e-9);
    }
  });

  it('leaves an open level exactly as the generator drew it', () => {
    // The clamp must not be a global tax. A level with room to spare gets the
    // full range, which is the whole reason for making this level-aware rather
    // than simply narrowing the ranges for everybody.
    for (let i = 0; i < 60; i++) {
      expect(deriveVariant(`level-${i}`, 1, null, 0.1)).toEqual(deriveVariant(`level-${i}`, 1));
    }
  });

  it('an explicit style.variant wins, and a malformed one is ignored', () => {
    const v = deriveVariant('aaaa', 1, { variant: { panelW: 3.5, hatchPitch: 'wide', nonsense: 1 } });
    expect(v.panelW).toBe(3.5);
    expect(v.hatchPitch).toBe(deriveVariant('aaaa', 1).hatchPitch);
    // And an out-of-range override is clamped rather than obeyed: a cosmetic
    // hint must not be able to hand the bake a pitch that costs the frame.
    expect(deriveVariant('aaaa', 1, { variant: { hatchPitch: 0.0001 } }).hatchPitch).toBeGreaterThanOrEqual(0.14);
    expect(deriveVariant('aaaa', 1, { variant: { panelW: 1e9 } }).panelW).toBeLessThanOrEqual(4.2);
  });

  it('variantKey separates two variants that differ', () => {
    expect(variantKey(deriveVariant('aaaa', 1))).toBe(variantKey(deriveVariant('aaaa', 1)));
    expect(variantKey(deriveVariant('aaaa', 1))).not.toBe(variantKey(deriveVariant('bbbb', 1)));
  });
});

describe('the stroke alphabet', () => {
  it('covers what the generator can ask it to draw', () => {
    // The signage strings, the words and the level numerals all come from fixed
    // lists in props.ts. Every character in them has to exist here, because an
    // unknown one is silently DROPPED and a half-spelled word on a wall is a
    // bug that does not look like one.
    const used = 'VELOGORIDEFASTNBRAKESDITAULNPHMC0123456789 !';
    for (const ch of used) expect(ALPHABET, `missing ${ch}`).toContain(ch);
  });

  it('lays a string out left to right with a sane width', () => {
    const L = textOutline('VELO', 0, 0, { size: 1 });
    expect(L.strokes.length).toBeGreaterThan(3);
    expect(L.width).toBeGreaterThan(3);
    expect(L.width).toBeLessThan(5);
    expect(L.minY).toBeGreaterThanOrEqual(-0.1);
    expect(L.maxY).toBeLessThanOrEqual(1.01);
  });

  it('centres when asked', () => {
    const l = textOutline('GO', 0, 0, { size: 1, align: 'left' });
    const c = textOutline('GO', 0, 0, { size: 1, align: 'center' });
    expect(c.minX).toBeLessThan(l.minX);
    expect((c.minX + c.maxX) / 2).toBeCloseTo(0, 1);
  });

  it('drops unknown characters rather than drawing a box', () => {
    // A tofu box in the middle of a wall piece is a bug that looks like a bug;
    // a missing letter just looks like worn paint.
    const a = textOutline('VE~LO', 0, 0, { size: 1 });
    const b = textOutline('VELO', 0, 0, { size: 1 });
    expect(a.strokes.length).toBe(b.strokes.length);
  });

  it('stacks vertically for a banner', () => {
    const v = textOutline('VELO', 0, 0, { size: 1, vertical: true });
    expect(v.maxY - v.minY).toBeGreaterThan(3);
    expect(v.maxX - v.minX).toBeLessThan(1.6);
  });

  it('is empty for an empty string rather than NaN', () => {
    const L = textOutline('', 0, 0, { size: 1 });
    expect(L.strokes).toEqual([]);
    expect(Number.isFinite(L.minX)).toBe(true);
  });

  it('scales linearly with size', () => {
    const a = textOutline('VELO', 0, 0, { size: 1 });
    const b = textOutline('VELO', 0, 0, { size: 3 });
    expect(b.width / a.width).toBeCloseTo(3, 5);
  });

  it('every glyph fits its box, so a word never blows its own bounds', () => {
    for (const ch of ALPHABET) {
      if (ch === ' ') continue;
      const L = textOutline(ch, 0, 0, { size: 1 });
      // Q's tail and a couple of others reach a hair outside on purpose.
      expect(L.minY, ch).toBeGreaterThan(-0.15);
      expect(L.maxY, ch).toBeLessThan(1.05);
      expect(L.minX, ch).toBeGreaterThan(-0.05);
      expect(L.maxX, ch).toBeLessThan(0.85);
    }
  });

  it('scrawl is seeded, bounded and finite', () => {
    // It is deliberately illegible — a tag is read as a gesture, not as words —
    // but it still has to stay in the box the placement measured.
    const pts = scrawl(0, 0, 3, 1, 4, rng(7));
    expect(pts.length).toBeGreaterThan(8);
    for (const [x, y] of pts) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThan(-2);
      expect(x).toBeLessThan(4);
      expect(y).toBeGreaterThan(-1);
      expect(y).toBeLessThan(2.5);
    }
    expect(scrawl(0, 0, 3, 1, 4, rng(7))).toEqual(scrawl(0, 0, 3, 1, 4, rng(7)));
    expect(scrawl(0, 0, 3, 1, 4, rng(8))).not.toEqual(scrawl(0, 0, 3, 1, 4, rng(7)));
  });
});
