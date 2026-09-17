// CLI front end for the air rig. See bin/air for usage and bin/_air.ts for the
// instrument itself.
import { FEATURES, measure, withCompression, withRebound } from './_air.ts';
import type { FeatureName } from './_air.ts';
import { PRESETS } from '../src/client/presets.ts';
import type { BikeSpec } from '../src/sim/spec.ts';
import { chooseRev, revLabel, specOn } from './_rev.ts';

const argv = process.argv.slice(2);
let only: string | null = null;
let sweep: number[] | null = null;
let compSweep: number[] | null = null;
let release = 29;
let target = 9;
let matrix: FeatureName | null = null;
let rev: number | undefined;
let linear = 0;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--rev') rev = Number(argv[++i]);
  else if (a === '--linear') linear = Number(argv[++i]);
  else if (a === '--preset') only = argv[++i];
  else if (a === '--sweep') sweep = argv[++i].split(',').map(Number);
  else if (a === '--compression-sweep') compSweep = argv[++i].split(',').map(Number);
  else if (a === '--release') release = Number(argv[++i]);
  else if (a === '--speed') target = Number(argv[++i]);
  else if (a === '--matrix') matrix = argv[++i] as FeatureName;
  else {
    console.error(`bin/air: unknown argument ${a}`);
    process.exit(2);
  }
}

const FEATURE_ORDER: FeatureName[] = ['bump', 'kicker', 'drop', 'bigdrop'];

const CHOICE = chooseRev(rev, linear);

function row(label: string, base: BikeSpec): void {
  const spec = specOn(CHOICE, base);
  const parts: string[] = [];
  for (const f of FEATURE_ORDER) {
    const r = measure(FEATURES[f], spec, { releaseX: release, targetSpeed: target, rev: CHOICE.rev });
    parts.push(
      `${f.padEnd(6)} ${r.approach.toFixed(2).padStart(5)} m/s  ` +
        `peak ${r.peak.toFixed(3).padStart(6)} m  air ${r.airtime.toFixed(3).padStart(5)} s  ` +
        `defl ${r.maxDeflect.toFixed(3)}${r.bottomedFrames ? `*${r.bottomedFrames}` : '  '}  ` +
        `land ${r.landingVy.toFixed(2).padStart(6)} m/s  settle ${r.settleSeconds < 0 ? '  n/a' : r.settleSeconds.toFixed(3)}` +
        (r.died ? '  DIED' : ''),
    );
  }
  console.log(`==> ${label}`);
  for (const p of parts) console.log(`    ${p}`);
}

console.log(`    ENGINE: ${revLabel(CHOICE)}`);
console.log('    peak = chassis height above its own resting height, metres');
console.log('    air  = longest stretch with neither wheel touching, seconds');
console.log('    defl = peak suspension deflection (*n = n frames on the hard clamp)');
console.log('    land = vertical speed at touchdown; settle = seconds from touchdown to still');
console.log('');

if (matrix) {
  // Rebound against approach speed, on one feature. A single-speed sweep is
  // misleading here: a soft spring is still oscillating when the wheel leaves a
  // short feature, so whether it happens to be extending at that instant is a
  // PHASE question, and phase moves with speed. Averaging across speeds is what
  // separates a real trend from where the sine wave happened to be.
  const base = PRESETS.find((p) => p.id === (only ?? PRESETS[0].id)) ?? PRESETS[0];
  const speeds = [5, 6, 7, 8, 9, 10, 11, 12];
  const rebounds = sweep ?? [120, 200, 320, 500, 800];
  console.log(`peak height (m) on "${matrix}" — rows are reboundDamping, columns approach speed`);
  console.log(`bike "${base.label}", compression ${base.spec.suspension.compressionDamping}, stiffness ${base.spec.suspension.stiffness}\n`);
  console.log('    rebound  ' + speeds.map((v) => String(v).padStart(6)).join('') + '     mean');
  for (const rb of rebounds) {
    const spec = specOn(CHOICE, withRebound(base.spec, rb));
    const peaks = speeds.map((v) => measure(FEATURES[matrix], spec, { releaseX: release, targetSpeed: v, rev: CHOICE.rev }).peak);
    const mean = peaks.reduce((a, b) => a + b, 0) / peaks.length;
    console.log('    ' + String(rb).padStart(7) + '  ' + peaks.map((p) => p.toFixed(3).padStart(6)).join('') + '   ' + mean.toFixed(4).padStart(6));
  }
} else if (sweep) {
  const base = PRESETS.find((p) => p.id === (only ?? PRESETS[0].id)) ?? PRESETS[0];
  console.log(`sweeping reboundDamping on "${base.label}" (compression stays at ${base.spec.suspension.compressionDamping})\n`);
  for (const v of sweep) row(`rebound ${v}`, withRebound(base.spec, v));
} else if (compSweep) {
  const base = PRESETS.find((p) => p.id === (only ?? PRESETS[0].id)) ?? PRESETS[0];
  console.log(`sweeping compressionDamping on "${base.label}" (rebound stays at ${base.spec.suspension.reboundDamping})\n`);
  for (const v of compSweep) row(`compression ${v}`, withCompression(base.spec, v));
} else {
  for (const p of PRESETS) {
    if (only && p.id !== only) continue;
    row(`${p.label}   [stiffness ${p.spec.suspension.stiffness}, comp ${p.spec.suspension.compressionDamping}, rebound ${p.spec.suspension.reboundDamping}, g ${p.spec.gravity}]`, p.spec);
  }
}
