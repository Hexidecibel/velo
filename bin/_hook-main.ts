// CLI front end for the hook rig. See bin/hook for usage and bin/_hook.ts for
// the instrument itself.
//
// Four modes, in the order the question has to be asked. They are separate
// because the answers differ, and running them together is how "a hook works"
// and "a hook is playable" get confused for one another.
import { chamber, deckRig, hang, ledge, place, pole, rail, rideAtTip, staticHangDeflection } from './_hook.ts';
import type { LedgeShape } from './_hook.ts';
import { BOOT_PRESET } from '../src/client/presets.ts';
import { createSim } from '../src/sim/sim.ts';
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '../src/sim/consts.ts';

const spec = BOOT_PRESET.spec;
const STATIC = staticHangDeflection(spec);
const MD = spec.suspension.maxDeflection;

const argv = process.argv.slice(2);
const mode = argv[0] ?? 'all';
if (!['hang', 'catch', 'ride', 'reach', 'all'].includes(mode)) {
  console.error(`bin/hook: unknown mode ${mode}`);
  process.exit(2);
}

function header(): void {
  const m = spec.chassis.mass + spec.rider.mass + 2 * spec.wheel.mass;
  console.log(
    `bike ${m.toFixed(0)} kg  spring ${spec.suspension.stiffness} N/m  travel ${MD} m  g ${spec.gravity}  ` +
      `friction ${spec.wheel.friction}`,
  );
  console.log(`static one-wheel hang = ${(STATIC * 100).toFixed(1)} cm of stretch\n`);
}

const HOLDS: Record<string, number> = {
  hold: 0,
  brake: IN_BRAKE,
  leanL: IN_LEAN_L,
  leanR: IN_LEAN_R,
  gas: IN_THROTTLE,
  gasL: IN_THROTTLE | IN_LEAN_L,
  gasR: IN_THROTTLE | IN_LEAN_R,
  flipgas: IN_FLIP | IN_THROTTLE,
};

/**
 * Mode `hang`: does a PLACED hang hold, on each shape a level could offer?
 *
 * The bike is put in the attitude rather than ridden into it, which is only
 * legitimate because it separates the statics from the entry. If a placed hang
 * does not hold, no entry can save it; if it does, the entry is still an open
 * question — and that is exactly how this came out.
 */
function modeHang(): void {
  console.log('--- placed hang: best hold over pitch x offset, 12 s, per shape ---');
  console.log('shape        best hold   at pitch/offset   peak stretch      settled reach below tip');
  const shapes: { name: string; poly: ReturnType<typeof ledge> }[] = [
    { name: 'blade', poly: ledge('spike', 0.3) },
    { name: 'square lip', poly: ledge('square', 0.3) },
    { name: 'round lip', poly: ledge('rounded', 0.3) },
    { name: 'pole w.10', poly: pole(0.1) },
    { name: 'pole w.06', poly: pole(0.06) },
    { name: 'rail', poly: rail() },
  ];
  for (const { name, poly } of shapes) {
    const lvl = chamber([poly]);
    let best = { hung: -1, pitch: 0, off: 0, defl: 0, reach: NaN };
    for (const wheel of [0, 1] as const) {
      for (let pitch = -180; pitch < 180; pitch += 6) {
        for (const off of [-0.2, -0.12, -0.06, -0.02, 0.04]) {
          const r = hang(lvl, spec, { wheel, pitchDeg: pitch, x: off, y: 0.25 }, 1536);
          if (r.hungSeconds > best.hung) best = { hung: r.hungSeconds, pitch, off, defl: r.peakDeflect, reach: r.bestReachY };
        }
      }
    }
    console.log(
      `${name.padEnd(12)} ${best.hung.toFixed(2).padStart(6)} s   ${String(best.pitch).padStart(4)} / ${best.off.toFixed(2).padStart(5)}` +
        `      ${best.defl.toFixed(3)} m (${(best.defl / STATIC).toFixed(2)}x)   ` +
        `${Number.isNaN(best.reach) ? '   n/a' : `${best.reach.toFixed(2)} m`}`,
    );
  }
  console.log('\nA lip is a SURFACE and a wheel rolls along it, so nothing resists the moment');
  console.log('of a body hanging to one side. A blade tip is a VERTEX and the contact point is');
  console.log('pinned to it. That is the whole difference, and it is why only one row holds.');
}

