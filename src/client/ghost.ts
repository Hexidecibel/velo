// Ghosts: somebody else's run, riding beside you.
//
// A ghost is a SECOND, INDEPENDENT SIM. Not a recorded trajectory played back,
// not a path sampled from the leaderboard — the same `createSim(level, spec)`
// the player is riding, fed the ghost's own input stream, one frame for one
// frame. That is only affordable because a replay is ~1 KB of run-length-encoded
// buttons rather than megabytes of positions, and because the sim was built
// cheap to instantiate and steppable headlessly for the solver that has not
// been written yet.
//
// THE GHOST IS STRICTLY READ-ONLY WITH RESPECT TO THE PLAYER, and this is
// asserted rather than hoped:
//
//   * It owns its own `Sim`, so its own `SimState` and its own `World`. The
//     world is built by `createWorld`, which CLONES the spec, so a ghost cannot
//     even reach the object the player's bike is made of.
//   * The level is shared and never written — the grid is built from it and the
//     tick only reads it.
//   * Nothing in this file touches the player's recorder, the player's sim or
//     the player's state. It cannot change the replay you are recording, and
//     `ghost.test.ts` proves it by hashing a run with and without a ghost
//     attached and asserting the chains are identical.
//
// A ghost whose physics do not match CANNOT BE SHOWN, and says so. Playing a
// rev-2 input stream under rev-3 physics would draw a bike taking a line that
// nobody ever rode, labelled with somebody's name and time. That is worse than
// an empty screen, and it is exactly the failure the whole rev mechanism exists
// to prevent.
import { createSim } from '@/sim/sim.ts';
import type { Sim } from '@/sim/sim.ts';
import { decodeInputs } from '@/sim/replay.ts';
import type { Replay } from '@/sim/replay.ts';
import { SIM_REV } from '@/sim/rev.ts';
import type { Level } from '@/sim/level.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import { specHash } from '@/sim/spec.ts';
import { copyState } from '@/sim/step.ts';
import type { SimState } from '@/sim/step.ts';
import { interpolate } from './render.ts';
import type { Pose } from './render.ts';

/** Which ghost, in the order the selector offers them. */
export type GhostKind = 'off' | 'above' | 'pb' | 'wr';

export const GHOST_KINDS: GhostKind[] = ['off', 'above', 'pb', 'wr'];

export const GHOST_LABELS: Record<GhostKind, string> = {
  off: 'no ghost',
  // The default, and it is the default because it is the one that makes you
  // ride harder. A world record is a number; the person one place ahead of you
  // is a race you can win tonight. Trials figured this out and it holds here.
  above: 'the run just above you',
  pb: 'your personal best',
  wr: 'the world best',
};

export interface Compat {
  ok: boolean;
  /** One legible line, empty when ok. Shown to the player, not logged. */
  reason: string;
}

/**
 * Everything that must line up before a ghost may be drawn. Separate from
 * `createGhost` so the refusal can be rendered without constructing anything,
 * and so the reasons are testable in plain node.
 */
export function ghostCompat(level: Level, spec: BikeSpec, replay: Replay): Compat {
  if (replay.simRev !== SIM_REV) {
    return {
      ok: false,
      reason:
        `that time was set under sim rev ${replay.simRev} and this build is rev ${SIM_REV}. ` +
        'The physics changed between them, so replaying those inputs here would draw a line nobody rode. ' +
        'It cannot be shown as a ghost.',
    };
  }
  if (replay.simHash !== level.simHash) {
    return { ok: false, reason: `that time is for a different level (${replay.simHash}).` };
  }
  const cur = specHash(spec);
  if (replay.specHash !== cur) {
    return {
      ok: false,
      reason:
        `that time was set on bike spec ${replay.specHash} and you are riding ${cur}. ` +
        'A ghost on a different bike is a different run — turn live tune off, or reset the tuning panel, to see it.',
    };
  }
  return { ok: true, reason: '' };
}

export interface GhostMeta {
  kind: GhostKind;
  /** "Hexi", or whatever they called themselves. Presentation only. */
  name: string;
  replayId: string;
  /** 1-based, when the entry came off a board. */
  rank: number | null;
}

