// The audio model is where all the feel lives, and it is pure numbers, so it
// tests in plain node like everything else. There is no jsdom here and no
// WebAudio: `engine.ts` is a thin applier of what this file produces and has
// nothing in it worth asserting that a browser would not catch first.
//
// What is asserted here is the SHAPE of each mapping, never an exact value.
// Every constant below is a tuning knob on the panel and will move; "pitch is
// bound to wheel spin and not to ground speed" will not.
import { describe, it, expect } from 'vitest';
import { createRideModel } from './model.ts';
import type { Cue, RideSample, Voices } from './model.ts';
import { cloneAudio, DEFAULT_AUDIO } from './params.ts';
import type { AudioParams } from './params.ts';
import { ENGINE_SPECS, engineFor, fireHzAt } from './firing.ts';

const FRAME = 1 / 60;

function sample(over: Partial<RideSample> = {}): RideSample {
  return {
    tick: 0,
    driveSpin: 0,
    speed: 0,
    grounded: 3,
    slip: 0,
    wheelVy: [0, 0],
    comp01: [0.3, 0.3],
    throttle: false,
    brake: false,
    facing: 1,
    dead: false,
    finished: false,
    applesLeft: 3,
    maxWheelSpin: 80,
    ...over,
  };
}

/** Run `n` frames of the same state, so the smoothers settle. */
function settle(
  model: ReturnType<typeof createRideModel>,
  s: (tick: number) => RideSample,
  n: number,
): { cues: Cue[]; voices: Voices } {
  // Copied, not kept: `update` returns the model's own two objects and
  // overwrites them next frame. See RideFrame.
  let last = model.update(s(0), FRAME);
  const cues: Cue[] = [...last.cues];
  for (let i = 1; i < n; i++) {
    last = model.update(s(i), FRAME);
    for (const c of last.cues) cues.push(c);
  }
  return { cues, voices: { ...last.voices } };
}

/** One frame, copied off the model's reused buffers. */
function frame(model: ReturnType<typeof createRideModel>, s: RideSample, dt = FRAME): { cues: Cue[]; voices: Voices } {
  const f = model.update(s, dt);
  return { cues: [...f.cues], voices: { ...f.voices } };
}

function newModel(over: Partial<AudioParams> = {}): {
  model: ReturnType<typeof createRideModel>;
  params: AudioParams;
} {
  const params = { ...cloneAudio(DEFAULT_AUDIO), ...over };
  return { model: createRideModel(() => params), params };
}

describe('engine pitch', () => {
  it('is bound to wheel spin and not to ground speed', () => {
    // The whole thesis of the engine sound in one test. These two states are
    // the same bike doing very different things: one rolling along gripping,
    // one sitting still with the wheel spinning up. Ground speed says they are
    // opposites; a speed-bound engine would get them exactly backwards.
    const rolling = newModel();
    const a = settle(rolling.model, (i) => sample({ tick: i * 4, speed: 12, driveSpin: 48 }), 40);

    const spinning = newModel();
    const b = settle(spinning.model, (i) => sample({ tick: i * 4, speed: 0, driveSpin: 78, throttle: true }), 40);

    expect(b.voices.engineHz).toBeGreaterThan(a.voices.engineHz);
  });

  it('climbs with spin and stops climbing at maxWheelSpin', () => {
    const at = (spin: number): number => {
      const { model } = newModel();
      return settle(model, (i) => sample({ tick: i * 4, driveSpin: spin, throttle: true }), 60).voices.engineHz;
    };
    const idle = at(0);
    const mid = at(40);
    const top = at(80);
    const past = at(200);
    expect(idle).toBeCloseTo(DEFAULT_AUDIO.engineIdleHz, 1);
    expect(mid).toBeGreaterThan(idle);
    expect(top).toBeGreaterThan(mid);
    expect(top).toBeCloseTo(DEFAULT_AUDIO.engineRevHz, 0);
    // Past the taper the wheel cannot be driven any faster, so neither may the
    // sound: an engine that kept climbing would be describing torque the bike
    // does not have.
    expect(past).toBeCloseTo(top, 5);
  });

  it('spreads the bottom of the rev range, where the riding happens', () => {
    const at = (spin: number): number => {
      const { model } = newModel();
      return settle(model, (i) => sample({ tick: i * 4, driveSpin: spin, throttle: true }), 60).voices.engineHz;
    };
    const span = at(80) - at(0);
    // A linear map would put exactly half the audible change below half revs.
    // The curve puts most of it there, which is the difference between pulling
    // away sounding like something and sounding like nothing.
    expect(at(40) - at(0)).toBeGreaterThan(span * 0.55);
  });

  it('is brighter under load than when free-revving at the same pitch', () => {
    // Throttle held at max wheel spin is the free-rev case: step.ts has tapered
    // drive torque to zero, so the engine is screaming with nothing behind it.
    // Same pitch, less pull, and the filter is what says so.
    const pulling = newModel();
    const pull = settle(pulling.model, (i) => sample({ tick: i * 4, driveSpin: 8, throttle: true }), 60);
    const freeing = newModel();
    const free = settle(freeing.model, (i) => sample({ tick: i * 4, driveSpin: 80, throttle: true }), 60);
    expect(pull.voices.engineCutoffHz / pull.voices.engineHz)
      .toBeGreaterThan(free.voices.engineCutoffHz / free.voices.engineHz);
  });

  it('goes silent when the run ends', () => {
    const { model } = newModel();
    settle(model, (i) => sample({ tick: i * 4, driveSpin: 50, throttle: true }), 40);
    const dead = settle(model, (i) => sample({ tick: 160 + i * 4, driveSpin: 50, dead: true }), 40);
    expect(dead.voices.engineGain).toBeLessThan(0.01);
  });
});

