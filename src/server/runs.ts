// Submission: everything between "a stranger POSTed some bytes" and "a row on
// the board".
//
// THE ONE IDEA THIS FILE IMPLEMENTS. A replay is an INPUT STREAM, not a
// trajectory — about a kilobyte of run-length-encoded button masks. The sim is
// deterministic and its cross-engine hash chain is proven (a browser-recorded
// run re-verifies bit-identically here, 56 and 64 hash checkpoints), so the
// server re-simulates the submission and derives the time ITSELF. You cannot
// fabricate a time because you never send one that is believed: you send
// buttons, and the physics decides what they did.
//
// That makes the board cheat-proof against fabricated times BY CONSTRUCTION,
// which is a strong property and a narrow one. It says nothing about WHO set
// the time (see the identity note in the README), and nothing about whether a
// human or a search produced the input stream — which is why there is a TAS
// category rather than a pretence.
//
// VERIFY BEFORE PERSISTING. Nothing below writes a byte until the
// re-simulation has confirmed the outcome, the time and the apple count. A
// store that holds unverified blobs is a store somebody has to audit later.
import {
  parseReplayFile,
  ReplayError,
  revMismatchRefusal,
  ticksToSeconds,
  verifyReplaySteps,
} from '@/sim/replay.ts';
import type { ReplayFile, VerifyResult } from '@/sim/replay.ts';
import { SIM_REV } from '@/sim/rev.ts';
import type { Category, Entry, Placement, Standing } from './board.ts';
import { entryFrom, isCategory, place, recordPb, sectionOf, standing } from './board.ts';
import { levelBySimHash, OFFICIAL_SPEC, OFFICIAL_SPEC_HASH } from './levels.ts';
import { MAX_FRAMES, MAX_HASHES, MAX_QUEUE_DEPTH, SUBMIT_PER_MINUTE, VERIFY_BUDGET_MS, VERIFY_SLICE_FRAMES } from './limits.ts';
import { createQueue } from './queue.ts';
import { appendSubmission, cleanName, isPlayerId, replayId, updateBoard, updatePlayer, writeReplay } from './store.ts';

export type RejectCode =
  | 'too-large'
  | 'bad-json'
  | 'bad-shape'
  | 'bad-replay'
  | 'sim-rev-mismatch'
  | 'unknown-level'
  | 'unknown-bike'
  | 'not-a-finish'
  | 'verification-failed'
  | 'timeout'
  | 'busy'
  | 'rate-limited';

export interface Rejected {
  ok: false;
  code: RejectCode;
  reason: string;
  /** Extra detail from the verifier, when it was the verifier that said no. */
  detail?: Partial<VerifyResult>;
}

export interface Accepted {
  ok: true;
  replayId: string;
  simHash: string;
  levelName: string;
  entry: Entry;
  placement: Placement;
  standing: Standing;
  /** How long the re-simulation took, in ms. Printed by bin/submit. */
  verifyMs: number;
  seconds: number;
}

export type SubmitResult = Accepted | Rejected;

const reject = (code: RejectCode, reason: string, detail?: Partial<VerifyResult>): Rejected => ({
  ok: false,
  code,
  reason,
  ...(detail ? { detail } : {}),
});

/** One queue for the whole process: verification is CPU, and there is one CPU thread. */
const queue = createQueue({ budgetMs: VERIFY_BUDGET_MS, maxDepth: MAX_QUEUE_DEPTH });

export interface QueueStats {
  depth: number;
  running: boolean;
  done: number;
  timedOut: number;
  refused: number;
  busiest: number;
}

export function queueStats(): QueueStats {
  return { depth: queue.depth, running: queue.running, ...queue.stats };
}

// --- rate limiting -----------------------------------------------------------
//
// Not a security control and not presented as one: a playerId is self-asserted,
// so anyone determined simply sends a different one. It is here for the failure
// this box has actually had — a wedged client spin-looping a request 49,000
// times in six hours — and for that it is exactly sufficient.

const recent = new Map<string, number[]>();

function rateLimited(playerId: string, now: number): boolean {
  const cutoff = now - 60_000;
  const hits = (recent.get(playerId) ?? []).filter((t) => t > cutoff);
  hits.push(now);
  recent.set(playerId, hits);
  // Opportunistic sweep so the map cannot grow without bound from one-shot ids.
  if (recent.size > 512) {
    for (const [k, v] of recent) if (v.every((t) => t <= cutoff)) recent.delete(k);
  }
  return hits.length > SUBMIT_PER_MINUTE;
}

// --- the submission ----------------------------------------------------------

export interface Submission {
  playerId: string;
  name: string;
  category: Category;
  replay: ReplayFile;
}

