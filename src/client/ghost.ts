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
import type { Appearance } from '@/shared/appearance.ts';

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
  // The fastest HUMAN run. The board has a TAS category and this is not it —
  // see the note above `chooseGhost`.
  wr: 'the fastest human run',
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
  /**
   * THEIR BIKE, NOT YOURS — and this is the payoff the whole customisation
   * feature is for. A ghost in the player's own colours is a second copy of
   * yourself; a ghost in the colours the person who set it chose is a person.
   *
   * Presentation only, like the name, and resolved by `resolveAppearance` so a
   * run from before any of this existed still shows up as somebody rather than
   * as a clone.
   */
  appearance: Appearance;
}

/**
 * ONE INPUT STREAM, RIDING ITS OWN SIM. The primitive under both a leaderboard
 * ghost and a montage rider.
 *
 * It exists as its own thing because the montage needs fifty of them and a
 * montage rider has no name, no rank and no replay id — everything `GhostMeta`
 * carries. Giving each of the fifty a synthetic meta would have been inventing
 * a fiction to satisfy a type; splitting the primitive out instead means the
 * isolation argument above is made ONCE and both callers inherit it.
 */
export interface Rider {
  /** Total input frames in the run. */
  readonly frames: number;
  /** How many have been played. */
  readonly at: number;
  /** True once the run has ended — it stops, it does not vanish. */
  readonly done: boolean;
  /** Which way this bike is facing. Its own, never the player's. */
  readonly facing: number;
  /** True once this rider's own sim reports the run finished. */
  readonly finished: boolean;
  /** True once this rider's own sim reports the head hit something. */
  readonly dead: boolean;
  /** Where the chassis is. Read-only, obviously. */
  readonly x: number;
  readonly y: number;
  advance(): void;
  reset(): void;
  pose(alpha: number): Pose;
}

/**
 * Build a rider from a decoded input stream.
 *
 * NO COMPATIBILITY CHECK HERE, deliberately: this takes masks, not a replay, so
 * it has nothing to check them against. Every caller that starts from a
 * `Replay` must run `ghostCompat` first — `createGhost` does, and `montage.ts`
 * filters on exactly the same three fields before it gets this far.
 */
export function createRider(level: Level, spec: BikeSpec, masks: readonly number[]): Rider {
  // Its own sim, built from the same level and spec the player is riding.
  // `createWorld` clones the spec, so this shares no mutable object with the
  // player's bike; the level is read-only to both.
  const sim: Sim = createSim(level, spec);
  let prev: SimState = sim.snapshot();
  let at = 0;

  return {
    frames: masks.length,
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
    get dead() {
      return sim.state.dead;
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
      // A finished rider interpolates against itself, which pins it at its final
      // pose. Stopping where it stopped is the point: the cluster of bikes
      // halted at the hard part IS the story, and one that vanished at its
      // death tick would erase it.
      return interpolate(prev, sim.state, at >= masks.length ? 1 : alpha);
    },
  };
}

export interface Ghost extends Rider {
  readonly meta: GhostMeta;
  /** Ticks the ghost's run took, for the label. */
  readonly timeTicks: number;
}

/**
 * Build a ghost. Throws on an incompatible replay rather than quietly drawing
 * something wrong — call `ghostCompat` first; the UI does.
 */
export function createGhost(level: Level, spec: BikeSpec, replay: Replay, meta: GhostMeta): Ghost {
  const compat = ghostCompat(level, spec, replay);
  if (!compat.ok) throw new Error(compat.reason);
  const rider = createRider(level, spec, decodeInputs(replay.inputs));
  // Delegated property by property rather than spread. Every live field on a
  // Rider is a GETTER, and `{ ...rider }` would copy the values they happened
  // to have at construction — a ghost frozen at frame 0 that still claimed to
  // be advancing. Ghost is Rider plus two constants, and this is the whole of
  // the difference.
  return {
    meta,
    timeTicks: replay.timeTicks,
    frames: rider.frames,
    get at() {
      return rider.at;
    },
    get done() {
      return rider.done;
    },
    get facing() {
      return rider.facing;
    },
    get finished() {
      return rider.finished;
    },
    get dead() {
      return rider.dead;
    },
    get x() {
      return rider.x;
    },
    get y() {
      return rider.y;
    },
    advance: () => rider.advance(),
    reset: () => rider.reset(),
    pose: (alpha: number) => rider.pose(alpha),
  };
}

