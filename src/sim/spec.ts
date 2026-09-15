// Every feel-critical constant on the bike, in one place, content-hashed.
//
// Nothing about the bike may be a literal buried in step.ts. Milestone 1 is
// dozens of tuning iterations driven by the user's own hands on live sliders,
// and a constant that is not in here is a constant that cannot be tuned
// without an edit-save-reload cycle.
//
// Units: metres, kilograms, seconds, radians. y is UP; gravity is -y.
import { Hasher } from './hash.ts';

/** Thrown by `parseSpec`. A bad spec is rejected, never coerced. */
export class SpecError extends Error {}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface BikeSpec {
  /** Magnitude, m/s^2. Applied as -y. */
  gravity: number;

  chassis: {
    mass: number;
    /** Rotational inertia about the chassis origin, kg m^2. */
    inertia: number;
    /**
     * Frame collision circles in chassis-local coordinates. Without these you
     * can drive the frame through a wall. Frame contact does NOT kill — only
     * the rider's head does.
     */
    colliders: Circle[];
  };

  wheel: {
    mass: number;
    radius: number;
    /**
     * Rotational inertia of one wheel. This single scalar per wheel is what
     * buys mid-air throttle counter-rotation, landing on a spun-up wheel and
     * being launched forward, wheelspin and traction limits, and brake-pitch in
     * mid-air — all real Elma techniques that a spinless wheel silently throws
     * away.
     */
    inertia: number;
    /** Chassis-local suspension anchors. Index 0 is -x, index 1 is +x. */
    anchors: [Vec2, Vec2];
    /** Coulomb friction coefficient at the contact patch. */
    friction: number;
    /**
     * Deliberately near zero. The SPRING does the bouncing, which is why a bike
     * bounces like a bike and not like a ball.
     */
    restitution: number;
  };

  suspension: {
    /** N/m, zero rest length: the wheel is pulled toward its anchor. */
    stiffness: number;
    /**
     * ASYMMETRIC DAMPING, N s/m along the anchor-to-wheel axis, and the split is
     * the point. `rate` in step.ts is d(len)/dt, so `rate < 0` is the wheel
     * moving TOWARD the chassis (the compression stroke, a landing or a bump)
     * and `rate > 0` is the spring pushing it back out (the rebound stroke).
     *
     * One symmetric coefficient forces a bad trade between the two halves. High
     * damping keeps a landing planted but also eats the rebound energy that
     * would otherwise launch the bike off a feature; low damping gives the pop
     * back but makes every landing a pogo. Real motorcycle suspension has two
     * separate adjusters for exactly this reason, and so does this one:
     * compression stays high so landings stay controlled, rebound comes down so
     * the spring returns what it stored.
     *
     * Set them EQUAL and the arithmetic is bit-identical to the single
     * coefficient it replaced — that is the migration path, and it is why rev 2
     * feel is one slider drag away.
     */
    compressionDamping: number;
    /** N s/m on the extension stroke. Lower than compression = more pop. */
    reboundDamping: number;
    /**
     * Hard radial clamp, metres. The suspension is ISOTROPIC — it pulls the
     * wheel toward the anchor in ANY direction, not along a prismatic axis.
     * A prismatic constraint transmits every horizontal impulse rigidly, which
     * makes landings harsh and removes fore-aft compliance entirely.
     */
    maxDeflection: number;
  };

  drive: {
    /** Peak torque on the rear wheel, N m. */
    maxTorque: number;
    /** Free-spin ceiling, rad/s. Torque falls off LINEARLY toward it. */
    maxWheelSpin: number;
    /** Applied to both wheels, clamped so a tick can never reverse spin. */
    brakeTorque: number;
  };