describe('landings', () => {
  /** Fall for `air` seconds at `fall` m/s, then touch down at `comp` compression. */
  function land(fall: number, comp: number, air = 0.5, p: Partial<AudioParams> = {}): Cue[] {
    const { model } = newModel(p);
    const frames = Math.round(air / FRAME);
    for (let i = 0; i < frames; i++) {
      model.update(sample({ tick: i * 4, grounded: 0, wheelVy: [-fall, -fall], comp01: [0, 0] }), FRAME);
    }
    return frame(model, sample({ tick: frames * 4, grounded: 3, wheelVy: [0, 0], comp01: [comp, comp] })).cues;
  }

  const strength = (cues: Cue[]): number => {
    const c = cues.find((x) => x.kind === 'land');
    return c && c.kind === 'land' ? c.strength : 0;
  };

  it('scales with impact velocity', () => {
    const soft = strength(land(2.5, 0.4));
    const hard = strength(land(11, 0.4));
    expect(soft).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(soft * 2);
  });

  it('scales with suspension compression at the same fall speed', () => {
    // The suspension already knows the difference between dropping onto a flat
    // and rolling into a slope at the same speed. This is that, and it is why
    // impact is not a function of velocity alone.
    const shallow = strength(land(6, 0.2));
    const bottomed = strength(land(6, 1));
    expect(bottomed).toBeGreaterThan(shallow);
  });

  it('fires once for a landing, not once per wheel', () => {
    expect(land(9, 0.6).filter((c) => c.kind === 'land')).toHaveLength(1);
  });

  it('ignores a wheel that barely skipped', () => {
    // A wheel chattering over rough ground leaves the floor for a few
    // milliseconds at a time. One thump per bounce is a drum roll, and a drum
    // roll is what makes a sound hated by attempt fifty.
    expect(land(8, 0.5, 0.04)).toHaveLength(0);
  });

  it('is silent when a gentle touchdown is below the threshold', () => {
    expect(land(0.4, 0.31)).toHaveLength(0);
  });

  it('obeys the impact sensitivity knob', () => {
    expect(strength(land(9, 0.6, 0.5, { impact: 0.2 })))
      .toBeLessThan(strength(land(9, 0.6, 0.5, { impact: 1 })));
  });
});

