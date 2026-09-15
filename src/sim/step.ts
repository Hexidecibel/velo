// One sim tick. The tick ORDER below is frozen: reordering it changes results
// even when every formula is unchanged, so it moves only with SIM_REV.
//
//   1. rider servo      PD torque toward the volt target; -tau on the chassis
//   2. drive / brake    torque on the wheel, reaction on the chassis
//   3. suspension       isotropic spring-damper (asymmetric comp/rebound)
//  3b. rider on pivot   static weight + INERTIAL reaction, both at the head
//   4. integrate v      semi-implicit Euler, gravity folded in
//   5. arm rate         gravity + pivot pseudo-force + servo
//   6. damping          v /= (1 + c*DT)
//   7. integrate x      positions, chassis rotor, arm rotor
//   8. broadphase + narrowphase, contacts SORTED
//   9. contact solve    normal + Coulomb friction, Baumgarte bias
//  10. suspension clamp hard radial limit at maxDeflection
//  11. head             the death sphere
//  12. apples, flower
//
// `stepTick` takes no dt argument, and neither does anything that calls it. If
// the signature permits one, someone eventually passes a variable dt and every
// replay downstream is silently poisoned.
import {
  DT,
  EPS,
  IN_BRAKE,
  IN_LEAN_L,
  IN_LEAN_R,
  IN_THROTTLE,
  SOLVER_ITERS,
  CONTACT_SLOP,
  BAUMGARTE,
  MAX_CORRECTION_VEL,
  CHASSIS_FRICTION,
  CHASSIS_RESTITUTION,
  RESTITUTION_CUTOFF,
  MAX_ANGVEL,
  MAX_ARM_ANGVEL,
  MAX_SPEED,
  PICKUP_RADIUS,
} from './consts.ts';
import { rotIntegrate, rotNormalize, rotX, rotY } from './rot.ts';
import type { Rot } from './rot.ts';
import { compareContacts } from './collide.ts';
import type { Contact } from './collide.ts';
import { COL_CHASSIS0, COL_WHEEL0, circleTouchesSolid, collectContacts } from './world.ts';
import type { World } from './world.ts';
import { Hasher } from './hash.ts';

export interface SimState {
  tick: number;

  // chassis rigid body
  px: number;
  py: number;
  vx: number;
  vy: number;
  /** Orientation rotor (cos, sin). Never an angle. */
  ox: number;
  oy: number;
  w: number;

  // wheels: point masses with one rotational scalar each
  wx: Float64Array;
  wy: Float64Array;
  wvx: Float64Array;
  wvy: Float64Array;
  wspin: Float64Array;

  // rider arm: world-space unit direction from the chassis pivot, plus its rate
  ax: number;
  ay: number;
  aw: number;

  /** +1 or -1. Selects the driven wheel and mirrors the sprite. */
  facing: number;
  /** Previous input frame's mask; only the flip bit's rising edge uses it. */
  prevMask: number;

  applesTaken: Uint8Array;
  applesLeft: number;
  dead: boolean;
  finished: boolean;
  /** Tick at which the run ended, or -1. */
  endTick: number;
  /** Bit i set when wheel i has a contact. Render/HUD only, but hashed. */
  grounded: number;
}

export function createState(w: World): SimState {
  const sp = w.spec;
  const st: SimState = {
    tick: 0,
    px: w.level.start.x,
    py: w.level.start.y,
    vx: 0,
    vy: 0,
    ox: 1,
    oy: 0,
    w: 0,
    wx: new Float64Array(2),
    wy: new Float64Array(2),
    wvx: new Float64Array(2),
    wvy: new Float64Array(2),
    wspin: new Float64Array(2),
    ax: sp.rider.rest.x,
    ay: sp.rider.rest.y,
    aw: 0,
    facing: 1,
    prevMask: 0,
    applesTaken: new Uint8Array(w.level.apples.length),
    applesLeft: w.level.apples.length,
    dead: false,
    finished: false,
    endTick: -1,
    grounded: 0,
  };
  for (let i = 0; i < 2; i++) {
    st.wx[i] = st.px + sp.wheel.anchors[i].x;
    st.wy[i] = st.py + sp.wheel.anchors[i].y;
  }
  return st;
}

