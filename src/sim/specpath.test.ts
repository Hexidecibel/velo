// Dotted paths, and the override layering `bin/spec` and live tune are built on.
//
// The two properties worth guarding are both about NOT silently doing nothing:
// a path that does not name a real field must be refused rather than created,
// and an override must layer per-field rather than replacing the spec — those
// are the only two behaviours under which `bin/spec set gravity 9.2` and a
// hand-tuned panel can both be in force at once.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPEC,
  applySpecOverride,
  cloneSpec,
  diffSpec,
  getSpecPath,
  setSpecPath,
  specHash,
  specPaths,
} from './spec.ts';

describe('spec paths', () => {
  it('enumerates every numeric field, including inside arrays', () => {
    const paths = specPaths();
    expect(paths).toContain('gravity');
    expect(paths).toContain('suspension.reboundDamping');
    expect(paths).toContain('rider.inertialTransferBrake');
    expect(paths).toContain('rider.inertialTransferDrive');
    // Array elements are addressed by index, with no bracket syntax to quote
    // in a shell.
    expect(paths).toContain('wheel.anchors.1.x');
    expect(paths).toContain('chassis.colliders.0.r');
    expect(new Set(paths).size).toBe(paths.length);
    // Every enumerated path must actually read back.
    for (const p of paths) expect(typeof getSpecPath(DEFAULT_SPEC, p)).toBe('number');
  });

  it('covers exactly what specHash covers', () => {
    // If a field can change a result it must be addressable, and if it is
    // addressable it must change the hash — otherwise `bin/spec set` can move
    // the bike without moving its identity, which would quietly break replay
    // verification.
    for (const p of specPaths()) {
      const s = cloneSpec(DEFAULT_SPEC);
      const before = specHash(s);
      expect(setSpecPath(s, p, (getSpecPath(s, p) as number) + 7.5)).toBe(true);
      expect(specHash(s)).not.toBe(before);
    }
  });

  it('refuses to create a path rather than writing a field nothing reads', () => {
    const s = cloneSpec(DEFAULT_SPEC);
    // The typo that motivated this: it would otherwise report success and
    // leave somebody wondering why the bike did not change.
    expect(setSpecPath(s, 'rider.intertialTransfer', 1)).toBe(false);
    expect(setSpecPath(s, 'nope', 1)).toBe(false);
    expect(setSpecPath(s, 'rider', 1)).toBe(false);
    expect(setSpecPath(s, 'wheel.anchors.9.x', 1)).toBe(false);
    expect(setSpecPath(s, 'gravity.x', 1)).toBe(false);
    expect(specHash(s)).toBe(specHash(DEFAULT_SPEC));
  });

  it('refuses a non-finite value', () => {
    const s = cloneSpec(DEFAULT_SPEC);
    expect(setSpecPath(s, 'gravity', NaN)).toBe(false);
    expect(setSpecPath(s, 'gravity', Infinity)).toBe(false);
    expect(s.gravity).toBe(DEFAULT_SPEC.gravity);
  });
});

describe('applySpecOverride', () => {
  it('layers per field and leaves everything else alone', () => {
    const base = cloneSpec(DEFAULT_SPEC);
    base.suspension.reboundDamping = 210;
    const { spec, applied, unknown } = applySpecOverride(base, { gravity: 9.2 });
    expect(applied).toEqual(['gravity']);
    expect(unknown).toEqual([]);
    expect(spec.gravity).toBe(9.2);
    // The hand-tuned value underneath survives: that is the whole precedence
    // rule, and without it live tune and the panel cannot both be usable.
    expect(spec.suspension.reboundDamping).toBe(210);
  });

  it('does not mutate the base', () => {
    const base = cloneSpec(DEFAULT_SPEC);
    applySpecOverride(base, { gravity: 1 });
    expect(base.gravity).toBe(DEFAULT_SPEC.gravity);
  });

  it('reports unknown keys instead of applying them', () => {
    const r = applySpecOverride(DEFAULT_SPEC, { gravity: 9, nonsense: 3, rider: { bogus: 1 } });
    expect(r.applied).toEqual(['gravity']);
    expect(r.unknown).toEqual(['nonsense', 'rider.bogus']);
    expect(specHash(r.spec)).not.toBe(specHash(DEFAULT_SPEC));
  });

  it('accepts a whole spec as an override', () => {
    // `bin/spec load` hands it one; it must parse identically to a one-field
    // override, because a spec IS a complete override.
    const tuned = cloneSpec(DEFAULT_SPEC);
    tuned.drive.maxTorque = 140;
    tuned.gravity = 9;
    const r = applySpecOverride(DEFAULT_SPEC, JSON.parse(JSON.stringify(tuned)));
    expect(r.unknown).toEqual([]);
    expect(specHash(r.spec)).toBe(specHash(tuned));
  });

  it('an empty override is the base, exactly', () => {
    const r = applySpecOverride(DEFAULT_SPEC, {});
    expect(specHash(r.spec)).toBe(specHash(DEFAULT_SPEC));
    expect(r.applied).toEqual([]);
  });
});

