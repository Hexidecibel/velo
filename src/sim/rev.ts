// Physics versioning.
//
// ONE hand-bumped integer pins everything that can affect a result — both the
// code and the constants. Conflating them is the usual mistake, but tracking
// them separately is pointless when either one invalidates a time.
//
// Through milestone 1 this bumps freely and times reset; say so in the UI.
// Tuning must stay cheap, and any scheme that makes retuning expensive during
// M1 makes the game worse. At public launch it freezes: frozen revs become
// frozen directories, `getEngine(rev)` dispatches to them, old replays verify
// forever, and the leaderboard FORKS by rev rather than resetting, so old times
// stay visible and honoured while the live board stays honest.
//
// `getEngine` exists from day one as a two-line switch over a single rev
// because it costs nothing now and is a migration later. Nothing calls it over
// HTTP yet; there is no server yet.
import { DT, TICKS_PER_FRAME } from './consts.ts';
import { createSim } from './sim.ts';
import type { Sim } from './sim.ts';
import { verifyReplay } from './replay.ts';
import type { Replay, VerifyResult } from './replay.ts';
import type { Level } from './level.ts';
import type { BikeSpec } from './spec.ts';

export const SIM_REV = 2;

export interface Engine {
  rev: number;
  dt: number;
  ticksPerFrame: number;
  createSim(level: Level, spec: BikeSpec): Sim;
  verifyReplay(level: Level, spec: BikeSpec, replay: Replay): VerifyResult;
}

/**
 * Rev 2 replaced the pendulum-only rider with a continuous, attitude-independent
 * `rider.attitudeTorque` on the chassis, and demoted gravity weight transfer to
 * a scaled flavour term. Rev 1's code is NOT kept: through milestone 1 the rev
 * bumps freely and times reset, which is the whole reason freezing revs into
 * directories is a launch-time job rather than a today job.
 */
const ENGINE_CURRENT: Engine = {
  rev: 2,
  dt: DT,
  ticksPerFrame: TICKS_PER_FRAME,
  createSim,
  verifyReplay,
};

export function getEngine(rev: number): Engine {
  switch (rev) {
    case 2:
      return ENGINE_CURRENT;
    default:
      throw new Error(`unknown SIM_REV ${rev}; this build knows ${SIM_REV}`);
  }
}

export function currentEngine(): Engine {
  return getEngine(SIM_REV);
}
