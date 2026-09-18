// WHAT MAKES AN ENGINE SOUND LIKE THAT ENGINE IS **WHEN IT FIRES**, not what
// the oscillator is set to.
//
// This file is the whole of that claim, and it is pure arithmetic with no
// WebAudio in it, so the thing the feature actually rests on is testable in
// plain node like everything else here.
//
// THE ARGUMENT, IN FOUR MACHINES:
//
//   * A 45-degree V-twin on a SHARED CRANKPIN cannot fire evenly. The two rods
//     hang off one pin, so the second cylinder comes round 315 degrees after
//     the first and then has to wait 405 for the next cycle. That 315/405 limp
//     is the entire potato-potato. It is a RHYTHM, not a timbre — get the
//     interval right and the waveform barely matters; get the interval wrong
//     and no amount of filtering rescues it.
//   * A TWO-STROKE fires every revolution instead of every other, so at the
//     same crank speed it is twice as busy as a four-stroke single and much
//     harsher at the top. That is what "brap" is.
//   * An INLINE FOUR fires four times per two revolutions, perfectly evenly.
//     The evenness is audible as SMOOTHNESS: every harmonic that is not a
//     multiple of four cancels exactly, which is why it reads as a pitch
//     rather than as a series of bangs, and it is why it can rev to five
//     figures without sounding silly.
//   * A LAWNMOWER is a four-stroke single with a mechanical governor. One bang
//     per two revolutions, a low governed ceiling, and the governor HUNTS —
//     that slow surge is the funny part, and it is a real mechanism rather
//     than a joke bolted on.
//
// HOW A FIRING PATTERN BECOMES A SOUND, WITHOUT A NODE PER BANG.
//
// One engine cycle is one period of a waveform. Put the exhaust pulses at their
// crank angles inside that period and you have a wave whose SHAPE is the firing
// order; run an oscillator at the cycle rate and the pulses come out at the
// right times, forever, for free. WebAudio's `PeriodicWave` takes exactly that
// — a Fourier series — and band-limits it for us, so there is no aliasing to
// worry about and no per-pulse scheduling at all.
//
// The coefficients come out ANALYTICALLY rather than from an FFT of a rendered
// pulse train. A pulse of shape `p` at phase `phi` with amplitude `a`
// contributes `a * P(n) * exp(-2*pi*i*n*phi)` to harmonic `n`, so the whole
// pattern is a sum over at most four terms per harmonic. A few thousand trig
// calls builds a motor.
//
// THE PULSE SHAPE IS SYMMETRIC ON PURPOSE. `P(n)` is a real, positive
// exponential decay — i.e. an even function of time — so the wave is identical
// under a sign flip of the sine terms. That makes this file immune to which
// way round a given WebAudio implementation reads `imag`, which is the one
// convention detail that would otherwise be untestable outside a browser.
//
// NOTHING HERE IS IMPORTED. Same discipline as src/sim: no DOM, no clock, no
// dependencies, so `bin/test` and an offline WAV renderer see exactly the
// numbers the browser does.

/** One cylinder firing, once, inside one engine cycle. */
export interface Fire {
  /** Crank angle within the cycle, degrees. */
  at: number;
  /** Relative punch. Not every cylinder on a real motor is equal. */
  gain: number;
}

/**
 * One motor. Everything above the line is MECHANICAL — it describes an engine
 * and could be looked up — and everything below it is taste.
 */
export interface EngineSpec {
  /** Matches an id in `ENGINES` in src/shared/appearance.ts. Asserted, not hoped. */
  id: string;

  // --- the mechanism ---------------------------------------------------------

  /** Degrees in one full cycle: 720 for a four-stroke, 360 for a two-stroke. */
  cycleDeg: number;
  /** Where in that cycle each cylinder fires. THE CHARACTER IS HERE. */
  fires: readonly Fire[];
  /** Crank speed at idle. */
  idleRpm: number;
  /** Crank speed where it stops making more, i.e. at `spec.drive.maxWheelSpin`. */
  redlineRpm: number;

  // --- the voicing -----------------------------------------------------------

