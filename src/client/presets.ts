// Bike presets.
//
// `DEFAULT_SPEC` in src/sim/spec.ts holds the plan's constants VERBATIM and is
// not edited here, because it is what every test and every recorded replay is
// keyed to. What it is not is driveable: measured on flat ground, holding the
// throttle from a standstill pitches the bike past 90 degrees within 0.4 s and
// backflips it into the floor, at every drive torque above about 160 N m. So
// the client boots on a tuned candidate instead, and the plan's numbers are one
// click away for comparison.
//
// The candidate differs in exactly four numbers, and the reasoning for each is
// below. Everything else — suspension, grip, geometry, masses, brake — is the
// plan's.
import { DEFAULT_SPEC, cloneSpec } from '@/sim/spec.ts';
import type { BikeSpec } from '@/sim/spec.ts';

/** Bake a lean target from an angle. The PANEL may call Math.sin; the sim may not. */
export function leanVectors(deg: number): { leanL: { x: number; y: number }; leanR: { x: number; y: number } } {
  const r = (deg * Math.PI) / 180;
  const s = Math.sin(r);
  const c = Math.cos(r);
  return { leanL: { x: -s, y: c }, leanR: { x: s, y: c } };
}

/** Recover the angle a pair of lean vectors was baked from, for the slider. */
export function leanAngleOf(spec: BikeSpec): number {
  return (Math.atan2(-spec.rider.leanL.x, spec.rider.leanL.y) * 180) / Math.PI;
}

function m1Candidate(): BikeSpec {
  const s = cloneSpec(DEFAULT_SPEC);

  // 450 -> 140 N m. 450 N m on a 0.25 m wheel is 1800 N of thrust on a 71 kg
  // bike: 2.5 g, far past what mu*N ~= 910 N can actually put down, so the
  // wheel simply spins and the reaction torque loops the chassis. 140 gives
  // ~14 m/s top speed and a bike that goes where you point it.
  s.drive.maxTorque = 140;

  // 11 -> 8 kg m^2. 11 implies a radius of gyration of 0.6 m, i.e. all of the
  // chassis mass at the axles. 8 leaves the volt with enough authority to
  // actually rotate the bike without making the throttle loop it faster.
  s.chassis.inertia = 8;

  // 0.15 -> 0.5 /s. Barely matters for translation; it is here to take the
  // ring out of the pitch axis after a landing.
  s.damping.angular = 0.5;

  // 40 -> 60 degrees. This is the one that makes the volt a real mechanic.
  // Below ~50 degrees the servo's reaction torque dominates and a volt pitches
  // the bike the WRONG way; above it, the rider's weight transfer wins and
  // leaning back lifts the front, which is what a player expects. At 60:
  // a 0.1 s tap gives a 35 degree wheelie and a 30 cm hop, a 0.2 s hold
  // backflips the bike. Both are measured on flat ground.
  Object.assign(s.rider, leanVectors(60));

  return s;
}

export interface Preset {
  id: string;
  label: string;
  spec: BikeSpec;
  note: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'm1',
    label: 'M1 candidate (driveable)',
    spec: m1Candidate(),
    note: 'Four numbers off the plan: drive 140, inertia 8, angular damping 0.5, lean 60 degrees.',
  },
  {
    id: 'plan',
    label: 'Plan defaults (backflips)',
    spec: cloneSpec(DEFAULT_SPEC),
    note: 'The plan verbatim. Holding gas from a standstill loops the bike within half a second.',
  },
  {
    id: 'floaty',
    label: 'Soft + floaty',
    spec: (() => {
      const s = m1Candidate();
      s.suspension.stiffness = 6500;
      s.suspension.damping = 320;
      s.gravity = 8;
      return s;
    })(),
    note: 'Half the spring rate and low gravity. Here to show what the sliders reach, not as a proposal.',
  },
  {
    id: 'grippy',
    label: 'Stiff + grippy',
    spec: (() => {
      const s = m1Candidate();
      s.suspension.stiffness = 22000;
      s.suspension.damping = 900;
      s.wheel.friction = 2.2;
      s.drive.maxTorque = 180;
      return s;
    })(),
    note: 'Nearly rigid suspension and a lot of grip — harsh landings, but it climbs.',
  },
];

export const BOOT_PRESET = PRESETS[0];