describe('cues', () => {
  it('fires one rising note per apple', () => {
    const { model } = newModel();
    model.update(sample({ tick: 0, applesLeft: 3 }), FRAME);
    const a = frame(model, sample({ tick: 4, applesLeft: 2 })).cues;
    model.update(sample({ tick: 8, applesLeft: 2 }), FRAME);
    const b = frame(model, sample({ tick: 12, applesLeft: 1 })).cues;
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].kind).toBe('apple');
    expect(b[0].kind).toBe('apple');
    if (a[0].kind === 'apple' && b[0].kind === 'apple') expect(b[0].step).toBeGreaterThan(a[0].step);
  });

  it('fires the flower once and death once', () => {
    const { model } = newModel();
    model.update(sample({ tick: 0 }), FRAME);
    expect(model.update(sample({ tick: 4, applesLeft: 0, finished: true }), FRAME).cues.map((c) => c.kind))
      .toEqual(['apple', 'finish']);
    // The sim freezes a finished run, so the same state arrives every frame
    // after. It must not re-fire.
    expect(model.update(sample({ tick: 8, applesLeft: 0, finished: true }), FRAME).cues).toHaveLength(0);
  });

  it('makes a faster death a bigger one, with a floor under a slow one', () => {
    const at = (speed: number): number => {
      const { model } = newModel();
      model.update(sample({ tick: 0, speed }), FRAME);
      const c = frame(model, sample({ tick: 4, speed, dead: true })).cues[0];
      return c && c.kind === 'death' ? c.strength : 0;
    };
    expect(at(1)).toBeGreaterThan(0.2);
    expect(at(18)).toBeGreaterThan(at(1));
  });

  it('whooshes on a flip', () => {
    const { model } = newModel();
    model.update(sample({ tick: 0, facing: 1 }), FRAME);
    expect(model.update(sample({ tick: 4, facing: -1 }), FRAME).cues.map((c) => c.kind)).toEqual(['flip']);
  });
});

describe('the restart loop', () => {
  it('fires nothing at all on a restart', () => {
    // THE most important test in this file for how the game feels. This is a
    // die-and-retry game: a player hears the start of a run hundreds of times
    // in a session, and anything that fires there will be hated long before
    // they get good at the level. So: nothing, ever, on the frame the clock
    // goes back — not the death that caused it, not a landing from the bike
    // dropping onto its wheels, not an apple count resetting.
    const { model } = newModel();
    for (let i = 0; i < 30; i++) {
      model.update(sample({ tick: i * 4, grounded: 0, wheelVy: [-12, -12], applesLeft: 1 }), FRAME);
    }
    model.update(sample({ tick: 120, speed: 14, dead: true }), FRAME);
    const restart = frame(model, sample({ tick: 0, grounded: 3, applesLeft: 3, comp01: [0.9, 0.9] }));
    expect(restart.cues).toHaveLength(0);
  });

  it('brings the engine up from silence rather than snapping to idle', () => {
    const { model } = newModel();
    const first = frame(model, sample({ tick: 0 }));
    expect(first.voices.engineGain).toBeLessThan(0.05);
    const later = settle(model, (i) => sample({ tick: (i + 1) * 4 }), 40);
    expect(later.voices.engineGain).toBeGreaterThan(first.voices.engineGain);
  });

  it('counts the apple ladder from the bottom again on the next run', () => {
    const { model } = newModel();
    model.update(sample({ tick: 0, applesLeft: 3 }), FRAME);
    const first = frame(model, sample({ tick: 4, applesLeft: 2 })).cues[0];
    model.update(sample({ tick: 0, applesLeft: 3 }), FRAME);
    const again = frame(model, sample({ tick: 4, applesLeft: 2 })).cues[0];
    expect(first.kind === 'apple' && again.kind === 'apple' && again.step).toBe(
      first.kind === 'apple' ? first.step : -1,
    );
  });
});

describe('tyre scrub', () => {
  it('is silent while the tyre grips and loud when it breaks away', () => {
    const grip = newModel();
    const g = settle(grip.model, (i) => sample({ tick: i * 4, slip: 0.2, throttle: true }), 40);
    const spin = newModel();
    const s = settle(spin.model, (i) => sample({ tick: i * 4, slip: 6, throttle: true }), 40);
    expect(g.voices.scrubGain).toBeLessThan(0.001);
    expect(s.voices.scrubGain).toBeGreaterThan(0.1);
    expect(s.voices.scrubHz).toBeGreaterThan(g.voices.scrubHz);
  });

  it('is silent in mid-air however fast the wheel is turning', () => {
    const { model } = newModel();
    const air = settle(model, (i) => sample({ tick: i * 4, grounded: 0, slip: 9, driveSpin: 80 }), 40);
    expect(air.voices.scrubGain).toBeLessThan(0.001);
  });
});

