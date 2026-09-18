// The armed start line: a restart sets the run up and then WAITS for you.
//
// Before this, R put you on the line and started the clock in the same
// instant — and started the GHOST with it. That last part is the whole reason
// this exists. A ghost that leaves while you are still gathering yourself opens
// a gap in the first half-second that has nothing to do with riding, and you
// spend the rest of the level chasing a number you never lost. It is a false
// time gap, and "restart and go fast" is the shape it takes for the player:
// the retry is instant, and being instant is exactly the problem.
//
// So a restart — and a level load — leaves the run ARMED: posed, framed, and
// frozen. The first sim input starts the clock, the recorder and the ghost
// together, on the same frame.
//
// FOUR DECISIONS, AND THEY ARE THE FEATURE:
//
//   * IT STARTS ON A NON-ZERO MASK, NOT ON A FRESH PRESS. Somebody who mashes R
//     with the throttle already down has said what they want as clearly as it
//     can be said, and making them release and re-press to be believed would
//     feel broken. `release(mask)` therefore looks at the mask the frame loop
//     was going to advance the sim with, and a held key is a non-zero mask.
//   * ONLY SIM INPUT ARMS IT. Throttle, brake, lean, flip, and the touch pads
//     that produce those same bits — because they go through `input.mask()`
//     rather than around it, this module gets the phone for free and cannot
//     disagree with the desktop about what counts. A command key, the overview,
//     the chooser and the legend are not "go" and do not start a run.
//   * NO TICK ADVANCES WHILE ARMED. This is the same mechanism the overview
//     freeze uses and deliberately not a second one: `release` is consulted in
//     `step()` at the one place that can move the sim, and a false answer
//     returns BEFORE `sim.advance`, so `state.tick` does not move, the recorder
//     gains no input frame, and the ghost — stepped strictly after the player —
//     gains none either. A run armed for a minute produces a byte-identical
//     replay to one started instantly. `armed.test.ts` asserts that against the
//     real sim and the real recorder; `bin/smoke` asserts it again in Chrome
//     through the real key path, because the gate lives in the frame loop where
//     no unit test reaches.
//   * IT IS NOT A DELAY. There is no countdown, no minimum hold and no fade:
//     the frame that sees input is the frame that rides. This is a die-and-retry
//     game whose loop is R, and anything that puts time in front of R is worse
//     than the problem being fixed.
//
// Not to be confused with `TouchControls.arm`, which is the phone's
// auto-throttle latch. They agree by accident of good design rather than by
// wiring: `restart()` disarms the latch, so a phone's mask is 0 after a restart
// too, and the first pad press does both jobs at once.
//
// State only, no canvas and no clock of its own — all of it testable in plain
// node, per house rules.

export interface Armed {
  /** True exactly while the sim must not advance. */
  readonly armed: boolean;
  /** A restart or a level load: set the run up and hold it. */
  arm(): void;
  /**
   * Let go without an input. For the paths that are not the player's own run —
   * a replay playback, a montage, a scripted run — where waiting for a press
   * that is never coming would look like a hang.
   */
  disarm(): void;
  /**
   * THE GATE, called once per sim input frame with the mask that frame would
   * advance the sim with. False means this frame does not happen at all.
   *
   * Disarming here rather than in a key handler is what makes "held counts"
   * fall out for free, and what keeps the decision on the same clock as the
   * thing it gates: the mask is sampled once per input frame at 128 Hz, so the
   * frame that starts the run is the frame whose input started it.
   */
  release(mask: number): boolean;
}

export function createArmed(): Armed {
  let armed = false;
  const self: Armed = {
    get armed(): boolean {
      return armed;
    },
    arm(): void {
      armed = true;
    },
    disarm(): void {
      armed = false;
    },
    release(mask: number): boolean {
      if (!armed) return true;
      if (mask === 0) return false;
      armed = false;
      return true;
    },
  };
  return self;
}
