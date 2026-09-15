// Rates and tuning-independent constants. Everything here that a replay can
// observe is a one-way door: change it and every replay ever recorded becomes
// unverifiable, so SIM_REV must move with it.

/**
 * 512 Hz. `DT` is exactly representable in binary (1/512), unlike 1/1000 or
 * 1/480 — which matters because an inexact dt makes `t = n * DT` drift in a way
 * that is fine on one machine and fine on another and different between them.
 *
 * At 20 m/s a wheel advances 0.039 m per tick against colliders half a metre
 * across, so nothing tunnels, and a 20 Hz suspension gets ~25 samples/period.
 */
export const DT = 0.001953125;
export const SIM_HZ = 512;

/**
 * Input is sampled at 128 Hz — every 4 ticks — and this is a competitive
 * fairness decision, not an implementation detail. Sampling once per rendered
 * frame would give a 144 Hz player finer input timing than a 60 Hz player, and
 * on a leaderboard that is an integrity problem. 7.8 ms granularity is well
 * below the floor of human timing precision, so it costs nothing in
 * expressiveness and makes replays 4x smaller.
 *
 * The input frame is therefore the sim's PUBLIC unit: `advance(mask)` is 4
 * ticks and `stepTick` is internal. That structurally guarantees every
 * trajectory the (later) solver can find is expressible as a replay.
 */
export const TICKS_PER_FRAME = 4;
export const INPUT_HZ = 128;

// Input bitmask. Stable forever; new bits append.
export const IN_THROTTLE = 1;
export const IN_BRAKE = 2;
export const IN_LEAN_L = 4;
export const IN_LEAN_R = 8;
export const IN_FLIP = 16;
export const IN_MASK = 31;

/**
 * Magnitudes below this hash as zero. UNCONDITIONAL — never behind a debug
 * flag, because a flag here means a dev build and a prod build disagree about
 * a state hash, which is precisely the failure the hash exists to detect.
 */
export const HASH_EPS = 1e-9;

/** Below this a direction is treated as degenerate rather than normalised. */
export const EPS = 1e-12;

// --- solver ---
export const SOLVER_ITERS = 8;
/** Penetration tolerated before positional projection kicks in (metres). */
export const CONTACT_SLOP = 0.0005;
/**
 * Baumgarte bias: the fraction of the remaining penetration turned into a
 * separating velocity each tick. Position correction rides inside the velocity
 * solve rather than as a separate projection pass, because a projection pass
 * over three chassis circles in a corner triple-counts and pops the bike.
 */
export const BAUMGARTE = 0.2;
/** Ceiling on that separating velocity, m/s. Stops a deep overlap exploding. */
export const MAX_CORRECTION_VEL = 2.0;
/** Frame circles are not tyres; they scrape rather than grip. */
export const CHASSIS_FRICTION = 0.5;
/** ...and they do not bounce. The spring does the bouncing on this bike. */
export const CHASSIS_RESTITUTION = 0;
/** Contacts closing slower than this get no restitution (stops resting jitter). */
export const RESTITUTION_CUTOFF = 1.0;

/** Hard caps. Present for stability, not for feel; a bike never reaches them. */
export const MAX_ANGVEL = 60;
export const MAX_ARM_ANGVEL = 40;
export const MAX_SPEED = 200;

/** Radius within which any part of the bike collects an apple / the flower. */
export const PICKUP_RADIUS = 0.4;

/** Upper bound on broadphase cells; cell size doubles until the grid fits. */
export const MAX_GRID_CELLS = 1 << 20;
export const BASE_CELL = 1.0;
