// The sim's public surface.
//
// `advance(mask)` is the ONLY way time moves, and one call is exactly one input
// frame (TICKS_PER_FRAME ticks at 128 Hz). `stepTick` stays internal. That
// structurally guarantees any trajectory the later solver finds is expressible
// as a replay — give a solver raw ticks and it will eventually find a run no
// human input stream can reproduce, and you discover that when you try to save
// it.
//
// Requirements the solver needs and that are nearly free now but painful later:
// steppable headlessly with no renderer, cheap to instantiate, no wall-clock
// reads anywhere, and snapshot/restore-able so a search can BRANCH from a state
// instead of replaying from the start.
import { IN_FLIP, IN_MASK, TICKS_PER_FRAME } from './consts.ts';
import type { Level } from './level.ts';
import type { BikeSpec } from './spec.ts';
import { specHash } from './spec.ts';
import { assignState, copyState, createState, hashState, normalizeStateRotors, stepTick } from './step.ts';
import type { SimState } from './step.ts';
import { createWorld } from './world.ts';
import type { World } from './world.ts';

export interface Sim {
  readonly world: World;
  readonly state: SimState;
  readonly specHash: string;
  /** One input frame. No dt argument, ever. */
  advance(mask: number): void;
  /** Deep copy of the state. The world is shared and never copied. */
  snapshot(): SimState;
  restore(s: SimState): void;
  hash(): string;
  reset(): void;
  /** Elapsed ticks, or the tick the run ended on. */
  elapsedTicks(): number;
}

export function createSim(level: Level, spec: BikeSpec): Sim {
  const world = createWorld(level, spec);
  const state = createState(world);
  const sh = specHash(world.spec);

  const sim: Sim = {
    world,
    state,
    specHash: sh,

    advance(mask: number): void {
      const m = mask & IN_MASK;
      // Flip is a pure discrete state change on the RISING EDGE: facing
      // flips, nothing else moves. Free, legal mid-air, no velocity change.
      // This works only because both wheels share a radius and the anchors are
      // symmetric — a soft one-way door if stat-varying bikes ever get
      // different wheel sizes.
      if ((m & IN_FLIP) !== 0 && (state.prevMask & IN_FLIP) === 0 && !state.dead && !state.finished) {
        state.facing = -state.facing;
      }
      state.prevMask = m;
      for (let i = 0; i < TICKS_PER_FRAME; i++) stepTick(world, state, m);
    },

    snapshot(): SimState {
      return copyState(state);
    },

    restore(s: SimState): void {
      assignState(state, s);
      normalizeStateRotors(state);
    },

    hash(): string {
      return hashState(state);
    },

    reset(): void {
      assignState(state, createState(world));
    },

    elapsedTicks(): number {
      return state.endTick >= 0 ? state.endTick : state.tick;
    },
  };
  return sim;
}
