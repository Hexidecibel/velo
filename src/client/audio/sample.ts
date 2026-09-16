// The one file that touches the sim, and it only ever READS.
//
// This is the whole of audio's coupling to the physics: one function, called
// once per rendered frame, that copies out a dozen numbers. Everything
// downstream — the model, the synth — sees a flat struct and cannot reach the
// sim at all even by accident.
//
// The purity guard forbids anything under `src/sim/` growing an audio
// dependency, and this direction is the mirror of it: a replay must be
// bit-identical whether the tab is muted or not. `audio.test.ts` asserts both —
// it runs the sampler against a SimState wrapped in a Proxy that throws on any
// write, and it compares the hash chain of a run sampled every frame against
// one that is not.
import { IN_BRAKE, IN_THROTTLE } from '@/sim/consts.ts';
import { COL_WHEEL0 } from '@/sim/world.ts';
import type { SimState } from '@/sim/step.ts';
import type { World } from '@/sim/world.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import type { RideSample } from './model.ts';

/** The same struct as `RideSample`, but writable — this is the only writer. */
type MutableSample = {
  -readonly [K in keyof RideSample]: K extends 'wheelVy' | 'comp01' ? [number, number] : RideSample[K];
};

// Reused across frames. One allocation for the life of the page rather than one
// per frame: at 144 Hz a fresh object and two fresh tuples per frame is 400+
// short-lived allocations a second for a struct that is overwritten immediately.
const out: MutableSample = {
  tick: 0,
  driveSpin: 0,
  speed: 0,
  grounded: 0,
  slip: 0,
  wheelVy: [0, 0],
  comp01: [0, 0],
  throttle: false,
  brake: false,
  facing: 1,
  dead: false,
  finished: false,
  applesLeft: 0,
  maxWheelSpin: 1,
};
const wheelVy = out.wheelVy;
const comp01 = out.comp01;

/**
 * Sample the sim for the audio engine. Reads only.
 *
 * `mask` is the input mask in force, passed in rather than read off the state,
 * because `state.prevMask` is the mask of the last input frame the SIM saw and
 * the throttle you want to hear is the one being held right now.
 */
export function sampleRide(world: World, s: SimState, spec: BikeSpec, mask: number): RideSample {
  const R = spec.wheel.radius;
  const md = Math.max(spec.suspension.maxDeflection, 1e-6);

  // The bike's own up axis: the chassis rotor applied to (0, 1). Suspension
  // travel is measured along it rather than along world-up, or every reading
  // would be a lie the moment the bike pitched — which is most of the time.
  const upx = -s.oy;
  const upy = s.ox;

  for (let i = 0; i < 2; i++) {
    wheelVy[i] = s.wvy[i];
    // Anchor in world space, and the wheel's offset from it along the bike's up
    // axis. POSITIVE IS COMPRESSED: the spring has zero rest length and pulls
    // the wheel toward the anchor, so the wheel sitting ABOVE its anchor is the
    // state that pushes the chassis up and carries the bike's weight.
    const ax = spec.wheel.anchors[i].x;
    const ay = spec.wheel.anchors[i].y;
    const axw = s.px + (s.ox * ax - s.oy * ay);
    const ayw = s.py + (s.oy * ax + s.ox * ay);
    comp01[i] = ((s.wx[i] - axw) * upx + (s.wy[i] - ayw) * upy) / md;
  }

  // Contact-patch slip, straight out of the quantity step.ts solves friction
  // against: the patch moves at `v.t - spin*R`, so a gripping tyre reads zero
  // and a spinning or locked one reads the difference. The contacts array is
  // the one the last tick filled; the renderer's debug overlay reads the same
  // one for the same reason.
  let slip = 0;
  for (let i = 0; i < world.contactCount; i++) {
    const c = world.contacts[i];
    const w = c.colliderIdx;
    if (w !== COL_WHEEL0 && w !== COL_WHEEL0 + 1) continue;
    const tx = -c.ny;
    const ty = c.nx;
    const v = Math.abs(s.wvx[w] * tx + s.wvy[w] * ty - s.wspin[w] * R);
    if (v > slip) slip = v;
  }

  // Forward-positive spin of the DRIVEN wheel. step.ts picks the rear the same
  // way and derives its torque taper from exactly this number; binding pitch to
  // anything else would make a flip sound like a gear change.
  const rear = s.facing > 0 ? 0 : 1;

  out.tick = s.tick;
  out.driveSpin = s.wspin[rear] * -s.facing;
  out.speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  out.grounded = s.grounded;
  out.slip = slip;
  out.throttle = (mask & IN_THROTTLE) !== 0;
  out.brake = (mask & IN_BRAKE) !== 0;
  out.facing = s.facing;
  out.dead = s.dead;
  out.finished = s.finished;
  out.applesLeft = s.applesLeft;
  out.maxWheelSpin = spec.drive.maxWheelSpin;
  return out;
}
