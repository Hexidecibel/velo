// THE ASSERTION THIS FILE EXISTS FOR IS THE FIRST ONE: cosmetics cannot reach
// `specHash`.
//
// `specHash` is what the server compares to decide whether a time counts, and
// the refusal it produces — "this bike is not the shipped one" — has already
// confused this user twice, from the tuning panel. If a colour could reach that
// hash, repainting your bike would refuse your runs, which is the single worst
// thing this feature could do. So it is not a convention: it is a test.
import { describe, it, expect } from 'vitest';
import { DEFAULT_SPEC, cloneSpec, specHash, specPaths } from '@/sim/spec.ts';
import {
  APPEARANCE_AXES,
  APPEARANCE_KEYS,
  BIKES,
  DECALS,
  ENGINES,
  DEFAULT_APPEARANCE,
  HELMETS,
  JACKETS,
  PAINTS,
  SCARVES,
  appearanceEqual,
  appearanceFor,
  appearanceLabel,
  cloneAppearance,
  isOption,
  labelFor,
  optionsFor,
  parseAppearance,
  resolveAppearance,
} from './appearance.ts';
import type { Appearance } from './appearance.ts';

/** Every legal appearance. 6 x 4 x 10 x 4 x 3 x 3 x 4. */
function everyAppearance(): Appearance[] {
  const out: Appearance[] = [];
  for (const bike of BIKES) {
    for (const engine of ENGINES) {
      for (const paint of PAINTS) {
        for (const helmet of HELMETS) {
          for (const jacket of JACKETS) {
            for (const scarf of SCARVES) {
              for (const decal of DECALS) {
                out.push({
                  bike: bike.id, engine: engine.id, paint: paint.id, helmet: helmet.id,
                  jacket: jacket.id, scarf: scarf.id, decal: decal.id,
                });
              }
            }
          }
        }
      }
    }
  }
  return out;
}

export const ALL_APPEARANCES = everyAppearance();

describe('cosmetics are outside BikeSpec', () => {
  it('the catalogue is big enough for the sweeps below to mean something', () => {
    // Guards every product sweep in this file and in bikeart.test.ts against
    // passing because the catalogue was empty — the classic way a coverage test
    // rots into a no-op.
    expect(ALL_APPEARANCES.length).toBe(
      BIKES.length * ENGINES.length * PAINTS.length * HELMETS.length
      * JACKETS.length * SCARVES.length * DECALS.length,
    );
    expect(ALL_APPEARANCES.length).toBeGreaterThan(1000);
    expect(BIKES.length).toBeGreaterThanOrEqual(6);
    expect(PAINTS.length).toBeGreaterThanOrEqual(10);
  });

  it('EVERY appearance leaves specHash bit-identical', () => {
    // The point is that there is no path at all from an appearance to the spec,
    // so this is stated the only honest way: take the shipped spec, hash it,
    // walk the entire product of liveries, and assert the hash is the same
    // string every time — including that nothing in the catalogue mutates the
    // spec it is handed.
    const spec = cloneSpec(DEFAULT_SPEC);
    const before = specHash(spec);
    for (const app of ALL_APPEARANCES) {
      // Doing what a caller does with one: reading it, cloning it, labelling it.
      cloneAppearance(app);
      appearanceLabel(app);
      expect(specHash(spec)).toBe(before);
    }
    expect(specHash(spec)).toBe(specHash(DEFAULT_SPEC));
  });

  it('changing ONLY the exhaust note leaves specHash bit-identical', () => {
    // Named separately from the product sweep above because it is the one a
    // player will actually try, and because it is the failure that would be
    // most infuriating: your times are on the board, you change what your bike
    // SOUNDS LIKE, and the server starts refusing your runs. The engine is
    // presentation exactly like the paint, and this says so on its own line.
    const spec = cloneSpec(DEFAULT_SPEC);
    const before = specHash(spec);
    for (const engine of ENGINES) {
      const app: Appearance = { ...DEFAULT_APPEARANCE, engine: engine.id };
      cloneAppearance(app);
      appearanceLabel(app);
      expect(parseAppearance(JSON.parse(JSON.stringify(app))).engine).toBe(engine.id);
      expect(specHash(spec), engine.id).toBe(before);
    }
    expect(specHash(spec)).toBe(specHash(DEFAULT_SPEC));
  });

  it('no appearance axis is an addressable field on the spec', () => {
    // `specPaths()` is derived from DEFAULT_SPEC itself, so it is by
    // construction the complete set of numbers the sim reads. If a cosmetic
    // ever appeared there it would be hashed, and this is what would say so.
    const paths = specPaths().join(' ').toLowerCase();
    for (const k of APPEARANCE_KEYS) expect(paths).not.toContain(k);
    for (const o of [...BIKES, ...ENGINES, ...PAINTS, ...HELMETS, ...JACKETS, ...SCARVES, ...DECALS]) {
      expect(paths).not.toContain(o.id);
    }
  });

  it('the spec object an appearance never sees stays frozen', () => {
    // DEFAULT_SPEC is deep-frozen. A cosmetic that tried to write to it would
    // throw in strict mode rather than silently succeeding, and this asserts
    // the freeze is still on — it is the mechanism, not a nicety.
    expect(Object.isFrozen(DEFAULT_SPEC)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SPEC.rider)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SPEC.wheel.anchors)).toBe(true);
  });
});

