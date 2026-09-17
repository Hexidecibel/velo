// Physics versioning, and the dispatcher that makes it real.
//
// ONE hand-bumped integer pins everything that can affect a result — both the
// code and the constants. Conflating them is the usual mistake, but tracking
// them separately is pointless when either one invalidates a time.
//
// THE SHAPE, now that it is built rather than promised. A rev is a
// SELF-CONTAINED DIRECTORY that imports nothing outside itself, `getEngine(rev)`
// hands out the matching engine, old replays verify forever, and the
// leaderboard forks by rev rather than resetting — so old times stay visible
// and honoured while the live board stays honest. That was always the launch
// plan; what forced it now is that rev 5 exists and rev 4 is still the game.
//
// WHERE REV 4 LIVES, AND WHY IT IS NOT A DIRECTORY. It lives at `src/sim/*.ts`,
// exactly where it always has. Freezing it by MOVING it into `src/sim/rev4/`
// would have rewritten a hundred `@/sim/...` import sites across the client,
// the server, the solver and bin/ — a large diff, in code owned by other
// people, with a real chance of moving it wrong, and buying nothing: what
// "frozen" has to mean is that no future physics edit can reach rev 4, and
// that is already true the moment every LATER rev lives in a directory of its
// own that cannot import upward. So rev 5 is the directory, rev 4 is the root,
// and the guarantee is the same one either way round.
//
// The behavioural half of the guarantee is `revfreeze.test.ts`, which re-runs
// every rev-4 replay in `replays/` — the pilot runs, the solver solutions, the
// exported board runs — through `getEngine(4)` and asserts the full periodic
// hash chain still matches bit for bit. A physics edit that reaches rev 4 fails
// that test loudly, at the file and frame it first diverged.
//
// SIM_REV IS THE LIVE REV, NOT THE NEWEST ONE. It still says 4 and the game
// still ships on 4: the user's instruction was "dont overwrite main game mode".
// `LATEST_REV` is the newest rev that exists. They are different numbers for
// the first time and everything that used to mean "the rev" means "the live
// rev" — `buildReplay` stamps it, the client records on it, the leaderboard
// board is keyed to it. Rev 5 is opt-in: reachable through `getEngine(5)` by
// anything that asks for it, and by nothing that does not.
import { DT, TICKS_PER_FRAME } from './consts.ts';
import { createSim } from './sim.ts';
import type { Sim } from './sim.ts';
import { buildReplay, verifyReplay, verifyReplaySteps } from './replay.ts';
import type { Replay, VerifyResult } from './replay.ts';
import type { SimState } from './step.ts';
import { parseLevel } from './level.ts';
import type { Level } from './level.ts';
import { DEFAULT_SPEC, parseSpec, specHash } from './spec.ts';
import type { BikeSpec } from './spec.ts';
import { ENGINE as ENGINE_REV5 } from './rev5/index.ts';

/**
 * The LIVE rev: the physics the game ships on, the rev a fresh run is recorded
 * under, and the rev the leaderboard's main board is keyed to. Hand-bumped, and
 * bumping it is a decision about the game rather than about the code — a newer
 * rev existing does not move it.
 */
export const SIM_REV = 4;

/** The newest rev that exists at all. `SIM_REV <= LATEST_REV`, always. */
export const LATEST_REV = 5;

export interface Engine {
  rev: number;
  dt: number;
  ticksPerFrame: number;
  createSim(level: Level, spec: BikeSpec): Sim;
  verifyReplay(level: Level, spec: BikeSpec, replay: Replay): VerifyResult;
  /**
   * The same verifier, SLICED. The server needs this one rather than the driver
   * above: it yields every `slice` input frames so the event loop keeps turning
   * and a run that overruns its budget can be abandoned. `slice` is a scheduling
   * knob and cannot affect the verdict.
   */
  verifyReplaySteps(
    level: Level,
    spec: BikeSpec,
    replay: Replay,
    slice?: number,
  ): Generator<number, VerifyResult, void>;
  /**
   * The rev's own replay builder, which stamps the rev's own number. Using the
   * live build's would label a rev-5 run as rev 4 and it would then fail to
   * verify anywhere, including here.
   */
  buildReplay(args: {
    level: Level;
    spec: BikeSpec;
    masks: readonly number[];
    hashEvery: number;
    hashes: string[];
    state: SimState;
    bike?: string;
  }): Replay;
  /**
   * The rev's OWN level compiler. Arc tessellation, winding normalisation and
   * `simHash` decide what the bike actually hits, so they are as much a part of
   * a rev as `step.ts` is — `DEFAULT_SAG_TOLERANCE` says so in as many words.
   * A caller that compiles a level with one rev's loader and runs it on
   * another's is doing something subtly wrong, and this is here so it does not
   * have to.
   */
  parseLevel(raw: unknown): Level;
  /** Likewise the rev's own spec parser and hash. One spec field became two in
   *  rev 4 and gained a third in rev 5; `specHash` moved both times. */
  parseSpec(raw: unknown): BikeSpec;
  specHash(spec: BikeSpec): string;
  defaultSpec: BikeSpec;
}

