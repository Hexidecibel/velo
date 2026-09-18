// THE PART OF THIS FEATURE NOBODY CAN HEAR IN A TEST, ASSERTED ANYWAY.
//
// The claim the four engines rest on is that their character is a FIRING
// PATTERN and not a timbre: a V-twin goes potato-potato because its two bangs
// are 315 and then 405 degrees apart, and a two-stroke is rude because it fires
// twice as often as a four-stroke at the same crank speed. Both of those are
// arithmetic, so both are checkable without ears.
//
// What is checked here, in order of how much it would matter to get wrong:
//
//   1. The bangs come out where they were put. Not by reading the spec back —
//      that proves nothing — but by RECONSTRUCTING the wave from its Fourier
//      series and finding the peaks in it, which is the same series WebAudio
//      is handed and the same one the offline WAV renderer uses.
//   2. The uneven engine is measurably uneven and the even ones are measurably
//      even, in the spectrum, against a same-cylinder-count control.
//   3. The four are distinct from each other on more than one axis.
//   4. The catalogue the picker shows and the catalogue the synth can build
//      are the same set of ids. A picker offering a motor that silently falls
//      back to another one is the worst outcome available here.
import { describe, it, expect } from 'vitest';
import { ENGINES } from '@/shared/appearance.ts';
import {
  CYCLE_SAMPLES,
  ENGINE_HARMONICS,
  ENGINE_SPECS,
  REFERENCE_ENGINE,
  engineFor,
  engineScales,
  engineWave,
  fireHzAt,
  firesPerRev,
  firingIntervals,
  peakAnglesOf,
  renderCycle,
} from './firing.ts';
import type { EngineSpec } from './firing.ts';

const spec = (id: string): EngineSpec => {
  const e = ENGINE_SPECS.find((x) => x.id === id);
  if (!e) throw new Error(`no engine ${id}`);
  return e;
};

describe('the catalogue and the synth agree', () => {
  it('offers exactly the engines it can build, in the same order', () => {
    // Two lists in two places, because one of them is SHARED with the server
    // and shared code has no business importing a synthesiser. The cost of that
    // split is this test, and it is a cheap price.
    expect(ENGINE_SPECS.map((e) => e.id)).toEqual(ENGINES.map((o) => o.id));
  });

  it('falls back rather than going silent on an id it has never heard of', () => {
    // Same posture as parseAppearance, and for the same reason: a newer client
    // picking a motor this build does not ship must still make a noise.
    expect(engineFor('from-the-future')).toBe(REFERENCE_ENGINE);
    expect(engineFor(null)).toBe(REFERENCE_ENGINE);
    expect(engineFor(42)).toBe(REFERENCE_ENGINE);
    expect(engineFor('vtwin').id).toBe('vtwin');
  });

  it('expresses every engine against the reference, which is itself unscaled', () => {
    // The two Hz sliders on the tuning panel are the REFERENCE engine's firing
    // rate. If that stopped being exactly 1:1 they would quietly become sliders
    // for a motor nobody rides, and model.test.ts's idle/redline assertions
    // would be asserting a coincidence.
    expect(REFERENCE_ENGINE.id).toBe(ENGINE_SPECS[0].id);
    const s = engineScales(REFERENCE_ENGINE);
    expect(s.idle).toBe(1);
    expect(s.rev).toBe(1);
  });
});

