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
import { parseSpec, specHash } from './spec.ts';
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

/**
 * `maxFrames` is the DoS guard, and it has to live here rather than in the
 * caller because the allocation happens here. A 512 KB upload of `0*10000000,`
 * repeated decodes to ~650 billion entries and takes the process out before any
 * length check downstream ever runs; the per-run 1e7 cap below does not help,
 * because the attack is the number of RUNS, not the size of one.
 *
 * Omitted, the behaviour is exactly what it always was — every existing caller
 * (the client, `bin/replay`, the tests) reads a file a human chose, and a cap
 * there would only turn a long honest run into a parse error. The server passes
 * one, because the server reads bytes a stranger uploaded.
 */
export function decodeInputs(s: string, maxFrames?: number): number[] {
  const out: number[] = [];
  if (s.length === 0) return out;
  const cap = maxFrames === undefined ? Infinity : maxFrames;
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
    // Checked BEFORE the loop, so the refusal costs nothing even when the
    // declared run length is absurd.
    if (out.length + count > cap) {
      throw new Error(`replay.inputs: more than ${cap} input frames — refusing to decode`);
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
 * claims. This is the function the server route calls, unchanged, on bytes a
 * stranger uploaded: the sim imports nothing, so the same bytes run in both
 * places and a browser-recorded run re-verifies bit-identically on the box.
 *
 * It is a thin driver over `verifyReplaySteps` below, and there is exactly ONE
 * implementation of the checks on purpose. The server needs to verify in slices
 * so it can yield the event loop and abandon a run that overruns its budget;
 * a second copy of the anti-cheat loop that drifts from this one is the single
 * worst bug this file could have.
 */
export function verifyReplay(level: Level, spec: BikeSpec, replay: Replay): VerifyResult {
  const it = verifyReplaySteps(level, spec, replay, Infinity);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

/**
 * The verifier, sliced. Yields the number of input frames simulated so far
 * every `slice` frames; returns the same `VerifyResult` `verifyReplay` does.
 *
 * `slice` is a scheduling knob and NOTHING ELSE — it cannot affect the outcome,
 * because it only decides where the loop pauses, never what the loop does. A
 * run verified in one slice and the same run verified in twenty produce the
 * identical result, and replay.test.ts asserts that rather than trusting this
 * sentence.
 */
export function* verifyReplaySteps(
  level: Level,
  spec: BikeSpec,
  replay: Replay,
  slice = 4096,
): Generator<number, VerifyResult, void> {
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
  const chunk = slice >= 1 ? slice : 1;
  let hi = 0;
  let sinceYield = 0;
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
    if (++sinceYield >= chunk) {
      sinceYield = 0;
      yield f + 1;
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

// --- the replay FILE ---------------------------------------------------------
//
// A `Replay` is the minimum the verifier needs. A replay FILE is that plus
// enough context to be a self-contained bug report, which is the whole reason
// this exists: "sometimes it gets weird" is unactionable, and "here is the
// file" is a deterministic re-run of the exact moment.
//
// The extras are strictly OPTIONAL and the verifier never reads them for
// identity — identity is `simHash`, `specHash` and `simRev`, exactly as before.
// They are there so a file dropped on a fresh checkout, or handed to
// `bin/replay` with no other arguments, still has a level to run on and a bike
// to run with.

/** Bumped only if the FILE envelope changes; unrelated to SIM_REV. */
export const REPLAY_FILE_VERSION = 1;

export interface ReplayFile extends Replay {
  fileVersion?: number;
  /** The level this was recorded on, verbatim, so the file stands alone. */
  level?: unknown;
  /** Human-readable, for the message when the level cannot be matched. */
  levelName?: string;
  /** The bike this was recorded on. Checked against `specHash` before use. */
  spec?: unknown;
  /** Presentation metadata only. The sim never reads a clock; the EXPORTER does. */
  recordedAt?: string;
  note?: string;
}

/** Everything that must line up before a replay can be played faithfully. */
export interface ReplayCompat {
  ok: boolean;
  revOk: boolean;
  levelOk: boolean;
  specOk: boolean;
  /** One legible line per problem. Empty when ok. */
  problems: string[];
  /** The replay carries a spec whose hash matches what it claims. */
  hasUsableSpec: boolean;
  /** The replay carries a level. */
  hasLevel: boolean;
}

/**
 * Say clearly what does not match, rather than silently playing something
 * different. This is the first real user of the versioning scheme and the
 * failure mode is the point: a replay recorded under another SIM_REV is not a
 * replay of anything this build can produce, and pretending otherwise would
 * make the whole rev mechanism decorative.
 */
export function checkReplayCompat(
  r: Replay,
  ctx: { level?: Level | null; spec?: BikeSpec | null } = {},
): ReplayCompat {
  const problems: string[] = [];
  const file = r as ReplayFile;

  const revOk = r.simRev === SIM_REV;
  if (!revOk) {
    problems.push(
      `SIM_REV mismatch: the replay was recorded under rev ${r.simRev}, this build is rev ${SIM_REV}. ` +
        'The physics changed between those revs, so replaying it here would show you a different run. ' +
        'Nothing can fix this but a build at the recorded rev.',
    );
  }

  let levelOk = true;
  if (ctx.level) {
    levelOk = ctx.level.simHash === r.simHash;
    if (!levelOk) {
      problems.push(
        `level mismatch: the replay is for simHash ${r.simHash}` +
          (file.levelName ? ` ("${file.levelName}")` : '') +
          `, the loaded level "${ctx.level.name}" hashes to ${ctx.level.simHash}.`,
      );
    }
  }

  const embedded = replaySpec(file);
  const hasUsableSpec = embedded !== null;
  let specOk = true;
  if (ctx.spec) {
    const cur = specHash(ctx.spec);
    specOk = cur === r.specHash;
    if (!specOk) {
      problems.push(
        `bike spec mismatch: the replay was recorded on spec ${r.specHash}, the current spec is ${cur}. ` +
          (hasUsableSpec
            ? 'The file carries its own spec — load that and the run reproduces exactly.'
            : 'The file does not carry a spec, so the recorded bike cannot be recovered from it.'),
      );
    }
  }

  return {
    ok: problems.length === 0,
    revOk,
    levelOk,
    specOk,
    problems,
    hasUsableSpec,
    hasLevel: file.level !== undefined && file.level !== null,
  };
}

/**
 * THE REV REFUSAL, in one place.
 *
 * `bin/replay` refuses a rev-mismatched file and so does the leaderboard's
 * submission route, and the two must not word it differently — a player told
 * one thing by the CLI and another by the server concludes one of them is
 * broken. It is a refusal rather than a warning for the reason stated in it:
 * replaying under different physics shows a run that is not the one recorded,
 * which is worse than not replaying at all.
 */
export function revMismatchRefusal(replayRev: number): string {
  return (
    `SIM_REV mismatch: the replay is rev ${replayRev}, this build is rev ${SIM_REV}. ` +
    'The physics changed between those revs. Re-running it here would show you a DIFFERENT run ' +
    'than the one that was recorded, which is worse than not running it at all, so this is a ' +
    'refusal rather than a warning. Through milestone 1 the rev bumps freely and replays do not ' +
    'survive it.'
  );
}

/**
 * The spec a replay file carries, but ONLY if it hashes to what the file
 * claims. A spec that does not is either corrupt or hand-edited, and adopting
 * it would produce a run that verifies against nothing.
 */
export function replaySpec(file: ReplayFile): BikeSpec | null {
  if (file.spec === undefined || file.spec === null) return null;
  let parsed: BikeSpec;
  try {
    parsed = parseSpec(file.spec);
  } catch {
    return null;
  }
  return specHash(parsed) === file.specHash ? parsed : null;
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new ReplayError(`${what}: expected a string, got ${typeof v}`);
  return v;
}

function int(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new ReplayError(`${what}: expected an integer in [${min}, ${max}], got ${JSON.stringify(v)}`);
  }
  return v;
}

function bool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') throw new ReplayError(`${what}: expected a boolean`);
  return v;
}

export class ReplayError extends Error {}

/**
 * Validate an arbitrary object into a ReplayFile. Rejects hard, with the field
 * name, for the same reason the level loader does: this parser will one day run
 * on a server against bytes a stranger uploaded, and it already runs today
 * against a file a user dragged in from who-knows-where.
 *
 * Note what is NOT checked here: whether the run is compatible with this build.
 * Parsing and compatibility are deliberately separate, because a rev-2 file must
 * still PARSE under rev 3 — otherwise the version mismatch surfaces as "corrupt
 * file" instead of as the accurate "recorded under a different physics rev".
 */
export function parseReplayFile(raw: unknown, opts: { maxFrames?: number } = {}): ReplayFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ReplayError('replay: expected an object');
  const r = raw as Record<string, unknown>;
  if (r.format !== 'velo-replay') {
    throw new ReplayError(`replay.format: expected "velo-replay", got ${JSON.stringify(r.format)}`);
  }

  const hashesRaw = r.hashes;
  if (!Array.isArray(hashesRaw)) throw new ReplayError('replay.hashes: expected an array');
  const hashes = hashesRaw.map((h, i) => str(h, `replay.hashes[${i}]`));

  const cap = opts.maxFrames;
  const frames = int(r.frames, 'replay.frames', 0, cap === undefined ? 1e8 : cap);
  const inputs = str(r.inputs, 'replay.inputs');
  // Decode eagerly: a malformed stream must fail here, at load, with a message
  // about the stream, not three screens later inside the verifier. The cap is
  // applied to the DECODE and not only to the declared `frames`, because the
  // two are independent until this line proves they agree.
  let masks: number[];
  try {
    masks = decodeInputs(inputs, cap);
  } catch (e) {
    throw new ReplayError(e instanceof Error ? e.message : String(e));
  }
  if (masks.length !== frames) {
    throw new ReplayError(`replay: claims ${frames} frames but the input stream decodes to ${masks.length}`);
  }

  const out: ReplayFile = {
    format: 'velo-replay',
    simRev: int(r.simRev, 'replay.simRev', 0, 1e6),
    simHash: str(r.simHash, 'replay.simHash'),
    bike: typeof r.bike === 'string' ? r.bike : 'default',
    specHash: str(r.specHash, 'replay.specHash'),
    frames,
    inputs,
    hashEvery: int(r.hashEvery, 'replay.hashEvery', 0, 1e7),
    hashes,
    finished: bool(r.finished, 'replay.finished'),
    dead: bool(r.dead, 'replay.dead'),
    timeTicks: int(r.timeTicks, 'replay.timeTicks', 0, 1e9),
    applesLeft: int(r.applesLeft, 'replay.applesLeft', 0, 1e6),
  };
  if (typeof r.fileVersion === 'number') out.fileVersion = r.fileVersion;
  if (r.level !== undefined && r.level !== null) out.level = r.level;
  if (typeof r.levelName === 'string') out.levelName = r.levelName;
  if (r.spec !== undefined && r.spec !== null) out.spec = r.spec;
  if (typeof r.recordedAt === 'string') out.recordedAt = r.recordedAt;
  if (typeof r.note === 'string') out.note = r.note;
  return out;
}

/**
 * Wrap a Replay into a self-contained file. `recordedAt` is passed IN rather
 * than read from a clock here, because this module is inside src/sim and the
 * sim never reads wall-clock time — the runtime purity trap in purity.test.ts
 * would fire on a `Date.now()` in this file, and it should.
 */
export function toReplayFile(
  r: Replay,
  extra: { level?: unknown; levelName?: string; spec?: BikeSpec; recordedAt?: string; note?: string } = {},
): ReplayFile {
  const out: ReplayFile = { ...r, fileVersion: REPLAY_FILE_VERSION };
  if (extra.level !== undefined) out.level = extra.level;
  if (extra.levelName !== undefined) out.levelName = extra.levelName;
  if (extra.spec !== undefined) out.spec = extra.spec;
  if (extra.recordedAt !== undefined) out.recordedAt = extra.recordedAt;
  if (extra.note !== undefined) out.note = extra.note;
  return out;
}

/** A short, sortable, filesystem-safe name for an exported replay. */
export function replayFileName(r: Replay, stamp: string): string {
  const safe = (s: string): string => s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
  const outcome = r.finished ? 'fin' : r.dead ? 'dead' : 'run';
  const secs = (r.timeTicks / SIM_HZ).toFixed(2);
  return `velo-rev${r.simRev}-${safe(stamp)}-${outcome}-${secs}s-${r.simHash.slice(0, 8)}.replay.json`;
}