  /**
   * Harmonic decay constant of ONE exhaust pulse. Higher is a sharper, brighter
   * crack; lower is a soft thud. Roughly, the pulse occupies `1/bright` of the
   * cycle.
   */
  bright: number;
  /** Multiplier on `params.engineCurve`. Above 1 holds low and then comes on. */
  curve: number;
  /**
   * Output trim, MEASURED rather than guessed: an offline render of all four at
   * full throttle put them ten decibels apart before these numbers existed.
   *
   * A sparse firing pattern is much quieter than a busy one at the same peak —
   * a lawnmower banging fifteen times a second simply has less energy in it
   * than an inline four banging three hundred — and peak-normalising the wave
   * equalises exactly the wrong thing. These pull them back to within a couple
   * of dB of each other, deliberately leaving the small engines a shade down.
   */
  level: number;
  /**
   * How ragged this motor's two layers are, as a multiplier on
   * `params.engineSpread`. Cylinder-to-cylinder timing scatter: an inline four
   * is built to a tighter tolerance than a lawnmower.
   */
  spread: number;
  /** Multiplier on `params.engineSub`. */
  sub: number;
  /** Sub-oscillator frequency as a multiple of the FIRING rate. */
  subMult: number;
  /** Lowpass cutoff, as a multiple of the firing rate, while coasting. */
  cutBase: number;
  /** How much more cutoff full engine load buys, same units. */
  cutLoad: number;
  /** Floor under the cutoff, Hz, so an idle is never a sine. */
  cutFloor: number;
  /** Filter resonance. The honk, the rasp, the bark. */
  q: number;
  /** Governor hunt rate, Hz. Zero for everything that is not a lawnmower. */
  huntHz: number;
  /** Governor hunt depth, as a fraction of the firing rate. */
  huntDepth: number;
}

/** Fires per crank revolution. A two-stroke single is twice a four-stroke single. */
export function firesPerRev(e: EngineSpec): number {
  return e.fires.length / (e.cycleDeg / 360);
}

/** Firing rate, Hz, at a given crank speed. The number you actually hear. */
export function fireHzAt(e: EngineSpec, rpm: number): number {
  return (rpm / 60) * firesPerRev(e);
}

/**
 * The gaps between consecutive bangs, in degrees, wrapping round the cycle.
 *
 * This is the assertion the V-twin exists for: `[315, 405]` and not `[360, 360]`.
 */
export function firingIntervals(e: EngineSpec): number[] {
  const at = e.fires.map((f) => f.at).sort((a, b) => a - b);
  return at.map((x, i) => (i + 1 < at.length ? at[i + 1] - x : at[0] + e.cycleDeg - x));
}

/**
 * THE FLEET.
 *
 * `road` is the reference engine and is deliberately first: it is what the game
 * shipped sounding closest to, its firing rate at idle and at the limiter ARE
 * `params.engineIdleHz` and `params.engineRevHz` unscaled, and every other
 * motor is expressed as a ratio against it. So the two sliders on the tuning
 * panel still mean exactly what they say, and moving them moves the whole fleet
 * together instead of desynchronising it.
 */
export const ENGINE_SPECS: readonly EngineSpec[] = [
  {
    // Inline four, 4 bangs per 720 degrees, perfectly even. At 1200 rpm that is
    // 40 firings a second — already a pitch rather than a rhythm, which is
    // exactly why an I4 sounds smooth — and 333 a second at a ten-thousand-rpm
    // limiter. Even spacing cancels every harmonic that is not a multiple of
    // four; `firing.test.ts` asserts that cancellation rather than describing it.
    id: 'road',
    cycleDeg: 720,
    fires: [
      { at: 0, gain: 1 },
      { at: 180, gain: 1 },
      { at: 360, gain: 1 },
      { at: 540, gain: 1 },
    ],
    idleRpm: 1200,
    redlineRpm: 10000,
    bright: 15,
    curve: 1,
    level: 1,
    spread: 0.7,
    sub: 1,
    subMult: 0.5,
    cutBase: 6,
    cutLoad: 9,
    cutFloor: 180,
    q: 3,
    huntHz: 0,
    huntDepth: 0,
  },
  {
    // Two-stroke single: ONE bang per revolution, not per two. At 1800 rpm that
    // is 30 a second where the lawnmower below manages 15 at the same crank
    // speed, and the ratio is the point — this is the only thing separating
    // "brap" from "putt" at the level of mechanism. `curve` above 1 holds the
    // note down and then lets it go, which is a powerband.
    id: 'dirt',
    cycleDeg: 360,
    fires: [{ at: 0, gain: 1 }],
    idleRpm: 1800,
    redlineRpm: 9500,
    bright: 26,
    curve: 1.15,
    level: 1.7,
    spread: 2,
    sub: 0.6,
    subMult: 1,
    cutBase: 30,
    cutLoad: 40,
    cutFloor: 220,
    q: 7,
    huntHz: 0,
    huntDepth: 0,
  },
  {
    // 45-degree V-twin on a shared crankpin: 315 degrees, then 405. THE LIMP IS
    // THE WHOLE THING. At a 900 rpm idle the cycle runs at 7.5 Hz and you hear
    // the two bangs as separate events, unevenly spaced, which is what
    // potato-potato is; by the 5500 rpm redline they have merged into a pitch
    // with a very lopsided harmonic structure. The uneven spacing is also why
    // every harmonic of the cycle survives instead of only the even ones.
    id: 'vtwin',
    cycleDeg: 720,
    fires: [
      { at: 0, gain: 1 },
      { at: 315, gain: 0.94 },
    ],
    idleRpm: 900,
    redlineRpm: 5500,
    bright: 13,
    curve: 0.9,
    level: 0.95,
    spread: 1,
    sub: 1.2,
    subMult: 2,
    cutBase: 24,
    cutLoad: 22,
    cutFloor: 160,
    q: 4,
    huntHz: 0,
    huntDepth: 0,
  },
  {
    // Four-stroke single with a mechanical governor. One bang per TWO
    // revolutions and a governed ceiling of 3600 rpm, so it is flat out almost
    // immediately (`curve` well under 1) and still only managing 30 bangs a
    // second at full noise. The hunt is the governor chasing its setpoint and
    // it is the reason this is funny on a backflip rather than merely quiet.
    id: 'mower',
    cycleDeg: 720,
    fires: [{ at: 0, gain: 1 }],
    idleRpm: 1800,
    redlineRpm: 3600,
    bright: 8,
    curve: 0.55,
    level: 2.4,
    spread: 3,
    sub: 0.15,
    subMult: 2,
    cutBase: 20,
    cutLoad: 14,
    cutFloor: 300,
    q: 10,
    huntHz: 3.4,
    huntDepth: 0.07,
  },
];