/**
 * The changelog, newest first.
 *
 *   5  The rider's inertial reaction on the pivot gained its LINEAR half,
 *      `rider.inertialTransferLinear`.
 *
 *      Rev 4 applied the reaction as a TORQUE only. For linear motion the
 *      rider was a constant lump at the chassis origin — `world.ts` folds
 *      `rider.mass` into the chassis's translational mass and stopped there —
 *      so moving the arm could not move the system's centre of mass, could not
 *      load or unload the suspension, and PUMPING WAS NOT A MECHANIC THAT
 *      COULD EXIST. Neither was a bunny hop. That is not a tuning miss; it is
 *      the `- m*L*u''` term being absent from the momentum sum, and no
 *      arrangement of jump geometry can work around a missing term.
 *
 *      Rev 5 restores it, solved simultaneously with the arm's own angular
 *      acceleration rather than lagged a tick behind it, which is closed form
 *      and costs one precomputed factor. See step.ts step 3b in src/sim/rev5.
 *      Set the coefficient to 0 and the arithmetic reduces term for term to
 *      rev 4; rev5.test.ts asserts the hash chains are identical rather than
 *      trusting the claim.
 *
 *      `specHash` moved: one more spec field. Rev 4 replays do not verify on
 *      rev 5 and cannot be made to — which is the versioning scheme working,
 *      and is why rev 4 is still here rather than replaced.
 *
 *   4  The rider's inertial reaction on the pivot became ASYMMETRIC:
 *      `rider.inertialTransfer` split into `inertialTransferBrake` and
 *      `inertialTransferDrive`, selected by the sign of the pivot's
 *      acceleration along the bike's forward axis.
 *
 *      Read as pure mechanics the rev-3 term is symmetric, and that symmetry
 *      was a tuning deadlock: the same rider mass that dives the nose under
 *      braking lifts it under acceleration, so every notch that tamed the
 *      launch wheelie weakened the brake dive the user had signed off on. The
 *      split is an ACTIVE-RIDER model — a real rider shifts their weight
 *      forward under acceleration precisely to keep the front down, which one
 *      coefficient cannot express. See step.ts step 3b for the full reasoning.
 *      Set the two equal and the branch selects the same number, so rev 4 with
 *      matched coefficients is arithmetically rev 3.
 *
 *      `drive.maxTorque` on the shipped preset also came down 140 -> 126, the
 *      user's own hand-tune, and the two changes ship together because the
 *      drive-side coefficient was chosen against that torque.
 *
 *      `specHash` moved: one spec field became two. Rev 3 replays do not
 *      verify here and cannot be made to — which is the versioning scheme
 *      working, not a fault.
 *
 *   3  Two changes, shipped together because neither ever escaped on its own.
 *
 *      (a) Suspension damping split into separate COMPRESSION and REBOUND
 *          coefficients. Set equal, the arithmetic is identical to rev 2's
 *          single coefficient — the split is a new lever, not a new force.
 *      (b) The rider's INERTIAL reaction on the pivot, `rider.inertialTransfer`
 *          — the m*a term step.ts had been calling the top M2 candidate. The
 *          static weight transfer moved to after the suspension so that it and
 *          the new term can share the pivot acceleration, which also reordered
 *          two floating-point additions. That reorder alone is worth ~5e-16 at
 *          frame 400 and a visibly different line by frame 5000, because a bike
 *          bouncing off geometry is chaotic — which is exactly why this is a
 *          rev bump and not a patch.
 *
 *      `specHash` moved too: one spec field became two and another was added.
 *      Rev 2 replays do not verify here and cannot be made to.
 *   2  Replaced the pendulum-only rider with a continuous,
 *      attitude-independent `rider.attitudeTorque` on the chassis, and demoted
 *      gravity weight transfer to a scaled flavour term.
 *
 * Revs 1-3 have no code here. Through milestone 1 the rev bumped freely and
 * times reset, which is exactly why freezing revs into directories was a
 * launch-time job rather than a day-one one; rev 4 is the first rev that
 * anybody's time is on, and therefore the first one worth keeping.
 */
const ENGINE_REV4: Engine = {
  rev: 4,
  dt: DT,
  ticksPerFrame: TICKS_PER_FRAME,
  createSim,
  // Called through rather than referenced, and the indirection is load-bearing:
  // `replay.ts` imports SIM_REV from this file, so this file and that one are a
  // cycle. Which half of it finishes evaluating first depends on which of the
  // two an importer reached first, and under Vite's SSR transform the losing
  // half's function bindings are not yet assigned — so capturing `verifyReplay`
  // into this object literal at module-init time yields `undefined` for any
  // consumer that happened to import `replay.ts` first. Resolving it at CALL
  // time cannot be wrong, whichever order the graph was walked in.
  verifyReplay: (level, spec, replay) => verifyReplay(level, spec, replay),
  verifyReplaySteps: (level, spec, replay, slice) => verifyReplaySteps(level, spec, replay, slice),
  buildReplay: (args) => buildReplay(args),
  parseLevel,
  parseSpec,
  specHash,
  defaultSpec: DEFAULT_SPEC,
};

/** Every rev this build can run, ascending. */
export const REVS: readonly number[] = [4, 5];

export function getEngine(rev: number): Engine {
  switch (rev) {
    case 4:
      return ENGINE_REV4;
    case 5:
      return ENGINE_REV5;
    default:
      throw new Error(`unknown SIM_REV ${rev}; this build knows ${REVS.join(', ')}`);
  }
}

/** True if `getEngine` would answer rather than throw. */
export function hasEngine(rev: number): boolean {
  return REVS.includes(rev);
}

/**
 * The LIVE engine — what the game is, today. Not the newest one: see SIM_REV
 * above. Call `getEngine(LATEST_REV)` if what you want is the bleeding edge,
 * and say so at the call site, because the two being different is the whole
 * point of there being two names.
 */
export function currentEngine(): Engine {
  return getEngine(SIM_REV);
}
