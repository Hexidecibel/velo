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
// There are two tuned specs here and the distinction is worth stating, because
// it decides which one to trust:
//
//   m1Candidate()  REASONED, with four numbers off the user's sliders. It was
//                  the default until something better turned up.
//   handTuned()    FOUND. The user drove the whole dropdown and picked this
//                  character out of the spread, then fixed the one number that
//                  was wrong. It is the default now.
//
// The dropdown itself is the reason the second one exists. Nobody reasoned
// their way to gravity 9; the user found it because there was a range of
// characters to drive rather than one candidate and a wall of sliders. Offer a
// spread, not a proposal, the next time a feel question comes up.
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

  // 0 -> 0.6 braking, 0.3 driving. The rider's INERTIAL reaction on the pivot,
  // and TWO numbers since SIM_REV 4 because one could not do the job.
  //
  // It arrived in rev 3 as a single coefficient, as the fix for "slamming on
  // the brake should slam down the front end, right? just like gassing lifts
  // up". They were right and that asymmetry was real: drive torque is reacted
  // straight onto the chassis so gassing lifted the front, while braking had no
  // comparable path at all and the nose just did not dive.
  //
  // What the single coefficient then bought was a second, worse deadlock. The
  // term is symmetric read as pure mechanics, so the same rider mass that dives
  // the nose under braking LIFTS it under acceleration — and the user hit that
  // from the other side: "i'm having a hard time hitting top speed without
  // front tire lifting". Every notch that tamed the launch wheelie took the
  // same notch out of the brake dive they liked. The split is not a fudge to
  // escape that; it is a more honest rider. See src/sim/spec.ts and step.ts
  // step 3b for the active-rider argument in full.
  //
  // BRAKE SIDE, 0.6. Where the user signed it off, and it is not moved here:
  // nothing about braking changed in rev 4.
  //
  // RE-MEASURED, and the old table in this comment is gone rather than kept,
  // because it was taken on a broken rig. bin/dive borrowed bin/air's level,
  // whose flat section ends at x = 30, so its "run up and settle" never
  // settled — every row started from wherever the bike happened to be when it
  // ran out of runway. See bin/_dive.ts. The rig now has its own 140 m runway
  // and averages 8 entries across the run-up's limit cycle, and its rows are
  // monotone in the coefficient for the first time.
  //
  // bin/dive --sweep, full brake from 9 m/s with the rear wheel down. Both
  // halves move together, so every row is the old single coefficient:
  //
  //                      at 0.15 s   to -30 deg
  //   inertialTransfer 0    -16.1       0.233 s   (the rev-2 bike)
  //   inertialTransfer 0.3  -19.8       0.208 s
  //   inertialTransfer 0.45 -20.4       0.206 s
  //   inertialTransfer 0.6  -23.4       0.189 s   <- the brake side
  //   inertialTransfer 1.0  -23.2       0.181 s   (physically honest)
  //   inertialTransfer 2.0  -32.3       0.152 s
  //
  // 0.6 rather than the honest 1.0 because sustained full brake already loops
  // the bike over the front at every setting including zero; 1.0 gets there
  // sooner still, which is a bigger change to a signed-off feel than the report
  // asked for. It is a slider, and 1.0 is one drag away.
  //
  // DRIVE SIDE, 0.3. Picked off the wheelie threshold rather than off a feel,
  // because the threshold is a pure torque balance about the rear contact patch
  // and has a closed form. Inertia is absent from it entirely:
  //
  //   mass 71 kg, CoM (0, 0.258), half-wheelbase 0.6 m, CoM 0.658 m above the
  //   contact, so the restoring moment is m*g*a = 383 N m. The nose-up moment
  //   is the whole bike's d'Alembert reaction at CoM height, m*a*h, plus the
  //   rider's extra m_r*L*a scaled by this coefficient.
  //
  //   at drive.maxTorque 126 (F = 504 N, accel 7.1 m/s^2):
  //     drive 0.45   nose-up 393   LIFTS by 10     the user's own hand-tune
  //     drive 0.30   nose-up 373   planted by 11   <- here
  //     drive 0      nose-up 332   planted by 51
  //
  // So the front comes up above 0.373 and stays down below it. 0.3 is the
  // largest round value on the planted side with any margin at all, which makes
  // it the setting that keeps the most throttle-lift feel while still answering
  // the complaint — and it is the value the user had live on data/spec.json
  // while playing, so it is the one they have actually ridden. It is not a
  // claim about what they will settle on: both halves are on the panel and the
  // brake side is untouched, which is the whole point of the split.
  //
  // CONFIRMED DYNAMICALLY, because the threshold above is a static balance and
  // the complaint is about a sustained hold. Full throttle from a standstill on
  // flat ground, time for the chassis to reach 30 degrees nose-up (it reaches
  // 90 eventually at EVERY setting, so the peak measures the loop and not the
  // wheelie — the time to get there is the number that discriminates):
  //
  //   mt 140, both 0.6    0.91 s     the rev-3 bike as shipped
  //   mt 126, both 0.45   1.02 s     the user's own hand-tune
  //   mt 126, both 0.30   1.10 s     what was live on data/spec.json
  //   mt 126, 0.6 / 0.30  1.12 s  <- here
  //   mt 126, 0.6 / 0.45  1.03 s
  //   mt 126, 0.6 / 0      1.48 s
  //
  // Which is the split doing exactly its job: the shipped bike lifts the nose
  // as reluctantly as the symmetric 0.30 the user was riding — 1.12 s against
  // 1.10 s — while braking behaves like 0.6, which the symmetric 0.30 could
  // not. 23% longer to the wheelie than the rev-3 bike, and no brake dive
  // given up for it.
  //
  // bin/dive's grounded-throttle row is NOT where this shows: at 9 m/s the
  // drive torque has already tapered against maxWheelSpin, so there is barely
  // any acceleration left to react to and every coefficient reads the same. The
  // wheelie is a low-speed phenomenon and the rig cruises. Worth giving bin/dive
  // a standstill-launch row; it does not have one yet.
  s.rider.inertialTransferBrake = 0.6;
  s.rider.inertialTransferDrive = 0.3;

  return s;
}

