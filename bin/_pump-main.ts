// CLI front end for the pump rig. See bin/pump for usage and bin/_pump.ts for
// the instrument.
import { BOOT_PRESET } from '../src/client/presets.ts';
import { cloneSpec } from '../src/sim/spec.ts';
import type { BikeSpec } from '../src/sim/spec.ts';
import { chooseRev, revLabel, specOn } from './_rev.ts';
import type { RevChoice } from './_rev.ts';
import {
  CREST_X, GAP_LEDGE_Y, GAP_WINDOW_X, FLAT, LIP, ROLL_START, atWindow, best, coastThrough, cycleGrid,
  climb, describePump, hillGap, pumpGrid, rollerEnd, rollerLevel, HANDS_OFF, NO_PUMP,
} from './_pump.ts';
import type { Launch, Pump } from './_pump.ts';

const argv = process.argv.slice(2);
let mode = 'lip';
let revs: number[] = [4, 5];
let linears: number[] = [0, 0.25, 0.5, 0.75, 1];
let target = 10;
/** Override rider.inertialTransferDrive — the rev-4 torque half the new linear
 *  term partly duplicates. Nothing else in the rigs touches the shipped bike. */
let driveOverride: number | null = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--revs') revs = argv[++i].split(',').map(Number);
  else if (a === '--linear') linears = argv[++i].split(',').map(Number);
  else if (a === '--speed') target = Number(argv[++i]);
  else if (a === '--drive') driveOverride = Number(argv[++i]);
  else if (!a.startsWith('-')) mode = a;
  else {
    console.error(`bin/pump: unknown argument ${a}`);
    process.exit(2);
  }
}

/** Every (rev, linear) pair worth a row, with rev 4 appearing exactly once. */
function choices(): RevChoice[] {
  const out: RevChoice[] = [];
  for (const rev of revs) {
    if (rev < 5) out.push(chooseRev(rev, 0));
    else for (const k of linears) out.push(chooseRev(rev, k));
  }
  return out;
}

const BASE: BikeSpec = (() => {
  if (driveOverride === null) return BOOT_PRESET.spec;
  const s = cloneSpec(BOOT_PRESET.spec);
  s.rider.inertialTransferDrive = driveOverride;
  return s;
})();
if (driveOverride !== null) console.log(`(rider.inertialTransferDrive overridden to ${driveOverride})\n`);

function fmt(l: Launch): string {
  if (l.died) return '           DIED';
  if (l.neverLeft) return '   never left the ground';
  return (
    `speed ${l.takeoffSpeed.toFixed(2).padStart(5)}  vy ${l.takeoffVy.toFixed(2).padStart(6)}  ` +
    `peak ${l.peak.toFixed(3).padStart(6)}  carry ${l.carry.toFixed(2).padStart(6)}  air ${l.airSeconds.toFixed(3)}`
  );
}

function lip(): void {
  console.log('THE LIP. 120 m of flat, then 0.45 m over a 2.5 m ramp.');
  console.log('Every candidate branches from ONE snapshot 1.2 m before the ramp, so the approach is');
  console.log('identical by construction. "best pump" is the best of 417 two-stroke lean sequences,');
  console.log('scored on peak height; "no pump" is the same bike holding the chassis level.\n');
  const grid = pumpGrid();
  for (const c of choices()) {
    const spec = specOn(c, BASE);
    const { approach, run } = atWindow(c, LIP, spec, { windowX: 118.8, target, seconds: 8, fromX: 119.5 });
    const r = best(run, grid, (l) => l.peak);
    const dPeak = r.launch.peak - r.baseline.peak;
    const dVy = r.launch.takeoffVy - r.baseline.takeoffVy;
    const dCarry = r.launch.carry - r.baseline.carry;
    console.log(`==> ${revLabel(c)}   approach ${approach.toFixed(2)} m/s`);
    console.log(`    no pump      ${fmt(r.baseline)}`);
    console.log(`    best pump    ${fmt(r.launch)}   [${describePump(r.pump)}]`);
    console.log(
      `    delta        peak ${(dPeak >= 0 ? '+' : '') + dPeak.toFixed(3)} m` +
        `   vy ${(dVy >= 0 ? '+' : '') + dVy.toFixed(2)} m/s` +
        `   carry ${(dCarry >= 0 ? '+' : '') + dCarry.toFixed(2)} m`,
    );
  }
}

/**
 * The user's sentence as a pass/fail: up the hill, pump at the crest, land on
 * the far side. Widen the gap until it stops working.
 *
 * Reported as the widest gap CLEARED rather than as a height, because that is
 * the question a level designer actually has — "can I put a 6 m gap here and
 * expect the pump to be the answer" — and because a metre of gap is a thing a
 * player can see.
 */
