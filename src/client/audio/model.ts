// State -> synth parameters. PURE, and that is the point.
//
// There is no WebAudio in this file and no DOM, so the interesting half of the
// audio — what a landing at 9 m/s should sound like versus one at 2 — is
// testable in plain node like everything else in this repo. `engine.ts` beside
// it owns the oscillators and does nothing but apply what comes out of here.
//
// It is also SAMPLED PER RENDERED FRAME, not per tick. The sim runs at 512 Hz
// and emitting an event per tick would be 512 scheduled envelopes a second for
// a game with maybe three audible things happening at once. The renderer reads
// state once a frame and so does this; the only thing that costs is the
// transients you can miss between two frames, and every one of those is handled
// by tracking a per-wheel extremum across the airborne window rather than by
// sampling faster.
import type { AudioParams } from './params.ts';

/**
 * Everything audio reads from the sim, in one flat struct of numbers.
 *
 * It is a STRUCT AND NOT THE SimState on purpose. Audio must not hold a
 * reference to live sim state — not because it would be slow, but because a
 * held reference is how "audio reads sim state and never writes it" quietly
 * stops being true. `sample.ts` builds one of these per frame and nothing
 * downstream of it can reach the sim at all.
 */
export interface RideSample {
  /** The sim clock. Going backwards means a restart, and resets the model. */
  tick: number;
  /**
   * Angular velocity of the DRIVEN wheel, forward-positive, rad/s.
   *
   * Forward-positive rather than signed-by-rotation so that a flip — which
   * changes which wheel is driven AND which way "forward" is — does not invert
   * the pitch. step.ts derives drive torque from exactly this quantity.
   */
  driveSpin: number;
  /** Chassis speed, m/s. Wind, and the weight of a death. */
  speed: number;
  /** The sim's grounded bitmask: bit i set when wheel i has a contact. */
  grounded: number;
  /** Worst contact-patch slip across both wheels, m/s. Zero when the tyre grips. */
  slip: number;
  /** Vertical velocity of each wheel, m/s. Negative is falling. */
  wheelVy: readonly [number, number];
  /**
   * Suspension travel per wheel as a fraction of `maxDeflection`, signed.
   * Positive is COMPRESSED — the wheel driven up toward the chassis, which is
   * what carries the bike's weight and what a landing spikes.
   */
  comp01: readonly [number, number];
  throttle: boolean;
  brake: boolean;
  /** +1 or -1. A change is a flip, which is free, legal mid-air, and worth a whoosh. */
  facing: number;
  dead: boolean;
  finished: boolean;
  applesLeft: number;
  /** `spec.drive.maxWheelSpin` — the spin at which drive torque reaches zero. */
  maxWheelSpin: number;
}

/** Continuous voices. Every field is applied to a long-lived node every frame. */
export interface Voices {
  engineHz: number;
  engineGain: number;
  /** Lowpass cutoff, Hz. Tracks how hard the engine is PULLING, not how fast. */
  engineCutoffHz: number;
  scrubGain: number;
  scrubHz: number;
  windGain: number;
  windHz: number;
  susGain: number;
  susHz: number;
}

/** One-shot cues. At most a handful a second, and usually none. */
export type Cue =
  | { kind: 'land'; strength: number }
  | { kind: 'apple'; step: number }
  | { kind: 'finish' }
  | { kind: 'death'; strength: number }
  | { kind: 'flip' };

/**
 * THE SAME TWO OBJECTS EVERY FRAME. `voices` and `cues` are owned by the model
 * and overwritten on the next `update`, because allocating a struct and an
 * array per frame for something the caller consumes immediately is exactly the
 * kind of per-frame garbage this feature is not allowed to introduce.
 *
 * The one rule that buys: read it, apply it, do not keep it. Every caller does
 * both inside the same `update` call, and the tests copy what they keep.
 */
export interface RideFrame {
  readonly voices: Voices;
  readonly cues: readonly Cue[];
}