/**
 * Mode `catch`: can an arriving bike CATCH a tip it is not already on?
 *
 * The grid is deliberately the window a level can actually deliver — upright-ish
 * attitudes, both directions, ordinary speeds — because a catch rate quoted over
 * every attitude in the circle flatters the answer.
 */
function modeCatch(): void {
  console.log('--- dynamic catch: arrive in flight, hold one input, must hold 2 s ---');
  const PITCHES = [-45, -20, 0, 20, 45];
  const XS = [-0.35, -0.2, -0.1, 0, 0.1];
  const DROPS = [0.3, 0.8, 1.6];
  const VXS = [-8, -5, -3, -2, -1, 0, 1, 2, 3, 5, 8];
  console.log('shape        policy  caught / tried    rate     stretch of the catches   fastest catch');
  for (const shape of ['spike', 'square', 'rounded'] as LedgeShape[]) {
    const lvl = chamber([ledge(shape, 0.3)]);
    for (const pol of ['hold', 'brake'] as const) {
      const mask = HOLDS[pol];
      let tried = 0;
      let caught = 0;
      let fastest = 0;
      const defl: number[] = [];
      for (const wheel of [0, 1] as const) {
        for (const pitch of PITCHES) {
          for (const x of XS) {
            for (const drop of DROPS) {
              for (const vx of VXS) {
                tried++;
                const vy = -Math.sqrt(2 * spec.gravity * drop);
                const r = hang(lvl, spec, { wheel, pitchDeg: pitch, x, y: 0.25 + drop, vx, vy, topY: 0 }, 1024, () => mask);
                if (r.hungSeconds >= 2.0) {
                  caught++;
                  defl.push(r.peakDeflect);
                  if (Math.abs(vx) > fastest) fastest = Math.abs(vx);
                }
              }
            }
          }
        }
      }
      defl.sort((a, b) => a - b);
      const q = (i: number): string => (defl.length ? (defl[i] / STATIC).toFixed(2) : '-');
      console.log(
        `${shape.padEnd(12)} ${pol.padEnd(6)} ${String(caught).padStart(4)} / ${String(tried).padEnd(6)} ` +
          `${((100 * caught) / tried).toFixed(2).padStart(6)} %   ` +
          `${`${q(0)} / ${q(defl.length >> 1)} / ${q(defl.length - 1)} x static`.padEnd(26)} ` +
          `${caught ? `${fastest} m/s` : '-'}`,
      );
    }
  }
  console.log(`\nEvery catch that holds bottoms the suspension: ${MD} m is the hard clamp and the`);
  console.log('median catch is at it. So the stretch cannot be a readout of how hard you came');
  console.log('in — the readout is pinned at the top of its scale for every arrival that sticks.');
}

