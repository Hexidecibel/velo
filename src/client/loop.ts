// Fixed-step accumulator with render interpolation.
//
// Two rules the sim depends on and that are easy to break here:
//
//  * `advance()` takes no dt and is called a whole number of times. The
//    renderer's frame rate never reaches the sim.
//  * the input mask is sampled ONCE PER SIM FRAME, not once per rendered frame.
//    Sampling per rendered frame is what gives a 144 Hz player finer input
//    timing than a 60 Hz player, which on a leaderboard is an integrity
//    problem rather than a nicety.
//
// The accumulator is clamped, because a browser tab that was backgrounded for
// thirty seconds must not try to catch up thirty seconds of physics in one
// frame — it would freeze, and if it ever finished, the run would be garbage
// anyway.
import { INPUT_HZ } from '@/sim/consts.ts';

export const FRAME_MS = 1000 / INPUT_HZ;
const MAX_CATCHUP_MS = 250;

export interface Loop {
  start(): void;
  stop(): void;
  paused: boolean;
}

export interface LoopHooks {
  /** Runs one input frame. Return the mask that was applied. */
  step(): void;
  /** alpha in [0, 1) between the previous and current sim state. */
  draw(alpha: number, dtMs: number): void;
}

export function createLoop(hooks: LoopHooks): Loop {
  let raf = 0;
  let last = 0;
  let acc = 0;
  let running = false;
  const self: Loop = {
    paused: false,
    start(): void {
      if (running) return;
      running = true;
      last = performance.now();
      acc = 0;
      raf = requestAnimationFrame(tick);
    },
    stop(): void {
      running = false;
      cancelAnimationFrame(raf);
    },
  };

  function tick(now: number): void {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    let dt = now - last;
    last = now;
    if (dt > MAX_CATCHUP_MS) dt = MAX_CATCHUP_MS;
    if (!self.paused) {
      acc += dt;
      // A hard iteration cap as well as the time clamp: if a machine genuinely
      // cannot keep up, it should run in slow motion rather than spiral.
      let guard = 64;
      while (acc >= FRAME_MS && guard-- > 0) {
        hooks.step();
        acc -= FRAME_MS;
      }
      if (guard <= 0) acc = 0;
    }
    hooks.draw(acc / FRAME_MS, dt);
  }

  return self;
}