  rider: {
    /**
     * The rider is a driven pendulum: one point mass on a massless arm
     * pivoting on the chassis, driven by a PD servo toward a target direction
     * set by the volt input, with +tau on the arm and -tau on the chassis.
     *
     * An angular impulse straight onto the chassis — the obvious first sketch —
     * is wrong three ways: volt authority is unbounded (so you bolt on a clamp,
     * and it feels like a clamp), there is no return stroke so volting is free
     * and degenerates into mashing, and worst, a fixed-offset head means
     * volting into a low ceiling does not kill you. Knowing when you cannot
     * afford to volt is real skill; a fixed head deletes it invisibly.
     */
    mass: number;
    armLength: number;
    /** The death sphere. Touch it to terrain and the run is over. */
    headRadius: number;
    /**
     * Target arm directions, as PRE-BAKED UNIT VECTORS in chassis-local space
     * rather than angles. This is the mechanism by which the sim never calls
     * Math.cos: the tuning panel bakes the vector from an angle, the sim only
     * ever multiplies.
     */
    rest: Vec2;
    leanL: Vec2;
    leanR: Vec2;
    /** Servo proportional gain, N m per unit of sine-error. */
    servoP: number;
    /** Servo derivative gain, N m s/rad, against arm-relative-to-chassis rate. */
    servoD: number;
    servoMaxTorque: number;
    /**
     * PRIMARY ROTATION CONTROL. Constant torque on the chassis, N m, applied
     * every tick a lean key is held, sign from the direction, INDEPENDENT of
     * chassis orientation and of gravity.
     *
     * Be honest about what this is: a GAMEPLAY term, not a physical one.
     * Nothing receives the reaction, so it does not conserve angular momentum.
     * It is here because the pendulum alone cannot do the job and the reason is
     * structural, not a tuning miss:
     *
     *   - the servo's target is chassis-relative, so when the chassis spins the
     *     target spins with it and the arm tracks it happily, producing no
     *     correcting torque at all;
     *   - the servo torque vanishes as the arm arrives, so rotation authority
     *     is a one-shot impulse rather than sustained control;
     *   - the only sustained term is gravity weight transfer, which depends on
     *     the arm's WORLD-horizontal component and therefore averages to zero
     *     over a revolution. During a spin it is a wobble, not a brake.
     *
     * Net, the pendulum-only model makes rotation control strongest upright and
     * useless inverted — exactly backwards from what a player needs. Elasto
     * Mania's left/right rotate the bike identically at every attitude, and that
     * orientation-independence is precisely why a spin there is recoverable.
     *
     * The physically honest version would react against wheel angular momentum,
     * the way a motocross rider actually does. Deliberately NOT built: authority
     * would vanish whenever the wheels are stopped, which is exactly when the
     * player most needs to correct.
     *
     * Against linear angular damping this gives w(t) = w_inf * (1 - e^(-c t))
     * with w_inf = tau / (I * c) and time constant 1/c — so a tap is a nudge, a
     * hold accelerates to a ceiling, and a sustained hold flips cleanly. No ramp
     * or charge-up mechanic is needed to get that; it falls out.
     */
    attitudeTorque: number;
    /**
     * 0..1, scaling the gravity weight-transfer torque. 1 keeps leaning back on
     * the throttle producing a wheelie — which is the single most important
     * thing a rider does — while `attitudeTorque` above carries the rotation
     * authority, so gravity no longer has to.
     */
    weightTransfer: number;
    /**
     * The rider's INERTIAL reaction on the pivot — the m*a term — scaled by
     * TWO coefficients rather than one, selected by the sign of the pivot's
     * acceleration along the bike's forward axis. See `inertialTransferDrive`
     * below, and step.ts step 3b for where the branch is taken.
     *
     * `weightTransfer` above transfers only the rider's STATIC weight: the
     * torque about the chassis origin of a mass hanging L metres up. That makes
     * gassing lift the front, because drive torque is reacted on the chassis
     * directly. Braking had no comparable path, so the nose did not dive —
     * which the user noticed and reported as an asymmetry, correctly.
     *
     * The honest fix is to evaluate the same torque in the pivot's ACCELERATING
     * frame rather than in an inertial one. The rider does not feel gravity, it
     * feels gravity MINUS the pivot's acceleration, and the arm already
     * integrates exactly that pseudo-force (see step.ts step 5). Feeding the
     * same quantity into the chassis torque is two lines, and it produces all
     * of this from one term:
     *
     *   brake        pivot decelerates, the rider's mass keeps going forward,
     *                and 35 kg at 1.2 g on a 0.55 m arm is ~230 N m of
     *                nose-down moment that simply was not being applied
     *   throttle     the mirror image: nose up, on top of the drive reaction
     *   landing      the pivot decelerates upward hard, so the rider's weight
     *                lands with it and a heavy landing feels heavy
     *   impact       and, timed into a face, this is what makes "lean in as you
     *                hit" convert momentum into climb — an inertial term
     *                governs timing, a static one cannot
     *
     * This one is the BRAKING half: the stoppie, and the one the user asked for
     * in as many words — "slamming on brake should slam down the front end,
     * right? just like gassing lifts up".
     *
     * Separate from `weightTransfer` on purpose: that one is set where the user
     * left it and the static behaviour it controls is signed off, so this gets
     * its own slider and its own zero. Set both halves to 0 and the bike is
     * arithmetically the rev-2 bike.
     *
     * NOT gated on being grounded. Braking a spinning wheel in mid-air puts
     * reaction torque on the chassis and pitches it — a different mechanism,
     * also real, also worth keeping. Two behaviours, not one with an exception.
     */
    inertialTransferBrake: number;
    /**
     * The DRIVING half of the same term: the pivot is accelerating the way the
     * rider is pointing, the rider's mass is left behind, and the nose lifts.
     * The launch wheelie.
     *
     * WHY THIS IS A SEPARATE NUMBER, AND WHY THE ASYMMETRY IS AN ACTIVE-RIDER
     * MODEL RATHER THAN A FUDGE. Read as pure mechanics the term is symmetric,
     * and that symmetry was the problem: the same rider mass that dives the
     * nose under braking lifts it under acceleration, so with one coefficient
     * every notch that tamed the launch wheelie took the same notch out of the
     * brake dive. The user hit exactly that wall from both sides — "i'm having
     * a hard time hitting top speed without front tire lifting" against
     * "slamming on brake should slam down the front end" — and no single value
     * satisfies both, because they are the two ends of one slider.
     *
     * A symmetric coefficient models a sack of potatoes strapped to the pivot:
     * it reacts to acceleration in both directions with the same authority
     * because it is not doing anything. A rider is not a sack of potatoes.
     * Under acceleration a real rider shifts their weight FORWARD — crouches
     * over the bars, pulls on them — precisely to keep the front wheel down,
     * and that is the most-practised habit in the sport. Under braking they do
     * not resist at all: they let the deceleration throw them forward and push
     * into the bars, which loads the front further. So the two directions
     * genuinely present different effective masses on the arm, and one number
     * cannot express that. Elma's bike behaves like there is somebody riding
     * it; this pair is what decides whether ours does.
     *
     * Set the two equal and the arithmetic is exactly the rev-3 single
     * coefficient — the branch selects the same number.
     */
    inertialTransferDrive: number;
  };