/** The reference the sliders are expressed in. First, and asserted to be first. */
export const REFERENCE_ENGINE: EngineSpec = ENGINE_SPECS[0];

/**
 * A motor's firing rate at idle and at the limiter, as a ratio against the
 * reference. This is what lets `params.engineIdleHz` / `engineRevHz` stay
 * honest sliders while four engines sit under them.
 */
export function engineScales(e: EngineSpec): { idle: number; rev: number } {
  return {
    idle: fireHzAt(e, e.idleRpm) / fireHzAt(REFERENCE_ENGINE, REFERENCE_ENGINE.idleRpm),
    rev: fireHzAt(e, e.redlineRpm) / fireHzAt(REFERENCE_ENGINE, REFERENCE_ENGINE.redlineRpm),
  };
}

const BY_ID = new Map<string, EngineSpec>(ENGINE_SPECS.map((e) => [e.id, e]));

/**
 * NEVER FATAL, exactly like `parseAppearance`. An id from a newer build, or a
 * corrupt localStorage blob, means the reference engine and a game that still
 * makes a noise — not a silent bike and not a throw inside the frame loop.
 */
export function engineFor(id: unknown): EngineSpec {
  return (typeof id === 'string' ? BY_ID.get(id) : undefined) ?? REFERENCE_ENGINE;
}

// --- the wave ----------------------------------------------------------------

/**
 * Harmonics in the table.
 *
 * SIZED AGAINST THE FILTER, not against taste. The lowpass in front of the
 * engine never opens past `fireHz * (cutBase + cutLoad) + cutFloor`, so the
 * highest harmonic of the CYCLE it can ever pass is
 * `fires * (cutBase + cutLoad + cutFloor / idleFireHz)` — worst at idle under
 * full load, where the floor is largest relative to the rate. The V-twin is the
 * extreme at 113. 160 is that with room, and anything above it is harmonics
 * being synthesised in order to be filtered out. `firing.test.ts` computes that
 * bound rather than trusting this paragraph.
 *
 * It was 256 until a build-cost measurement, and the number matters more than
 * it looks: a table is rebuilt whenever somebody changes engine, and this is
 * one of the two terms in what that costs.
 */
export const ENGINE_HARMONICS = 160;

/** Samples used to reconstruct a wave in a test. */
export const CYCLE_SAMPLES = 1024;

/**
 * Samples used to find the peak when normalising. Coarser than CYCLE_SAMPLES
 * because it is looking for a maximum rather than drawing a picture, and it is
 * the other term in what an engine change costs.
 */
const NORM_SAMPLES = 512;

export interface EngineWave {
  /** Cosine terms, index 0 (DC) always zero. */
  real: Float32Array;
  /** Sine terms, index 0 always zero. */
  imag: Float32Array;
}

