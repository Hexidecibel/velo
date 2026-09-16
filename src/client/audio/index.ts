// Audio's public surface: lifecycle, the browser's rules, and one `update` the
// frame loop calls.
//
// Three browser facts drive everything here, and all three are handled rather
// than logged about:
//
//  1. A page may not start audio before a user gesture. So the AudioContext is
//     not CONSTRUCTED until the first pointer or key event — not constructed
//     and then resumed, because merely constructing one on a gestureless page
//     puts a warning in the console, and a warning that reappears on every load
//     forever is how a console stops being worth reading. Until then `update`
//     is a cheap no-op and the game is exactly as it was before audio existed.
//
//  2. A backgrounded tab should cost nothing. `visibilitychange` suspends the
//     context, which stops the audio thread outright — not a gain ramp to zero,
//     which keeps every oscillator running to render silence.
//
//  3. Everything can fail. A locked-down browser, a machine with no output
//     device, an AudioContext that refuses to resume. Every entry point here is
//     wrapped, and a failure sets `error` and disables audio for the session
//     rather than throwing into the frame loop. Nothing about this feature is
//     allowed to be able to stop the game running.
//
// MUTE SUSPENDS THE CONTEXT TOO. A muted game is silent and free, not silent
// and still paying for nine voices.
import type { AudioParams } from './params.ts';
import { createRideModel } from './model.ts';
import type { RideModel, RideSample } from './model.ts';
import { createSynth } from './engine.ts';
import type { Synth } from './engine.ts';

export type AudioState = 'idle' | 'starting' | 'running' | 'suspended' | 'unsupported' | 'failed';

export interface Audio {
  readonly state: AudioState;
  readonly started: boolean;
  readonly muted: boolean;
  readonly error: string | null;
  /** Milliseconds the last `update` cost on the main thread. */
  readonly lastMs: number;
  /** How many cues have been fired since boot. A diagnostic, and smoke reads it. */
  readonly cueCount: number;
  /** Start now, if a gesture has happened or the caller is one. Idempotent. */
  start(): void;
  setMuted(on: boolean): void;
  toggleMuted(): boolean;
  /**
   * Duck everything, 0..1. The overview freezes the sim, and an engine note
   * held flat for as long as TAB is down is the one case where being faithful
   * to the state sounds broken.
   */
  setDuck(x: number): void;
  /** Once per rendered frame, after the draw. */
  update(sample: RideSample, dtSec: number): void;
  /** A level change or a replay starting: forget the run, kill every tail. */
  reset(): void;
}

interface AudioCtor {
  new (): AudioContext;
}

