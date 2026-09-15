// Public barrel for the deterministic core.
//
// Everything below this line runs unchanged under Vite-bundled V8, `tsx` on
// Node, a Web Worker and a headless solver, because src/sim imports nothing.
export { DT, SIM_HZ, INPUT_HZ, TICKS_PER_FRAME, IN_THROTTLE, IN_BRAKE, IN_LEAN_L, IN_LEAN_R, IN_FLIP, IN_MASK, PICKUP_RADIUS, DEFAULT_SAG_TOLERANCE, MAX_ARC_SEGMENTS, MIN_EDGE_LEN2 } from './consts.ts';
export { ROT_IDENTITY, rotIntegrate, rotNormalize, rotX, rotY, unrotX, unrotY, sinSmall, cosSmall } from './rot.ts';
export type { Rot } from './rot.ts';
export { Hasher, hashNumbers } from './hash.ts';
export { DEFAULT_SPEC, cloneSpec, specHash } from './spec.ts';
export type { BikeSpec, Vec2, Circle } from './spec.ts';
export { parseLevel, pointInSolid, LevelError } from './level.ts';
export type { Level, RawLevel, RawPolygon, DecorPolygon, RawPoint, RawArc, RawVertex, CompiledPolygon, PolyKind } from './level.ts';
export { tessellateArc, chordSag } from './arc.ts';
export type { ArcStatus } from './arc.ts';
export { buildGrid, queryCircle } from './broadphase.ts';
export type { Grid } from './broadphase.ts';
export { circleEdge, compareContacts, makeContact } from './collide.ts';
export type { Contact } from './collide.ts';
export { createWorld, COL_WHEEL0, COL_WHEEL1, COL_CHASSIS0, COL_HEAD } from './world.ts';
export type { World } from './world.ts';
export { createState, stepTick, copyState, assignState, hashState } from './step.ts';
export type { SimState } from './step.ts';
export { createSim } from './sim.ts';
export type { Sim } from './sim.ts';
export { encodeInputs, decodeInputs, buildReplay, verifyReplay, ticksToSeconds } from './replay.ts';
export type { Replay, VerifyResult } from './replay.ts';
export { SIM_REV, getEngine, currentEngine } from './rev.ts';
export type { Engine } from './rev.ts';
export { crossCheck, crossCheckMask } from './crosscheck.ts';
export type { CrossCheck } from './crosscheck.ts';
export { TEST_LEVEL } from './testlevel.ts';
export { CURVE_LEVEL } from './curvelevel.ts';