  damping: {
    /**
     * Applied as `v /= (1 + c*DT)`, which is unconditionally stable at any DT
     * and, unlike the exact `v *= exp(-c*DT)`, contains no Math.exp.
     */
    linear: number;
    angular: number;
  };
}

/**
 * Reasoned starting points, not measured truth. The entire point of milestone 1
 * is that these change — drive the bike, drag the sliders, press "Copy spec
 * JSON", paste the result back over this object. Do not retype a spec by hand:
 * a slider emits doubles like 0.30000000000000004 and the exact doubles that
 * were tuned with must be the exact doubles that ship.
 */
export const DEFAULT_SPEC: BikeSpec = deepFreeze({
  gravity: 10.0,

  chassis: {
    mass: 30,
    inertia: 11,
    colliders: [
      { x: 0, y: 0.05, r: 0.28 },
      { x: -0.35, y: 0.02, r: 0.2 },
      { x: 0.35, y: 0.02, r: 0.2 },
    ],
  },

  wheel: {
    mass: 3,
    radius: 0.25,
    inertia: 0.15,
    anchors: [
      { x: -0.6, y: -0.15 },
      { x: 0.6, y: -0.15 },
    ],
    friction: 1.4,
    restitution: 0.05,
  },

  suspension: {
    stiffness: 12000,
    // Equal, deliberately: DEFAULT_SPEC is the plan's numbers verbatim and every
    // test keys off it, so the asymmetric-damping change must leave it moving
    // bit-identically. The tuned split lives in the M1 preset, where every other
    // deviation from the plan already lives.
    compressionDamping: 500,
    reboundDamping: 500,
    maxDeflection: 0.25,
  },

  drive: {
    maxTorque: 450,
    maxWheelSpin: 80,
    brakeTorque: 900,
  },

  rider: {
    mass: 35,
    armLength: 0.55,
    headRadius: 0.16,
    rest: { x: 0, y: 1 },
    leanL: { x: -0.643, y: 0.766 },
    leanR: { x: 0.643, y: 0.766 },
    servoP: 2500,
    servoD: 220,
    servoMaxTorque: 900,
    // Measured against the M1 candidate's inertia 12 and angular damping 3.0:
    // terminal 4.98 rad/s, a full revolution in 1.26 s at that rate, and a
    // runaway -6 rad/s spin arrested in 0.18 s. Note the effective inertia is
    // NOT chassis.inertia alone — the chassis has to drag the rider's arm round
    // with it, and m*L^2 = 10.6 kg m^2 is nearly as much again as the chassis's
    // 12 — so the naive tau/(I*c) over-predicts the rate by about 2x. See
    // presets.ts, which is where these numbers are actually set together.
    attitudeTorque: 340,
    weightTransfer: 1,
    // Both zero in DEFAULT_SPEC, which is the plan verbatim and has no such
    // term at all. The presets turn them on; see presets.ts for the measured
    // numbers and for why the two halves do not match.
    inertialTransferBrake: 0,
    inertialTransferDrive: 0,
  },

  damping: {
    linear: 0.02,
    angular: 0.15,
  },
});

