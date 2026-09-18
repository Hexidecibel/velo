// The prop system's two constraints, asserted against the REAL TWENTY LEVELS.
//
// Not against a synthetic fixture, and that is deliberate. The Phase 1 bug was
// not a logic error anybody could have spotted in a unit test of a helper — it
// was a bracketed pipe hung through 19-low-roof's corridor, and the only way to
// catch that class of thing is to run the placement over the levels the user is
// actually playing and check every prop it produces. The levels are plain JSON
// on disk and the planner is pure, so this costs nothing but a `readFileSync`.
//
// If a level is ever added to `levels/` that the prop system handles badly,
// this test fails on that level by name.
//
// IT RUNS OVER EVERY LEVEL, CORE OR NOT, and the count below is only over the
// core ones. Those are two different jobs and conflating them broke this test
// the first time the level editor wrote a file: the constraints below are about
// the prop system and must cover a draft somebody is halfway through authoring,
// while "found all twenty" is about the SHIPPED SET and must not move because
// somebody pressed ^S. `tier` is the field that tells them apart — absent means
// core — and it exists precisely so a question like this has an answer.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseLevel } from '@/sim/level.ts';
import type { Level } from '@/sim/level.ts';
import { CONCRETE, derivePalette, levelPalette } from './palette.ts';
import { contrast, hueDist, hueOf } from './color.ts';
import { deriveVariant, MID_VARIANT } from './variant.ts';
import { faceThreshold, DEFAULT_ART } from './params.ts';
import { buildField, findSites, playSolidFraction, rayGap, worstClearance } from './space.ts';
import {
  decorColors, MURAL_KEEPOUT, planProps, PROP_CEILING_CLEAR, PROP_MIN_CLEAR, propBudget,
} from './props.ts';

const DIR = new URL('../../../levels/', import.meta.url).pathname;
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.json') && /^\d\d-/.test(f)).sort();
const LEVELS: { id: string; level: Level }[] = FILES.map((f) => ({
  id: f.replace(/\.json$/, ''),
  level: parseLevel(JSON.parse(readFileSync(join(DIR, f), 'utf8'))),
}));

const T = faceThreshold(DEFAULT_ART);

function planFor(level: Level): ReturnType<typeof planProps> {
  const P = levelPalette(level.style, level.simHash);
  const V = deriveVariant(level.simHash, 1, level.style);
  return planProps(level, P, V, T);
}

describe('the level set this runs against', () => {
  it('found all twenty core levels', () => {
    const core = LEVELS.filter((l) => l.level.tier === null || l.level.tier === undefined || l.level.tier === 'core');
    expect(core.length).toBe(20);
  });

  it('also covers whatever drafts are in levels/', () => {
    // Not an assertion about the count — there may be none — but a statement
    // that the constraints below are not quietly skipping them.
    expect(LEVELS.length).toBeGreaterThanOrEqual(20);
  });
});