function gap(): void {
  console.log('THE HILL AND THE GAP. 94 m of flat, 6 m of climb over 24 m, a rounded crest, then');
  console.log('the gap, with the landing ledge 1.5 m below the crest. The pump window opens 12 m');
  console.log('before the edge — about a second and a half, which is a pump a person can time.');
  console.log('A gap COUNTS only if the bike lands ON THE LEDGE and lives. Swept in 0.25 m steps.\n');
  const grid = pumpGrid(160);
  for (const c of choices()) {
    const spec = specOn(c, BASE);
    let baseMax = 0;
    let pumpMax = 0;
    let bestLabel = 'none';
    let approachAt = 0;
    for (let w = 1; w <= 20.01; w += 0.25) {
      const level = hillGap(w);
      const { approach, run } = atWindow(c, level, spec, { windowX: GAP_WINDOW_X, target, seconds: 8, fromX: CREST_X - 4 });
      approachAt = approach;
      const cleared = (l: Launch): boolean =>
        !l.died && !l.neverLeft && l.landX > CREST_X + w && Math.abs(l.landY - (GAP_LEDGE_Y + 0.4)) < 1.2;
      if (cleared(run(NO_PUMP))) baseMax = w;
      let any = false;
      for (const p of grid) {
        if (!cleared(run(p))) continue;
        any = true;
        bestLabel = describePump(p);
        break;
      }
      if (any) pumpMax = w;
      if (!any && w > baseMax + 0.75) break;
    }
    console.log(
      `==> ${revLabel(c).padEnd(22)} speed into the window ${approachAt.toFixed(2)} m/s` +
        `   widest gap: no pump ${baseMax.toFixed(2)} m` +
        `   pumped ${pumpMax.toFixed(2)} m   (+${(pumpMax - baseMax).toFixed(2)} m)   [${bestLabel}]`,
    );
  }
}

/**
 * Is it stable at 512 Hz? Two questions, and they fail differently.
 *
 *   MASHING     hold the lean keys alternating as fast as the input rate
 *               allows, which is the worst case a player can produce, and watch
 *               for the arm-rate clamp, the angular-velocity clamp, and
 *               anything non-finite.
 *   RESTING     leave it alone on flat ground for twenty seconds. A term that
 *               feeds back on itself shows up here as a buzz that never decays,
 *               and it is the failure mode nobody notices in a rig that is
 *               always moving.
 */
function stability(): void {
  console.log('STABILITY AT 512 Hz. MAX_ARM_ANGVEL is 40 rad/s and MAX_ANGVEL is 60; either being');
  console.log('touched means the clamp is doing load-bearing work rather than sitting there as a');
  console.log('guard. "rest buzz" is the largest |vy| over the last 10 s of standing still.\n');
  for (const c of choices()) {
    const spec = specOn(c, BASE);
    for (const period of [2, 4, 8, 16]) {
      const sim = c.engine.createSim(FLAT, spec);
      let maxAw = 0;
      let maxW = 0;
      let armClamp = 0;
      let angClamp = 0;
      let bad = false;
      for (let f = 0; f < 128 * 20; f++) {
        const half = Math.floor(f / period) % 2 === 0;
        sim.advance(half ? 4 : 8);
        const s = sim.state;
        if (!Number.isFinite(s.px + s.py + s.vx + s.vy + s.w + s.aw)) bad = true;
        maxAw = Math.max(maxAw, Math.abs(s.aw));
        maxW = Math.max(maxW, Math.abs(s.w));
        if (Math.abs(s.aw) >= 39.999) armClamp++;
        if (Math.abs(s.w) >= 59.999) angClamp++;
        if (s.dead) break;
      }
      const s = sim.state;
      console.log(
        `    ${revLabel(c).padEnd(22)} mash every ${String(period).padStart(2)} frames:` +
          ` max |aw| ${maxAw.toFixed(1).padStart(5)}  max |w| ${maxW.toFixed(1).padStart(5)}` +
          `  armclamp ${String(armClamp).padStart(5)}  angclamp ${String(angClamp).padStart(5)}` +
          `  ${s.dead ? 'DIED' : 'alive'}${bad ? '   NON-FINITE' : ''}`,
      );
    }
    // Resting.
    const sim = c.engine.createSim(FLAT, spec);
    let buzz = 0;
    for (let f = 0; f < 128 * 20; f++) {
      sim.advance(0);
      if (f > 128 * 10) buzz = Math.max(buzz, Math.abs(sim.state.vy));
    }
    console.log(`    ${revLabel(c).padEnd(22)} rest buzz: |vy| <= ${buzz.toExponential(2)} m/s\n`);
  }
}