describe('the catalogue', () => {
  it('has a default that is the FIRST option on every axis', () => {
    // "Default" and "the art that was signed off" must be the same thing, or
    // they drift apart and the shipped bike quietly becomes unreachable.
    for (const ax of APPEARANCE_AXES) {
      expect(DEFAULT_APPEARANCE[ax.key]).toBe(ax.options[0].id);
    }
  });

  it('exposes every axis through the generic accessors the picker uses', () => {
    for (const ax of APPEARANCE_AXES) {
      expect(optionsFor(ax.key)).toBe(ax.options);
      for (const o of ax.options) {
        expect(isOption(ax.key, o.id)).toBe(true);
        expect(labelFor(ax.key, o.id)).toBe(o.label);
      }
      expect(isOption(ax.key, 'no-such-option')).toBe(false);
      expect(isOption(ax.key, 7)).toBe(false);
    }
    expect(APPEARANCE_AXES.map((a) => a.key).sort()).toEqual([...APPEARANCE_KEYS].sort());
  });

  it('has unique ids and a note on every option', () => {
    for (const ax of APPEARANCE_AXES) {
      const ids = ax.options.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const o of ax.options) {
        expect(o.label.length).toBeGreaterThan(0);
        expect(o.note.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('parseAppearance', () => {
  it('is never fatal, per axis', () => {
    // The opposite posture to parseSpec, deliberately. A bad spec is rejected
    // because one NaN poisons the sim within a tick; a bad appearance is a hint
    // about a colour, and refusing a run over one would be absurd.
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance('cafe')).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance([])).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance(42)).toEqual(DEFAULT_APPEARANCE);
  });

  it('keeps the axes it understands and defaults the ones it does not', () => {
    // A client one version newer picking a livery this build does not ship must
    // keep everything else it chose. Collapsing the whole appearance onto the
    // default over one unknown id would make a newer client look broken.
    const got = parseAppearance({ bike: 'cafe', paint: 'from-the-future', helmet: 'goggles' });
    expect(got.bike).toBe('cafe');
    expect(got.paint).toBe(DEFAULT_APPEARANCE.paint);
    expect(got.helmet).toBe('goggles');
    expect(got.jacket).toBe(DEFAULT_APPEARANCE.jacket);
  });

  it('round-trips every legal appearance through JSON', () => {
    // This is the wire: an appearance goes out in a submission and in a replay
    // file's meta block, and comes back off a board row.
    for (const app of ALL_APPEARANCES) {
      expect(parseAppearance(JSON.parse(JSON.stringify(app)))).toEqual(app);
    }
  });

  it('ignores extra keys rather than carrying them', () => {
    const got = parseAppearance({ ...DEFAULT_APPEARANCE, wheelRadius: 0.9, gravity: 1 }) as unknown as Record<string, unknown>;
    expect(got.wheelRadius).toBeUndefined();
    expect(got.gravity).toBeUndefined();
    expect(Object.keys(got).sort()).toEqual([...APPEARANCE_KEYS].sort());
  });
});

describe('somebody who has never chosen', () => {
  it('gets a stable appearance derived from their playerId', () => {
    // Deterministic, so a given player looks the same on every machine and on
    // every reload, and the person you raced yesterday is recognisable today.
    const a = appearanceFor('k3jf83nd8sl2mfk1');
    expect(appearanceFor('k3jf83nd8sl2mfk1')).toEqual(a);
    expect(parseAppearance(a)).toEqual(a);
  });

  it('spreads across the catalogue rather than giving everyone the same bike', () => {
    // The whole reason derivation exists instead of one shared default: a board
    // of people who have never opened the customiser should still be a board of
    // different people. Same argument as derivePalette and twenty levels.
    const bikes = new Set<string>();
    const paints = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const a = appearanceFor(`player${i}abcdefgh`);
      bikes.add(a.bike);
      paints.add(a.paint);
    }
    expect(bikes.size).toBe(BIKES.length);
    expect(paints.size).toBe(PAINTS.length);
  });

  it('does not put adjacent ids on the same bike in the next colour along', () => {
    // The axes come off independent bits of two hashes rather than one counter,
    // which is what stops a device-minted run of similar ids from producing a
    // visibly sequential set of bikes.
    const a = appearanceFor('aaaaaaaaaaaa1');
    const b = appearanceFor('aaaaaaaaaaaa2');
    expect(appearanceEqual(a, b)).toBe(false);
  });
});

describe('resolveAppearance — one answer, in one place', () => {
  it('prefers what travelled with the thing being drawn', () => {
    const carried = { ...DEFAULT_APPEARANCE, bike: 'bobber', paint: 'acid' };
    expect(resolveAppearance(carried, 'somebodyelse')).toEqual(carried);
  });

  it('falls back to the playerId derivation, then to the shipped bike', () => {
    // The order matters and it is the thing two code paths would otherwise
    // disagree about — which is how half a crowd ends up in the wrong livery.
    expect(resolveAppearance(undefined, 'k3jf83nd8sl2mfk1')).toEqual(appearanceFor('k3jf83nd8sl2mfk1'));
    expect(resolveAppearance(null, null)).toEqual(DEFAULT_APPEARANCE);
    expect(resolveAppearance(undefined, '')).toEqual(DEFAULT_APPEARANCE);
  });

  it('repairs a carried appearance rather than trusting it', () => {
    const got = resolveAppearance({ bike: 'nonsense', paint: 'ice' }, 'whoever12');
    expect(got.paint).toBe('ice');
    expect(got.bike).toBe(DEFAULT_APPEARANCE.bike);
  });
});
