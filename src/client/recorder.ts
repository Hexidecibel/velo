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

// --- every attempt, not just the last one ------------------------------------
//
// The recorder above throws a run away the moment the next one starts. Keeping
// them instead costs about a kilobyte per attempt — the input stream is
// run-length encoded and a minute of riding is a few hundred bytes — and it is
// the one piece of groundwork that turns the Super Meat Boy montage (every
// failed attempt replayed at once alongside the line that worked) from a
// data-model change plus a rendering job into a rendering job.
//
// SESSION-SCOPED, deliberately. Nothing here is written to disk or to
// localStorage: attempts are for the run of play you are having right now, and
// persisting them would be inventing the storage layer that belongs to the
// server milestone. There is no UI for this yet and that is fine.

export type Outcome = 'finished' | 'dead' | 'abandoned';

export interface Attempt {
  /** 1-based, in the order they happened this session. */
  n: number;
  outcome: Outcome;
  replay: Replay;
}

/**
 * Cap on retained attempts. At ~1 KB each this is ~200 KB, which is nothing,
 * and it is high enough that a genuinely long grind on one level still has its
 * whole history. Oldest go first.
 */
export const MAX_ATTEMPTS = 200;

export interface AttemptLog {
  readonly all: readonly Attempt[];
  /** Attempts on one level, oldest first. Keyed by simHash — the level's identity. */
  forLevel(simHash: string): Attempt[];
  add(replay: Replay): Attempt;
  clear(): void;
}

export function createAttemptLog(): AttemptLog {
  let attempts: Attempt[] = [];
  let seq = 0;
  return {
    get all() {
      return attempts;
    },
    forLevel(simHash: string): Attempt[] {
      return attempts.filter((a) => a.replay.simHash === simHash);
    },
    add(replay: Replay): Attempt {
      const a: Attempt = {
        n: ++seq,
        outcome: replay.finished ? 'finished' : replay.dead ? 'dead' : 'abandoned',
        replay,
      };
      attempts.push(a);
      if (attempts.length > MAX_ATTEMPTS) attempts = attempts.slice(attempts.length - MAX_ATTEMPTS);
      return a;
    },
    clear(): void {
      attempts = [];
      seq = 0;
    },
  };
}
