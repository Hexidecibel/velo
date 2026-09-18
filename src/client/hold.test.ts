// The claim every screen that covers the game has to keep: holding the sim
// cannot affect a recorded replay.
//
// It is asserted the way overview.test.ts and armed.test.ts assert theirs —
// against the REAL sim and the REAL recorder, driving the actual gate from
// main.ts's `step()` — rather than by reading main.ts, because the property is
// about the gate and the gate is what a future edit will break. The difference
// here is that the gate now has more than one source, so the shape of the test
// is: hold it for the SAME frames from a DIFFERENT reason, and get the same
// bytes out. Any one of them, all of them at once, overlapping, does not matter.
import { describe, it, expect } from 'vitest';
import { createSimHold } from './hold.ts';
import { createSim } from '@/sim/sim.ts';
import { DEFAULT_SPEC, cloneSpec } from '@/sim/spec.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { parseLevel } from '@/sim/level.ts';
import { createRecorder } from './recorder.ts';
import { IN_LEAN_R, IN_THROTTLE } from '@/sim/consts.ts';

function maskFor(frame: number): number {
  return (frame % 7 < 4 ? IN_THROTTLE : 0) | (frame % 11 === 0 ? IN_LEAN_R : 0);
}

/**
 * main.ts's `step()`, reduced to the gate, the sim and the recorder — the same
 * reduction overview.test.ts makes, driven through the real register.
 */
function drive(frames: number, wire: (hold: ReturnType<typeof createSimHold>, at: () => number) => void) {
  const level = parseLevel(TEST_LEVEL);
  const sim = createSim(level, cloneSpec(DEFAULT_SPEC));
  const rec = createRecorder();
  let f = 0;
  const hold = createSimHold();
  wire(hold, () => f);
  for (; f < frames; f++) {
    // THIS IS THE GATE. Return before the sim is touched: no advance, so no
    // tick and no clock; no capture, so no frame in the input stream.
    if (hold.held) continue;
    const mask = maskFor(rec.frames);
    sim.advance(mask);
    rec.capture(mask, sim);
  }
  return { sim, rec, level };
}

const replay = (d: ReturnType<typeof drive>): string =>
  JSON.stringify(d.rec.build(d.level, cloneSpec(DEFAULT_SPEC), d.sim));

describe('anything holding the sim leaves the replay byte-identical', () => {
  const plain = (): ReturnType<typeof drive> => drive(600, () => undefined);

  it('holds for one source', () => {
    // Somebody reading the about page for three seconds in the middle of a run,
    // which is the exact thing the page invites.
    const held = drive(1000, (h, at) => h.add('about', () => at() >= 200 && at() < 600));
    const base = plain();
    expect(held.sim.hash()).toBe(base.sim.hash());
    expect(held.sim.state.tick).toBe(base.sim.state.tick);
    expect(held.rec.frames).toBe(base.rec.frames);
    expect(replay(held)).toBe(replay(base));
  });

  it('holds for TWO sources at once, which is the case a second gate would break', () => {
    // The overview held over the top of the about page, or the other way round.
    // Two independent booleans that both mean "stopped" is exactly the pair
    // that a second, private freeze would get wrong — one of them releases and
    // the sim starts running underneath a panel that is still up.
    const held = drive(1300, (h, at) => {
      h.add('overview', () => at() >= 200 && at() < 700);
      h.add('about', () => at() >= 500 && at() < 900);
    });
    const base = plain();
    expect(held.sim.state.tick).toBe(base.sim.state.tick);
    expect(replay(held)).toBe(replay(base));
  });

  it('holds for the PROFILE SCREEN, which opens itself on a first run', () => {
    // THE ONE SOURCE THAT IS NOT OPENED BY THE PLAYER. The overview, the about
    // page and the customiser are all things somebody reached for; the profile
    // screen appears on a first load and again on a first finish, over a level
    // that is already loaded and — in the finish case — over a run that has
    // just been recorded and is about to be posted.
    //
    // That makes this the source where a missed hold would be worst: a bike
    // coasting off a ledge while a seven-year-old picks a helmet, on the run
    // the server is being asked to verify. Same register, same guarantee, and
    // the bytes are the proof rather than the argument.
    const held = drive(1400, (h, at) => h.add('profile', () => at() >= 120 && at() < 920));
    const base = plain();
    expect(held.sim.hash()).toBe(base.sim.hash());
    expect(held.sim.state.tick).toBe(base.sim.state.tick);
    expect(held.rec.frames).toBe(base.rec.frames);
    expect(replay(held)).toBe(replay(base));
  });

  it('holds when the profile opens OVER the results screen and the overview', () => {
    // The first-finish case, as it actually stacks: the run is over, the
    // results panel is up, and the profile opens on top of it. Nothing may move
    // while any of them is, and — the part a second private freeze would get
    // wrong — the sim must not start running again when the FIRST of them
    // closes underneath the one still on screen.
    const held = drive(1600, (h, at) => {
      h.add('overview', () => at() >= 200 && at() < 700);
      h.add('profile', () => at() >= 500 && at() < 1200);
    });
    const base = plain();
    expect(held.sim.state.tick).toBe(base.sim.state.tick);
    expect(replay(held)).toBe(replay(base));
  });

  it('does not let the clock run while held', () => {
    const { sim } = drive(300, (h, at) => h.add('about', () => at() >= 100));
    // 100 frames advanced, 200 held. The clock is state.tick, which only
    // stepTick moves, so it has to read exactly the 100.
    expect(sim.state.tick).toBe(100 * 4);
  });

  it('is not vacuous: with nothing registered the run actually runs', () => {
    // Guards every assertion above against passing because `held` is stuck on.
    const { sim, rec } = plain();
    expect(sim.state.tick).toBeGreaterThan(0);
    expect(rec.frames).toBe(600);
  });
});

describe('the register', () => {
  it('holds when ANY source holds and releases only when every one lets go', () => {
    let a = false;
    let b = false;
    const h = createSimHold();
    h.add('overview', () => a);
    h.add('about', () => b);
    expect(h.held).toBe(false);
    a = true;
    expect(h.held).toBe(true);
    b = true;
    expect(h.held).toBe(true);
    a = false;
    // STILL HELD. This is the whole reason it is a register: releasing one
    // reason must not release the sim while another screen is still up.
    expect(h.held).toBe(true);
    b = false;
    expect(h.held).toBe(false);
  });

  it('says which, because a frozen game with nothing on screen is a bug report', () => {
    let a = false;
    let b = false;
    const h = createSimHold();
    h.add('overview', () => a);
    h.add('about', () => b);
    expect(h.by).toEqual([]);
    b = true;
    expect(h.by).toEqual(['about']);
    a = true;
    // Registration order, not precedence — any one of them holds.
    expect(h.by).toEqual(['overview', 'about']);
  });

  it('cannot leak, because a holder is a predicate and not a lock', () => {
    // A push/pop counter has to be balanced, and the failure of an unbalanced
    // one is a permanently frozen game with nothing on screen to say why. There
    // is no second piece of state here to get out of step: if the panel is
    // shut, the panel is not holding anything.
    let open = false;
    const h = createSimHold();
    h.add('panel', () => open);
    for (let i = 0; i < 100; i++) {
      open = true;
      expect(h.held).toBe(true);
      open = false;
      expect(h.held).toBe(false);
    }
  });

  it('is empty and free before anything is wired', () => {
    const h = createSimHold();
    expect(h.held).toBe(false);
    expect(h.by).toEqual([]);
  });
});