// --- choosing one ------------------------------------------------------------
//
// THE LINE A MACHINE TOOK IS A SPOILER, AND THAT IS WHY THIS FILE ONLY EVER
// LOOKS AT THE HUMAN BOARD.
//
// Route choice is this game's depth: apples come in any order, and on a good
// level the orders differ in both feel and time. A TAS entry is the output of a
// search over that space — it IS the answer. Watching it does not merely
// discourage, it deletes the puzzle, permanently, because you cannot un-see a
// route.
//
// So the TIME and the LINE are separated, and the split is absolute:
//
//   * A TAS TIME may be shown. "41.7 s exists here" is motivating, and it is
//     proof the level is completable — which has already mattered twice in this
//     project, when the scripted pilot declared three levels broken and the
//     solver disproved it. That is information, not a solution.
//   * A TAS LINE is never a ghost. Not chosen for you, not offered in the
//     selector, and — this is the part that was wrong before — NOT the fallback
//     when the human board is empty. "No ghost yet, be the first" is a perfectly
//     good state and an honest one.
//
// AND THERE IS NO OTHER DOOR. There was once a gate — watch the machine line
// once you had finished the level yourself — and a gate was the wrong answer,
// because it kept the thing it was gating. A time is information; a line is a
// solution, and a searched optimal line deletes the puzzle permanently. So the
// client has no route to a TAS line at all: no key, no button, no unlock. The
// only thing that plays one is `bin/replay` at a terminal, which is an authoring
// tool used deliberately and not something offered to a player mid-session.

/** One board row, reduced to what a ghost needs. */
export type GhostEntry =
  | { replayId: string; name: string; timeTicks: number; playerId: string; appearance?: Appearance }
  | null;

/** Where a player stands on ONE board — the shape `/api/leaderboard` returns. */
export interface Standing {
  /** The entry one place ahead of this player. Server-computed; see api.ts. */
  above: GhostEntry;
  /** This player's own best on this board. */
  you: GhostEntry;
  /** The board's leader. */
  best: GhostEntry;
  rank: number | null;
  total: number;
}

export interface GhostPick {
  kind: GhostKind;
  entry: GhostEntry;
  rank: number | null;
}

/**
 * Resolve a requested ghost against what the HUMAN board offers.
 *
 * `boards.tas` is accepted and deliberately never read. It is in the signature
 * rather than absent from it so that the rule is stated where it is enforced and
 * `ghost.test.ts` can assert it directly: a level with a TAS entry and no human
 * entry yields NO ghost, which is the behaviour a missing parameter could only
 * imply.
 *
 * The chain is `above` -> `pb` -> nothing:
 *
 *   * Race the person in front of you. With a field of two that is the whole
 *     point — one real person, a second or two ahead, is a race you can win
 *     tonight.
 *   * Nobody in front? Your own best, which is still a race.
 *   * Neither? Nothing. `wr` is offered in the selector and is never fallen back
 *     to: silently showing somebody a record forty seconds faster is
 *     discouraging, and that argument applies doubly to a solver's run.
 *
 * `above` for a player with NO time is the SLOWEST entry on the board, computed
 * by the server because the client only ever receives the top N. That is the
 * right answer and not a degenerate one: with no time everybody is ahead of you,
 * and the nearest of them is the one you can actually catch.
 */
export function chooseGhost(
  want: GhostKind,
  boards: { human: Standing | null; tas?: Standing | null },
): GhostPick {
  const human = boards.human;
  if (want === 'off' || !human) return { kind: want === 'off' ? 'off' : want, entry: null, rank: null };
  if (want === 'wr') return { kind: 'wr', entry: human.best, rank: human.best ? 1 : null };
  if (want === 'pb') return { kind: 'pb', entry: human.you, rank: human.rank };
  // want === 'above'
  if (human.above) return { kind: 'above', entry: human.above, rank: human.rank === null ? null : human.rank - 1 };
  if (human.you) return { kind: 'pb', entry: human.you, rank: human.rank };
  return { kind: 'above', entry: null, rank: null };
}

/**
 * Why there is no ghost, in one line, or '' when there is one (or when the
 * player asked for none).
 *
 * It never mentions the TAS board. An empty human board says "be the first",
 * full stop — a note explaining that a machine run is being withheld is itself a
 * hint that something is being withheld, and the point of the rule is that the
 * solver's line should not be present in ordinary play even as an absence.
 */
export function ghostNoteFor(
  want: GhostKind,
  pick: GhostPick,
  boards: { human: Standing | null; tas?: Standing | null },
): string {
  if (want === 'off' || pick.entry) return '';
  // No board at all is a network story, and boardStatus is already telling it.
  if (!boards.human) return '';
  if (boards.human.total === 0) return 'no ghost yet — be the first to finish this level';
  return `no ${GHOST_LABELS[want]} to race yet`;
}

/**
 * May this player watch the LINE of a run in this category?
 *
 * Human lines only, unconditionally. Somebody else riding it by hand is the
 * whole social half of the board, and it is how people learn from each other.
 *
 * A TAS line is never watchable in the client — see the block above
 * `chooseGhost`. There is no second argument here on purpose: there is no state
 * a player can reach that turns a machine line on, so there is nothing to pass.
 */
export function watchableCategory(category: 'human' | 'tas'): boolean {
  return category === 'human';
}
