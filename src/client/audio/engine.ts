// The synth. Every sound in the game is made here, from oscillators and one
// buffer of noise — there are no audio files and there never will be.
//
// Same reason the art is drawn in code: it has to work on any level, including
// generated ones, and a sample pack is megabytes of liability nobody asked for.
// It also means "how hard was that landing" is a continuous parameter rather
// than a choice between thud_soft.wav and thud_hard.wav.
//
// THE GRAPH IS BUILT ONCE AND NEVER GROWS. Twenty-eight nodes, all started at
// `build()` and all still running when the tab closes; a cue is an envelope
// scheduled onto an AudioParam of a node that already exists. Creating a node
// per event is the normal way to do this and it is the wrong way here: level 20
// is already near the frame budget on a software rasteriser, and node churn
// costs main-thread time and GC pressure exactly when the frame is busiest —
// which is exactly when the sounds happen.
//
// Taste: Jet Set Radio Future. Synthetic and characterful, not a recording of a
// motor. Two detuned wave oscillators and a square sub through a filter that
// opens with LOAD rather than with revs, which is the part that makes it read
// as a machine doing work rather than as a tone going up.
//
// THE ENGINE IS A FIRING PATTERN, NOT A WAVEFORM, and that is the one thing in
// this file worth understanding. `firing.ts` turns a cylinder count and a set
// of crank angles into a `PeriodicWave` — one engine cycle is one period, and
// each cylinder's exhaust pulse sits inside it at its own angle. Run that
// oscillator at the CYCLE rate and every bang lands where it belongs, forever,
// at the cost of one oscillator. A V-twin's 315/405 limp is therefore a
// property of the wavetable rather than of any scheduling, which is why it
// survives being paused, backgrounded, ducked and detuned.
//
// The wave is built lazily and cached per engine. It costs a few hundred
// thousand float operations once, on a click in the customiser — never in a
// frame that is riding.
import type { Cue, Voices } from './model.ts';
import { semitone } from './model.ts';
import { engineFor, engineWave } from './firing.ts';
import type { EngineSpec } from './firing.ts';

/** Below this an AudioParam change is not worth a scheduling call. */
const EPS_HZ = 0.5;
const EPS_GAIN = 0.0015;

export interface Synth {
  readonly ctx: AudioContext;
  /** Continuous voices, once per rendered frame. */
  apply(v: Voices): void;
  /**
   * Swap the firing pattern, and the layer offset baked into the second table.
   * Idempotent, and free when nothing changed.
   *
   * IT BUILDS TWO WAVETABLES, so it is deliberately not something `apply()`
   * does: called from a click in the customiser or from the gesture that opens
   * the context, a millisecond is invisible; called from the frame loop it is a
   * visible spike, and `bin/audiobench` was the thing that noticed.
   */
  setEngine(id: string, spread: number): void;
  /** One-shot. At most a handful a second. */
  fire(cue: Cue, p: { pickup: number; finish: number; death: number; impact: number; flip: number }): void;
  /** Master level, 0..1. Mute and the overview duck both come through here. */
  setMaster(level: number): void;
  /** Silence everything scheduled. Used on a level change and on mute. */
  panic(): void;
  close(): Promise<void>;
}

function osc(ctx: AudioContext, type: OscillatorType, hz: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = hz;
  return o;
}

function gain(ctx: AudioContext, v: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function filter(ctx: AudioContext, type: BiquadFilterType, hz: number, q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  return f;
}

/**
 * Two seconds of white noise, generated once.
 *
 * One looping buffer source feeds every noise voice — tyre scrub, wind, the
 * suspension, the crunch of a landing and the crunch of a death — through their
 * own filters. Five voices off one source, and the source is the only thing
 * that had to be generated.
 */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Two poles of lowpass on the way in, so it is not the harsh full-band hiss
  // that every naive WebAudio noise source is. The filters downstream shape it
  // further; this just takes the razor off.
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    a += (w - a) * 0.45;
    b += (a - b) * 0.45;
    d[i] = b * 2.2;
  }
  return buf;
}