/** Mode `ride`: the entry a player would actually attempt — off the end of a deck. */
function modeRide(): void {
  console.log('--- ridden entry: accelerate along a deck, run off the blade tip ---');
  console.log('best hook over approach speed 1-12 m/s x hold x tail, per blade thickness:');
  for (const t of [0.12, 0.3, 0.6]) {
    const lvl = deckRig(t);
    let best = { s: -1, label: '', defl: 0 };
    let any = 0;
    let tried = 0;
    for (const [hn, hv] of Object.entries(HOLDS)) {
      for (const [tn, tv] of Object.entries(HOLDS)) {
        for (let target = 1; target <= 12; target++) {
          tried++;
          const r = rideAtTip(lvl, spec, target, hv, tv);
          if (r.hookedSeconds > 0) any++;
          if (r.hookedSeconds > best.s) best = { s: r.hookedSeconds, label: `${target} m/s ${hn} -> ${tn}`, defl: r.peakDeflect };
        }
      }
    }
    console.log(
      `  blade ${t.toFixed(2)} m:  best ${best.s.toFixed(2)} s (${best.label}), ` +
        `stretch ${best.defl.toFixed(3)} m (${(best.defl / STATIC).toFixed(2)}x);  ` +
        `${any} of ${tried} approaches hooked at all`,
    );
  }
  console.log('\nA bike riding off a tip carries its momentum past the tip. To hook you would');
  console.log('have to arrive with almost no horizontal speed, which is not a thing a level can');
  console.log('ask for and not a thing a player would enjoy being asked.');
}

/** Mode `reach`: what a hang could collect, and whether you can get out of one. */
function modeReach(): void {
  const lvl = chamber([ledge('spike', 0.3)]);
  const arm = spec.rider.armLength;
  const pts = (sim: ReturnType<typeof createSim>): [number, number][] => {
    const s = sim.state;
    return [[s.px, s.py], [s.px + arm * s.ax, s.py + arm * s.ay], [s.wx[0], s.wy[0]], [s.wx[1], s.wy[1]]];
  };
  console.log('--- the hang itself: what it reaches, and what gets you out of it ---');
  console.log('(tip at the origin; the deck is solid for x < 0)\n');
  console.log('held input   still hooked after 4 s?   pickup points sweep x        y');
  for (const [name, mask] of Object.entries(HOLDS)) {
    const sim = createSim(lvl, spec);
    place(sim, { wheel: 0, pitchDeg: -100, x: -0.12, y: 0.25 });
    for (let f = 0; f < 256; f++) sim.advance(0);
    let xmin = Infinity;
    let xmax = -Infinity;
    let ymin = Infinity;
    let ymax = -Infinity;
    let left = -1;
    for (let f = 0; f < 512; f++) {
      sim.advance(mask);
      for (const [x, y] of pts(sim)) {
        if (x < xmin) xmin = x;
        if (x > xmax) xmax = x;
        if (y < ymin) ymin = y;
        if (y > ymax) ymax = y;
      }
      if (left < 0 && sim.state.wy[0] < -1) left = f;
      if (sim.state.dead) break;
    }
    console.log(
      `${name.padEnd(12)} ${(left < 0 ? 'still hooked' : `let go at ${(left / 128).toFixed(2)} s`).padEnd(24)} ` +
        `[${xmin.toFixed(2)}, ${xmax.toFixed(2)}]   [${ymin.toFixed(2)}, ${ymax.toFixed(2)}]`,
    );
  }
  const sim = createSim(lvl, spec);
  place(sim, { wheel: 0, pitchDeg: -100, x: -0.12, y: 0.25 });
  for (let f = 0; f < 768; f++) sim.advance(0);
  let ymin = Infinity;
  let xmin = Infinity;
  for (const [x, y] of pts(sim)) {
    if (y < ymin) ymin = y;
    if (x < xmin) xmin = x;
  }
  console.log(
    `\nWith the 0.4 m pickup radius a settled hang collects an apple down to ` +
      `${(ymin - 0.4).toFixed(2)} m below the tip\nand back to x ${(xmin - 0.4).toFixed(2)} under the deck. ` +
      `The apples-underneath-the-poles layout is buildable;\nthere is just no reliable way to arrive at it.`,
  );
}

header();
if (mode === 'hang' || mode === 'all') modeHang();
if (mode === 'catch' || mode === 'all') {
  if (mode === 'all') console.log('');
  modeCatch();
}
if (mode === 'ride' || mode === 'all') {
  if (mode === 'all') console.log('');
  modeRide();
}
if (mode === 'reach' || mode === 'all') {
  if (mode === 'all') console.log('');
  modeReach();
}
