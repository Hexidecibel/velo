// CLI front end for the hook rig. See bin/hook for usage and bin/_hook.ts for
// the instrument itself.
//
// Four modes, in the order the question has to be asked. They are separate
// because the answers differ, and running them together is how "a hook works"
// and "a hook is playable" get confused for one another.
import {
  barb,
  barbDeck,
  chamber,
  clearanceOf,
  deckRig,
  hang,
  ledge,
  place,
  pole,
  rail,
  rideAtTip,
  seatY,
  staticHangDeflection,
} from './_hook.ts';
import type { BarbOpts, LedgeShape } from './_hook.ts';
import type { RawPolygon } from '../src/sim/level.ts';
import { BOOT_PRESET } from '../src/client/presets.ts';
import { createSim } from '../src/sim/sim.ts';
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '../src/sim/consts.ts';

const spec = BOOT_PRESET.spec;
const STATIC = staticHangDeflection(spec);
const MD = spec.suspension.maxDeflection;

const argv = process.argv.slice(2);
const mode = argv[0] ?? 'all';
if (!['hang', 'catch', 'ride', 'reach', 'capture', 'all'].includes(mode)) {
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

/**
 * Mode `capture`: the SECOND experiment, and the one that closes the question.
 *
 * The first pass concluded a wheel cannot be hooked, named the cause as "no
 * rolling resistance for a circle on a convex surface", and named the fix as "a
 * concave capture feature". Every shape it tested — blade, square lip, rounded
 * lip, poles, rail — was convex. So the fix it named was never built, and this
 * builds it: notches, dishes, cradles and raised lips, swept the same way and
 * scored against the same four questions, plus the one the first pass could
 * only assert.
 *
 * Read the clearance table FIRST. It is the whole answer and everything below
 * it is corroboration.
 */
function modeCapture(): void {
  const XS: number[] = [];
  for (let x = -0.75; x <= 0.051; x += 0.05) XS.push(Number(x.toFixed(3)));
  const PS: number[] = [];
  for (let p = -180; p < 180; p += 15) PS.push(p);

  // A placed hang is scored over a GRID rather than by its best cell, because
  // the best cell is the same 11 s blade hang in every row — the shape that
  // holds is always the tip, whatever is bolted on around it. What a capture
  // feature is supposed to buy is a bigger BASIN, and only the cell count sees
  // that.
  const basin = (poly: RawPolygon): { best: number; cells: number; total: number } => {
    const lvl = chamber([poly]);
    let best = 0;
    let cells = 0;
    let total = 0;
    for (const x of XS) {
      const y = seatY(poly, x, spec.wheel.radius);
      if (Number.isNaN(y)) continue;
      for (const p of PS) {
        total++;
        const r = hang(lvl, spec, { wheel: 0, pitchDeg: p, x, y: y + 0.002 }, 1024);
        if (r.hungSeconds > best) best = r.hungSeconds;
        if (r.hungSeconds >= 2) cells++;
      }
    }
    return { best, cells, total };
  };

  console.log('--- 0. how much solid may sit under a hooked wheel? ---');
  console.log('the plain blade tip, with its underside pushed down by tipT metres:\n');
  console.log('tipT       best hold   holding cells');
  for (const t of [0, 0.005, 0.01, 0.02, 0.05, 0.12, 0.2]) {
    const b = basin(barb({ innerH: 0, outerH: 0, tipT: t }));
    console.log(
      `${t.toFixed(3).padStart(5)} m   ${b.best.toFixed(2).padStart(6)} s   ${String(b.cells).padStart(3)} / ${b.total}`,
    );
  }
  console.log('\nFIVE MILLIMETRES. That is the entire budget, and it is why a notch is not a');
  console.log('hard shape to tune but a geometrically excluded one: the chassis collider at');
  console.log('local (-0.35, 0.02), r 0.20, rides 0.30 m from the hooked wheel\'s anchor and the');
  console.log('anchor is only the deflection below the wheel centre, so the collider\'s TOP sits');
  console.log('within a centimetre of the surface the wheel is resting on. The frame is already');
  console.log('in the space a notch would need. A notch deep enough to hold a 0.25 m wheel is');
  console.log('fifty times over budget.');

  const shapes: [string, Partial<BarbOpts>][] = [
    ['plain blade tip (control)', { innerH: 0, outerH: 0 }],
    ['inner lip 0.12 @0.5, wall 105', { pocket: 0.5, innerH: 0.12, innerDeg: 105, outerH: 0 }],
    ['inner lip 0.20 @0.5, wall 80', { pocket: 0.5, innerH: 0.2, outerH: 0 }],
    ['outer barb 0.05, wall 110', { pocket: 0.5, innerH: 0, outerH: 0.05, outerDeg: 110 }],
    ['outer barb 0.22, wall 90', { pocket: 0.6, innerH: 0, outerH: 0.22, outerDeg: 90 }],
    ['both lips 0.10 (pocket)', { pocket: 0.6, innerH: 0.1, outerH: 0.1 }],
    ['dish 0.05 (sunken notch)', { pocket: 0.6, dish: 0.05, innerH: 0, outerH: 0 }],
    ['dish 0.20 (cradle)', { pocket: 0.6, dish: 0.2, innerH: 0, outerH: 0 }],
    ['dish 0.20 + both lips', { pocket: 0.6, dish: 0.2, innerH: 0.1, outerH: 0.1 }],
  ];

  console.log('\n--- 1. does it hold? placed hang, 17 seats x 24 pitches, hold >= 2 s ---');
  console.log('shape                            best hold   basin');
  for (const [label, o] of shapes) {
    const b = basin(barb(o));
    console.log(
      `${label.padEnd(32)} ${b.best.toFixed(2).padStart(6)} s   ${String(b.cells).padStart(3)} / ${b.total}` +
        `  (${((100 * b.cells) / b.total).toFixed(1)} %)`,
    );
  }
  console.log('\nNothing beats the bare tip on hold time, because in every row that holds it is');
  console.log('the tip doing the holding. An inboard lip is at least harmless and widens the');
  console.log('basin a little — it resists the one direction the tip does not already cover.');
  console.log('Anything OUTBOARD zeroes the row: a lip short enough to stay out of the frame\'s');
  console.log('swing path is one a 0.25 m wheel simply rolls over, and it ramps the wheel off');
  console.log('the end instead of stopping it.');

  const entryShapes = shapes.filter((_, i) => [0, 1, 2, 6, 8].includes(i));

  console.log('\n--- 2. can you get into it? free drop, same grid as bin/hook catch ---');
  console.log('shape                            policy caught / tried   rate     stretch min/med/max');
  const PITCHES = [-45, -20, 0, 20, 45];
  const DXS = [-0.6, -0.45, -0.35, -0.2, -0.1, 0, 0.1];
  const DROPS = [0.3, 0.8, 1.6];
  const VXS = [-8, -5, -3, -2, -1, 0, 1, 2, 3, 5, 8];
  for (const [label, o] of entryShapes) {
    const poly = barb(o);
    const lvl = chamber([poly]);
    for (const pol of ['hold', 'brake'] as const) {
      const mask = HOLDS[pol];
      let tried = 0;
      let caught = 0;
      const defl: number[] = [];
      for (const wheel of [0, 1] as const) {
        for (const pitch of PITCHES) {
          for (const x of DXS) {
            const seat = seatY(poly, x, spec.wheel.radius);
            if (Number.isNaN(seat)) continue;
            for (const drop of DROPS) {
              for (const vx of VXS) {
                tried++;
                const vy = -Math.sqrt(2 * spec.gravity * drop);
                const r = hang(lvl, spec, { wheel, pitchDeg: pitch, x, y: seat + drop, vx, vy, topY: 0 }, 1024, () => mask);
                if (r.hungSeconds >= 2) {
                  caught++;
                  defl.push(r.peakDeflect);
                }
              }
            }
          }
        }
      }
      defl.sort((a, b) => a - b);
      const q = (i: number): string => (defl.length ? defl[i].toFixed(3) : '  -  ');
      console.log(
        `${label.padEnd(32)} ${pol.padEnd(6)} ${String(caught).padStart(3)} / ${String(tried).padEnd(6)} ` +
          `${((100 * caught) / tried).toFixed(2).padStart(5)} %   ${q(0)} / ${q(defl.length >> 1)} / ${q(defl.length - 1)}`,
      );
    }
  }
  console.log(`\n3. DOES THE STRETCH MEAN ANYTHING? No, and a gentler capture does not change it:`);
  console.log(`every catch above still sits on the ${MD} m clamp. Saturated, exactly as before.`);

  console.log('\n--- 4. ridden entry: accelerate along the deck and run off the end ---');
  for (const [label, o] of entryShapes) {
    const lvl = barbDeck(o);
    let best = { s: -1, label: '' };
    let any = 0;
    let tried = 0;
    for (const [hn, hv] of Object.entries(HOLDS)) {
      for (const [tn, tv] of Object.entries(HOLDS)) {
        for (let target = 1; target <= 12; target++) {
          tried++;
          const r = rideAtTip(lvl, spec, target, hv, tv);
          if (r.hookedSeconds > 0.5) any++;
          if (r.hookedSeconds > best.s) best = { s: r.hookedSeconds, label: `${target} m/s ${hn} -> ${tn}` };
        }
      }
    }
    console.log(
      `${label.padEnd(32)} best ${best.s.toFixed(2).padStart(5)} s (${best.label.padEnd(24)})  ` +
        `${any} of ${tried} held past half a second`,
    );
  }

  console.log('\n--- 5. can you get out? settle a hang, then hold one input for 4 s ---');
  for (const [label, o] of entryShapes.slice(0, 3)) {
    const poly = barb(o);
    const lvl = chamber([poly]);
    const y = seatY(poly, -0.2, spec.wheel.radius) + 0.002;
    const outs: string[] = [];
    for (const [name, mask] of Object.entries(HOLDS)) {
      const sim = createSim(lvl, spec);
      place(sim, { wheel: 0, pitchDeg: -30, x: -0.2, y });
      for (let f = 0; f < 256; f++) sim.advance(0);
      let left = -1;
      for (let f = 0; f < 512; f++) {
        sim.advance(mask);
        if (left < 0 && sim.state.wy[0] < -1) left = f;
        if (sim.state.dead) break;
      }
      outs.push(`${name} ${left < 0 ? 'stuck' : `${(left / 128).toFixed(2)}s`}`);
    }
    console.log(`${label.padEnd(32)} ${outs.join('  ')}`);
  }

  // The hang that DOES hold is held by the frame, not by the tyre. Worth
  // printing, because the hold-time column cannot tell a balanced hook from a
  // wedged one and the two are different mechanics.
  const ctl = barb({ innerH: 0, outerH: 0 });
  const sim = createSim(chamber([ctl]), spec);
  place(sim, { wheel: 0, pitchDeg: -30, x: -0.2, y: seatY(ctl, -0.2, spec.wheel.radius) + 0.002 });
  for (let f = 0; f < 768; f++) sim.advance(0);
  const c = clearanceOf(sim, 0);
  console.log(
    `\nAnd what the one working hang is actually resting on: chassis colliders in` +
      `\ncontact = [${c.chassisTouching.join(', ')}] (2,3,4 are the three frame circles), settled` +
      `\npitch ${c.pitchDeg.toFixed(0)} deg, stretch ${c.defl.toFixed(3)} m. Collider 3 is the r 0.20 circle beside the` +
      `\nhooked wheel and it is TOUCHING: the blade's 11 s is the frame wedged against the` +
      `\nunderside of the blade, a clamp, not a balanced hook. That is also why nothing in` +
      `\nthe escape row above ever lets go.`,
  );
}

header();
if (mode === 'capture' || mode === 'all') {
  modeCapture();
  if (mode === 'all') console.log('');
}
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