export function createSynth(ctx: AudioContext): Synth {
  // --- the bus --------------------------------------------------------------
  //
  // A limiter, not because anything here is loud on its own, but because a
  // death at speed is four voices firing on the same frame and the sum clips.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -9;
  limiter.knee.value = 8;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.16;
  const master = gain(ctx, 0);
  master.connect(limiter);
  limiter.connect(ctx.destination);

  // --- engine ---------------------------------------------------------------
  //
  // Two of them, detuned either side of the fundamental, both carrying the same
  // firing pattern. Two copies of a bang train drifting a few cents apart is
  // what stops a synthesised motor sounding like a synthesiser: the pulses
  // phase in and out against each other exactly the way two cylinders that are
  // not perfectly matched do.
  const engA = osc(ctx, 'sawtooth', 60);
  const engB = osc(ctx, 'sawtooth', 60);
  const engSub = osc(ctx, 'square', 30);
  const engAG = gain(ctx, 0.42);
  const engBG = gain(ctx, 0.34);
  const engSubG = gain(ctx, 0.35);
  const engMix = gain(ctx, 1);
  const engFilter = filter(ctx, 'lowpass', 400, 5);
  const engGain = gain(ctx, 0);
  engA.connect(engAG).connect(engMix);
  engB.connect(engBG).connect(engMix);
  engSub.connect(engSubG).connect(engMix);
  engMix.connect(engFilter).connect(engGain).connect(master);

  // A slow wobble on the cutoff. Without it the idle is a dead sine and reads
  // as a test tone; with it the bike sounds like it is running rather than
  // switched on. Deliberately tiny — this is the sound you hear on every
  // restart and anything with a shape to it becomes a tic.
  const lfo = osc(ctx, 'sine', 5.1);
  const lfoG = gain(ctx, 26);
  lfo.connect(lfoG).connect(engFilter.frequency);

  // --- noise ----------------------------------------------------------------
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  noise.loop = true;

  const scrubF = filter(ctx, 'bandpass', 800, 1.6);
  const scrubG = gain(ctx, 0);
  noise.connect(scrubF).connect(scrubG).connect(master);

  const windF = filter(ctx, 'bandpass', 420, 0.7);
  const windG = gain(ctx, 0);
  noise.connect(windF).connect(windG).connect(master);

  const susF = filter(ctx, 'bandpass', 120, 6);
  const susG = gain(ctx, 0);
  noise.connect(susF).connect(susG).connect(master);

  // Event-driven noise. Kept separate from the continuous voices above because
  // a param cannot be under `setTargetAtTime` control and carry a scheduled
  // envelope at the same time without one fighting the other.
  const crashF = filter(ctx, 'lowpass', 900, 1.1);
  const crashG = gain(ctx, 0);
  noise.connect(crashF).connect(crashG).connect(master);

  const whooshF = filter(ctx, 'bandpass', 900, 2.2);
  const whooshG = gain(ctx, 0);
  noise.connect(whooshF).connect(whooshG).connect(master);

  // --- event oscillators ----------------------------------------------------
  const thump = osc(ctx, 'sine', 90);
  const thumpG = gain(ctx, 0);
  thump.connect(thumpG).connect(master);

  const growl = osc(ctx, 'sawtooth', 120);
  const growlF = filter(ctx, 'lowpass', 900, 1.4);
  const growlG = gain(ctx, 0);
  growl.connect(growlF).connect(growlG).connect(master);

  const chimeA = osc(ctx, 'triangle', 520);
  const chimeAG = gain(ctx, 0);
  chimeA.connect(chimeAG).connect(master);
  const chimeB = osc(ctx, 'sine', 1040);
  const chimeBG = gain(ctx, 0);
  chimeB.connect(chimeBG).connect(master);

  for (const o of [engA, engB, engSub, lfo, thump, growl, chimeA, chimeB]) o.start();
  noise.start();

  // Last applied value per continuous param, so an unchanged voice costs a
  // compare and not a scheduling call. Most frames change two of the nine.
  const last = {
    engHz: -1, engSubHz: -1, engGain: -1, engCut: -1, engQ: -1, sub: -1,
    scrubGain: -1, scrubHz: -1,
    windGain: -1, windHz: -1,
    susGain: -1, susHz: -1,
  };

  // Built on demand and kept. Four engines is four tables for the life of the
  // page; building one is a few hundred thousand float ops, which is nothing
  // once and unthinkable per frame.
  const waves = new Map<string, PeriodicWave>();
  let engineSpec: EngineSpec = engineFor(null);
  /** The layer offset currently baked into engB's table, in thousandths of a cycle. */
  let spreadMilli = -1;

  function waveFor(e: EngineSpec, shift: number): PeriodicWave {
    const key = `${e.id}:${Math.round(shift * 1000)}`;
    const have = waves.get(key);
    if (have) return have;
    const w = engineWave(e, undefined, shift);
    // `disableNormalization` because firing.ts has already peak-normalised the
    // series itself. Normalising twice would be harmless; normalising somewhere
    // that a test cannot see would not be, and that is the point — what the
    // offline renderer writes to a WAV is what this plays.
    const wave = ctx.createPeriodicWave(w.real, w.imag, { disableNormalization: true });
    waves.set(key, wave);
    return wave;
  }

  /**
   * THE TWO LAYERS RUN AT THE SAME FREQUENCY and differ only by a fixed
   * rotation of the pattern. That is the whole of the "two slightly mismatched
   * cylinders" effect, and doing it in the TABLE rather than by detuning an
   * oscillator is the only way to have it without the firing rhythm wandering —
   * see the note on `shift` in firing.ts, which is a bug an offline render
   * caught before anybody had to listen to it.
   */
  function applyEngine(e: EngineSpec, milli: number): void {
    engineSpec = e;
    spreadMilli = milli;
    engA.setPeriodicWave(waveFor(e, 0));
    engB.setPeriodicWave(waveFor(e, milli / 1000));
  }

  // NOT built here. The oscillators are sawtooths for exactly as long as it
  // takes `createAudio` to call `setEngine` on the next line of the same
  // synchronous block — building a table the caller is about to replace would
  // be two milliseconds spent to be wrong.

  function follow(p: AudioParam, target: number, prev: number, t: number, tau: number, eps: number): number {
    if (prev >= 0 && Math.abs(target - prev) < eps) return prev;
    p.setTargetAtTime(target, t, tau);
    return target;
  }

  /**
   * Attack-decay on a gain that is otherwise silent.
   *
   * `exponentialRampToValueAtTime` cannot reach zero, so it lands on a
   * thousandth of the peak and a `setValueAtTime` closes it off — otherwise the
   * tail of the last cue sits at -60 dB under everything forever, and eight of
   * those is an audible floor.
   */
  function ping(p: AudioParam, t: number, peak: number, attack: number, decay: number): void {
    const v = Math.max(peak, 1e-4);
    p.cancelScheduledValues(t);
    p.setValueAtTime(1e-4, t);
    p.linearRampToValueAtTime(v, t + attack);
    p.exponentialRampToValueAtTime(v * 0.001, t + attack + decay);
    p.setValueAtTime(0, t + attack + decay + 0.005);
  }

  /** Frequency sweep on a voice that is about to be pinged. */
  function sweep(p: AudioParam, t: number, from: number, to: number, dur: number): void {
    p.cancelScheduledValues(t);
    p.setValueAtTime(Math.max(from, 1e-3), t);
    p.exponentialRampToValueAtTime(Math.max(to, 1e-3), t + dur);
  }

  return {
    ctx,

    setEngine(id: string, spread: number): void {
      const next = engineFor(id);
      const milli = Math.round(Math.max(0, Math.min(0.2, spread)) * 1000);
      if (next === engineSpec && milli === spreadMilli) return;
      applyEngine(next, milli);
    },

    apply(v: Voices): void {
      const t = ctx.currentTime;
      // The oscillators run at the CYCLE rate, not the firing rate: one period
      // of the wave is one full engine cycle with every bang inside it.
      if (last.engHz < 0 || Math.abs(v.engineCycleHz - last.engHz) >= EPS_HZ * 0.25) {
        last.engHz = v.engineCycleHz;
        engA.frequency.setTargetAtTime(v.engineCycleHz, t, 0.012);
        engB.frequency.setTargetAtTime(v.engineCycleHz, t, 0.012);
      }
      if (last.engSubHz < 0 || Math.abs(v.engineSubHz - last.engSubHz) >= EPS_HZ) {
        last.engSubHz = v.engineSubHz;
        engSub.frequency.setTargetAtTime(v.engineSubHz, t, 0.012);
      }
      // A wavetable rebuild, so it is gated on the value actually MOVING by a
      // thousandth of a cycle. In play that is never: `setEngine` already put
      // the right table in place off the frame loop, and this fires only while
      // somebody drags the spread slider on the tuning panel. Every value it
      // lands on is cached, so a drag pays once per stop.
      const wantMilli = Math.round(v.engineSpread * 1000);
      if (wantMilli !== spreadMilli) applyEngine(engineSpec, wantMilli);
      if (Math.abs(v.engineSub - last.sub) >= EPS_GAIN) {
        last.sub = v.engineSub;
        engSubG.gain.setTargetAtTime(v.engineSub, t, 0.03);
      }
      last.engGain = follow(engGain.gain, v.engineGain, last.engGain, t, 0.03, EPS_GAIN);
      last.engCut = follow(engFilter.frequency, v.engineCutoffHz, last.engCut, t, 0.025, EPS_HZ * 6);
      // Per engine and otherwise constant, so this is a compare on every frame
      // but the one where somebody changed motor.
      last.engQ = follow(engFilter.Q, v.engineQ, last.engQ, t, 0.05, 0.01);
      last.scrubGain = follow(scrubG.gain, v.scrubGain, last.scrubGain, t, 0.02, EPS_GAIN);
      last.scrubHz = follow(scrubF.frequency, v.scrubHz, last.scrubHz, t, 0.03, EPS_HZ * 8);
      last.windGain = follow(windG.gain, v.windGain, last.windGain, t, 0.05, EPS_GAIN);
      last.windHz = follow(windF.frequency, v.windHz, last.windHz, t, 0.08, EPS_HZ * 8);
      last.susGain = follow(susG.gain, v.susGain, last.susGain, t, 0.015, EPS_GAIN);
      last.susHz = follow(susF.frequency, v.susHz, last.susHz, t, 0.04, EPS_HZ * 4);
    },

    fire(cue, p): void {
      const t = ctx.currentTime;
      switch (cue.kind) {
        case 'land': {
          // Harder means LOWER and LONGER, not higher: the crack on top comes
          // from the noise burst, and the body is what says how much bike came
          // down. A gentle touchdown is a short tick with almost no tail.
          const s = cue.strength;
          const dur = 0.07 + 0.19 * s;
          sweep(thump.frequency, t, 150 + 95 * s, 44 - 10 * s, dur);
          ping(thumpG.gain, t, 0.22 + 0.5 * s, 0.004, dur);
          sweep(crashF.frequency, t, 700 + 2500 * s, 220, 0.05 + 0.13 * s);
          ping(crashG.gain, t, 0.07 + 0.3 * s, 0.003, 0.05 + 0.18 * s);
          break;
        }
        case 'apple': {
          // Up a fourth inside 50 ms, and a step further up the ladder for each
          // apple in the run. Short and bright, and plainly not the flower.
          const base = 560 * semitone(cue.step);
          sweep(chimeA.frequency, t, base, base * semitone(5), 0.05);
          ping(chimeAG.gain, t, 0.16 * p.pickup, 0.004, 0.12);
          sweep(chimeB.frequency, t, base * 2, base * 2 * semitone(5), 0.05);
          ping(chimeBG.gain, t, 0.07 * p.pickup, 0.004, 0.1);
          break;
        }
        case 'finish': {
          // Three notes and a tail — a resolution rather than one more step,
          // which is the only thing it has to say that the apple does not.
          const notes = [523.25, 659.25, 880];
          const g = chimeAG.gain;
          const f = chimeA.frequency;
          g.cancelScheduledValues(t);
          f.cancelScheduledValues(t);
          g.setValueAtTime(1e-4, t);
          for (let k = 0; k < notes.length; k++) {
            const tk = t + k * 0.115;
            const len = k === notes.length - 1 ? 0.8 : 0.11;
            f.setValueAtTime(notes[k], tk);
            g.setValueAtTime(1e-4, tk);
            g.linearRampToValueAtTime(0.2 * p.finish, tk + 0.008);
            g.exponentialRampToValueAtTime(1e-4, tk + len);
          }
          g.setValueAtTime(0, t + 0.23 + 0.82);
          sweep(whooshF.frequency, t, 1100, 4200, 0.5);
          ping(whooshG.gain, t, 0.09 * p.finish, 0.1, 0.5);
          break;
        }
        case 'death': {
          // The one sound in the game that is allowed weight. A pitch collapse
          // under a filtered crunch: dull, low, and over in half a second,
          // because it is the sound of the loop restarting and you will hear it
          // more than any other.
          const s = cue.strength;
          sweep(growl.frequency, t, 185 + 70 * s, 34, 0.45);
          sweep(growlF.frequency, t, 1100 + 900 * s, 170, 0.4);
          ping(growlG.gain, t, 0.22 + 0.3 * s, 0.004, 0.42);
          sweep(crashF.frequency, t, 2600, 190, 0.3);
          ping(crashG.gain, t, 0.16 + 0.26 * s, 0.002, 0.3);
          sweep(thump.frequency, t, 120, 36, 0.14);
          ping(thumpG.gain, t, 0.3 * s, 0.003, 0.16);
          break;
        }
        case 'flip': {
          sweep(whooshF.frequency, t, 520, 2400, 0.13);
          ping(whooshG.gain, t, 0.11 * p.flip, 0.025, 0.12);
          break;
        }
      }
    },

    setMaster(level: number): void {
      master.gain.setTargetAtTime(Math.max(0, Math.min(1, level)), ctx.currentTime, 0.02);
    },

    panic(): void {
      const t = ctx.currentTime;
      for (const g of [thumpG, crashG, whooshG, growlG, chimeAG, chimeBG]) {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(0, t);
      }
    },

    close(): Promise<void> {
      try {
        for (const o of [engA, engB, engSub, lfo, thump, growl, chimeA, chimeB]) o.stop();
        noise.stop();
      } catch {
        // Already stopped. Closing twice is not an error worth reporting.
      }
      return ctx.close();
    },
  };
}