export interface Ghost {
  readonly meta: GhostMeta;
  /** Total input frames in the ghost's run. */
  readonly frames: number;
  /** How many have been played. */
  readonly at: number;
  /** True once the ghost's run has ended — it stops, it does not vanish. */
  readonly done: boolean;
  /** Ticks the ghost's run took, for the label. */
  readonly timeTicks: number;
  /** Which way the ghost's own bike is facing. NOT the player's. */
  readonly facing: number;
  /** True once the ghost's own sim reports the run over. */
  readonly finished: boolean;
  /** Where the ghost's chassis is, for the gap readout. Read-only, obviously. */
  readonly x: number;
  readonly y: number;
  advance(): void;
  reset(): void;
  pose(alpha: number): Pose;
}

/**
 * Build a ghost. Throws on an incompatible replay rather than quietly drawing
 * something wrong — call `ghostCompat` first; the UI does.
 */
export function createGhost(level: Level, spec: BikeSpec, replay: Replay, meta: GhostMeta): Ghost {
  const compat = ghostCompat(level, spec, replay);
  if (!compat.ok) throw new Error(compat.reason);

  const masks = decodeInputs(replay.inputs);
  // Its own sim, built from the same level and spec the player is riding.
  // `createWorld` clones the spec, so this shares no mutable object with the
  // player's bike; the level is read-only to both.
  const sim: Sim = createSim(level, spec);
  let prev: SimState = sim.snapshot();
  let at = 0;

  return {
    meta,
    frames: masks.length,
    timeTicks: replay.timeTicks,
    get at() {
      return at;
    },
    get done() {
      return at >= masks.length;
    },
    get facing() {
      return sim.state.facing;
    },
    get finished() {
      return sim.state.finished;
    },
    get x() {
      return sim.state.px;
    },
    get y() {
      return sim.state.py;
    },

    advance(): void {
      if (at >= masks.length) return;
      // Copied BEFORE the step, exactly as the player's frame does it, so the
      // renderer interpolates between two real consecutive states rather than
      // shimmering between one state and itself.
      prev = copyState(sim.state);
      sim.advance(masks[at++]);
    },

    reset(): void {
      sim.reset();
      prev = sim.snapshot();
      at = 0;
    },

    pose(alpha: number): Pose {
      // A finished ghost interpolates against itself, which pins it at its final
      // pose. Stopping where it stopped is the point: the cluster of ghosts
      // halted at the hard part IS the story, and a ghost that vanished at its
      // death tick would erase it.
      return interpolate(prev, sim.state, at >= masks.length ? 1 : alpha);
    },
  };
}

// --- choosing one ------------------------------------------------------------

export interface GhostCandidate {
  kind: GhostKind;
  entry: { replayId: string; name: string; timeTicks: number; playerId: string } | null;
  rank: number | null;
}

/**
 * Resolve a requested ghost against what the board actually offers, falling
 * back in the order that keeps a ghost on screen when one is possible.
 *
 * The default chain is `above` -> `pb` -> nothing, which is what the brief
 * asks for: race the person in front when there is one, your own best
 * otherwise. `wr` is offered but never fallen back to — if somebody asked for
 * the run above them and there is nobody above them, silently showing them a
 * world record forty seconds faster is discouraging rather than motivating.
 *
 * `above` for a player with NO time is the slowest entry on the board, which is
 * the right answer and not a degenerate one: with no time everybody is ahead of
 * you, and the nearest of them is the one you can actually catch. The server
 * computes it, because the client only ever receives the top N.
 */
export function chooseGhost(
  want: GhostKind,
  board: { above: GhostCandidate['entry']; you: GhostCandidate['entry']; best: GhostCandidate['entry']; rank: number | null },
): { kind: GhostKind; entry: GhostCandidate['entry']; rank: number | null } {
  if (want === 'off') return { kind: 'off', entry: null, rank: null };
  if (want === 'wr') return { kind: 'wr', entry: board.best, rank: board.best ? 1 : null };
  if (want === 'pb') return { kind: 'pb', entry: board.you, rank: board.rank };
  // want === 'above'
  if (board.above) return { kind: 'above', entry: board.above, rank: board.rank === null ? null : board.rank - 1 };
  if (board.you) return { kind: 'pb', entry: board.you, rank: board.rank };
  return { kind: 'above', entry: null, rank: null };
}
