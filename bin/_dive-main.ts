// CLI front end for the pitch rig. See bin/dive.
import { BRAKE, SAMPLES, THROTTLE, pitchUnder } from './_dive.ts';
import { PRESETS } from '../src/client/presets.ts';
import { cloneSpec } from '../src/sim/spec.ts';
import type { BikeSpec } from '../src/sim/spec.ts';

const argv = process.argv.slice(2);
let only: string | null = null;
let sweep: number[] | null = null;
let speed = 9;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--preset') only = argv[++i];
  else if (a === '--sweep') sweep = argv[++i].split(',').map(Number);
  else if (a === '--speed') speed = Number(argv[++i]);
  else {
    console.error(`bin/dive: unknown argument ${a}`);
    process.exit(2);
  }
}

function withInertial(spec: BikeSpec, v: number): BikeSpec {
  const s = cloneSpec(spec);
  s.rider.inertialTransfer = v;
  return s;
}

function row(label: string, spec: BikeSpec): void {
  const b = pitchUnder(spec, BRAKE, { speed });
  const t = pitchUnder(spec, THROTTLE, { speed });
  const air = pitchUnder(spec, BRAKE, { speed, airborne: true });
  const cols = (r: { at: number[] }): string => r.at.map((v) => v.toFixed(1).padStart(7)).join('');
  const tail = (r: { to30: number; peakRate: number; wentOver: boolean }): string =>
    `   to -30 ${r.to30 < 0 ? '  n/a' : r.to30.toFixed(3)}   rate ${r.peakRate.toFixed(0).padStart(5)} deg/s${r.wentOver ? '   OVER THE BARS' : ''}`;
  console.log(`==> ${label}`);
  console.log(`    brake, grounded   ${cols(b)}${tail(b)}   entry ${b.entry.toFixed(2)} m/s`);
  console.log(`    throttle, grounded${cols(t)}${tail(t)}   entry ${t.entry.toFixed(2)} m/s`);
  console.log(`    brake, AIRBORNE   ${cols(air)}${tail(air)}   (wheel reaction — a different mechanism)`);
}

console.log('    pitch in degrees at ' + SAMPLES.map((v) => v + 's').join(' / ') + ', relative to the attitude when the input landed');
console.log('    NEGATIVE = nose down. Facing is +x throughout.');
console.log('    columns:           ' + SAMPLES.map((v) => (v + 's').padStart(7)).join(''));
console.log('');

if (sweep) {
  const base = PRESETS.find((p) => p.id === (only ?? PRESETS[0].id)) ?? PRESETS[0];
  console.log(`sweeping rider.inertialTransfer on "${base.label}" at ${speed} m/s\n`);
  for (const v of sweep) row(`inertialTransfer ${v}`, withInertial(base.spec, v));
} else {
  for (const p of PRESETS) {
    if (only && p.id !== only) continue;
    row(`${p.label}   [inertialTransfer ${p.spec.rider.inertialTransfer}, weightTransfer ${p.spec.rider.weightTransfer}]`, p.spec);
  }
}