/**
 * THE DEFAULT, and the only spec in this file that was found rather than
 * reasoned to. It is the "soft + floaty" experiment above with gravity raised
 * from 8 to 9, and the provenance matters more than the numbers do: the user
 * drove every preset in the dropdown, picked this character out of the spread,
 * and dialled the one number that was wrong. Their words, in order:
 *
 *   "soft and floaty feels close to original!!!"
 *   "maybe just a TINY bit too floaty"
 *   "gravity on 9 is fucking sick"
 *
 * "Close to original" is the highest praise available on this project, since
 * reproducing how Elasto Mania feels is the whole exercise. So this is not a
 * proposal and not a demo of what the sliders reach — it is the game's feel,
 * arrived at by hand, and the reasoned candidate it replaced is one click away
 * in the dropdown for comparison.
 *
 * Three numbers off `m1Candidate`, and all three pull the same way:
 *
 *   stiffness  12000 -> 6500   Half the spring rate. Long, compliant travel:
 *                              the bike breathes over terrain instead of
 *                              skittering across it. This is the "soft".
 *   damping      500 -> 320    Both coefficients, still symmetric. Less
 *                              dissipation to match the softer spring.
 *   gravity       10 -> 9      Hang time, and the ONLY lever on it. At 8 the
 *                              user called it too floaty; at 9 it is the arc
 *                              they wanted. Nothing in the suspension touches
 *                              this, which is why the earlier hunt through the
 *                              damping sliders could never have found it.
 *
 * A fourth arrived later, by the same route — driven by hand, recovered from an
 * exported replay rather than reasoned to:
 *
 *   maxTorque    140 -> 126    Their number. It is also what the drive-side
 *                              inertial coefficient above was chosen against:
 *                              the wheelie threshold is a torque balance and it
 *                              moves with drive torque, so these two are a
 *                              pair. At 140 the front lifts at full throttle
 *                              above drive 0.096, which is why m1Candidate —
 *                              still at 140 — wheelies on the same coefficient
 *                              and is left that way, being a comparison preset.
 */
function handTuned(): BikeSpec {
  const s = m1Candidate();
  s.suspension.stiffness = 6500;
  s.suspension.compressionDamping = 320;
  s.suspension.reboundDamping = 320;
  s.gravity = 9;
  s.drive.maxTorque = 126;
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
    id: 'soft',
    label: 'Soft (hand-tuned default)',
    spec: handTuned(),
    note: 'Found by the user on these sliders, not derived: half the spring rate, gravity 9. "Close to original."',
  },
  {
    id: 'm1',
    label: 'Stiffer, earlier (first candidate)',
    spec: m1Candidate(),
    note: 'The reasoned candidate the soft default replaced. Stiffer and heavier-feeling; kept for comparison.',
  },
  {
    id: 'plan',
    label: 'Plan defaults (backflips)',
    spec: cloneSpec(DEFAULT_SPEC),
    note: 'The plan verbatim. Holding gas from a standstill loops the bike within half a second.',
  },
  {
    id: 'floaty',
    label: 'Softer + lower gravity',
    spec: (() => {
      const s = handTuned();
      s.gravity = 8;
      return s;
    })(),
    note: 'The default at gravity 8 — the version the user called "a TINY bit too floaty". One slider apart.',
  },
  {
    id: 'poppy',
    label: 'Soft + poppy (asymmetric damping)',
    spec: (() => {
      const s = handTuned();
      // The default with the two damping coefficients pulled apart — the only
      // preset that uses the asymmetry at all. REBOUND ALONE comes down;
      // compression stays exactly where the user left it.
      //
      // That is not the textbook recipe and the measurement is why. The obvious
      // move is "compression up so landings stay planted, rebound down so it
      // pops", but compression damping is what decides how much energy gets
      // INTO the spring in the first place, so raising it costs more launch
      // than the lower rebound buys back: bin/air measured comp 450 / rebound
      // 180 at a LOWER mean peak than the symmetric default. Lowering rebound
      // on its own is the move that works.
      //
      // Measured on bin/air's 0.2 m bump, mean peak chassis height over
      // approach speeds 5-12 m/s: rebound 800 -> 0.178 m, 500 -> 0.209,
      // 320 (the default) -> 0.244, 120 -> 0.281. Touchdown speed off the drop
      // is unchanged to within 0.1 m/s across the whole range, which is the
      // point of splitting the coefficient: the launch half moved and the
      // landing half did not.
      s.suspension.reboundDamping = 150;
      return s;
    })(),
    note: 'The default with rebound damping halved: same landings, about a third more height off bumps. Try it if you want more air off terrain; the default is symmetric.',
  },
  {
    id: 'grippy',
    label: 'Stiff + grippy',
    spec: (() => {
      const s = m1Candidate();
      s.suspension.stiffness = 22000;
      s.suspension.compressionDamping = 900;
      s.suspension.reboundDamping = 900;
      s.wheel.friction = 2.2;
      s.drive.maxTorque = 180;
      return s;
    })(),
    note: 'Nearly rigid suspension and a lot of grip — harsh landings, but it climbs.',
  },
];

/** What the client boots on. The dropdown is ordered with it first. */
export const BOOT_PRESET = PRESETS[0];
