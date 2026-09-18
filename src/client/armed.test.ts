// The armed start line's one load-bearing claim: waiting cannot cost you
// anything, and cannot give you anything either.
//
// Same shape of proof as overview.test.ts, and deliberately so — the arming
// gate is not a second freeze, it is the same "return before the sim is
// touched" mechanism consulted one line lower in `step()`. So it is tested the
// same way: the real sim, the real recorder, the real rider, and the real
// `createArmed`, driven through a reduction of the client's frame loop down to
// the parts that can be wrong.
//
// What a bug here would look like: a run armed for a minute banking a replay
// with a minute of zero-input frames RLE'd into the front of it — a slower time
// and a different file for a line that was ridden identically. Or the reverse,
// the ghost quietly taking its first steps while the player is still parked,
// which is the false time gap this whole feature exists to close.
import { describe, it, expect } from 'vitest';
import { createArmed } from './armed.ts';
import { createSim } from '@/sim/sim.ts';
import { DEFAULT_SPEC, cloneSpec } from '@/sim/spec.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { parseLevel } from '@/sim/level.ts';
import { createRecorder } from './recorder.ts';
import { createRider } from './ghost.ts';
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '@/sim/consts.ts';

/** A deterministic, boring input stream. Nothing here depends on its shape. */
function maskFor(frame: number): number {
  return (frame % 7 < 4 ? IN_THROTTLE : 0) | (frame % 11 === 0 ? IN_LEAN_R : 0);
}

/**
 * The client's frame loop, reduced to the only parts that matter here: the
 * armed gate from main.ts's `step()`, the recorder, and a ghost stepped
 * strictly after the player, exactly as `step()` does it.
 *
 * `waitFrames` frames of dead air go in FRONT of the run — a player who
 * restarted and then sat there. The input stream itself is unchanged: it is
 * keyed to the RECORDED frame rather than the loop frame, because a frozen
 * frame consumes no input.
 */
function drive(waitFrames: number, runFrames: number) {
  const level = parseLevel(TEST_LEVEL);
  const spec = cloneSpec(DEFAULT_SPEC);
  const sim = createSim(level, spec);
  const rec = createRecorder();
  // A ghost with a long, real input stream of its own, so "did it move" is a
  // question with a real answer for as long as the test runs.
  const ghost = createRider(level, spec, new Array(4000).fill(IN_THROTTLE));
  const armed = createArmed();
  armed.arm();
  const ghostAtRelease: number[] = [];

  for (let f = 0; f < waitFrames + runFrames; f++) {
    // Nothing at all during the wait — not a held key, not a stray bit.
    const mask = f < waitFrames ? 0 : maskFor(rec.frames);
    // THIS IS THE GATE: a false answer returns before the sim is touched. No
    // advance, so no tick and no clock; no capture, so no frame in the input
    // stream; and no `ghost.advance()`, because it is below this line in
    // `step()` too.
    if (!armed.release(mask)) {
      ghostAtRelease.push(ghost.at);
      continue;
    }
    sim.advance(mask);
    rec.capture(mask, sim);
    ghost.advance();
  }
  return { sim, rec, level, spec, ghost, ghostAtRelease };
}