/** Structural clone. Used by the tuning panel, which mutates freely. */
export function cloneSpec(s: BikeSpec): BikeSpec {
  return {
    gravity: s.gravity,
    chassis: {
      mass: s.chassis.mass,
      inertia: s.chassis.inertia,
      colliders: s.chassis.colliders.map((c) => ({ x: c.x, y: c.y, r: c.r })),
    },
    wheel: {
      mass: s.wheel.mass,
      radius: s.wheel.radius,
      inertia: s.wheel.inertia,
      anchors: [
        { x: s.wheel.anchors[0].x, y: s.wheel.anchors[0].y },
        { x: s.wheel.anchors[1].x, y: s.wheel.anchors[1].y },
      ],
      friction: s.wheel.friction,
      restitution: s.wheel.restitution,
    },
    suspension: { ...s.suspension },
    drive: { ...s.drive },
    rider: {
      ...s.rider,
      rest: { ...s.rider.rest },
      leanL: { ...s.rider.leanL },
      leanR: { ...s.rider.leanR },
    },
    damping: { ...s.damping },
  };
}

/**
 * Content hash of every number the sim reads off the spec, in a fixed order.
 * Recorded on every replay: a time set on one bike is not a time set on
 * another, and "the constants changed" must be as visible as "the code changed".
 */
export function specHash(s: BikeSpec): string {
  const h = new Hasher();
  h.num(s.gravity);
  h.num(s.chassis.mass);
  h.num(s.chassis.inertia);
  h.int(s.chassis.colliders.length);
  for (const c of s.chassis.colliders) {
    h.num(c.x);
    h.num(c.y);
    h.num(c.r);
  }
  h.num(s.wheel.mass);
  h.num(s.wheel.radius);
  h.num(s.wheel.inertia);
  for (const a of s.wheel.anchors) {
    h.num(a.x);
    h.num(a.y);
  }
  h.num(s.wheel.friction);
  h.num(s.wheel.restitution);
  h.num(s.suspension.stiffness);
  h.num(s.suspension.compressionDamping);
  h.num(s.suspension.reboundDamping);
  h.num(s.suspension.maxDeflection);
  h.num(s.drive.maxTorque);
  h.num(s.drive.maxWheelSpin);
  h.num(s.drive.brakeTorque);
  h.num(s.rider.mass);
  h.num(s.rider.armLength);
  h.num(s.rider.headRadius);
  h.num(s.rider.rest.x);
  h.num(s.rider.rest.y);
  h.num(s.rider.leanL.x);
  h.num(s.rider.leanL.y);
  h.num(s.rider.leanR.x);
  h.num(s.rider.leanR.y);
  h.num(s.rider.servoP);
  h.num(s.rider.servoD);
  h.num(s.rider.servoMaxTorque);
  h.num(s.rider.attitudeTorque);
  h.num(s.rider.weightTransfer);
  h.num(s.rider.inertialTransferBrake);
  h.num(s.rider.inertialTransferDrive);
  h.num(s.damping.linear);
  h.num(s.damping.angular);
  return h.digest();
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const k of Object.keys(o as object)) {
      deepFreeze((o as Record<string, unknown>)[k]);
    }
    Object.freeze(o);
  }
  return o;
}

/**
 * Validate an arbitrary object — a parsed JSON file, a pasted panel dump, the
 * `spec` embedded in a replay — into a real BikeSpec, rejecting hard rather
 * than handing the sim an `undefined` that becomes a NaN on the first tick.
 *
 * The loader rule from level.ts applies here for the same reason: one NaN
 * poisons the whole state buffer within a tick, and a bike that silently
 * vanishes is a much worse error message than "spec.wheel.radius: expected a
 * finite number".
 */