describe('frame independence', () => {
  it('reaches the same place at 30 fps as at 144 fps', () => {
    // The sim is fixed-step and audio is not, so every smoother here is
    // framerate-dependent by construction. It must at least CONVERGE to the
    // same value, or the same run sounds different on two machines.
    const run = (dt: number): number => {
      const { model } = newModel();
      let v = 0;
      for (let i = 0; i < Math.round(1.5 / dt); i++) {
        v = model.update(sample({ tick: i * 4, driveSpin: 55, throttle: true }), dt).voices.engineHz;
      }
      return v;
    };
    expect(run(1 / 30)).toBeCloseTo(run(1 / 144), 2);
  });

  it('survives a frame time of zero, a negative one, and a tab that was asleep', () => {
    const { model } = newModel();
    for (const dt of [0, -1, 30, NaN]) {
      const out = model.update(sample({ tick: 4, driveSpin: 30 }), dt);
      expect(Number.isFinite(out.voices.engineHz)).toBe(true);
      expect(Number.isFinite(out.voices.engineGain)).toBe(true);
    }
  });
});

// --- the four engines --------------------------------------------------------
//
// The acoustics of a firing pattern live in firing.test.ts, which asserts that
// the bangs come out at the crank angles they were put at. THIS is the other
// half: that the pattern is driven by the sim, that all four are driven the
// same way, and that swapping one cannot change anything except the noise.

