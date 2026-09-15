// Every feel-critical constant on the bike, in one place, content-hashed.
//
// Nothing about the bike may be a literal buried in step.ts. Milestone 1 is
// dozens of tuning iterations driven by the user's own hands on live sliders,
// and a constant that is not in here is a constant that cannot be tuned
// without an edit-save-reload cycle.
//
// Units: metres, kilograms, seconds, radians. y is UP; gravity is -y.
import { Hasher } from './hash.ts';

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
    /** N s/m, along the anchor-to-wheel axis. */
    damping: number;
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
    damping: 500,
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
  h.num(s.suspension.damping);
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