export function parseSpec(raw: unknown): BikeSpec {
  const obj = (v: unknown, what: string): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new SpecError(`${what}: expected an object`);
    return v as Record<string, unknown>;
  };
  const num = (v: unknown, what: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new SpecError(`${what}: expected a finite number, got ${JSON.stringify(v) ?? String(v)}`);
    }
    return v;
  };
  const v2 = (v: unknown, what: string): Vec2 => {
    const o = obj(v, what);
    return { x: num(o.x, `${what}.x`), y: num(o.y, `${what}.y`) };
  };

  const r = obj(raw, 'spec');
  const chassis = obj(r.chassis, 'spec.chassis');
  const wheel = obj(r.wheel, 'spec.wheel');
  const susp = obj(r.suspension, 'spec.suspension');
  const drive = obj(r.drive, 'spec.drive');
  const rider = obj(r.rider, 'spec.rider');
  const damping = obj(r.damping, 'spec.damping');

  if (!Array.isArray(chassis.colliders)) throw new SpecError('spec.chassis.colliders: expected an array');
  const colliders: Circle[] = chassis.colliders.map((c, i) => {
    const o = obj(c, `spec.chassis.colliders[${i}]`);
    return {
      x: num(o.x, `spec.chassis.colliders[${i}].x`),
      y: num(o.y, `spec.chassis.colliders[${i}].y`),
      r: num(o.r, `spec.chassis.colliders[${i}].r`),
    };
  });
  if (!Array.isArray(wheel.anchors) || wheel.anchors.length !== 2) {
    throw new SpecError('spec.wheel.anchors: expected exactly two anchors');
  }

  return {
    gravity: num(r.gravity, 'spec.gravity'),
    chassis: {
      mass: num(chassis.mass, 'spec.chassis.mass'),
      inertia: num(chassis.inertia, 'spec.chassis.inertia'),
      colliders,
    },
    wheel: {
      mass: num(wheel.mass, 'spec.wheel.mass'),
      radius: num(wheel.radius, 'spec.wheel.radius'),
      inertia: num(wheel.inertia, 'spec.wheel.inertia'),
      anchors: [v2(wheel.anchors[0], 'spec.wheel.anchors[0]'), v2(wheel.anchors[1], 'spec.wheel.anchors[1]')],
      friction: num(wheel.friction, 'spec.wheel.friction'),
      restitution: num(wheel.restitution, 'spec.wheel.restitution'),
    },
    suspension: {
      stiffness: num(susp.stiffness, 'spec.suspension.stiffness'),
      compressionDamping: num(susp.compressionDamping, 'spec.suspension.compressionDamping'),
      reboundDamping: num(susp.reboundDamping, 'spec.suspension.reboundDamping'),
      maxDeflection: num(susp.maxDeflection, 'spec.suspension.maxDeflection'),
    },
    drive: {
      maxTorque: num(drive.maxTorque, 'spec.drive.maxTorque'),
      maxWheelSpin: num(drive.maxWheelSpin, 'spec.drive.maxWheelSpin'),
      brakeTorque: num(drive.brakeTorque, 'spec.drive.brakeTorque'),
    },
    rider: {
      mass: num(rider.mass, 'spec.rider.mass'),
      armLength: num(rider.armLength, 'spec.rider.armLength'),
      headRadius: num(rider.headRadius, 'spec.rider.headRadius'),
      rest: v2(rider.rest, 'spec.rider.rest'),
      leanL: v2(rider.leanL, 'spec.rider.leanL'),
      leanR: v2(rider.leanR, 'spec.rider.leanR'),
      servoP: num(rider.servoP, 'spec.rider.servoP'),
      servoD: num(rider.servoD, 'spec.rider.servoD'),
      servoMaxTorque: num(rider.servoMaxTorque, 'spec.rider.servoMaxTorque'),
      attitudeTorque: num(rider.attitudeTorque, 'spec.rider.attitudeTorque'),
      weightTransfer: num(rider.weightTransfer, 'spec.rider.weightTransfer'),
      inertialTransferBrake: num(rider.inertialTransferBrake, 'spec.rider.inertialTransferBrake'),
      inertialTransferDrive: num(rider.inertialTransferDrive, 'spec.rider.inertialTransferDrive'),
    },
    damping: {
      linear: num(damping.linear, 'spec.damping.linear'),
      angular: num(damping.angular, 'spec.damping.angular'),
    },
  };
}