/**
 * The firing pattern as a Fourier series, PEAK-NORMALISED to +-1.
 *
 * Normalised here rather than by WebAudio (`disableNormalization: true` at the
 * call site) so that what a test reconstructs and what an offline WAV render
 * writes is bit-for-bit what the browser plays. A normalisation that happens
 * somewhere you cannot see is a normalisation you cannot check.
 *
 * `shift` ROTATES the whole pattern by a fraction of a cycle, and it exists for
 * one specific reason that an offline render caught before anybody had to hear
 * it. The second engine layer used to be DETUNED, the way the two saws were
 * before this was a firing pattern — and a detune on a pulse train is not a
 * chorus, it is a flam that WANDERS. At an inline four's 10 Hz idle cycle, ten
 * cents is the second layer's bangs sliding all the way round the first one's
 * over about half a minute: the firing rhythm, the one thing this whole file
 * exists to get right, slowly turning into a different engine and back. So the
 * two layers now run at exactly the same frequency and are separated by a fixed
 * fraction of a cycle instead. Cylinder-to-cylinder scatter, which is what it
 * was always pretending to be, and it cannot drift because there is nothing
 * for it to drift against.
 *
 * Note what peak-normalisation does NOT do: it does not equalise loudness. Two
 * sparse bangs per cycle peak at the same place as four overlapping ones and
 * carry far less energy, which is what each spec's `level` trim is for.
 */
export function engineWave(e: EngineSpec, harmonics = ENGINE_HARMONICS, shift = 0): EngineWave {
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  for (let n = 1; n < harmonics; n++) {
    // The spectrum of one pulse. A real, positive, exponentially decaying
    // envelope is a symmetric (even) bump in time — see the header note about
    // why that symmetry is load-bearing.
    const env = Math.exp(-(n - 1) / e.bright);
    let re = 0;
    let im = 0;
    for (const f of e.fires) {
      const ph = 2 * Math.PI * n * (f.at / e.cycleDeg + shift);
      re += f.gain * Math.cos(ph);
      im += f.gain * Math.sin(ph);
    }
    real[n] = env * re;
    imag[n] = env * im;
  }
  let peak = 0;
  const probe = renderCycle({ real, imag }, NORM_SAMPLES);
  for (let i = 0; i < probe.length; i++) {
    const v = Math.abs(probe[i]);
    if (v > peak) peak = v;
  }
  if (peak > 1e-9) {
    for (let n = 1; n < harmonics; n++) {
      real[n] /= peak;
      imag[n] /= peak;
    }
  }
  return { real, imag };
}

/**
 * One cycle of the wave, sampled. The inverse of `engineWave`, and the only
 * way to assert in plain node that the bangs came out where they were put.
 */
export function renderCycle(wave: EngineWave, n: number): Float32Array {
  const out = new Float32Array(n);
  const h = wave.real.length;
  // ONE HARMONIC AT A TIME, STEPPED BY ROTATION. The obvious form — a `cos` and
  // a `sin` per sample per harmonic — is two trig calls a hundred and sixty
  // thousand times, which measured at thirty milliseconds a table and would
  // have put a visible hitch on the click that changes engine. Advancing the
  // angle by a fixed rotation instead costs four multiplies, and the drift over
  // a few hundred steps of double-precision is far below the 32-bit float this
  // lands in.
  for (let k = 1; k < h; k++) {
    const a = wave.real[k];
    const b = wave.imag[k];
    if (a === 0 && b === 0) continue;
    const dth = (2 * Math.PI * k) / n;
    const dc = Math.cos(dth);
    const ds = Math.sin(dth);
    let c = 1;
    let s = 0;
    for (let i = 0; i < n; i++) {
      out[i] += a * c + b * s;
      const nc = c * dc - s * ds;
      s = c * ds + s * dc;
      c = nc;
    }
  }
  return out;
}

/**
 * Where the bangs actually landed, in degrees of crank, read back off a
 * rendered cycle.
 *
 * Peaks above `floor` of the maximum, keeping the largest sample in each run of
 * consecutive candidates. Deliberately dumb: a smarter peak finder could be
 * made to agree with the input, and the point of this function is that it does
 * not know what the input was.
 */
export function peakAnglesOf(e: EngineSpec, floor = 0.45, samples = CYCLE_SAMPLES): number[] {
  const cycle = renderCycle(engineWave(e), samples);
  let max = 0;
  for (const v of cycle) if (v > max) max = v;
  const cut = max * floor;
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const prev = cycle[(i - 1 + samples) % samples];
    const next = cycle[(i + 1) % samples];
    if (cycle[i] >= cut && cycle[i] >= prev && cycle[i] > next) out.push((i / samples) * e.cycleDeg);
  }
  return out;
}