export interface RideModel {
  update(s: RideSample, dtSec: number): RideFrame;
  /** Forget everything. A level change, a replay start, a restart. */
  reset(): void;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * One-pole smoothing toward a target, framerate-independent.
 *
 * `dt / tau` rather than `1 - exp(-dt/tau)`: the difference is invisible at any
 * frame time a browser produces, and the clamp makes it unconditionally stable
 * where the exponential form needs no clamp but does need an exp per voice per
 * frame. Six voices at 144 Hz is not where the budget should go.
 */
function toward(cur: number, target: number, dtSec: number, tau: number): number {
  const k = tau <= 0 ? 1 : clamp01(dtSec / tau);
  return cur + (target - cur) * k;
}

/**
 * Minimum time a wheel must be off the ground before its touchdown counts as a
 * landing. Without it, a wheel skipping along rough terrain fires a thump per
 * bounce and the whole level sounds like a drum roll — which is exactly the
 * "annoying by attempt fifty" failure the brief warns about.
 */
const MIN_AIR_SEC = 0.09;

/** Pickup ladder, in semitones above the base. Pentatonic, so it cannot sour. */
const PICKUP_STEPS = [0, 2, 4, 7, 9, 12, 14, 16];

export function createRideModel(params: () => AudioParams): RideModel {
  const voices: Voices = {
    engineHz: 0,
    engineGain: 0,
    engineCutoffHz: 400,
    scrubGain: 0,
    scrubHz: 800,
    windGain: 0,
    windHz: 400,
    susGain: 0,
    susHz: 120,
  };

  let started = false;
  let prevTick = -1;
  let prevGrounded = 0;
  let prevApplesLeft = -1;
  let prevDead = false;
  let prevFinished = false;
  let prevFacing = 0;
  // Per wheel: how long it has been airborne, and the fastest it was falling
  // while it was. The fall speed is the interesting number and it is GONE by
  // the time the contact appears, so it has to be caught on the way down.
  const airSec = [0, 0];
  const airFall = [0, 0];
  const prevComp = [0, 0];
  let applesTakenThisRun = 0;
  // Reused. See RideFrame: this is the model's array, not the caller's.
  const cues: Cue[] = [];

  function reset(): void {
    started = false;
    prevTick = -1;
    prevGrounded = 0;
    prevApplesLeft = -1;
    prevDead = false;
    prevFinished = false;
    prevFacing = 0;
    airSec[0] = 0;
    airSec[1] = 0;
    airFall[0] = 0;
    airFall[1] = 0;
    prevComp[0] = 0;
    prevComp[1] = 0;
    applesTakenThisRun = 0;
    voices.engineGain = 0;
    voices.scrubGain = 0;
    voices.windGain = 0;
    voices.susGain = 0;
  }

  return {
    reset,
    update(s: RideSample, dtSecRaw: number): RideFrame {
      // A tab that was backgrounded, a breakpoint, a slow first frame, and —
      // seen in the wild on the first frame after a resize — a NaN out of a
      // zero-length timestamp difference. Clamped rather than trusted, because
      // every smoother below divides by it and one NaN here would stick in the
      // smoothed voices forever.
      const dt = Number.isFinite(dtSecRaw) ? clamp(dtSecRaw, 1 / 480, 1 / 12) : 1 / 60;
      const p = params();
      cues.length = 0;

      // THE RESTART. The clock going backwards is the only signal needed and it
      // covers every route to a fresh run — R, a death, a level change, a
      // replay starting. Nothing may fire on the frame it happens: the whole
      // point of a die-and-retry loop is that restarting is free, and a sound
      // on every restart is the first thing a player would come to hate.
      const restarted = !started || s.tick < prevTick;
      if (restarted) {
        reset();
        started = true;
        prevTick = s.tick;
        prevGrounded = s.grounded;
        prevApplesLeft = s.applesLeft;
        prevDead = s.dead;
        prevFinished = s.finished;
        prevFacing = s.facing;
        prevComp[0] = s.comp01[0];
        prevComp[1] = s.comp01[1];
        // The engine comes up from silence rather than snapping to idle. Same
        // reason: this is the sound of attempt fifty-one starting.
        voices.engineHz = p.engineIdleHz;
      }

      const over = s.dead || s.finished;

      // --- the engine ------------------------------------------------------
      //
      // Wheel spin, normalised against the spin at which drive torque reaches
      // zero. `rev` is therefore 1 exactly where the bike stops being able to
      // push harder, which is the moment the sound should stop climbing.
      const maxSpin = Math.max(s.maxWheelSpin, 1e-3);
      const rev = clamp01(Math.abs(s.driveSpin) / maxSpin);
      const shaped = Math.pow(rev, Math.max(p.engineCurve, 0.05));
      const targetHz = p.engineIdleHz + (p.engineRevHz - p.engineIdleHz) * shaped;

      // The taper. step.ts scales drive torque by (1 - fwd/maxWheelSpin), so
      // `pull` is literally the fraction of its torque the engine still has.
      // At a standstill under gas it is 1; at max wheelspin it is 0 and the
      // engine is screaming with nothing behind it. That distinction is the
      // single most informative thing the sound can tell you, and it is why
      // brightness tracks pull while pitch tracks spin.
      const pull = s.throttle ? clamp01(1 - rev) : 0;

      let gain = p.engineLevel * (0.3 + 0.7 * (0.25 + 0.75 * shaped));
      if (!s.throttle) gain *= 0.6;
      gain *= 0.78 + 0.22 * pull;
      if (over) gain = 0;

      voices.engineHz = toward(voices.engineHz, targetHz, dt, 0.035);
      voices.engineGain = toward(voices.engineGain, gain, dt, over ? 0.05 : 0.09);
      voices.engineCutoffHz = toward(
        voices.engineCutoffHz,
        clamp(voices.engineHz * (2.4 + 5.5 * pull) + 160, 90, 9000),
        dt,
        0.05,
      );

      // --- tyre scrub ------------------------------------------------------
      //
      // The sim already knows when the contact patch is sliding: the friction
      // impulse in step.ts is computed from `v.t - spin*R`, and sample.ts
      // recomputes exactly that. A deadband keeps the ordinary rolling
      // micro-slip silent — without it the tyre hisses continuously and you
      // stop hearing the one case that matters.
      const slipOver = Math.max(0, s.slip - p.scrubFloor);
      const scrubTarget = s.grounded !== 0 && !over ? clamp01(slipOver / 5.5) * p.scrub : 0;
      voices.scrubGain = toward(voices.scrubGain, scrubTarget, dt, 0.045);
      voices.scrubHz = toward(voices.scrubHz, 680 + Math.min(s.slip, 14) * 105, dt, 0.06);

      // --- air -------------------------------------------------------------
      const airborne = s.grounded === 0;
      const windTarget = over
        ? 0
        : clamp01((s.speed - 7) / 16) * clamp01((s.speed - 7) / 16) * p.wind * (airborne ? 1 : 0.45);
      voices.windGain = toward(voices.windGain, windTarget, dt, 0.12);
      voices.windHz = toward(voices.windHz, 360 + Math.min(s.speed, 30) * 34, dt, 0.15);

      // --- the suspension working ------------------------------------------
      //
      // Compression RATE, not compression. A bike parked on its springs is
      // fully compressed and silent; a bike crossing a ridge at speed is barely
      // compressed and should creak. This is also what covers every bump that
      // never leaves the ground, which is why there is no "bump" cue.
      let rate = 0;
      for (let i = 0; i < 2; i++) {
        const r = Math.abs(s.comp01[i] - prevComp[i]) / dt;
        if (r > rate) rate = r;
      }
      const susTarget = over ? 0 : clamp01((rate - 0.6) / 9) * p.suspension;
      voices.susGain = toward(voices.susGain, susTarget, dt, 0.03);
      voices.susHz = toward(
        voices.susHz,
        95 + clamp01(Math.max(s.comp01[0], s.comp01[1])) * 150,
        dt,
        0.08,
      );

      // --- landings --------------------------------------------------------
      //
      // PER WHEEL, not per bike. The common case in play is the front wheel
      // touching first and the rear then slamming down, and the rear slam is
      // the one with the weight in it; a bike-level "was airborne, is grounded"
      // test hears the first touch and misses the thump.
      for (let i = 0; i < 2; i++) {
        const wasDown = (prevGrounded & (1 << i)) !== 0;
        const isDown = (s.grounded & (1 << i)) !== 0;
        if (!isDown) {
          airSec[i] += dt;
          const fall = -s.wheelVy[i];
          if (fall > airFall[i]) airFall[i] = fall;
          continue;
        }
        if (!wasDown && !restarted && !over && airSec[i] >= MIN_AIR_SEC) {
          // Two independent halves, and both are needed. Fall speed alone
          // cannot tell a landing on a hard flat from one into a soft slope
          // taken at the same speed; compression alone cannot tell a landing
          // from leaning on the springs. The suspension already knows the
          // difference between a hard landing and a gentle one — this is where
          // it gets used.
          const vTerm = clamp01((airFall[i] - p.impactFrom) / Math.max(p.impactSpan, 0.1));
          const cTerm = clamp01((s.comp01[i] - 0.3) / 0.65);
          const strength = clamp01(0.65 * vTerm + 0.35 * cTerm) * p.impact;
          if (strength > 0.03) {
            const last = cues.length > 0 ? cues[cues.length - 1] : null;
            // Both wheels inside one frame is one landing, at the harder of the
            // two. Two envelopes 4 ms apart on the same voice is a flam, not a
            // thump.
            if (last && last.kind === 'land') {
              if (strength > last.strength) last.strength = strength;
            } else {
              cues.push({ kind: 'land', strength });
            }
          }
        }
        airSec[i] = 0;
        airFall[i] = 0;
      }

      // --- apples, the flower, and dying -----------------------------------
      if (!restarted) {
        if (prevApplesLeft >= 0 && s.applesLeft < prevApplesLeft) {
          // One cue even if two apples fall in one frame: the pitch ladder is
          // the reward and two of it at once is a chord nobody asked for.
          applesTakenThisRun += prevApplesLeft - s.applesLeft;
          cues.push({ kind: 'apple', step: PICKUP_STEPS[(applesTakenThisRun - 1) % PICKUP_STEPS.length] });
        }
        if (s.finished && !prevFinished) cues.push({ kind: 'finish' });
        if (s.dead && !prevDead) {
          // A fast death is a bigger crunch, but a slow one is still a death:
          // the floor is there because head-to-ceiling at walking pace is the
          // most demoralising way to end a run and it should not be a tap.
          cues.push({ kind: 'death', strength: clamp01(0.35 + s.speed / 22) * p.death });
        }
        // The flip is free and legal mid-air, so it happens a LOT — it is how
        // you double back. It gets a short air whoosh and nothing more; a flip
        // sound with any weight to it would be the most-repeated noise in the
        // game.
        if (s.facing !== prevFacing && !over) cues.push({ kind: 'flip' });
      }

      prevTick = s.tick;
      prevGrounded = s.grounded;
      prevApplesLeft = s.applesLeft;
      prevDead = s.dead;
      prevFinished = s.finished;
      prevComp[0] = s.comp01[0];
      prevComp[1] = s.comp01[1];
      prevFacing = s.facing;

      p.engineHz = voices.engineHz;
      return { voices, cues };
    },
  };
}

/** Semitones to a frequency ratio. Renderer-side maths, so `pow` is fine here. */
export function semitone(n: number): number {
  return Math.pow(2, n / 12);
}
