// Record-and-replay, locally, on day one.
//
// The plan puts replays in milestone 3. They land here instead because they are
// about thirty lines once the input stream exists, and they validate the entire
// determinism bet IMMEDIATELY rather than at leaderboard launch. Press T, watch
// the run play back, and compare the hash chain. If the physics drift between a
// live run and its replay, that needs to surface now, not in three months when
// a server starts rejecting people's times.
import { buildReplay, verifyReplay } from '@/sim/replay.ts';
import type { Replay, VerifyResult } from '@/sim/replay.ts';
import type { Level } from '@/sim/level.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import type { Sim } from '@/sim/sim.ts';

/** Hash every N input frames: a quarter-second net, ~1 KB per minute of run. */
export const HASH_EVERY = 32;

export interface Recorder {
  readonly frames: number;
  /** Cleared by anything that invalidates the stream — a restart, a spec edit. */
  reset(): void;
  /** Call once per input frame, immediately AFTER sim.advance(mask). */
  capture(mask: number, sim: Sim): void;
  build(level: Level, spec: BikeSpec, sim: Sim): Replay | null;
}

export function createRecorder(): Recorder {
  let masks: number[] = [];
  let hashes: string[] = [];

  return {
    get frames() {
      return masks.length;
    },
    reset(): void {
      masks = [];
      hashes = [];
    },
    capture(mask: number, sim: Sim): void {
      masks.push(mask);
      if (masks.length % HASH_EVERY === 0) hashes.push(sim.hash());
    },
    build(level: Level, spec: BikeSpec, sim: Sim): Replay | null {
      if (masks.length === 0) return null;
      return buildReplay({ level, spec, masks, hashEvery: HASH_EVERY, hashes, state: sim.state });
    },
  };
}

export interface Verified {
  replay: Replay;
  result: VerifyResult;
}

/**
 * Verify before playing back, not after. The point of the exercise is the
 * hash-chain comparison; watching the bike take a different line is the
 * consolation prize.
 */
export function verify(level: Level, spec: BikeSpec, replay: Replay): Verified {
  return { replay, result: verifyReplay(level, spec, replay) };
}