describe('clearance: a prop must be visibly non-collidable', () => {
  // The three classes, and the geometric invariant each one carries. Every prop
  // on every level has to satisfy the one for its class, and the failure
  // message names the level and the prop so a regression is diagnosable rather
  // than merely red.
  for (const { id, level } of LEVELS) {
    it(`${id}`, () => {
      const f = buildField(level);
      const plan = planFor(level);
      for (const p of plan.props) {
        const where = `${id} ${p.kind} (${p.cls}) at ${p.x.toFixed(1)},${p.y.toFixed(1)}`;

        if (p.cls === 'paint') {
          // ENTIRELY INSIDE THE MATERIAL. A thing inside the solid cannot be
          // mistaken for a thing in the air.
          expect(worstClearance(f, p.minX, p.minY, p.maxX, p.maxY), `${where}: not fully solid`).toBe(0);
          continue;
        }

        if (p.cls === 'mural') {
          // Open air all round, so it never crowds a collision edge.
          expect(
            worstClearance(f, p.minX, p.minY, p.maxX, p.maxY),
            `${where}: too close to an edge`,
          ).toBeGreaterThanOrEqual(MURAL_KEEPOUT);
          continue;
        }

        // A fixture: its body sits in air, and the room it sits in is real.
        const k = 0.03;
        expect(
          worstClearance(f, p.minX + k, p.minY + k, p.maxX - k, p.maxY - k),
          `${where}: body intersects solid`,
        ).toBeGreaterThan(0);
        const need = p.kind === 'banner' || p.kind === 'cable' ? PROP_CEILING_CLEAR : PROP_MIN_CLEAR;
        expect(p.clear, `${where}: site too tight`).toBeGreaterThanOrEqual(need);
      }
    });
  }

  it('never puts a thing inside a tight corridor', () => {
    // THE 19-LOW-ROOF TEST, stated as the question the Phase 1 bug failed:
    // measure the corridor the prop is standing in, floor to ceiling, THROUGH
    // the prop itself. A bracketed pipe slung under a two-metre ceiling passes
    // "is its body in air" and fails this, which is the whole difference.
    //
    // Run over all twenty rather than only the two obvious ones: the levels
    // whose lesson is head clearance are where it was noticed, not where the
    // rule stops applying.
    for (const { id, level } of LEVELS) {
      const f = buildField(level);
      for (const p of planFor(level).props) {
        if (p.cls === 'paint') continue;
        const up = rayGap(f, p.x, p.y, 0, 1).gap;
        const down = rayGap(f, p.x, p.y, 0, -1).gap;
        const corridor = up + down;
        expect(
          corridor,
          `${id}: ${p.kind} sits in a ${corridor.toFixed(1)} m corridor at ${p.x.toFixed(1)},${p.y.toFixed(1)}`,
        ).toBeGreaterThanOrEqual(PROP_MIN_CLEAR);
      }
    }
  });

  it('dresses 19 and 20 with paint and murals rather than things', () => {
    // The corollary of the rule, on the two levels the art could make UNFAIR
    // rather than merely uglier: whatever they get, most of it is pigment.
    for (const id of ['19-low-roof', '20-close-quarters']) {
      const level = LEVELS.find((l) => l.id === id)!.level;
      const props = planFor(level).props;
      const fixtures = props.filter((p) => p.cls === 'fixture').length;
      expect(fixtures, `${id}: ${fixtures} of ${props.length} are things`)
        .toBeLessThanOrEqual(props.length / 2);
    }
  });

  it('props do not overlap each other', () => {
    for (const { id, level } of LEVELS) {
      const props = planFor(level).props;
      for (let i = 0; i < props.length; i++) {
        for (let j = i + 1; j < props.length; j++) {
          const a = props[i];
          const b = props[j];
          const apart = a.minX > b.maxX || a.maxX < b.minX || a.minY > b.maxY || a.maxY < b.minY;
          expect(apart, `${id}: ${a.kind} overlaps ${b.kind}`).toBe(true);
        }
      }
    }
  });
});

describe('budget: enforced from the first prop', () => {
  it('never exceeds the level budget', () => {
    for (const { id, level } of LEVELS) {
      const plan = planFor(level);
      expect(plan.props.length, id).toBeLessThanOrEqual(plan.budget);
    }
  });

  it('the budget itself is bounded however big a level gets', () => {
    // A per-level prop system is the first art layer that is not bounded by the
    // screen, so the cap is what keeps it honest. A 428 m level does not get
    // four hundred things to bounding-box test every frame.
    const huge = { minX: 0, maxX: 4000, minY: 0, maxY: 400 } as unknown as Level;
    expect(propBudget(huge, 1.7, 0.1)).toBeLessThanOrEqual(52);
    const tiny = { minX: 0, maxX: 8, minY: 0, maxY: 6 } as unknown as Level;
    expect(propBudget(tiny, 0.3, 0.1)).toBeGreaterThanOrEqual(4);
  });

  it('the density dial actually moves the count', () => {
    const { level } = LEVELS[9];
    const P = levelPalette(level.style, level.simHash);
    const lo = planProps(level, P, { ...MID_VARIANT, propDensity: 0.3 }, T);
    const hi = planProps(level, P, { ...MID_VARIANT, propDensity: 1.7 }, T);
    expect(lo.budget).toBeLessThan(hi.budget);
    expect(lo.props.length).toBeLessThanOrEqual(hi.props.length);
  });

  it('the busy levels are dressed more thinly than the open ones', () => {
    // THE LEVEL-AWARE PART, and the reason it exists: render cost tracks
    // visible solid area, 19 and 20 are the two levels whose frames are mostly
    // material, and they are exactly the levels where the choppiness was
    // reported from play. Props are the newest thing in that frame and the
    // least load-bearing, so they are the first thing that has to justify
    // itself there.
    const frac = (id: string): number => {
      const level = LEVELS.find((l) => l.id === id)!.level;
      return playSolidFraction(buildField(level), level);
    };
    // First: the measurement really does rank them the way the reasoning says.
    // 20 sits near 0.54 and 19 near 0.41, where the open levels are near 0.10.
    for (const busy of ['19-low-roof', '20-close-quarters']) {
      for (const open of ['16-one-way', '17-backswing', '10-cathedral']) {
        expect(frac(busy), `${busy} vs ${open}`).toBeGreaterThan(frac(open));
      }
    }
    // Then: that measurement is what drives the budget. Held on ONE level so
    // area is constant — comparing props per square metre across levels only
    // measures which of them hit the absolute cap.
    const level = LEVELS.find((l) => l.id === '20-close-quarters')!.level;
    expect(propBudget(level, 1, frac('20-close-quarters')))
      .toBeLessThan(propBudget(level, 1, frac('16-one-way')));
  });

  it('a level whose frames are nearly all solid is barely dressed at all', () => {
    // 08-needle measures at 0.88 solid — the extreme case, and the floor on the
    // busy multiplier is what keeps it from going to nothing while still making
    // it the thinnest in the set.
    const level = LEVELS.find((l) => l.id === '08-needle')!.level;
    const frac = playSolidFraction(buildField(level), level);
    expect(frac).toBeGreaterThan(0.7);
    expect(propBudget(level, 1, frac)).toBeLessThan(propBudget(level, 1, 0.1));
  });
});