// --- dotted paths ------------------------------------------------------------
//
// A BikeSpec is a nested object of numbers, and three separate things now need
// to talk about ONE of those numbers by name: `bin/spec set gravity 9.2`, the
// override file on disk, and the panel row that has to grey itself out because
// something else is driving that field. A dotted path is the obvious shared
// vocabulary, and enumerating the legal ones from the spec itself rather than
// from a hand-written list means a field added to BikeSpec is addressable the
// moment it exists — a list you have to remember to update is a list that is
// wrong.
//
// Array elements are addressed by index: `wheel.anchors.0.x`,
// `chassis.colliders.1.r`. That is uniform with object keys and needs no
// bracket syntax to parse or to quote in a shell.
//
// Deliberately NOT part of `specHash`: these are an addressing scheme, not
// state. Nothing here can change what the sim computes.

function walkPaths(node: unknown, prefix: string, out: string[]): void {
  if (typeof node === 'number') {
    out.push(prefix);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkPaths(v, prefix ? `${prefix}.${i}` : String(i), out));
    return;
  }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node as object)) {
      walkPaths((node as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k, out);
    }
  }
}

/**
 * Every addressable numeric field, in declaration order. Derived from
 * DEFAULT_SPEC, so it is by construction the complete and current set.
 */
export function specPaths(): string[] {
  const out: string[] = [];
  walkPaths(DEFAULT_SPEC, '', out);
  return out;
}

/** The value at a dotted path, or undefined if the path does not name a number. */
export function getSpecPath(spec: BikeSpec, path: string): number | undefined {
  let node: unknown = spec;
  for (const seg of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return typeof node === 'number' ? node : undefined;
}

/**
 * Write a value at a dotted path. Returns false — rather than creating the
 * path — when it does not already name a number on the spec.
 *
 * Refusing to create is the important half. `bin/spec set rider.intertialTransfer 1`
 * with the typo left in would otherwise write a field nothing reads, report
 * success, and leave somebody wondering why the bike did not change.
 */
export function setSpecPath(spec: BikeSpec, path: string, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const segs = path.split('.');
  let node: unknown = spec;
  for (let i = 0; i < segs.length - 1; i++) {
    if (node === null || typeof node !== 'object') return false;
    node = (node as Record<string, unknown>)[segs[i]];
  }
  const last = segs[segs.length - 1];
  if (node === null || typeof node !== 'object') return false;
  const target = node as Record<string, unknown>;
  if (typeof target[last] !== 'number') return false;
  target[last] = value;
  return true;
}

export interface SpecChange {
  path: string;
  from: number;
  to: number;
}

/**
 * Every numeric field where two specs disagree. This is what the client turns
 * into "gravity 9 → 9.2" when a spec arrives from somewhere else mid-session:
 * a bike that silently changes under a player who is concentrating is the worst
 * possible outcome, because they conclude they have lost their touch.
 */
export function diffSpec(a: BikeSpec, b: BikeSpec): SpecChange[] {
  const out: SpecChange[] = [];
  for (const p of specPaths()) {
    const from = getSpecPath(a, p);
    const to = getSpecPath(b, p);
    if (from !== undefined && to !== undefined && from !== to) out.push({ path: p, from, to });
  }
  return out;
}

/**
 * Layer a partial override over a base spec, returning a NEW spec plus the
 * paths that were actually applied.
 *
 * `override` is a partial BikeSpec-shaped object — the same shape a whole spec
 * has, with any subset of the fields — so a file written by hand, by
 * `bin/spec set`, or by dumping a complete tuned spec all parse the same way.
 * Unknown paths are reported rather than applied; the caller decides whether
 * that is a warning or an error, because a file written by a newer build with
 * a field this one has not got is a very different situation from a typo on a
 * command line.
 */
export function applySpecOverride(
  base: BikeSpec,
  override: unknown,
): { spec: BikeSpec; applied: string[]; unknown: string[] } {
  const spec = cloneSpec(base);
  const applied: string[] = [];
  const unknownPaths: string[] = [];
  const flat: { path: string; value: unknown }[] = [];

  const flatten = (node: unknown, prefix: string): void => {
    if (node === null || typeof node !== 'object') {
      flat.push({ path: prefix, value: node });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i)));
      return;
    }
    for (const k of Object.keys(node as object)) {
      flatten((node as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k);
    }
  };
  if (override && typeof override === 'object') flatten(override, '');

  for (const { path, value } of flat) {
    if (typeof value === 'number' && setSpecPath(spec, path, value)) applied.push(path);
    else unknownPaths.push(path);
  }
  return { spec, applied, unknown: unknownPaths };
}