describe('an armed run cannot affect a recorded replay', () => {
  it('produces an identical state hash, tick count and input stream', () => {
    const instant = drive(0, 600);
    // A minute at the 128 Hz input rate. Absurd on purpose: nobody sits on the
    // line for a minute, and a bug that only shows up after one is still a bug
    // that shows up after three seconds.
    const waited = drive(128 * 60, 600);

    expect(waited.sim.hash()).toBe(instant.sim.hash());
    expect(waited.sim.state.tick).toBe(instant.sim.state.tick);
    expect(waited.rec.frames).toBe(instant.rec.frames);

    const a = instant.rec.build(instant.level, instant.spec, instant.sim);
    const b = waited.rec.build(waited.level, waited.spec, waited.sim);
    expect(b).not.toBeNull();
    // The whole replay, byte for byte: the RLE'd input stream, the periodic
    // hash chain, the final state hash and the CLAIMED TIME — which is the one
    // a minute of waiting would have added a minute to.
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('does not let the clock run while armed', () => {
    const { sim, rec } = drive(200, 100);
    // 200 frames armed, 100 ridden. The clock is state.tick, which only
    // stepTick moves, so it has to read exactly the 100.
    expect(sim.state.tick).toBe(100 * 4);
    expect(rec.frames).toBe(100);
  });

  it('holds the GHOST on the line too, which is the actual complaint', () => {
    // A fix where the player waits and the ghost does not is not a fix: the
    // gap it opens in the first half-second is the false time gap, and it would
    // simply have moved from the clock to the road.
    const { ghost, ghostAtRelease } = drive(300, 100);
    expect(ghostAtRelease.length).toBe(300);
    // Not one frame, across the entire wait.
    expect(ghostAtRelease.every((at) => at === 0)).toBe(true);
    // And it goes when the player goes: one ghost frame per input frame.
    expect(ghost.at).toBe(100);
  });
});

describe('what counts as go', () => {
  it('starts on a mask that was ALREADY held, not on a fresh press', () => {
    // Mashing R with the throttle down is a sentence, and the answer to it is
    // not "release and press again". `release` never sees an edge — it sees the
    // mask the loop was about to advance with — so held falls out for free.
    const armed = createArmed();
    armed.arm();
    expect(armed.release(IN_THROTTLE)).toBe(true);
    expect(armed.armed).toBe(false);
  });

  it('goes on ANY sim bit, because every one of them is a decision to ride', () => {
    for (const bit of [IN_THROTTLE, IN_BRAKE, IN_LEAN_L, IN_LEAN_R, IN_FLIP]) {
      const armed = createArmed();
      armed.arm();
      expect(armed.release(bit)).toBe(true);
      expect(armed.armed).toBe(false);
    }
    // And on a combination, which is what a phone's auto-throttle plus a lean
    // pad actually produces.
    const both = createArmed();
    both.arm();
    expect(both.release(IN_THROTTLE | IN_LEAN_L)).toBe(true);
  });

  it('stays armed on an empty mask for as long as that lasts', () => {
    const armed = createArmed();
    armed.arm();
    for (let i = 0; i < 10000; i++) expect(armed.release(0)).toBe(false);
    expect(armed.armed).toBe(true);
  });

  it('is a gate and not a latch: once released it never gates again', () => {
    // The mask goes back to 0 constantly mid-run — every coast, every gap
    // between a lean and the next one. If an empty mask could re-arm, the game
    // would freeze the first time the player let go of everything.
    const armed = createArmed();
    armed.arm();
    armed.release(IN_THROTTLE);
    for (let i = 0; i < 1000; i++) expect(armed.release(0)).toBe(true);
    expect(armed.armed).toBe(false);
  });

  it('lets the paths that are not the player run without a press', () => {
    // A replay playback, a montage and a scripted run are things you WATCH.
    // Waiting for input that is never coming would read as a hang.
    const armed = createArmed();
    armed.arm();
    armed.disarm();
    expect(armed.armed).toBe(false);
    expect(armed.release(0)).toBe(true);
  });

  it('re-arms on every restart, not just the first', () => {
    // The loop is R-ride-die-R. Arming once at boot and never again would fix
    // the first restart of a session and none of the other forty.
    const armed = createArmed();
    for (let i = 0; i < 3; i++) {
      armed.arm();
      expect(armed.armed).toBe(true);
      expect(armed.release(0)).toBe(false);
      expect(armed.release(IN_THROTTLE)).toBe(true);
    }
  });

  it('starts out unarmed, so nothing has to disarm a boot that never armed', () => {
    expect(createArmed().armed).toBe(false);
  });
});