describe('the firing pattern', () => {
  it('gives the V-twin its limp: 315 degrees, then 405', () => {
    // THE ONE NUMBER THIS WHOLE ENGINE IS. Two rods on one crankpin 45 degrees
    // apart cannot fire evenly, and the 90-degree deficit is the potato.
    expect(firingIntervals(spec('vtwin'))).toEqual([315, 405]);
  });

  it('gives the inline four perfect evenness', () => {
    expect(firingIntervals(spec('road'))).toEqual([180, 180, 180, 180]);
  });

  it('makes the two-stroke fire twice as often as the four-stroke single', () => {
    // This IS the brap, stated mechanically: the same crank speed, twice the
    // bangs, because a two-stroke fires every revolution instead of every
    // other. Nothing about the timbre is doing this work.
    expect(firesPerRev(spec('dirt'))).toBe(2 * firesPerRev(spec('mower')));
    expect(fireHzAt(spec('dirt'), 1800)).toBe(2 * fireHzAt(spec('mower'), 1800));
  });

  it('puts every bang where the spec said, read back off the rendered wave', () => {
    // The strong version: reconstruct the waveform from the same Fourier series
    // that is handed to WebAudio, find its peaks, and check they land on the
    // crank angles. This cannot pass by agreeing with itself — `peakAnglesOf`
    // never sees `fires`.
    for (const e of ENGINE_SPECS) {
      const got = peakAnglesOf(e);
      const want = e.fires.map((f) => f.at).sort((a, b) => a - b);
      expect(got.length, e.id).toBe(want.length);
      // One sample of a 1024-point cycle is 0.7 degrees on a four-stroke.
      for (let i = 0; i < want.length; i++) expect(got[i], `${e.id} fire ${i}`).toBeCloseTo(want[i], -0.5);
    }
  });

  it('is what makes the uneven engine uneven, in the spectrum', () => {
    // A control with the SAME cylinder count, the same pulse shape and the same
    // everything else, firing evenly. An even twin cancels every odd harmonic
    // of the cycle exactly; the shared-crankpin twin cannot, and the energy
    // that turns up in those odd harmonics is the limp.
    // Both controls carry identical cylinders, so the ONLY difference between
    // them is the crank angle of the second bang. Nothing else can account for
    // the result.
    const even: EngineSpec = { ...spec('vtwin'), fires: [{ at: 0, gain: 1 }, { at: 360, gain: 1 }] };
    const limp: EngineSpec = { ...spec('vtwin'), fires: [{ at: 0, gain: 1 }, { at: 315, gain: 1 }] };
    const a = engineWave(even);
    const b = engineWave(limp);
    const odd = (w: { real: Float32Array; imag: Float32Array }): number => {
      let sum = 0;
      for (let n = 1; n < w.real.length; n += 2) sum += Math.hypot(w.real[n], w.imag[n]);
      return sum;
    };
    expect(odd(a)).toBeLessThan(1e-5);
    expect(odd(b)).toBeGreaterThan(0.5);
    // And the shipped engine is the second of those, not the first.
    expect(odd(engineWave(spec('vtwin')))).toBeGreaterThan(0.5);
  });

  it('is what makes the even engine even: an inline four repeats four times a cycle', () => {
    // Four evenly spaced bangs means every harmonic that is not a multiple of
    // four cancels, which is the same statement as "the waveform repeats four
    // times inside one engine cycle". That is why an I4 reads as a pitch rather
    // than as a series of events, and why it can rev to five figures.
    const w = engineWave(spec('road'));
    for (let n = 1; n < w.real.length; n++) {
      if (n % 4 !== 0) expect(Math.hypot(w.real[n], w.imag[n]), `harmonic ${n}`).toBeLessThan(1e-6);
    }
    const cycle = renderCycle(w, CYCLE_SAMPLES);
    const q = CYCLE_SAMPLES / 4;
    for (let i = 0; i < q; i++) expect(cycle[i]).toBeCloseTo(cycle[i + q], 5);
  });

  it('does NOT let the V-twin repeat on a half cycle, which is the same fact', () => {
    const cycle = renderCycle(engineWave(spec('vtwin')), CYCLE_SAMPLES);
    const h = CYCLE_SAMPLES / 2;
    let worst = 0;
    for (let i = 0; i < h; i++) worst = Math.max(worst, Math.abs(cycle[i] - cycle[i + h]));
    expect(worst).toBeGreaterThan(0.5);
  });
});