/**
 * Validate the envelope. Split from `submit` so the pure half — what shapes are
 * refused and with which message — is testable without a filesystem or a clock.
 */
export function parseSubmission(raw: unknown): Submission | Rejected {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return reject('bad-shape', 'expected a JSON object with playerId, name, category and replay');
  }
  const r = raw as Record<string, unknown>;

  if (!isPlayerId(r.playerId)) {
    return reject(
      'bad-shape',
      'playerId must be 8-32 characters of [0-9a-z]. The client generates one and keeps it in localStorage.',
    );
  }
  const name = cleanName(r.name);
  if (name.length === 0) {
    return reject('bad-shape', 'name must be at least one printable character');
  }
  const category = r.category === undefined ? 'human' : r.category;
  if (!isCategory(category)) {
    return reject('bad-shape', `category must be "human" or "tas", got ${JSON.stringify(r.category)}`);
  }

  let replay: ReplayFile;
  try {
    // The cap goes IN, so the run-length decode refuses before it allocates.
    // `[0, 4294967295]` is the trivial version of this attack and the body size
    // limit does not stop it: eight bytes of JSON become four billion array
    // entries.
    replay = parseReplayFile(r.replay, { maxFrames: MAX_FRAMES });
  } catch (e) {
    const msg = e instanceof ReplayError || e instanceof Error ? e.message : String(e);
    return reject('bad-replay', msg);
  }
  if (replay.hashes.length > MAX_HASHES) {
    return reject('bad-replay', `replay.hashes holds ${replay.hashes.length} entries; the cap is ${MAX_HASHES}`);
  }

  return { playerId: r.playerId, name, category, replay };
}

/**
 * The checks that can be made without simulating anything. Ordered cheapest and
 * most decisive first, so a rev-mismatched file never reaches the queue at all.
 */
function preflight(sub: Submission): Rejected | { level: NonNullable<ReturnType<typeof levelBySimHash>> } {
  if (sub.replay.simRev !== SIM_REV) {
    return reject('sim-rev-mismatch', revMismatchRefusal(sub.replay.simRev));
  }

  const level = levelBySimHash(sub.replay.simHash);
  if (!level) {
    return reject(
      'unknown-level',
      `no level on this server hashes to ${sub.replay.simHash}` +
        (sub.replay.levelName ? ` ("${sub.replay.levelName}")` : '') +
        '. Boards exist only for levels this build ships: a replay may carry its own level so that it ' +
        'stands alone as a bug report, but trusting that here would let anybody mint a board for a ' +
        'one-metre ramp with the flower on top.',
    );
  }

  if (sub.replay.specHash !== OFFICIAL_SPEC_HASH) {
    return reject(
      'unknown-bike',
      `that run was recorded on bike spec ${sub.replay.specHash}; the shipped bike is ${OFFICIAL_SPEC_HASH}. ` +
        'A time set on a tuned bike is a real run of a different sport — the verifier would confirm it ' +
        'happily — so it is refused rather than mixed in. Reset the tuning panel, or turn live tune off, ' +
        'and ride it again.',
    );
  }

  if (!sub.replay.finished || sub.replay.dead) {
    return reject('not-a-finish', 'only a finished run goes on a board');
  }

  return { level };
}

/**
 * What actually goes on disk: the replay WITHOUT its embedded level or bike
 * spec.
 *
 * A replay FILE carries both so that it stands alone as a bug report — drop it
 * on a fresh checkout and the exact moment runs again. A replay on a
 * leaderboard needs neither, and keeping them would be actively worse in three
 * ways. It is the bulk of the bytes: `10-cathedral` submits at 20 KB of which
 * 19 KB is a level the server already has by simHash. Every ghost fetch would
 * carry that level down to a client that is currently RIDING it. And a second
 * copy of the level in the store invites the question of which one is
 * authoritative, when the answer is fixed: the file in `levels/`, matched by
 * simHash, is the only level this server will verify against.
 *
 * `bin/replay` still plays a blob straight out of the store, because it falls
 * back to scanning `levels/` for a matching simHash.
 */
function storedForm(replay: ReplayFile): Record<string, unknown> {
  const out: Record<string, unknown> = { ...replay };
  delete out.level;
  delete out.spec;
  return out;
}

export interface SubmitOptions {
  /** Injected so tests are not at the mercy of a clock. */
  now?: () => number;
}

