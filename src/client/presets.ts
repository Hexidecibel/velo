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
// The candidate differs in six numbers, and the reasoning for each is below.
// Everything else — suspension, grip, geometry, masses, brake — is the plan's.
//
// Four of them came out of the user's own hands on the sliders: drive torque,
// chassis inertia, angular damping and lean angle. The other two are the
// rotation-authority fix, and they are set HERE together because they only make
// sense together — attitude torque, chassis inertia and angular damping jointly
// decide the flip rate.
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

  // 11 -> 12 kg m^2. The user's number, arrived at on the sliders. It reads as
  // a heavier, calmer bike on the ground, and together with the angular damping
  // below it sets the flip rate — see attitudeTorque.
  s.chassis.inertia = 12;

  // 0.15 -> 3.0 /s. Also the user's. Barely matters for translation; on the
  // pitch axis it is what stops the bike ringing after a landing, and it is
  // half of what makes a held lean converge to a rate rather than accelerate
  // forever: w(t) = w_inf * (1 - e^(-c t)), so 3.0 /s is a 0.33 s time constant.
  s.damping.angular = 3.0;

  // 40 -> 28 degrees. The user's again, and the earlier note that "below ~50
  // degrees a volt pitches the bike the WRONG way" no longer applies: that was
  // true when the servo's reaction torque was the only rotation authority
  // there was. With attitudeTorque carrying the rotation, lean angle is back to
  // being what it should be — where the rider's WEIGHT and HEAD go — and 28
  // degrees keeps the head out of low ceilings.
  Object.assign(s.rider, leanVectors(28));

  // NEW, and the fix for "spin just keeps going, need to be able to correct
  // easily". 340 N m of attitude-independent torque while a lean key is held.
  // Measured in free fall against inertia 12 and damping 3.0:
  //
  //   a 6-frame tap      46 degrees      an attitude nudge (47 ms)
  //   a 13-frame tap     89 degrees      a committed correction (0.1 s)
  //   a 1 s hold        267 degrees      past inverted, still recoverable
  //   held           4.16-5.74 rad/s     terminal, wobbling once per revolution
  //   first full flip    1.61 s          from rest, including the spin-up
  //   at terminal        1.26 s          per revolution
  //   arresting -6 rad/s 0.18 s          which is the user's actual complaint
  //   arresting -8 rad/s 0.21 s          faster than the bike can reach alone
  //
  // No ramp or charge-up mechanic: a constant torque against linear angular
  // damping already gives w(t) = w_inf * (1 - e^(-c t)), so a tap is a nudge
  // and a hold accelerates to a ceiling. That is what "the longer you hold, the
  // faster you spin (slightly)" wants, and it falls out for free.
  //
  // On flat ground a held lean does NOT lift the front on its own: 340 N m is
  // under the ~410 N m it takes to tip 68 kg over a 0.6 m half-wheelbase. That
  // is the right split — the ground holds you, the air is where you rotate.
  s.rider.attitudeTorque = 340;

  // 1 -> 0.6. Gravity weight transfer is now flavour, not authority. The term
  // peaks at m*g*L = 192 N m, and at full strength that is over half the
  // attitude torque and the wrong half: it depends on the arm's WORLD-horizontal
  // component, so it modulates the spin rate once per revolution and, with a
  // weaker attitude torque than this, it can hold the bike inverted outright —
  // the rider hangs below the pivot and that is a stable equilibrium. Which is
  // precisely the "spin just keeps going" the player felt.
  //
  // What it costs to turn down is almost nothing, which is the surprise here.
  // Measured on flat ground, a 26-frame lean hold from rest:
  //
  //   weightTransfer 1.0   11 deg of pitch, a 12 cm hop, spin band 3.57-6.23
  //   weightTransfer 0.6    9 deg of pitch, a 10 cm hop, spin band 4.16-5.74
  //   weightTransfer 0.4    9 deg of pitch, a  9 cm hop, spin band 4.44-5.49
  //
  // So the ground feel the user signed off on survives, and the airborne spin
  // rate stops swinging by 75%. 0.6 keeps a visible once-per-revolution wobble,
  // which reads as the rider's weight swinging round rather than as noise. It
  // is a slider; 1.0 is the old behaviour exactly.
  s.rider.weightTransfer = 0.6;

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
