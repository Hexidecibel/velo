import { describe, it, expect } from 'vitest';
import { parseLevel } from './level.ts';
import { createSim } from './sim.ts';
import { DEFAULT_SPEC, cloneSpec, specHash } from './spec.ts';
import type { BikeSpec } from './spec.ts';
import { TEST_LEVEL } from './testlevel.ts';
import {
  buildReplay,
  checkReplayCompat,
  decodeInputs,
  revMismatchRefusal,
  verifyReplaySteps,
  encodeInputs,
  parseReplayFile,
  replayFileName,
  replaySpec,
  ticksToSeconds,
  toReplayFile,
  verifyReplay,
} from './replay.ts';
import type { Replay } from './replay.ts';
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE, SIM_HZ } from './consts.ts';
import { SIM_REV } from './rev.ts';

const level = parseLevel(TEST_LEVEL);
const drive = (f: number): number =>
  (f % 9 < 6 ? IN_THROTTLE : 0) |
  (f % 53 === 0 ? IN_BRAKE : 0) |
  (f % 31 < 5 ? IN_LEAN_L : 0) |
  (f % 43 < 4 ? IN_LEAN_R : 0) |
  (f % 97 === 0 ? IN_FLIP : 0);

function record(frames = 900, spec = DEFAULT_SPEC, hashEvery = 32): Replay {
  const sim = createSim(level, spec);
  const masks: number[] = [];
  const hashes: string[] = [];
  for (let f = 0; f < frames; f++) {
    const m = drive(f);
    masks.push(m);
    sim.advance(m);
    if ((f + 1) % hashEvery === 0) hashes.push(sim.hash());
  }
  return buildReplay({ level, spec, masks, hashEvery, hashes, state: sim.state });
}

describe('input RLE', () => {
  it('round-trips', () => {
    const masks = Array.from({ length: 500 }, (_, f) => drive(f));
    expect(decodeInputs(encodeInputs(masks))).toEqual(masks);
  });

  it('round-trips the empty stream', () => {
    expect(decodeInputs(encodeInputs([]))).toEqual([]);
  });

  it('actually compresses a held key', () => {
    const held = new Array(1000).fill(IN_THROTTLE);
    expect(encodeInputs(held)).toBe('1*1000');
  });

  it('rejects a malformed or hostile stream rather than trusting it', () => {
    // This parser will one day run on a server against uploaded bytes.
    expect(() => decodeInputs('1*999999999999')).toThrow(/run length/);
    expect(() => decodeInputs('9999')).toThrow(/bad mask/);
    expect(() => decodeInputs('-1*3')).toThrow(/bad mask/);
    expect(() => decodeInputs('1*0')).toThrow(/run length/);
    expect(() => decodeInputs('x*3')).toThrow(/bad mask/);
  });
});

describe('verifyReplay', () => {
  it('accepts a replay of the run that produced it', () => {
    // The whole determinism bet, checked end to end, on day one rather than at
    // leaderboard launch.
    const r = record();
    const v = verifyReplay(level, DEFAULT_SPEC, r);
    expect(v.reason).toBeUndefined();
    expect(v.ok).toBe(true);
    expect(v.timeTicks).toBe(r.timeTicks);
  });

  it('is stable across repeated verification', () => {
    const r = record();
    const a = verifyReplay(level, DEFAULT_SPEC, r);
    const b = verifyReplay(level, DEFAULT_SPEC, r);
    expect(b.finalHash).toBe(a.finalHash);
  });

  it('catches a tampered input stream at the frame it diverges', () => {
    const r = record();
    const masks = decodeInputs(r.inputs);
    // Early enough to be before the run ends. Past the end the state is frozen
    // by design, so a later edit legitimately changes nothing.
    masks[24] ^= IN_THROTTLE;
    const forged: Replay = { ...r, inputs: encodeInputs(masks) };
    const v = verifyReplay(level, DEFAULT_SPEC, forged);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/desync|disagree/);
  });

  it('catches a claimed time that the inputs do not produce', () => {
    const r = record();
    const v = verifyReplay(level, DEFAULT_SPEC, { ...r, timeTicks: 1 });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/time disagrees/);
  });

  it('refuses a replay recorded on a different bike', () => {
    const other = cloneSpec(DEFAULT_SPEC);
    other.suspension.stiffness += 1;
    const r = record();
    const v = verifyReplay(level, other, r);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/bike spec/);
  });

  it('refuses a replay recorded on a different level', () => {
    const moved = parseLevel({ ...TEST_LEVEL, flower: { x: 58, y: 4.6 } });
    const r = record();
    const v = verifyReplay(moved, DEFAULT_SPEC, r);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/for level/);
  });

  it('refuses a replay from another sim rev', () => {
    const r = record();
    const v = verifyReplay(level, DEFAULT_SPEC, { ...r, simRev: SIM_REV + 1 });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/sim rev/);
  });

  it('refuses a frame count that disagrees with the input stream', () => {
    const r = record();
    const v = verifyReplay(level, DEFAULT_SPEC, { ...r, frames: r.frames + 1 });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/frames/);
  });
});

