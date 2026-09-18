// Audio parameters. Same shape as CameraParams, OverviewParams and ArtParams,
// and for the same reason: anything with feel goes on the tuning panel, and
// "how high does the engine rev" is feel of the most direct kind.
//
// Every field is a number, including the switches, because the panel's slider
// machinery is generic over the object it edits but not over the CONTROL. A 0/1
// slider is a worse checkbox and a much smaller change than a second control
// type.
//
// NOTHING HERE REACHES THE SIM. These numbers change what you hear and can
// never change where the bike goes — audio reads sim state and never writes it,
// exactly like the renderer. audio.test.ts asserts that with a Proxy that
// throws on any write rather than trusting this paragraph.
export interface AudioParams {
  /** 1 = silent. Remembered in localStorage, toggled with M. */
  muted: number;
  /** Master volume, 0..1, before the limiter. */
  master: number;

  // --- the engine ------------------------------------------------------------
  //
  // Pitch is bound to WHEEL ANGULAR VELOCITY, not to ground speed. They agree
  // while the tyre grips and diverge exactly when it is interesting — wheelspin
  // off the line, and throttle held in mid-air, which is a real technique and
  // the sound of it should be a real scream rather than silence.

  // WHAT THE TWO HZ NUMBERS MEAN, now that there are four engines under them:
  // they are the REFERENCE motor's FIRING RATE — bangs per second, not the
  // oscillator's frequency — and every other engine is a fixed ratio against
  // it, computed from its cylinder count and its rev range in firing.ts. So
  // these stay sliders that say what they do, and moving one moves the whole
  // fleet together instead of pulling it apart. Which engine you are riding is
  // an APPEARANCE axis and is not on this panel; see src/shared/appearance.ts.

  /**
   * Firing rate at a stopped wheel, for the reference engine (an inline four at
   * a 1200 rpm idle, which is 40 bangs a second). You hear this on every
   * restart, so it is tuned against a restart loop rather than against a play.
   */
  engineIdleHz: number;
  /**
   * Firing rate at `spec.drive.maxWheelSpin`, where drive torque has tapered to
   * zero — the reference engine's 10,000 rpm limiter, four bangs per two revs.
   */
  engineRevHz: number;
  /**
   * Exponent on the normalised wheel spin before it maps to pitch. Below 1 it
   * spreads the bottom of the range, where all the riding happens — linear
   * pitch puts the whole audible change in the last third of the rev range and
   * makes pulling away sound like nothing at all.
   */
  engineCurve: number;
  /** Engine level into the master bus. Each engine then trims itself off this. */
  engineLevel: number;
  /**
   * How far the two engine layers are separated, as a PERCENTAGE OF ONE ENGINE
   * CYCLE. Cylinder-to-cylinder timing scatter, and the "synthetic" in the tone.
   *
   * A percentage of a cycle and not a detune in cents, which is what it was
   * when the engine was two saws. A detune on a pulse train is a flam that
   * wanders — see the note on `shift` in firing.ts. This one is a fixed offset
   * and holds still.
   */
  engineSpread: number;
  /** Level of the square sub under the firing rate. Body, not pitch. */
  engineSub: number;

  // --- impacts ---------------------------------------------------------------

  /**
   * Master sensitivity of the landing thump. Strength is derived from the speed
   * the wheel was falling at AND from how far the suspension compressed, which
   * is the whole of why a drop onto a flat and a drop into a berm differ.
   */
  impact: number;
  /** Fall speed, m/s, at which a landing becomes audible at all. */
  impactFrom: number;
  /** Fall speed, m/s, above `impactFrom`, at which it is at full strength. */
  impactSpan: number;

  /** Tyre scrub / wheelspin, from the contact-patch slip the sim computes. */
  scrub: number;
  /** Slip speed, m/s, below which the tyre is treated as gripping. */
  scrubFloor: number;

  /** Suspension working: a quiet creak that tracks compression RATE. */
  suspension: number;
  /** Air noise, rising with speed. */
  wind: number;
  /** Whoosh on a mid-air flip. */
  flip: number;

  // --- events ----------------------------------------------------------------

  /** Apple pickup. Short, bright, and it climbs a ladder within one run. */
  pickup: number;
  /** The flower. Longer than the apple and plainly a resolution rather than one more step. */
  finish: number;
  /**
   * Death. Your head hitting terrain is the core tension of the game and it
   * gets a sound with weight — but you hear it hundreds of times in a session,
   * so it is a short dull crunch and not a shriek.
   */
  death: number;

  // --- outputs ---------------------------------------------------------------
  //
  // Written by the audio engine, never read back as input. They live here
  // because this object is audio's public surface (`window.velo.audio.params`)
  // and a diagnostic that cannot be read from outside the page is not one.

  /** Milliseconds the last per-frame audio update cost on the MAIN thread. */
  updateMs: number;
  /** Firing rate actually in force, Hz — bangs a second. Handy while tuning by ear. */
  engineHz: number;
}

export const DEFAULT_AUDIO: AudioParams = {
  muted: 0,
  master: 0.55,

  // 40 bangs a second is a 1200 rpm idle on an inline four, and it is
  // deliberately down where a laptop speaker reproduces little of the
  // fundamental: on a small speaker it reads as a soft pulse rather than a
  // drone, and on headphones it is a warm floor. The restart loop is the
  // acceptance test for this number, not a single play. 333 is a 10,000 rpm
  // limiter — the road bike is the only one of the four allowed to go there.
  engineIdleHz: 40,
  engineRevHz: 333,
  engineCurve: 0.62,
  engineLevel: 0.5,
  engineSpread: 1.5,
  engineSub: 0.35,

  impact: 0.9,
  impactFrom: 1.6,
  impactSpan: 11,

  scrub: 0.5,
  scrubFloor: 0.7,

  suspension: 0.3,
  wind: 0.35,
  flip: 0.45,

  pickup: 0.6,
  finish: 0.7,
  death: 0.75,

  updateMs: 0,
  engineHz: 0,
};

export function cloneAudio(p: AudioParams): AudioParams {
  return { ...p };
}