describe('the two layers are offset, not detuned', () => {
  // The bug an offline render caught before anybody had to listen to it. The
  // second engine layer used to be DETUNED, the way the two saws were before
  // the engine was a firing pattern. A detune on a pulse train is not a chorus:
  // at an inline four's 10 Hz idle cycle, ten cents is the second layer's bangs
  // sliding the whole way round the first layer's over about half a minute, so
  // the firing rhythm — the entire point — slowly becomes a different engine
  // and back. The layers now run at the same frequency, separated by a fixed
  // rotation of the pattern.
  const shifted = (e: EngineSpec, s: number): number[] =>
    peakAnglesOf({ ...e, fires: e.fires.map((f) => ({ ...f, at: (f.at + s * e.cycleDeg) % e.cycleDeg })) });

  it('rotates the whole pattern by exactly the offset asked for', () => {
    for (const e of ENGINE_SPECS) {
      const want = shifted(e, 0.05);
      const w = engineWave(e, undefined, 0.05);
      const cycle = renderCycle(w, CYCLE_SAMPLES);
      let max = 0;
      for (const v of cycle) max = Math.max(max, v);
      const got: number[] = [];
      for (let i = 0; i < CYCLE_SAMPLES; i++) {
        const prev = cycle[(i - 1 + CYCLE_SAMPLES) % CYCLE_SAMPLES];
        const next = cycle[(i + 1) % CYCLE_SAMPLES];
        if (cycle[i] >= max * 0.45 && cycle[i] >= prev && cycle[i] > next) got.push((i / CYCLE_SAMPLES) * e.cycleDeg);
      }
      expect(got.length, e.id).toBe(want.length);
      for (let i = 0; i < want.length; i++) expect(got[i], `${e.id} ${i}`).toBeCloseTo(want[i], -0.5);
    }
  });

  it('changes nothing about the magnitude spectrum, because it IS only a rotation', () => {
    // If a shift changed the harmonic magnitudes it would be a filter, not a
    // timing offset, and stacking two of them would colour the engine rather
    // than thicken it.
    for (const e of ENGINE_SPECS) {
      const a = engineWave(e);
      const b = engineWave(e, undefined, 0.037);
      for (let n = 1; n < a.real.length; n++) {
        // Three places, not more: each wave is peak-normalised against its own
        // 1024-point reconstruction, and a rotated pattern's true peak lands
        // between two of those samples slightly differently. That is a
        // normalisation artefact in the fourth decimal, not a spectrum change.
        expect(Math.hypot(b.real[n], b.imag[n]), `${e.id} harmonic ${n}`)
          .toBeCloseTo(Math.hypot(a.real[n], a.imag[n]), 3);
      }
    }
  });

  it('gives the loose machines more scatter than the tight ones', () => {
    const by = (id: string): number => spec(id).spread;
    expect(by('mower')).toBeGreaterThan(by('dirt'));
    expect(by('dirt')).toBeGreaterThan(by('vtwin'));
    expect(by('vtwin')).toBeGreaterThanOrEqual(by('road'));
  });
});

describe('the wave itself', () => {
  it('is peak-normalised here rather than somewhere a test cannot see', () => {
    // WebAudio would normalise this for us, and then what a WAV render wrote
    // and what the browser played would differ by an unknown factor. It is done
    // in firing.ts and `disableNormalization` is passed at the call site.
    for (const e of ENGINE_SPECS) {
      let peak = 0;
      for (const v of renderCycle(engineWave(e), CYCLE_SAMPLES)) peak = Math.max(peak, Math.abs(v));
      expect(peak, e.id).toBeCloseTo(1, 2);
    }
  });

  it('has no DC term, so no engine drags the mix off centre', () => {
    for (const e of ENGINE_SPECS) {
      expect(engineWave(e).real[0]).toBe(0);
      expect(engineWave(e).imag[0]).toBe(0);
    }
  });

  it('is finite everywhere, on every engine', () => {
    for (const e of ENGINE_SPECS) {
      const w = engineWave(e);
      expect([...w.real, ...w.imag].every((v) => Number.isFinite(v)), e.id).toBe(true);
    }
  });
});