// Per-tick scratch. Module-level rather than on World because `stepTick` is
// synchronous and never yields, so no two calls are ever live at once — and
// keeping it off World keeps World cheap to reason about.
const SWF_X = new Float64Array(2);
const SWF_Y = new Float64Array(2);
const SWT = new Float64Array(2);

export function stepTick(w: World, s: SimState, mask: number): void {
  // A finished or dead run freezes. The state hash then stays constant, which
  // is what makes "the replay is N frames long" a meaningful statement.
  if (s.dead || s.finished) {
    s.tick++;
    return;
  }

  const sp = w.spec;
  const rot: Rot = { x: s.ox, y: s.oy };
  const R = sp.wheel.radius;

  let fx = 0;
  let fy = 0;
  let tq = 0;
  SWF_X[0] = 0;
  SWF_X[1] = 0;
  SWF_Y[0] = 0;
  SWF_Y[1] = 0;
  SWT[0] = 0;
  SWT[1] = 0;

  // --- 1. rider servo ---------------------------------------------------
  // The volt. A PD servo drives the arm toward a chassis-local target and puts
  // the equal-and-opposite torque on the chassis. It still MOVES THE ARM, and
  // therefore the head, which is what makes volting into a low ceiling lethal —
  // a real skill worth keeping. What it is no longer is the main source of
  // rotation: see `attitudeTorque` below and in spec.ts.
  const leanL = (mask & IN_LEAN_L) !== 0;
  const leanR = (mask & IN_LEAN_R) !== 0;
  let tlx = sp.rider.rest.x;
  let tly = sp.rider.rest.y;
  if (leanL !== leanR) {
    tlx = leanL ? sp.rider.leanL.x : sp.rider.leanR.x;
    tly = leanL ? sp.rider.leanL.y : sp.rider.leanR.y;
  }
  const tgx = rotX(rot, tlx, tly);
  const tgy = rotY(rot, tlx, tly);

  // Error as the SINE of the arm-to-target angle, saturated past 90 degrees.
  // Not an angle, because an angle needs atan2. Monotone on (-90, 90) and
  // bounded outside it, which is all a P term needs.
  const sinErr = s.ax * tgy - s.ay * tgx;
  const cosErr = s.ax * tgx + s.ay * tgy;
  const err = cosErr >= 0 ? sinErr : sinErr >= 0 ? 1 : -1;

  let servoT = sp.rider.servoP * err - sp.rider.servoD * (s.aw - s.w);
  const servoMax = sp.rider.servoMaxTorque;
  if (servoT > servoMax) servoT = servoMax;
  else if (servoT < -servoMax) servoT = -servoMax;
  tq -= servoT;

  // Weight transfer used to be applied here. It has MOVED to step 3b, after
  // the suspension, because it is now evaluated in the pivot's accelerating
  // frame and therefore needs the chassis acceleration — which is known only
  // once the suspension forces are in. Nothing else changed about it; see 3b.

  // Attitude control. A constant torque on the chassis while a lean key is
  // held, sign from the direction, with NO dependence on chassis orientation or
  // on gravity. This is the primary rotation control and it is a gameplay term,
  // not a physical one: nothing receives the reaction, so angular momentum is
  // not conserved. That is deliberate and Elma-faithful — left and right rotate
  // the bike identically at every attitude, which is the whole reason a spin is
  // recoverable there. The full reasoning, including the physically-honest
  // version that was rejected, is on `attitudeTorque` in spec.ts.
  if (leanL !== leanR) tq += leanL ? sp.rider.attitudeTorque : -sp.rider.attitudeTorque;

  // --- 2. drive and brake -----------------------------------------------
  // Torque ON THE WHEEL with reaction on the chassis, not a force at the
  // contact patch. That is what gives mid-air throttle counter-rotation and
  // brake-pitch.
  const rear = s.facing > 0 ? 0 : 1;
  if ((mask & IN_THROTTLE) !== 0) {
    // Forward-positive wheel spin. Torque falls off LINEARLY to zero at
    // maxWheelSpin; a piecewise-linear curve, never an exponential one, because
    // an exponential needs Math.exp.
    const fwd = s.wspin[rear] * -s.facing;
    let frac = 1 - fwd / sp.drive.maxWheelSpin;
    if (frac > 1) frac = 1;
    else if (frac < 0) frac = 0;
    SWT[rear] += -s.facing * sp.drive.maxTorque * frac;
  }
  if ((mask & IN_BRAKE) !== 0) {
    for (let i = 0; i < 2; i++) {
      const spn = s.wspin[i];
      // Cap so one tick can never drive the spin through zero and out the
      // other side, which would make the brake a reverse gear at low speed.
      const cap = (Math.abs(spn) * sp.wheel.inertia) / DT;
      let bt = sp.drive.brakeTorque;
      if (bt > cap) bt = cap;
      SWT[i] -= Math.sign(spn) * bt;
    }
  }
  tq -= SWT[0] + SWT[1];

  // --- 3. suspension ----------------------------------------------------
  // ISOTROPIC: the wheel is pulled toward its chassis-local anchor in ANY
  // direction, zero rest length. Not a prismatic constraint along the bike's
  // down-axis — that transmits every horizontal impulse rigidly and makes
  // landings harsh with no fore-aft compliance.
  for (let i = 0; i < 2; i++) {
    const rx = rotX(rot, sp.wheel.anchors[i].x, sp.wheel.anchors[i].y);
    const ry = rotY(rot, sp.wheel.anchors[i].x, sp.wheel.anchors[i].y);
    const dx = s.px + rx - s.wx[i];
    const dy = s.py + ry - s.wy[i];
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS) continue;
    const len = Math.sqrt(len2);
    const ux = dx / len;
    const uy = dy / len;
    // Velocity of the anchor POINT on the chassis, not of the chassis origin.
    const avx = s.vx - s.w * ry;
    const avy = s.vy + s.w * rx;
    const rate = (avx - s.wvx[i]) * ux + (avy - s.wvy[i]) * uy;
    // Asymmetric damping. `rate` is d(len)/dt with len the anchor-to-wheel
    // distance, so rate < 0 is the COMPRESSION stroke (the wheel coming up into
    // the bike on a landing or a bump) and rate > 0 is REBOUND (the spring
    // pushing it back out). Picking the coefficient off the sign is the whole
    // mechanism: compression damping stays high so landings stay planted, and
    // rebound damping comes down so the spring returns its stored energy to the
    // bike instead of to heat, which is what makes a feature pop you.
    //
    // With the two equal this is arithmetically identical to the single
    // coefficient of rev 2 — the branch selects the same number.
    const c = rate < 0 ? sp.suspension.compressionDamping : sp.suspension.reboundDamping;
    const mag = sp.suspension.stiffness * len + c * rate;
    const sfx = mag * ux;
    const sfy = mag * uy;
    SWF_X[i] += sfx;
    SWF_Y[i] += sfy;
    fx -= sfx;
    fy -= sfy;
    tq -= rx * sfy - ry * sfx;
  }

  // --- 3b. the rider on the pivot ---------------------------------------
  // The chassis's own linear acceleration, needed HERE rather than in step 4
  // because the rider's reaction depends on it. This is legitimate and not a
  // circular dependency: fx and fy come from the suspension alone and no torque
  // term feeds into them, so the translational acceleration is already final at
  // this point in the tick even though the angular one is not.
  const acx = fx * w.invChassisMass;
  const acy = fy * w.invChassisMass - sp.gravity;

  // The rider's mass sits L metres up an arm on the pivot, and what it pulls
  // against is not gravity but gravity MINUS the pivot's acceleration. Splitting
  // that into its two halves is what lets them be tuned apart:
  //
  //   STATIC, scaled by `weightTransfer` — tau = cross(L*u, (0, -m*g)).
  //     Without it, the rider's mass sits exactly on the rotation centre,
  //     moving the arm cannot move the system's centre of mass, and leaning has
  //     no steady-state effect at all. Measured: with gas held from a standstill
  //     the bike looped at every drive torque above ~170 N m and holding "lean
  //     forward" made it loop SOONER. One line fixes that and makes leaning back
  //     on the throttle produce a wheelie. It depends on the arm's WORLD-
  //     horizontal component, so over a revolution it averages to zero — during
  //     a spin it is a wobble, not a brake — which is why it is scaled down to
  //     flavour and `attitudeTorque` carries the rotation authority.
  //
  //   INERTIAL, scaled by `inertialTransfer` — tau = cross(L*u, -m*a_pivot).
  //     The term the old comment here called the top M2 candidate. Brake and
  //     the pivot decelerates while 35 kg of rider keeps going: that is the
  //     stoppie, and it was missing entirely. Gas and it mirrors. Land and the
  //     pivot decelerates upward, so the rider's weight lands with the bike.
  //     Unlike the static half it does NOT average to zero over a revolution,
  //     because it tracks what the bike is doing rather than which way it is
  //     pointing, and unlike a brake-input special case it is one honest term
  //     that happens to produce all of those behaviours.
  //
  // Together they are exactly `cross(L*u, m*(g_vec - a_pivot))`, which is the
  // same quantity the arm itself integrates in step 5 — see `ex`/`ey` there.
  tq += -sp.rider.mass * sp.gravity * sp.rider.armLength * s.ax * sp.rider.weightTransfer;
  tq += sp.rider.mass * sp.rider.armLength * (s.ay * acx - s.ax * acy) * sp.rider.inertialTransfer;

  // --- 4. integrate velocities ------------------------------------------
  s.vx += acx * DT;
  s.vy += acy * DT;
  s.w += tq * w.invChassisInertia * DT;
  for (let i = 0; i < 2; i++) {
    s.wvx[i] += SWF_X[i] * w.invWheelMass * DT;
    s.wvy[i] += (SWF_Y[i] * w.invWheelMass - sp.gravity) * DT;
    s.wspin[i] += SWT[i] * w.invWheelInertia * DT;
  }

  // --- 5. arm rate ------------------------------------------------------
  // In the pivot's accelerating frame the rider sees gravity plus the pivot
  // pseudo-force. Including the pseudo-force is what makes a hard landing throw
  // the rider forward instead of leaving him welded upright. Step 3b now feeds
  // the chassis half of the same quantity; the two are deliberately the same
  // physics seen from the two ends of the arm.
  const ex = -acx;
  const ey = -sp.gravity - acy;
  s.aw += ((s.ax * ey - s.ay * ex) / sp.rider.armLength + servoT * w.invArmInertia) * DT;

  // --- 6. damping -------------------------------------------------------
  // v /= (1 + c*DT). Unconditionally stable at any DT and, unlike the exact
  // v *= exp(-c*DT), free of Math.exp.
  const dl = 1 / (1 + sp.damping.linear * DT);
  const da = 1 / (1 + sp.damping.angular * DT);
  s.vx *= dl;
  s.vy *= dl;
  s.w *= da;
  s.aw *= da;
  for (let i = 0; i < 2; i++) {
    s.wvx[i] *= dl;
    s.wvy[i] *= dl;
    s.wspin[i] *= da;
  }

  clampState(s);

  // --- 7. integrate positions -------------------------------------------
  s.px += s.vx * DT;
  s.py += s.vy * DT;
  const nrot = rotIntegrate(rot, s.w, DT);
  s.ox = nrot.x;
  s.oy = nrot.y;
  const narm = rotIntegrate({ x: s.ax, y: s.ay }, s.aw, DT);
  s.ax = narm.x;
  s.ay = narm.y;
  for (let i = 0; i < 2; i++) {
    s.wx[i] += s.wvx[i] * DT;
    s.wy[i] += s.wvy[i] * DT;
  }

  // --- 8. contacts ------------------------------------------------------
  w.contactCount = 0;
  collectContacts(w, COL_WHEEL0, s.wx[0], s.wy[0], R);
  collectContacts(w, COL_WHEEL0 + 1, s.wx[1], s.wy[1], R);
  for (let c = 0; c < sp.chassis.colliders.length; c++) {
    const col = sp.chassis.colliders[c];
    const cxw = s.px + rotX(nrot, col.x, col.y);
    const cyw = s.py + rotY(nrot, col.x, col.y);
    collectContacts(w, COL_CHASSIS0 + c, cxw, cyw, col.r);
  }
  const contacts = w.contacts.slice(0, w.contactCount);
  // Sorting by (colliderIdx, polyIdx, edgeIdx) is a DETERMINISM requirement,
  // not an optimisation: a sequential impulse solver is order-dependent and the
  // broadphase emits candidates in cell order, which depends on where the bike
  // happens to be standing.
  contacts.sort(compareContacts);

  s.grounded = 0;
  for (const c of contacts) {
    if (c.colliderIdx === COL_WHEEL0) s.grounded |= 1;
    else if (c.colliderIdx === COL_WHEEL0 + 1) s.grounded |= 2;
  }

  // --- 9. contact solve -------------------------------------------------
  solveContacts(w, s, contacts);

  // --- 10. suspension hard clamp ----------------------------------------
  for (let i = 0; i < 2; i++) {
    const rx = rotX(nrot, sp.wheel.anchors[i].x, sp.wheel.anchors[i].y);
    const ry = rotY(nrot, sp.wheel.anchors[i].x, sp.wheel.anchors[i].y);
    const axw = s.px + rx;
    const ayw = s.py + ry;
    const dx = axw - s.wx[i];
    const dy = ayw - s.wy[i];
    const len2 = dx * dx + dy * dy;
    const md = sp.suspension.maxDeflection;
    if (len2 <= md * md || len2 < EPS) continue;
    const len = Math.sqrt(len2);
    const ux = dx / len;
    const uy = dy / len;
    s.wx[i] = axw - ux * md;
    s.wy[i] = ayw - uy * md;
    const avx = s.vx - s.w * ry;
    const avy = s.vy + s.w * rx;
    const rel = (s.wvx[i] - avx) * ux + (s.wvy[i] - avy) * uy;
    if (rel < 0) {
      // Separating faster than the clamp allows. The wheel is a tenth of the
      // chassis mass, so the momentum is absorbed by the wheel alone rather
      // than split. In practice the spring never lets it get here.
      s.wvx[i] -= rel * ux;
      s.wvy[i] -= rel * uy;
    }
  }

  // --- 11. the death sphere ---------------------------------------------
  const hx = s.px + sp.rider.armLength * s.ax;
  const hy = s.py + sp.rider.armLength * s.ay;
  if (circleTouchesSolid(w, hx, hy, sp.rider.headRadius)) {
    s.dead = true;
    s.endTick = s.tick + 1;
  }

  // --- 12. apples and flower --------------------------------------------
  if (!s.dead) {
    const pr2 = PICKUP_RADIUS * PICKUP_RADIUS;
    for (let a = 0; a < w.level.apples.length; a++) {
      if (s.applesTaken[a] !== 0) continue;
      const ap = w.level.apples[a];
      if (touchesPoint(s, hx, hy, ap.x, ap.y, pr2)) {
        s.applesTaken[a] = 1;
        s.applesLeft--;
      }
    }
    if (s.applesLeft === 0) {
      const fl = w.level.flower;
      if (touchesPoint(s, hx, hy, fl.x, fl.y, pr2)) {
        s.finished = true;
        s.endTick = s.tick + 1;
      }
    }
  }

  s.tick++;
}

