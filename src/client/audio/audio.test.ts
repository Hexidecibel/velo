// AUDIO READS SIM STATE AND NEVER WRITES IT, exactly like the renderer.
//
// That is the whole contract, and it is worth more than every sound in the
// feature: a replay must verify identically on the server whether the player's
// tab was muted, loud, or had no audio device at all. A leaderboard where the
// volume slider can change a time is not a leaderboard.
//
// Three checks, and none of them trusts a comment:
//
//  1. `src/sim/` does not mention audio. The sim imports nothing (isolation.
//     test.ts) so an import edge is already impossible; this catches the other
//     direction of the same mistake — a sim file growing an `if (audio)`.
//  2. The sampler runs against a SimState and a World wrapped in Proxies that
//     THROW on any write. A single stray assignment fails the test with the
//     property name in the message.
//  3. A real run, sampled every frame and fed to the model, produces the same
//     hash chain as the identical run with no audio in it at all.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSim } from '@/sim/sim.ts';
import { parseLevel } from '@/sim/level.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { DEFAULT_SPEC } from '@/sim/spec.ts';
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '@/sim/consts.ts';
import type { SimState } from '@/sim/step.ts';
import type { World } from '@/sim/world.ts';

import { sampleRide } from './sample.ts';
import { createRideModel } from './model.ts';
import { cloneAudio, DEFAULT_AUDIO } from './params.ts';

const SIM_DIR = fileURLToPath(new URL('../../sim/', import.meta.url));
const CLIENT_DIR = fileURLToPath(new URL('../', import.meta.url));
const clientSrc = (name: string): string => readFileSync(join(CLIENT_DIR, name), 'utf8');

/** A busy input stream: every bit, and enough air time to land from. */
function script(n: number): number[] {
  const masks: number[] = [];
  for (let f = 0; f < n; f++) {
    let m = 0;
    if (f % 7 < 5) m |= IN_THROTTLE;
    if (f % 31 === 0) m |= IN_BRAKE;
    if (f % 13 < 4) m |= IN_LEAN_L;
    if (f % 19 < 3) m |= IN_LEAN_R;
    if (f % 61 === 0) m |= IN_FLIP;
    masks.push(m);
  }
  return masks;
}