describe('time', () => {
  it('converts ticks to seconds at the sim rate', () => {
    expect(ticksToSeconds(SIM_HZ)).toBe(1);
    expect(ticksToSeconds(0)).toBe(0);
  });
});

describe('replay files', () => {
  it('round-trips through JSON and re-verifies', () => {
    const r = record(400);
    const file = toReplayFile(r, {
      level: TEST_LEVEL,
      levelName: level.name,
      spec: DEFAULT_SPEC,
      recordedAt: '2026-09-15T00:00:00Z',
      note: 'it got weird here',
    });
    // Through actual bytes, because that is the trip the feature makes.
    const back = parseReplayFile(JSON.parse(JSON.stringify(file)));
    expect(back.frames).toBe(r.frames);
    expect(back.inputs).toBe(r.inputs);
    expect(back.note).toBe('it got weird here');
    expect(verifyReplay(level, DEFAULT_SPEC, back).ok).toBe(true);
  });

  it('recovers the recorded bike from the file', () => {
    const tuned = cloneSpec(DEFAULT_SPEC);
    tuned.suspension.reboundDamping = 210;
    const r = record(200, tuned);
    const file = parseReplayFile(JSON.parse(JSON.stringify(toReplayFile(r, { spec: tuned }))));
    const got = replaySpec(file);
    expect(got).not.toBeNull();
    expect(specHash(got as BikeSpec)).toBe(r.specHash);
    // ...and the recovered bike is close enough to be the same bike, not just
    // a hash collision.
    expect((got as BikeSpec).suspension.reboundDamping).toBe(210);
  });

  it('refuses a spec whose hash does not match what the file claims', () => {
    const r = record(64);
    const tampered = cloneSpec(DEFAULT_SPEC);
    tampered.drive.maxTorque += 1;
    const file = parseReplayFile(JSON.parse(JSON.stringify(toReplayFile(r, { spec: tampered }))));
    expect(replaySpec(file)).toBeNull();
  });

  it('rejects malformed files with the field name, not a stack trace', () => {
    const good = JSON.parse(JSON.stringify(toReplayFile(record(64), { spec: DEFAULT_SPEC })));
    expect(() => parseReplayFile({ ...good, format: 'nope' })).toThrow(/replay.format/);
    expect(() => parseReplayFile({ ...good, frames: good.frames + 1 })).toThrow(/frames/);
    expect(() => parseReplayFile({ ...good, hashes: 'no' })).toThrow(/hashes/);
    expect(() => parseReplayFile({ ...good, simRev: 'two' })).toThrow(/simRev/);
    expect(() => parseReplayFile({ ...good, inputs: '9999' })).toThrow(/bad mask/);
    expect(() => parseReplayFile(null)).toThrow(/expected an object/);
  });

  it('PARSES a file from another sim rev, and reports the mismatch separately', () => {
    // The distinction matters: a rev-mismatched file is not corrupt, and saying
    // "corrupt" would send the user hunting for the wrong problem.
    const r = record(64);
    const old = parseReplayFile({ ...JSON.parse(JSON.stringify(toReplayFile(r))), simRev: SIM_REV - 1 });
    expect(old.frames).toBe(r.frames);
    const c = checkReplayCompat(old, { level, spec: DEFAULT_SPEC });
    expect(c.ok).toBe(false);
    expect(c.revOk).toBe(false);
    expect(c.problems.join(' ')).toMatch(/SIM_REV mismatch/);
  });

  it('names each mismatch — rev, level and bike — independently', () => {
    const r = record(64);
    const other = cloneSpec(DEFAULT_SPEC);
    other.wheel.friction += 0.5;
    const c = checkReplayCompat(r, { level, spec: other });
    expect(c.revOk).toBe(true);
    expect(c.levelOk).toBe(true);
    expect(c.specOk).toBe(false);
    expect(c.problems).toHaveLength(1);
    expect(c.problems[0]).toMatch(/bike spec mismatch/);

    const elsewhere = parseLevel({ ...TEST_LEVEL, apples: [{ x: 3, y: 3 }] });
    const c2 = checkReplayCompat(r, { level: elsewhere, spec: DEFAULT_SPEC });
    expect(c2.levelOk).toBe(false);
    expect(c2.problems[0]).toMatch(/level mismatch/);
  });

  it('is clean when everything lines up', () => {
    const c = checkReplayCompat(record(64), { level, spec: DEFAULT_SPEC });
    expect(c.ok).toBe(true);
    expect(c.problems).toEqual([]);
  });

  it('builds a filename that says what the run was', () => {
    const r = record(128);
    const n = replayFileName(r, '2026-09-15T01-02-03');
    expect(n.startsWith(`velo-rev${SIM_REV}-`)).toBe(true);
    expect(n.endsWith('.replay.json')).toBe(true);
    expect(n).not.toMatch(/[^a-zA-Z0-9._-]/);
  });
});

