// The replay format, and the verifier that will one day be the leaderboard's
// only anti-cheat.
//
// A replay is a per-input-frame bitmask stream, run-length encoded, plus the
// level identity, the bike spec identity, the sim rev, and PERIODIC STATE
// HASHES. The hashes are the point: they turn a desync into a loud failure at
// the frame it happened rather than a user complaint six months later that
// nobody can reproduce.
//
// This lands in milestone 1, ahead of when the plan strictly needs it, because
// it is ~30 lines once the input stream exists and it validates the whole
// determinism bet immediately. If the physics drift between a live run and its
// replay, we need to know now.
import { IN_MASK, SIM_HZ } from './consts.ts';
import type { Level } from './level.ts';
import type { BikeSpec } from './spec.ts';
import { specHash } from './spec.ts';
import { createSim } from './sim.ts';
import type { SimState } from './step.ts';
import { SIM_REV } from './rev.ts';

export interface Replay {
  format: 'velo-replay';
  simRev: number;
  /** Level identity: the sim-relevant hash, never the file's content hash. */
  simHash: string;
  /** Bike identity. Recorded from day one even while only one bike exists. */
  bike: string;
  specHash: string;
  /** Number of input frames. */
  frames: number;
  /** Run-length encoded masks, "mask*count" comma separated. */
  inputs: string;
  /** State hash every `hashEvery` frames, in order. */
  hashEvery: number;
  hashes: string[];
  /** What the recorder claims happened. The verifier re-derives all of it. */
  finished: boolean;
  dead: boolean;
  timeTicks: number;
  applesLeft: number;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  /** Input frame at which a hash first disagreed. */
  atFrame?: number;
  expected?: string;
  actual?: string;
  finished: boolean;
  dead: boolean;
  timeTicks: number;
  applesLeft: number;
  finalHash: string;
}

export function encodeInputs(masks: readonly number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < masks.length) {
    const m = masks[i] & IN_MASK;
    let n = 1;
    while (i + n < masks.length && (masks[i + n] & IN_MASK) === m) n++;
    parts.push(n === 1 ? String(m) : m + '*' + n);
    i += n;
  }
  return parts.join(',');
}

export function decodeInputs(s: string): number[] {
  const out: number[] = [];
  if (s.length === 0) return out;
  for (const part of s.split(',')) {
    const star = part.indexOf('*');
    const maskStr = star < 0 ? part : part.slice(0, star);
    const countStr = star < 0 ? '1' : part.slice(star + 1);
    const mask = Number(maskStr);
    const count = Number(countStr);
    if (!Number.isInteger(mask) || mask < 0 || mask > IN_MASK) {
      throw new Error(`replay.inputs: bad mask ${JSON.stringify(maskStr)}`);
    }
    if (!Number.isInteger(count) || count < 1 || count > 1e7) {
      throw new Error(`replay.inputs: bad run length ${JSON.stringify(countStr)}`);
    }
    for (let i = 0; i < count; i++) out.push(mask);
  }
  return out;
}

export function buildReplay(args: {
  level: Level;
  spec: BikeSpec;
  masks: readonly number[];
  hashEvery: number;
  hashes: string[];
  state: SimState;
  bike?: string;
}): Replay {
  return {
    format: 'velo-replay',
    simRev: SIM_REV,
    simHash: args.level.simHash,
    bike: args.bike ?? 'default',
    specHash: specHash(args.spec),
    frames: args.masks.length,
    inputs: encodeInputs(args.masks),
    hashEvery: args.hashEvery,
    hashes: args.hashes.slice(),
    finished: args.state.finished,
    dead: args.state.dead,
    timeTicks: args.state.endTick >= 0 ? args.state.endTick : args.state.tick,
    applesLeft: args.state.applesLeft,
  };
}

/**
 * Re-simulate an input stream and check it against everything the replay
 * claims. This is the function a server route will call, unchanged, once there
 * is a server: the sim imports nothing, so the same bytes run in both places.
 */
export function verifyReplay(level: Level, spec: BikeSpec, replay: Replay): VerifyResult {
  const fail = (reason: string, extra?: Partial<VerifyResult>): VerifyResult => ({
    ok: false,
    reason,
    finished: false,
    dead: false,
    timeTicks: 0,
    applesLeft: level.apples.length,
    finalHash: '',
    ...extra,
  });

  if (replay.format !== 'velo-replay') return fail(`not a velo replay: ${String(replay.format)}`);
  if (replay.simRev !== SIM_REV) {
    return fail(`replay is sim rev ${replay.simRev}, this engine is rev ${SIM_REV}`);
  }
  if (replay.simHash !== level.simHash) {
    return fail(`replay is for level ${replay.simHash}, got ${level.simHash}`);
  }
  const sh = specHash(spec);
  if (replay.specHash !== sh) return fail(`replay is for bike spec ${replay.specHash}, got ${sh}`);

  let masks: number[];
  try {
    masks = decodeInputs(replay.inputs);
  } catch (e) {
    return fail(String(e instanceof Error ? e.message : e));
  }
  if (masks.length !== replay.frames) {
    return fail(`replay claims ${replay.frames} frames, inputs decode to ${masks.length}`);
  }

  const sim = createSim(level, spec);
  const every = replay.hashEvery > 0 ? replay.hashEvery : 0;
  let hi = 0;
  for (let f = 0; f < masks.length; f++) {
    sim.advance(masks[f]);
    if (every > 0 && (f + 1) % every === 0) {
      const got = sim.hash();
      const want = replay.hashes[hi++];
      if (want !== undefined && want !== got) {
        return fail('state hash mismatch — the sim desynced', {
          atFrame: f,
          expected: want,
          actual: got,
          finished: sim.state.finished,
          dead: sim.state.dead,
          timeTicks: sim.elapsedTicks(),
          applesLeft: sim.state.applesLeft,
          finalHash: got,
        });
      }
    }
  }

  const st = sim.state;
  const result: VerifyResult = {
    ok: true,
    finished: st.finished,
    dead: st.dead,
    timeTicks: sim.elapsedTicks(),
    applesLeft: st.applesLeft,
    finalHash: sim.hash(),
  };
  if (st.finished !== replay.finished) return { ...result, ok: false, reason: 'finished flag disagrees' };
  if (st.dead !== replay.dead) return { ...result, ok: false, reason: 'dead flag disagrees' };
  if (result.timeTicks !== replay.timeTicks) {
    return { ...result, ok: false, reason: `time disagrees: claimed ${replay.timeTicks}, got ${result.timeTicks}` };
  }
  if (st.applesLeft !== replay.applesLeft) return { ...result, ok: false, reason: 'apple count disagrees' };
  return result;
}

/** Seconds, from a tick count. Presentation only; never feeds the sim. */
export function ticksToSeconds(ticks: number): number {
  return ticks / SIM_HZ;
}