function audioCtor(): AudioCtor | null {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function createAudio(params: () => AudioParams): Audio {
  const model: RideModel = createRideModel(params);
  let synth: Synth | null = null;
  let state: AudioState = 'idle';
  let error: string | null = null;
  let muted = params().muted > 0;
  let duck = 1;
  let lastMs = 0;
  let cueCount = 0;
  let lastMaster = -1;
  /** Serialises resume/suspend. See resumeIfWanted. */
  let pending: Promise<void | undefined> = Promise.resolve();

  const self: Audio = {
    get state() {
      return state;
    },
    get started() {
      return synth !== null;
    },
    get muted() {
      return muted;
    },
    get error() {
      return error;
    },
    get lastMs() {
      return lastMs;
    },
    get cueCount() {
      return cueCount;
    },
    start,
    setMuted,
    toggleMuted(): boolean {
      setMuted(!muted);
      return muted;
    },
    setDuck(x: number): void {
      const v = x < 0 ? 0 : x > 1 ? 1 : x;
      if (Math.abs(v - duck) < 0.005) return;
      duck = v;
      pushMaster();
    },
    update,
    reset(): void {
      model.reset();
      synth?.panic();
    },
  };

  function fail(e: unknown): void {
    // ONCE. A frame-loop failure that reported itself would write sixty lines a
    // second into the console and bury whatever the real problem was.
    if (error === null) error = e instanceof Error ? e.message : String(e);
    state = 'failed';
  }

  function start(): void {
    if (synth || state === 'failed' || state === 'unsupported') return;
    const Ctor = audioCtor();
    if (!Ctor) {
      state = 'unsupported';
      error = 'this browser has no WebAudio';
      return;
    }
    state = 'starting';
    try {
      const ctx = new Ctor();
      synth = createSynth(ctx);
      pushMaster();
      ctx.addEventListener('statechange', syncState);
      resumeIfWanted();
      syncState();
    } catch (e) {
      synth = null;
      fail(e);
    }
  }

  function syncState(): void {
    if (!synth || state === 'failed') return;
    const s = synth.ctx.state;
    state = s === 'running' ? 'running' : s === 'closed' ? 'failed' : 'suspended';
  }

  /**
   * Resume unless something WANTS us quiet: mute, or a hidden tab.
   *
   * SERIALISED, and that is not defensive plumbing — it is a bug that was
   * caught by the smoke check. `resume()` and `suspend()` are both async and
   * both decide what to do from `ctx.state`, so an unmute immediately followed
   * by the tab being hidden read a context that was still 'suspended', decided
   * there was nothing to suspend, and then the resume landed and left a hidden
   * tab making noise. Chaining them means each one sees the state the previous
   * one actually reached.
   */
  function resumeIfWanted(): void {
    if (!synth) return;
    const ctx = synth.ctx;
    pending = pending.then(
      () => {
        const wantOn = !muted && !document.hidden;
        if (wantOn && ctx.state !== 'running') return ctx.resume();
        if (!wantOn && ctx.state === 'running') return ctx.suspend();
        return undefined;
      },
      // A rejected resume is the ordinary no-gesture-yet case, not an error,
      // and it must not poison the chain for every transition after it.
      () => undefined,
    ).then(syncState, syncState);
  }

  function pushMaster(): void {
    if (!synth) return;
    const want = muted ? 0 : params().master * duck;
    // Deadbanded: the panel's volume slider writes the params object directly
    // and there is nothing to hook, so this is called every frame and must cost
    // a compare on the frames where nobody touched it.
    if (Math.abs(want - lastMaster) < 0.0005) return;
    lastMaster = want;
    try {
      synth.setMaster(want);
    } catch (e) {
      fail(e);
    }
  }

  function setMuted(on: boolean): void {
    if (muted === on) return;
    muted = on;
    params().muted = on ? 1 : 0;
    if (!synth) return;
    // Gain first, then suspend: suspending a context that is mid-ramp leaves
    // the ramp to finish on resume, which is an audible blip on unmute.
    pushMaster();
    synth.panic();
    resumeIfWanted();
  }

  function update(sample: RideSample, dtSec: number): void {
    if (state === 'failed' || state === 'unsupported') return;
    // No context yet, or muted, or hidden. The model is still stepped when a
    // context exists and is merely suspended — so that unmuting mid-run does
    // not fire a landing cue for a landing that happened a minute ago — but
    // when there is nothing to hear at all, nothing runs.
    if (!synth) return;
    if (muted || synth.ctx.state !== 'running') {
      // Keep the model's idea of the run current, but drop every cue on the
      // floor — unmuting mid-run must not fire the landing you had a minute
      // ago. This is the cheap path and it is the one a muted player is on.
      model.update(sample, dtSec);
      lastMs = 0;
      return;
    }
    const t0 = performance.now();
    try {
      const p = params();
      const frame = model.update(sample, dtSec);
      synth.setTimbre(p.engineDetune, p.engineSub);
      synth.apply(frame.voices);
      for (const cue of frame.cues) {
        synth.fire(cue, p);
        cueCount++;
      }
      pushMaster();
      lastMs = performance.now() - t0;
      params().updateMs = lastMs;
    } catch (e) {
      fail(e);
    }
  }

  // --- the browser's rules ----------------------------------------------------

  // The gesture. `capture` so a click on the tuning panel counts too, and no
  // `once`, because the first gesture can arrive while the context construction
  // is still failing for some other reason and the second should get a go.
  const onGesture = (): void => {
    if (synth) {
      // Chrome can leave a context suspended after a tab restore even with the
      // gesture requirement satisfied. Any gesture is a chance to fix that.
      resumeIfWanted();
      return;
    }
    start();
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, onGesture, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) synth?.panic();
    resumeIfWanted();
  });

  return self;
}
