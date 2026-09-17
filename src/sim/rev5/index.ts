// SIM_REV 5 — the rev under development.
//
// WHAT CHANGED FROM REV 4, in one line: the rider's inertial reaction on the
// pivot gained its LINEAR half. Through rev 4 the reaction was applied as a
// torque only and the rider was, for linear motion, a 35 kg lump bolted to the
// chassis origin — so moving the arm could not move the system's centre of
// mass, could not load or unload the suspension, and pumping was therefore not
// a mechanic that could exist. See step.ts step 3b.
//
// WHAT THIS DIRECTORY IS. A rev is a self-contained directory that imports
// NOTHING outside itself — not even from `src/sim/` one level up. That rule is
// the entire freezing mechanism: a rev that cannot reach out cannot be changed
// by an edit made anywhere else, so "rev 4 still verifies" is a structural
// guarantee rather than a promise somebody has to keep. The cost is a dozen
// duplicated files per rev, and that cost is the point; the plan calls this
// "a directory copy" and it is meant literally.
//
// Rev 4 is not a directory here because it does not need to be: it lives at
// `src/sim/*.ts` where it always has, it is what `SIM_REV` still names, and it
// is what every direct `@/sim/...` import in the client and the server still
// gets. Freezing it by MOVING it would have meant rewriting a hundred import
// sites for no behavioural gain and a real risk of moving it wrong. Freezing it
// by not-touching-it, and keeping every later rev out of its way in a directory
// of its own, gets the same guarantee for nothing. When rev 5 is promoted, the
// only thing that moves is the integer in `src/sim/rev.ts`.
import { DT, TICKS_PER_FRAME } from './consts.ts';
import { createSim } from './sim.ts';
import { buildReplay, verifyReplay, verifyReplaySteps } from './replay.ts';
import { parseLevel } from './level.ts';
import { DEFAULT_SPEC, parseSpec, specHash } from './spec.ts';
import { SIM_REV } from './rev.ts';

export const ENGINE = {
  rev: SIM_REV,
  dt: DT,
  ticksPerFrame: TICKS_PER_FRAME,
  createSim,
  verifyReplay,
  verifyReplaySteps,
  buildReplay,
  parseLevel,
  parseSpec,
  specHash,
  defaultSpec: DEFAULT_SPEC,
};