/**
 * THE DECISIVE ONE. Coast a roller section with the throttle off and read the
 * speed at the far end. Nothing but gravity and the rider can move the energy,
 * and gravity nets to zero across a section that starts and ends at the same
 * height — so a faster exit is the rider having pumped, full stop.
 */
function rollers(): void {
  const count = 6;
  const exitX = rollerEnd(count);
  const level = rollerLevel(count);
  const SPEEDS = [8, 9, 10, 11, 12];
  console.log(`ROLLERS. 120 m of flat, then ${count} sinusoidal rollers, 4.5 m long and 0.3 m tall,`);
  console.log('starting and ending at the same height. THE THROTTLE IS OFF from the moment the');
  console.log('section starts, so the only thing that can add energy is the rider.');
  console.log('');
  console.log('Rollers are LOSSY — a coasting bike leaves at about a fifth of the speed it entered');
  console.log('at — which is exactly why they are the right instrument: there is room for a rider to');
  console.log('show up in the number. Baseline is the BETTER of hands-off and attitude-hold, because');
  console.log('the level-hold presses the same keys a pump does and would otherwise be credited to it.');
  console.log(`Averaged over entry speeds ${SPEEDS.join('/')} m/s: a single entry measures the phase of`);
  console.log('the suspension against the first roller as much as it measures the rider.\n');
  const grid = cycleGrid();
  for (const c of choices()) {
    const spec = specOn(c, BASE);
    let sumIn = 0;
    let sumBase = 0;
    let sumBest = 0;
    let n = 0;
    const labels = new Map<string, number>();
    for (const sp of SPEEDS) {
      const { approach, run } = coastThrough(c, level, spec, {
        windowX: ROLL_START - 0.5, exitX, target: sp, seconds: 14,
      });
      const hold = run(NO_PUMP);
      const off = run(HANDS_OFF);
      const baseSpeed = Math.max(hold.reachedExit ? hold.exitSpeed : 0, off.reachedExit ? off.exitSpeed : 0);
      let bestSpeed = baseSpeed;
      let bestP: Pump = NO_PUMP;
      for (const p of grid) {
        const r = run(p);
        if (r.died || !r.reachedExit) continue;
        if (r.exitSpeed > bestSpeed) { bestSpeed = r.exitSpeed; bestP = p; }
      }
      labels.set(describePump(bestP), (labels.get(describePump(bestP)) ?? 0) + 1);
      sumIn += approach;
      sumBase += baseSpeed;
      sumBest += bestSpeed;
      n++;
    }
    const commonest = [...labels.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const gain = (sumBest - sumBase) / n;
    console.log(
      `==> ${revLabel(c).padEnd(22)} mean in ${(sumIn / n).toFixed(2)}` +
        `   coast out ${(sumBase / n).toFixed(2)}` +
        `   pumped out ${(sumBest / n).toFixed(2)}` +
        `   ${(gain >= 0 ? '+' : '') + gain.toFixed(2)} m/s   [${commonest}]`,
    );
  }
}

/**
 * Can it still climb? The blunt one, and it exists because the gap rig found the
 * bike arriving at the top of a 14-degree hill at walking pace on some settings.
 * A term that buys pumping and costs climbing has not obviously paid for itself.
 */
function climbing(): void {
  console.log('CLIMB. Full throttle from 94 m of flat, up `rise` metres over 24 m, speed at the top.');
  console.log('A bike that cannot climb cannot use a pump at the top of a hill, whatever the pump does.\n');
  const RISES: [number, string][] = [[2, ' 5 deg'], [4, '10 deg'], [6, '14 deg'], [8, '18 deg']];
  for (const c of choices()) {
    const spec = specOn(c, BASE);
    const cols = RISES.map(([r, label]) => {
      const res = climb(c, spec, r, target);
      return `${label} ${res.reached ? res.top.toFixed(2).padStart(5) : ' STUCK'}`;
    });
    console.log(`    ${revLabel(c).padEnd(22)} ${cols.join('   ')}   (m/s at the top)`);
  }
}

if (mode === 'lip') lip();
else if (mode === 'climb') climbing();
else if (mode === 'rollers') rollers();
else if (mode === 'gap') gap();
else if (mode === 'stability') stability();
else {
  console.error(`bin/pump: unknown mode "${mode}" — try lip, rollers, gap, climb or stability`);
  process.exit(2);
}