/** Any of the bike's four reference points within `r2` of (tx, ty). */
function touchesPoint(s: SimState, hx: number, hy: number, tx: number, ty: number, r2: number): boolean {
  let dx = hx - tx;
  let dy = hy - ty;
  if (dx * dx + dy * dy <= r2) return true;
  dx = s.px - tx;
  dy = s.py - ty;
  if (dx * dx + dy * dy <= r2) return true;
  for (let i = 0; i < 2; i++) {
    dx = s.wx[i] - tx;
    dy = s.wy[i] - ty;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

function clampState(s: SimState): void {
  if (s.w > MAX_ANGVEL) s.w = MAX_ANGVEL;
  else if (s.w < -MAX_ANGVEL) s.w = -MAX_ANGVEL;
  if (s.aw > MAX_ARM_ANGVEL) s.aw = MAX_ARM_ANGVEL;
  else if (s.aw < -MAX_ARM_ANGVEL) s.aw = -MAX_ARM_ANGVEL;
  const sp2 = s.vx * s.vx + s.vy * s.vy;
  if (sp2 > MAX_SPEED * MAX_SPEED) {
    const k = MAX_SPEED / Math.sqrt(sp2);
    s.vx *= k;
    s.vy *= k;
  }
  for (let i = 0; i < 2; i++) {
    const w2 = s.wvx[i] * s.wvx[i] + s.wvy[i] * s.wvy[i];
    if (w2 > MAX_SPEED * MAX_SPEED) {
      const k = MAX_SPEED / Math.sqrt(w2);
      s.wvx[i] *= k;
      s.wvy[i] *= k;
    }
  }
}

function solveContacts(w: World, s: SimState, contacts: Contact[]): void {
  if (contacts.length === 0) return;
  const sp = w.spec;
  const R = sp.wheel.radius;
  const invWM = w.invWheelMass;
  const invWI = w.invWheelInertia;
  const invCM = w.invChassisMass;
  const invCI = w.invChassisInertia;
  const wheelEmT = invWM + R * R * invWI;

  for (let iter = 0; iter < SOLVER_ITERS; iter++) {
    for (let k = 0; k < contacts.length; k++) {
      const c = contacts[k];
      const nx = c.nx;
      const ny = c.ny;
      const tx = -ny;
      const ty = nx;

      // Baumgarte: penetration becomes a target separating velocity rather
      // than a separate positional projection pass.
      let bias = (BAUMGARTE * (c.depth - CONTACT_SLOP)) / DT;
      if (bias < 0) bias = 0;
      else if (bias > MAX_CORRECTION_VEL) bias = MAX_CORRECTION_VEL;

      const isWheel = c.colliderIdx < COL_CHASSIS0;
      if (isWheel) {
        const i = c.colliderIdx;
        const vn = s.wvx[i] * nx + s.wvy[i] * ny;
        let target = bias;
        let rest = sp.wheel.restitution;
        if (-vn < RESTITUTION_CUTOFF) rest = 0;
        const bounce = -rest * vn;
        if (bounce > target) target = bounce;
        if (vn < target) {
          const jn = (target - vn) / invWM;
          s.wvx[i] += jn * nx * invWM;
          s.wvy[i] += jn * ny * invWM;

          // Coulomb friction with SPIN COUPLING. The contact patch velocity is
          // v.t - spin*R, so the same impulse both slows the slide and spins
          // the wheel; that is what turns drive torque into forward motion and
          // what makes a spun-up wheel launch you on landing.
          const vt = (s.wvx[i] * tx + s.wvy[i] * ty) - s.wspin[i] * R;
          let jt = -vt / wheelEmT;
          const lim = sp.wheel.friction * jn;
          if (jt > lim) jt = lim;
          else if (jt < -lim) jt = -lim;
          s.wvx[i] += jt * tx * invWM;
          s.wvy[i] += jt * ty * invWM;
          s.wspin[i] += -R * jt * invWI;
        }
      } else {
        const rx = c.px - s.px;
        const ry = c.py - s.py;
        const vpx = s.vx - s.w * ry;
        const vpy = s.vy + s.w * rx;
        const vn = vpx * nx + vpy * ny;
        const rn = rx * ny - ry * nx;
        const emN = invCM + rn * rn * invCI;
        let target = bias;
        let rest = CHASSIS_RESTITUTION;
        if (-vn < RESTITUTION_CUTOFF) rest = 0;
        const bounce = -rest * vn;
        if (bounce > target) target = bounce;
        if (vn < target) {
          const jn = (target - vn) / emN;
          s.vx += jn * nx * invCM;
          s.vy += jn * ny * invCM;
          s.w += (rx * (jn * ny) - ry * (jn * nx)) * invCI;

          const vpx2 = s.vx - s.w * ry;
          const vpy2 = s.vy + s.w * rx;
          const vt = vpx2 * tx + vpy2 * ty;
          const rt = rx * ty - ry * tx;
          const emT = invCM + rt * rt * invCI;
          let jt = -vt / emT;
          const lim = CHASSIS_FRICTION * jn;
          if (jt > lim) jt = lim;
          else if (jt < -lim) jt = -lim;
          s.vx += jt * tx * invCM;
          s.vy += jt * ty * invCM;
          s.w += (rx * (jt * ty) - ry * (jt * tx)) * invCI;
        }
      }
    }
  }
}

/** Snapshot-safe deep copy. Cheap and fixed-size: the solver will call it a lot. */
export function copyState(s: SimState): SimState {
  return {
    tick: s.tick,
    px: s.px,
    py: s.py,
    vx: s.vx,
    vy: s.vy,
    ox: s.ox,
    oy: s.oy,
    w: s.w,
    wx: s.wx.slice(),
    wy: s.wy.slice(),
    wvx: s.wvx.slice(),
    wvy: s.wvy.slice(),
    wspin: s.wspin.slice(),
    ax: s.ax,
    ay: s.ay,
    aw: s.aw,
    facing: s.facing,
    prevMask: s.prevMask,
    applesTaken: s.applesTaken.slice(),
    applesLeft: s.applesLeft,
    dead: s.dead,
    finished: s.finished,
    endTick: s.endTick,
    grounded: s.grounded,
  };
}

export function assignState(dst: SimState, src: SimState): void {
  dst.tick = src.tick;
  dst.px = src.px;
  dst.py = src.py;
  dst.vx = src.vx;
  dst.vy = src.vy;
  dst.ox = src.ox;
  dst.oy = src.oy;
  dst.w = src.w;
  dst.wx.set(src.wx);
  dst.wy.set(src.wy);
  dst.wvx.set(src.wvx);
  dst.wvy.set(src.wvy);
  dst.wspin.set(src.wspin);
  dst.ax = src.ax;
  dst.ay = src.ay;
  dst.aw = src.aw;
  dst.facing = src.facing;
  dst.prevMask = src.prevMask;
  dst.applesTaken.set(src.applesTaken);
  dst.applesLeft = src.applesLeft;
  dst.dead = src.dead;
  dst.finished = src.finished;
  dst.endTick = src.endTick;
  dst.grounded = src.grounded;
}

/**
 * Hash of everything that can affect a future tick, plus the run outcome.
 * Field order is frozen with SIM_REV.
 */
export function hashState(s: SimState): string {
  const h = new Hasher();
  h.int(s.tick);
  h.num(s.px);
  h.num(s.py);
  h.num(s.vx);
  h.num(s.vy);
  h.num(s.ox);
  h.num(s.oy);
  h.num(s.w);
  for (let i = 0; i < 2; i++) {
    h.num(s.wx[i]);
    h.num(s.wy[i]);
    h.num(s.wvx[i]);
    h.num(s.wvy[i]);
    h.num(s.wspin[i]);
  }
  h.num(s.ax);
  h.num(s.ay);
  h.num(s.aw);
  h.int(s.facing);
  h.int(s.prevMask);
  h.int(s.applesLeft);
  for (let i = 0; i < s.applesTaken.length; i++) h.byte(s.applesTaken[i]);
  h.bool(s.dead);
  h.bool(s.finished);
  h.int(s.endTick);
  h.int(s.grounded);
  return h.digest();
}

/** Renormalise a rotor that has been restored or hand-built. */
export function normalizeStateRotors(s: SimState): void {
  const r = rotNormalize(s.ox, s.oy);
  s.ox = r.x;
  s.oy = r.y;
  const a = rotNormalize(s.ax, s.ay);
  s.ax = a.x;
  s.ay = a.y;
}