describe('diffSpec', () => {
  it('names every field that moved, and nothing else', () => {
    const a = cloneSpec(DEFAULT_SPEC);
    const b = cloneSpec(DEFAULT_SPEC);
    b.gravity = 9.2;
    b.rider.inertialTransferBrake = 0.45;
    expect(diffSpec(a, b)).toEqual([
      { path: 'gravity', from: 10, to: 9.2 },
      { path: 'rider.inertialTransferBrake', from: 0, to: 0.45 },
    ]);
    expect(diffSpec(a, a)).toEqual([]);
  });
});

describe('what an override CANNOT reach', () => {
  // The freeze rule, asserted rather than trusted. `bin/spec` exists to layer a
  // runtime tuning override; it must not be able to change the physics version
  // or the committed default, because the bike the user signed off on has to be
  // exactly the bike they play tomorrow while a level set is being judged
  // against it.

  it('cannot address anything outside BikeSpec', () => {
    // SIM_REV, the level, the tick order and the rates are all elsewhere and
    // none of them is a field on a spec, so there is no path that names them.
    const paths = specPaths();
    for (const forbidden of ['simRev', 'SIM_REV', 'rev', 'DT', 'dt', 'ticksPerFrame', 'simHash']) {
      expect(paths).not.toContain(forbidden);
      expect(setSpecPath(cloneSpec(DEFAULT_SPEC), forbidden, 1)).toBe(false);
    }
  });

  it('never mutates the spec it was handed', () => {
    // The presets are shared module state and, unlike DEFAULT_SPEC, are not
    // frozen. If layering an override mutated its base, `bin/spec show` would
    // drift a little further from the shipped bike on every invocation — and
    // silently, because it prints the drifted value quite happily.
    const base = cloneSpec(DEFAULT_SPEC);
    const before = specHash(base);
    const r = applySpecOverride(base, { gravity: 1, rider: { inertialTransferBrake: 2 }, wheel: { anchors: [{ x: -9 }, {}] } });
    expect(specHash(base)).toBe(before);
    expect(specHash(r.spec)).not.toBe(before);
    // ...including on the paths it actually wrote.
    expect(base.gravity).toBe(DEFAULT_SPEC.gravity);
    expect(base.wheel.anchors[0].x).toBe(DEFAULT_SPEC.wheel.anchors[0].x);
  });

  it('THROWS rather than quietly failing if anything aims a write at DEFAULT_SPEC', () => {
    // Belt and braces, and the belt turns out to be stronger than expected:
    // the shipped constants are deep-frozen and every module here is an ES
    // module, so assignment is in strict mode and a write to them throws
    // instead of being silently dropped. That is the behaviour worth pinning —
    // a no-op write would leave a caller believing it had changed the bike.
    expect(Object.isFrozen(DEFAULT_SPEC)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SPEC.suspension)).toBe(true);
    expect(() => setSpecPath(DEFAULT_SPEC, 'gravity', 99)).toThrow(/read only/);
    expect(DEFAULT_SPEC.gravity).toBe(10);
    // Which is unreachable in practice, because the layering clones first.
    expect(() => applySpecOverride(DEFAULT_SPEC, { gravity: 99 })).not.toThrow();
    expect(DEFAULT_SPEC.gravity).toBe(10);
  });
});