describe('determinism', () => {
  it('a level is dressed identically every time', () => {
    for (const { id, level } of LEVELS.slice(0, 6)) {
      const a = planFor(level).props;
      const b = planFor(level).props;
      expect(a, id).toEqual(b);
    }
  });

  it('different levels are dressed differently', () => {
    const sig = (l: Level): string => planFor(l).props.map((p) => `${p.kind}@${p.x.toFixed(1)}`).join(',');
    const seen = new Set(LEVELS.map(({ level }) => sig(level)));
    expect(seen.size).toBe(LEVELS.length);
  });
});

describe('prop colours', () => {
  it('never reuse a collision-lip colour', () => {
    // Those three colours mean "this is the boundary and this is which way it
    // faces". A sign in the same yellow as the floor lip spends the player's
    // attention on the wrong thing. Checked by VALUE, because in the shipped
    // concrete palette `yellow` and `lipTop` are literally the same string.
    for (const { id, level } of LEVELS) {
      const P = levelPalette(level.style, level.simHash);
      const lips = new Set([P.lipTop, P.lipSide, P.lipUnder]);
      for (const c of decorColors(P)) expect(lips.has(c), `${id}: ${c}`).toBe(false);
      for (const p of planFor(level).props) {
        for (const c of p.colors) {
          // Ink and cream are structural (outlines, paper) and are allowed even
          // if a palette happens to land one of them near a lip.
          if (c === P.ink || c === P.ink2 || c === P.cream || c === P.steel || c === P.steelD) continue;
          expect(lips.has(c), `${id}: ${p.kind} uses a lip colour`).toBe(false);
        }
      }
    }
  });

  it('drops the lip colours out of the decor set for the hand-authored palette too', () => {
    expect(decorColors(CONCRETE)).not.toContain(CONCRETE.lipTop);
    expect(decorColors(CONCRETE).length).toBeGreaterThan(5);
  });

  it('also drops colours that merely LOOK like a lip colour', () => {
    // Exact-match filtering catches the hand-authored palette, where `yellow`
    // and `lipTop` are the same string. It does not catch a derived palette
    // whose decor green is a few degrees of hue from its floor lip — which
    // looks identical on screen and is the case that actually matters once
    // palettes are generated.
    const near = (c: string, l: string): boolean =>
      l === c || (hueDist(hueOf(c), hueOf(l)) < 22 && contrast(c, l) < 1.35);
    let filtered = 0;
    for (let i = 0; i < 300; i++) {
      const p = derivePalette(i * 7919 + 13);
      const all = [p.cyan, p.magenta, p.lime, p.orange, p.cream, p.teal, p.rust, p.lilac, p.steel, p.red, p.yellow];
      const want = all.filter((c) => ![p.lipTop, p.lipSide, p.lipUnder].some((l) => near(c, l)));
      // Either the confusable ones are gone, or — if that left too few to dress
      // a level with — the whole set is kept, which is the lesser evil.
      expect(decorColors(p), `seed ${i}`).toEqual(want.length >= 5 ? want : all);
      expect(decorColors(p).length, `seed ${i}`).toBeGreaterThanOrEqual(5);
      if (want.length < all.length) filtered++;
    }
    // And the rule is not vacuous: on a real spread of palettes it fires often.
    expect(filtered).toBeGreaterThan(30);
  });
});

describe('sites', () => {
  it('every level offers somewhere to put something', () => {
    for (const { id, level } of LEVELS) {
      const f = buildField(level);
      expect(findSites(level, f, T).length, id).toBeGreaterThan(0);
    }
  });

  it('site order does not depend on polygon order', () => {
    // Placement walks the site list, so if the list depended on the order the
    // polygons happen to be listed in, re-exporting a level would move its
    // dressing. Reversing the polygons must not change the ranks.
    const { level } = LEVELS[3];
    const f = buildField(level);
    const a = findSites(level, f, T).map((s) => s.rank);
    const flipped = { ...level, polys: [...level.polys].reverse() } as Level;
    const b = findSites(flipped, buildField(flipped), T).map((s) => s.rank);
    expect(b).toEqual(a);
  });
});