describe('choosing an engine', () => {
  /** Firing rate, settled, at a given wheel spin, on a given motor. */
  function hzAt(id: string, spin: number, frames = 90): number {
    const { model } = newModel();
    model.setEngine(id);
    return settle(model, (i) => sample({ tick: i * 4, driveSpin: spin, throttle: true }), frames)
      .voices.engineHz;
  }

  it('leaves pitch tracking wheel spin monotonically on every one of them', () => {
    // The thesis at the top of this file has to survive four motors. Whatever
    // the cylinder count, opening the throttle must make the note go one way.
    for (const e of ENGINE_SPECS) {
      let prev = -1;
      for (const spin of [0, 5, 10, 20, 30, 40, 55, 70, 80]) {
        const hz = hzAt(e.id, spin);
        expect(hz, `${e.id} at spin ${spin}`).toBeGreaterThan(prev);
        prev = hz;
      }
    }
  });

  it('stops climbing at maxWheelSpin on every one of them', () => {
    for (const e of ENGINE_SPECS) {
      expect(hzAt(e.id, 400), e.id).toBeCloseTo(hzAt(e.id, 80), 1);
    }
  });

  it('makes four measurably different noises at the same wheel speed', () => {
    // Twenty bangs a second apart at full chat, minimum. Two motors that agree
    // to within a rounding error at the same spin are one motor with two names.
    const top = ENGINE_SPECS.map((e) => ({ id: e.id, hz: hzAt(e.id, 80) }));
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        expect(Math.abs(top[i].hz - top[j].hz), `${top[i].id} vs ${top[j].id}`).toBeGreaterThan(20);
      }
    }
  });

  it('puts them in the order the mechanism says: I4, two-stroke, V-twin, mower', () => {
    // Bangs per second at full throttle and full spin. The two-stroke beats the
    // V-twin despite having a quarter of the cylinders because it fires every
    // revolution; the mower is last because it fires every OTHER revolution and
    // is governed. None of this is a taste decision.
    expect(hzAt('road', 80)).toBeGreaterThan(hzAt('dirt', 80));
    expect(hzAt('dirt', 80)).toBeGreaterThan(hzAt('vtwin', 80));
    expect(hzAt('vtwin', 80)).toBeGreaterThan(hzAt('mower', 80));
  });

  it('lands each engine on its own documented rev range', () => {
    // The specs claim rpm figures. This is the check that those figures are
    // what actually comes out rather than documentation that drifted.
    for (const e of ENGINE_SPECS) {
      expect(hzAt(e.id, 0), `${e.id} idle`).toBeCloseTo(fireHzAt(e, e.idleRpm), 0);
      expect(hzAt(e.id, 80), `${e.id} redline`).toBeCloseTo(fireHzAt(e, e.redlineRpm), 0);
    }
  });

  it('runs the oscillator at the CYCLE rate, which is what places the bangs', () => {
    // The firing pattern is one period of a wave (see firing.ts). Get this
    // divide wrong and a V-twin plays its limp at twice the rate it should.
    for (const e of ENGINE_SPECS) {
      const { model } = newModel();
      model.setEngine(e.id);
      const v = settle(model, (i) => sample({ tick: i * 4, driveSpin: 40, throttle: true }), 90).voices;
      expect(v.engineCycleHz, e.id).toBeCloseTo(v.engineHz / e.fires.length, 6);
      expect(v.engineSubHz, e.id).toBeCloseTo(v.engineHz * e.subMult, 6);
    }
  });

  it('hunts on the lawnmower and nowhere else', () => {
    // The governor chasing its setpoint. It is the funny part, and it is a real
    // mechanism rather than a wobble bolted on, so it is asserted like one.
    const spread = (id: string): number => {
      const { model } = newModel();
      model.setEngine(id);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 300; i++) {
        const hz = model.update(sample({ tick: i * 4, driveSpin: 0, throttle: true }), FRAME).voices.engineHz;
        if (i > 120) {
          lo = Math.min(lo, hz);
          hi = Math.max(hi, hz);
        }
      }
      return (hi - lo) / ((hi + lo) / 2);
    };
    expect(spread('mower')).toBeGreaterThan(0.04);
    for (const e of ENGINE_SPECS) {
      if (e.id !== 'mower') expect(spread(e.id), e.id).toBeLessThan(1e-6);
    }
  });

  it('falls back to the reference engine on an id it does not know', () => {
    expect(hzAt('from-the-future', 40)).toBeCloseTo(hzAt(engineFor(null).id, 40), 6);
  });

  it('CANNOT change a single cue, however loud the engine gets', () => {
    // The engine is presentation inside a subsystem that is already
    // presentation. Landings, apples, the flower and death are events in the
    // run, and a lawnmower must not miss one.
    const run = (id: string): string => {
      const { model } = newModel();
      model.setEngine(id);
      const out: string[] = [];
      for (let i = 0; i < 40; i++) {
        model.update(sample({ tick: i * 4, grounded: 0, wheelVy: [-9, -9], comp01: [0, 0], throttle: true }), FRAME);
      }
      for (let i = 40; i < 60; i++) {
        const f = model.update(
          sample({ tick: i * 4, grounded: 3, comp01: [0.8, 0.8], applesLeft: i < 45 ? 3 : 2, throttle: true }),
          FRAME,
        );
        for (const c of f.cues) out.push(c.kind);
      }
      return out.join(',');
    };
    const road = run('road');
    expect(road).toContain('land');
    expect(road).toContain('apple');
    for (const e of ENGINE_SPECS) expect(run(e.id), e.id).toBe(road);
  });
});

describe('the picker preview', () => {
  it('revs a stationary bike and then stops', () => {
    // The customiser pauses the sim, so without this, choosing an engine
    // changes an idle you have to take on faith.
    const { model } = newModel();
    model.setEngine('vtwin');
    const still = settle(model, (i) => sample({ tick: i * 4 }), 60).voices.engineHz;
    model.blip();
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      peak = Math.max(peak, model.update(sample({ tick: 240 }), FRAME).voices.engineHz);
    }
    expect(peak).toBeGreaterThan(still * 1.5);
    const after = settle(model, () => sample({ tick: 240 }), 120).voices.engineHz;
    expect(after).toBeCloseTo(still, 0);
  });

  it('is audible on a dead run, because that is what the panel is usually opened over', () => {
    const { model } = newModel();
    settle(model, (i) => sample({ tick: i * 4, dead: true }), 60);
    model.blip();
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      peak = Math.max(peak, model.update(sample({ tick: 240, dead: true }), FRAME).voices.engineGain);
    }
    expect(peak).toBeGreaterThan(0.05);
  });
});
