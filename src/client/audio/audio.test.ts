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