export async function submit(raw: unknown, opts: SubmitOptions = {}): Promise<SubmitResult> {
  const now = opts.now ?? Date.now;
  const parsed = parseSubmission(raw);
  if ('ok' in parsed && parsed.ok === false) return parsed;
  const sub = parsed as Submission;

  if (rateLimited(sub.playerId, now())) {
    return reject('rate-limited', `more than ${SUBMIT_PER_MINUTE} submissions a minute from one player`);
  }

  const pre = preflight(sub);
  if ('ok' in pre && pre.ok === false) return pre;
  const { level } = pre as { level: NonNullable<ReturnType<typeof levelBySimHash>> };

  // --- the re-simulation, sliced and budgeted ---
  const outcome = await queue.run<VerifyResult>(function* () {
    return yield* verifyReplaySteps(level.level, OFFICIAL_SPEC, sub.replay, VERIFY_SLICE_FRAMES);
  });

  if (!outcome.ok && outcome.reason === 'busy') {
    return reject('busy', `the verification queue is full (${outcome.depth} waiting) — try again in a moment`);
  }
  if (!outcome.ok) {
    return reject(
      'timeout',
      `verification exceeded its ${VERIFY_BUDGET_MS} ms budget after ${outcome.ms} ms and was abandoned`,
    );
  }

  const verified = outcome.value;
  if (!verified.ok) {
    return reject('verification-failed', verified.reason ?? 'the re-simulation disagreed with the replay', {
      atFrame: verified.atFrame,
      expected: verified.expected,
      actual: verified.actual,
      timeTicks: verified.timeTicks,
      applesLeft: verified.applesLeft,
    });
  }
  // `verifyReplay` already compared the claimed outcome, time and apple count
  // against what it derived, so reaching here means they agreed. These two are
  // the board's OWN requirement on top of that, stated separately so it is
  // obvious they are policy rather than verification.
  if (!verified.finished || verified.dead) {
    return reject('not-a-finish', 're-simulation says that run did not finish');
  }
  if (verified.applesLeft !== 0) {
    return reject('not-a-finish', `re-simulation says ${verified.applesLeft} apples were left uncollected`);
  }

  // --- persist, now that it is proven ---
  const id = replayId(sub.replay);
  const at = new Date(now()).toISOString();
  writeReplay(sub.replay.simHash, id, storedForm(sub.replay));

  const entry = entryFrom(
    {
      replayId: id,
      playerId: sub.playerId,
      name: sub.name,
      category: sub.category,
      simRev: sub.replay.simRev,
      specHash: sub.replay.specHash,
      bike: sub.replay.bike,
      frames: sub.replay.frames,
      at,
    },
    verified,
  );

  // ONE pass under the lock, and the standing is read off the board that was
  // actually written rather than reconstructed from the placement afterwards.
  // A second trip would also mean a second fsync+rename for a pure read, which
  // is the kind of write nobody remembers is happening.
  const { placement, after } = await updateBoard(sub.replay.simHash, level.name, at, (board) => {
    const r = place(board, entry, level.name);
    return {
      board: r.board,
      result: {
        placement: r.placement,
        after: standing(sectionOf(r.board, entry.simRev, entry.category), sub.playerId),
      },
    };
  });

  await updatePlayer(sub.playerId, sub.name, at, (player) => ({
    player: recordPb(player, sub.replay.simHash, placement.entry),
    result: null,
  }));

  // The log is appended LAST, after everything it describes is durable. A
  // record in the log whose replay blob is missing would make `bin/board
  // rebuild` produce a board entry with no ghost behind it; the other order
  // cannot happen.
  appendSubmission({ at, simHash: sub.replay.simHash, levelName: level.name, entry });

  return {
    ok: true,
    replayId: id,
    simHash: sub.replay.simHash,
    levelName: level.name,
    entry: placement.entry,
    placement,
    standing: after,
    verifyMs: outcome.ms,
    seconds: ticksToSeconds(verified.timeTicks),
  };
}

/**
 * HTTP status for a rejection. Kept beside the codes so they cannot drift, and
 * typed as the literal union rather than `number` because Hono's `c.json`
 * insists on a real status code — which is a good insistence: it is what stops
 * a typo'd 4000 compiling.
 */
export type RejectStatus = 400 | 404 | 409 | 413 | 422 | 429 | 503 | 504;

export function statusFor(code: RejectCode): RejectStatus {
  switch (code) {
    case 'too-large':
      return 413;
    case 'bad-json':
    case 'bad-shape':
    case 'bad-replay':
      return 400;
    case 'sim-rev-mismatch':
    case 'unknown-bike':
      return 409;
    case 'unknown-level':
      return 404;
    case 'not-a-finish':
    case 'verification-failed':
      return 422;
    case 'timeout':
      return 504;
    case 'busy':
      return 503;
    case 'rate-limited':
      return 429;
    default:
      return 400;
  }
}