describe('decodeInputs — the server cap', () => {
  it('is unlimited when no cap is given, exactly as it always was', () => {
    expect(decodeInputs('0*100000').length).toBe(100000);
  });

  it('refuses before allocating when the total would exceed the cap', () => {
    // The trivial CPU/memory kill, `[0, 4294967295]`: the existing per-run
    // limit catches this one...
    expect(() => decodeInputs('0*4294967295', 1000)).toThrow(/run length/);
    // ...but not this one. Each run here is individually legal and there are
    // enough of them to exhaust memory, which is why the cap has to be on the
    // decoded TOTAL and has to be checked before the inner loop runs.
    const many = new Array(50).fill('0*1000000').join(',');
    expect(() => decodeInputs(many, 76800)).toThrow(/refusing to decode/);
  });

  it('allows a stream exactly at the cap', () => {
    expect(decodeInputs('0*100', 100).length).toBe(100);
    expect(() => decodeInputs('0*101', 100)).toThrow(/refusing to decode/);
  });

  it('parseReplayFile passes the cap through to the decode', () => {
    const r = { format: 'velo-replay', simRev: SIM_REV, simHash: 'x', bike: 'default', specHash: 'y',
      frames: 4294967295, inputs: '0*4294967295', hashEvery: 0, hashes: [],
      finished: false, dead: false, timeTicks: 0, applesLeft: 0 };
    expect(() => parseReplayFile(r, { maxFrames: 1000 })).toThrow();
    // And the declared frame count is bounded by the same number, so a lie
    // about `frames` is caught before the stream is even looked at.
    expect(() => parseReplayFile({ ...r, frames: 2000, inputs: '0*2000' }, { maxFrames: 1000 })).toThrow(/frames/);
  });
});

describe('verifyReplaySteps', () => {
  it('gives the identical result however it is sliced', () => {
    // The slice size is a SCHEDULING knob and nothing else — it decides where
    // the loop pauses, never what the loop does. The server depends on that
    // being true, because it verifies in slices and the CLI does not.
    const replay = record(400);
    const whole = verifyReplay(level, DEFAULT_SPEC, replay);
    expect(whole.ok).toBe(true);
    for (const slice of [1, 7, 64, 1000, Infinity]) {
      const it = verifyReplaySteps(level, DEFAULT_SPEC, replay, slice);
      let step = it.next();
      let yields = 0;
      while (!step.done) {
        yields++;
        step = it.next();
      }
      expect(step.value).toEqual(whole);
      if (slice === 1) expect(yields).toBe(replay.frames);
      if (slice === Infinity) expect(yields).toBe(0);
    }
  });
});

describe('revMismatchRefusal', () => {
  it('is one wording, shared by the CLI and the server', () => {
    const msg = revMismatchRefusal(2);
    expect(msg).toContain('the replay is rev 2');
    expect(msg).toContain(`this build is rev ${SIM_REV}`);
    expect(msg).toContain('refusal rather than a warning');
  });
});