describe('the four are actually four', () => {
  it('has a distinct waveform per engine', () => {
    const rendered = ENGINE_SPECS.map((e) => renderCycle(engineWave(e), 256));
    for (let i = 0; i < rendered.length; i++) {
      for (let j = i + 1; j < rendered.length; j++) {
        let diff = 0;
        for (let k = 0; k < 256; k++) diff += Math.abs(rendered[i][k] - rendered[j][k]);
        expect(diff / 256, `${ENGINE_SPECS[i].id} vs ${ENGINE_SPECS[j].id}`).toBeGreaterThan(0.02);
      }
    }
  });

  it('has a distinct firing-rate range per engine', () => {
    // Not a decoration: two motors that cover the same range at the same wheel
    // speed are the same motor wearing different filters, whatever the picker
    // says about them.
    const ranges = ENGINE_SPECS.map((e) => [fireHzAt(e, e.idleRpm), fireHzAt(e, e.redlineRpm)]);
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        expect(Math.abs(ranges[i][1] - ranges[j][1]), `${ENGINE_SPECS[i].id} vs ${ENGINE_SPECS[j].id}`)
          .toBeGreaterThan(20);
      }
    }
  });

  it('lets the road bike rev far higher than anything else, and the mower not at all', () => {
    // The brief in two numbers. An inline four is the only one of these allowed
    // near five figures, and a governed lawnmower is flat out at 3600 rpm.
    const top = (id: string): number => spec(id).redlineRpm;
    expect(top('road')).toBeGreaterThan(top('dirt'));
    expect(top('dirt')).toBeGreaterThan(top('vtwin'));
    expect(top('vtwin')).toBeGreaterThan(top('mower'));
    expect(top('road') / top('mower')).toBeGreaterThan(2.5);
  });

  it('only gives the governor hunt to the thing that has a governor', () => {
    for (const e of ENGINE_SPECS) {
      if (e.id === 'mower') expect(e.huntHz).toBeGreaterThan(0);
      else expect(e.huntHz, e.id).toBe(0);
    }
  });

  it('carries exactly as many harmonics as the filter can ever pass', () => {
    // Both ends of this matter. Too few and an engine is audibly duller than
    // its own filter setting asks for; too many and every engine change spends
    // milliseconds synthesising harmonics that are then filtered out — and an
    // engine change happens on a click, where a hitch is visible.
    //
    // The bound: the lowpass sits at `fireHz * (cutBase + cutLoad*pull) +
    // cutFloor`, and the oscillator runs at `fireHz / fires`, so the highest
    // CYCLE harmonic that survives is `fires * (cutBase + cutLoad + cutFloor /
    // idleFireHz)` — worst at idle under full load.
    let worst = 0;
    for (const e of ENGINE_SPECS) {
      const need = e.fires.length * (e.cutBase + e.cutLoad + e.cutFloor / fireHzAt(e, e.idleRpm));
      expect(need, e.id).toBeLessThan(ENGINE_HARMONICS);
      worst = Math.max(worst, need);
    }
    // And not wildly more than it needs, or the cost is being paid for nothing.
    expect(ENGINE_HARMONICS).toBeLessThan(worst * 2);
  });

  it('keeps the output trims within a range that cannot deafen anybody', () => {
    // These are MEASURED — an offline render of all four at full throttle put
    // them ten decibels apart before the trims existed, and they now sit within
    // about two. This is the guard rail around that, not a restatement of it:
    // a trim outside this range is somebody having typed a number, not measured
    // one, and it is the audio bug a player would feel in their ears.
    for (const e of ENGINE_SPECS) {
      expect(e.level, e.id).toBeGreaterThan(0.5);
      expect(e.level, e.id).toBeLessThan(3);
    }
  });

  it('keeps every spec finite and sane, so no preset can poison the frame loop', () => {
    for (const e of ENGINE_SPECS) {
      expect(e.fires.length, e.id).toBeGreaterThan(0);
      expect(e.cycleDeg === 360 || e.cycleDeg === 720, e.id).toBe(true);
      expect(e.idleRpm, e.id).toBeGreaterThan(0);
      expect(e.redlineRpm, e.id).toBeGreaterThan(e.idleRpm);
      expect(e.bright, e.id).toBeGreaterThan(0);
      for (const f of e.fires) {
        expect(f.at, e.id).toBeGreaterThanOrEqual(0);
        expect(f.at, e.id).toBeLessThan(e.cycleDeg);
        expect(f.gain, e.id).toBeGreaterThan(0);
      }
    }
  });
});