describe('the sim knows nothing about audio', () => {
  it('has no audio reference anywhere under src/sim', () => {
    const offenders: string[] = [];
    for (const f of readdirSync(SIM_DIR).filter((x) => x.endsWith('.ts')).sort()) {
      const text = readFileSync(join(SIM_DIR, f), 'utf8');
      // Deliberately crude and case-insensitive: the failure this guards
      // against is somebody wiring a sound into the tick, and every spelling of
      // that contains the word.
      for (const m of text.matchAll(/\baudio\b/gi)) offenders.push(`${f}: "${m[0]}"`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('the sampler only reads', () => {
  it('throws nothing when every write into the sim is trapped', () => {
    const level = parseLevel(TEST_LEVEL);
    const sim = createSim(level, DEFAULT_SPEC);
    const masks = script(400);

    const written: string[] = [];
    const guard = <T extends object>(o: T, label: string): T =>
      new Proxy(o, {
        set(_t, k) {
          written.push(`${label}.${String(k)}`);
          throw new Error(`audio wrote ${label}.${String(k)}`);
        },
        defineProperty(_t, k) {
          written.push(`${label}.${String(k)} (defineProperty)`);
          throw new Error(`audio defined ${label}.${String(k)}`);
        },
        get(t, k) {
          const v = (t as Record<string | symbol, unknown>)[k];
          // The typed arrays on SimState are where a write would actually go —
          // `s.wx[0] = ...` never touches the state object itself — so they get
          // the same treatment one level down.
          if (ArrayBuffer.isView(v)) return guard(v as unknown as object, `${label}.${String(k)}`);
          return v;
        },
      });

    const state = guard(sim.state, 'state') as SimState;
    const world = guard(sim.world, 'world') as World;
    const params = cloneAudio(DEFAULT_AUDIO);
    const model = createRideModel(() => params);

    for (const m of masks) {
      sim.advance(m);
      model.update(sampleRide(world, state, DEFAULT_SPEC, m), 1 / 60);
    }
    expect(written).toEqual([]);
  });
});

describe('muting cannot change a run', () => {
  it('produces an identical hash chain with audio and without', () => {
    const level = parseLevel(TEST_LEVEL);
    const masks = script(900);

    const bare = createSim(level, DEFAULT_SPEC);
    const bareHashes: string[] = [];
    for (const m of masks) {
      bare.advance(m);
      bareHashes.push(bare.hash());
    }

    // The same run, with audio sampled and the model stepped every frame —
    // which is the loud path, since a muted player's model is stepped too.
    const loud = createSim(level, DEFAULT_SPEC);
    const params = cloneAudio(DEFAULT_AUDIO);
    const model = createRideModel(() => params);
    const loudHashes: string[] = [];
    let cues = 0;
    for (const m of masks) {
      loud.advance(m);
      cues += model.update(sampleRide(loud.world, loud.state, DEFAULT_SPEC, m), 1 / 60).cues.length;
      loudHashes.push(loud.hash());
    }

    expect(loudHashes).toEqual(bareHashes);
    // And the run was not so dull that the assertion above was vacuous: a
    // silent run past a silent model proves nothing.
    expect(cues).toBeGreaterThan(0);
  });
});

// GHOSTS ARE SILENT, AND THIS IS WHERE THAT IS ENFORCED RATHER THAN HOPED.
//
// An `Appearance` now carries an engine, and an appearance travels with every
// replay — so the tempting thing, and the obviously wrong thing, is for a ghost
// to sound like its owner. The end-of-level montage puts up to twenty-four
// bikes on screen riding at once (see MONTAGE_CAP, which was measured rather
// than guessed). Twenty-four engines would not be atmosphere, it would be a
// wall of noise on top of the one screen in the game that is supposed to be a
// reward. Your bike makes a noise. Everybody else is a picture.
//
// That is a property of the WIRING, not of any function, so it is checked the
// way isolation.test.ts checks its own: by reading the source.
describe('only the player makes a noise', () => {
  const GHOSTLY = ['ghost.ts', 'montage.ts', 'recorder.ts'];

  it('has no audio reference at all in the files that own other bikes', () => {
    const offenders: string[] = [];
    for (const f of GHOSTLY) {
      const text = clientSrc(f);
      // Anti-vacuity: these files are meant to be substantial, and a rename or
      // a deletion must fail this test rather than quietly satisfy it.
      expect(text.length, f).toBeGreaterThan(2000);
      for (const m of text.matchAll(/\baudio\b/gi)) offenders.push(`${f}: "${m[0]}"`);
    }
    expect(offenders).toEqual([]);
  });

  it('builds exactly one audio engine and feeds it exactly one bike', () => {
    const main = clientSrc('main.ts');
    // One context, one model, one synth — there is no second one for a ghost to
    // be given even by accident.
    expect(main.match(/createAudio\(/g)?.length).toBe(1);
    // One sampler call, and the sim it samples is the PLAYER's. A ghost owns
    // its own `Sim` (see ghost.ts), so a second call here with a ghost's world
    // is the shape the mistake would take.
    expect(main.match(/sampleRide\(/g)?.length).toBe(1);
    expect(main).toContain('audio.update(sampleRide(sim.world, sim.state, spec, appliedMask), dtSec)');
    expect(main.match(/audio\.update\(/g)?.length).toBe(1);
  });

  it('only ever tells the synth about the LOCAL player\'s engine', () => {
    // `resolveAppearance` hands out other people's liveries all over this file
    // — for board rows, ghost captions and montage riders — and every one of
    // those now carries an engine id. The one thing that must never happen is
    // one of them reaching `setEngine`.
    const main = clientSrc('main.ts');
    const calls = [...main.matchAll(/audio\.setEngine\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(calls.length).toBeGreaterThan(0);
    for (const arg of calls) expect(arg).toBe('identity.appearance.engine');
  });
});
