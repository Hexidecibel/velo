// CLI front end for the pitch rig. See bin/dive.
import { BRAKE, SAMPLES, THROTTLE, launchFromRest, pitchUnder } from './_dive.ts';
import { PRESETS } from '../src/client/presets.ts';
import { cloneSpec } from '../src/sim/spec.ts';
import type { BikeSpec } from '../src/sim/spec.ts';

const argv = process.argv.slice(2);
let only: string | null = null;
let sweep: number[] | null = null;
/** Which half of the inertial transfer a sweep moves: both, brake only, drive only. */
let side: 'both' | 'brake' | 'drive' = 'both';
let speed = 9;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--preset') only = argv[++i];
  else if (a === '--sweep') sweep = argv[++i].split(',').map(Number);
  else if (a === '--sweep-brake') { sweep = argv[++i].split(',').map(Number); side = 'brake'; }
  else if (a === '--sweep-drive') { sweep = argv[++i].split(',').map(Number); side = 'drive'; }
  else if (a === '--speed') speed = Number(argv[++i]);
  else {
    console.error(`bin/dive: unknown argument ${a}`);
    process.exit(2);
  }
}

/**
 * Set one or both halves of the rider's inertial transfer.
 *
 * `--sweep` moves BOTH, which is deliberately the default: with the two equal
 * the branch in step.ts selects the same number either way, so a both-sweep row
 * is exactly the old single-coefficient bike and the historical table in
 * presets.ts stays comparable. Sweep one half to see the split do its job.
 */
function withInertial(spec: BikeSpec, v: number): BikeSpec {
  const s = cloneSpec(spec);
  if (side !== 'drive') s.rider.inertialTransferBrake = v;
  if (side !== 'brake') s.rider.inertialTransferDrive = v;
  return s;
}

function row(label: string, spec: BikeSpec): void {
  const b = pitchUnder(spec, BRAKE, { speed });
  const t = pitchUnder(spec, THROTTLE, { speed });
  const air = pitchUnder(spec, BRAKE, { speed, airborne: true });
  const launch = launchFromRest(spec);
  const cols = (r: { at: number[] }): string => r.at.map((v) => v.toFixed(1).padStart(7)).join('');
  const tail = (r: { to30: number; peakRate: number; wentOver: boolean; upToSpeed: boolean; spread: number }): string =>
    `  +-${(r.spread / 2).toFixed(1).padStart(4)}   to -30 ${r.to30 < 0 ? '  n/a' : r.to30.toFixed(3)}   rate ${r.peakRate.toFixed(0).padStart(5)} deg/s${r.wentOver ? '   OVER THE BARS' : ''}${r.upToSpeed ? '' : '   NEVER REACHED SPEED — not a measurement'}`;
  console.log(`==> ${label}`);
  console.log(`    brake, grounded   ${cols(b)}${tail(b)}   entry ${b.entry.toFixed(2)} m/s`);
  console.log(`    throttle, grounded${cols(t)}${tail(t)}   entry ${t.entry.toFixed(2)} m/s`);
  console.log(`    brake, AIRBORNE   ${cols(air)}${tail(air)}   (wheel reaction — a different mechanism)`);
  // Positive here, and the only row that is: this one is nose-UP. It is also
  // the only row in which the drive half of the inertial transfer is
  // measurable, because at 9 m/s drive torque has already tapered against
  // maxWheelSpin and every coefficient reads the same.
  console.log(
    `    throttle FROM REST${cols(launch)}` +
      `  +- 0.0   to +30 ${launch.to30 < 0 ? '  n/a' : launch.to30.toFixed(3)}` +
      `   rate ${launch.peakRate.toFixed(0).padStart(5)} deg/s${launch.wentOver ? '   LOOPED' : ''}` +
      `${launch.died ? '   DIED' : ''}   (NOSE-UP; the wheelie half)`,
  );
}

console.log('    pitch in degrees at ' + SAMPLES.map((v) => v + 's').join(' / ') + ', relative to the attitude when the input landed');
console.log('    MEAN over 8 entries spread across the run-up\'s limit cycle; +- is half the spread at the last sample.');
console.log('    NEGATIVE = nose down, EXCEPT the from-rest row, which is nose-UP. Facing is +x throughout.');
console.log('    columns:           ' + SAMPLES.map((v) => (v + 's').padStart(7)).join(''));
console.log('');

if (sweep) {
  const base = PRESETS.find((p) => p.id === (only ?? PRESETS[0].id)) ?? PRESETS[0];
  const what = side === 'both' ? 'both halves' : `the ${side} half`;
  console.log(`sweeping ${what} of rider.inertialTransfer* on "${base.label}" at ${speed} m/s\n`);
  for (const v of sweep) row(`inertialTransfer ${side} ${v}`, withInertial(base.spec, v));
} else {
  for (const p of PRESETS) {
    if (only && p.id !== only) continue;
    row(`${p.label}   [inertial brake ${p.spec.rider.inertialTransferBrake} / drive ${p.spec.rider.inertialTransferDrive}, weightTransfer ${p.spec.rider.weightTransfer}, maxTorque ${p.spec.drive.maxTorque}]`, p.spec);
  }
}
