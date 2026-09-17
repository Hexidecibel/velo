// What the end-of-level panel decides to show. No DOM in this file.
//
// The split is deliberate and matches the house rule that tests run in plain
// node with no jsdom: everything here is arithmetic over plain objects and is
// tested in `results.test.ts`, and `resultsui.ts` is the part that turns the
// result into elements. What could actually be WRONG — a PB delta with the sign
// backwards, a refusal rendered as a shrug, your own row missing because you are
// outside the top five — is all decided here.
//
// THE RULE THE WHOLE SCREEN SERVES: the fastest path back into the game is the
// default. This is a die-and-retry game. A results screen that costs three
// clicks to reach the next level is worse than no results screen at all, so the
// actions below are keyboard-first, Enter goes onward, and nothing on this
// screen is ever waited on — the summary renders complete on the frame the run
// ends, and the network fills itself in afterwards.
import { ticksToSeconds } from '@/sim/replay.ts';
import type { BoardEntry, BoardPayload } from './api.ts';

export function fmtTime(ticks: number): string {
  return ticksToSeconds(ticks).toFixed(3);
}

/** A signed difference, always with its sign, because that IS the information. */
export function fmtDelta(ticks: number): string {
  const s = ticksToSeconds(Math.abs(ticks)).toFixed(3);
  return `${ticks < 0 ? '-' : '+'}${s}`;
}

// --- versus your best --------------------------------------------------------

export interface PbLine {
  /** `first` when there was nothing to compare against. */
  kind: 'first' | 'faster' | 'slower' | 'same';
  /** True exactly when this run is the one now stored as the best. */
  newPb: boolean;
  /** Signed, in ticks: negative is faster than the old best. */
  deltaTicks: number | null;
  previousTicks: number | null;
  /** The headline under the time. Short on purpose. */
  text: string;
}

/**
 * Compare a finished run against the best that stood BEFORE it.
 *
 * `previousTicks` must be read before the store is updated — `recordBest`
 * overwrites in place, so reading after it makes every run look like a tie. That
 * ordering is the one real hazard in this function and the reason it takes the
 * previous time as an argument rather than looking it up.
 */
export function pbLine(timeTicks: number, previousTicks: number | null): PbLine {
  if (previousTicks === null) {
    return {
      kind: 'first',
      newPb: true,
      deltaTicks: null,
      previousTicks: null,
      // The badge above it already says FIRST FINISH, so this line has to add
      // something rather than repeat it.
      text: 'nothing to beat yet — this is the time to beat',
    };
  }
  const delta = timeTicks - previousTicks;
  if (delta === 0) {
    return {
      kind: 'same',
      newPb: false,
      deltaTicks: 0,
      previousTicks,
      // Exact ties are not hypothetical on a 128 Hz input grid, so this branch
      // exists rather than being folded into "slower" and reading as a loss.
      text: `dead level with your best, ${fmtTime(previousTicks)}s`,
    };
  }
  if (delta < 0) {
    return {
      kind: 'faster',
      newPb: true,
      deltaTicks: delta,
      previousTicks,
      text: `${fmtDelta(delta)}s on your best of ${fmtTime(previousTicks)}s`,
    };
  }
  return {
    kind: 'slower',
    newPb: false,
    deltaTicks: delta,
    previousTicks,
    text: `${fmtDelta(delta)}s off your best of ${fmtTime(previousTicks)}s`,
  };
}

// --- did it post, and if not, why --------------------------------------------

/**
 * Where a submission got to. Set by the client as it goes, so the panel can
 * render a resolved state rather than a spinner that never ends.
 *
 * `not-posted` is the local refusal — the client already knows the bike is not
 * the shipped one and does not spend a round trip to be told.
 */
export interface SubmitState {
  kind: 'posting' | 'posted' | 'needs-name' | 'refused' | 'offline' | 'not-posted' | 'no-server';
  /** The server's `code`, when it answered with one. */
  code?: string;
  /** Whatever the server or the network actually said. Kept for the detail line. */
  reason?: string;
  rank?: number;
  total?: number;
  pb?: boolean;
}

export interface SubmitMessage {
  tone: 'ok' | 'warn' | 'bad' | '';
  /** One sentence, in plain words, that resolves the question "did it count". */
  text: string;
  /**
   * What to DO about it, empty when there is nothing to do. "Not posted: this
   * bike is not the shipped one" has confused this user once already, which is
   * exactly the kind of refusal that is fixable and was not saying how.
   */
  fix: string;
  /** The server's own wording, shown small underneath. */
  detail: string;
}

/**
 * Turn a submission outcome into words a player can act on.
 *
 * Every refusal the server can produce is handled by NAME here, because the
 * alternative — echoing `reason` and hoping — is how a fixable problem reads as
 * a dead end. The codes are the `RejectCode` union in src/server/runs.ts; the
 * default branch is the honest fallback for one added there and not here.
 */
export function submitMessage(s: SubmitState): SubmitMessage {
  const detail = s.reason ?? '';
  switch (s.kind) {
    case 'posting':
      return { tone: '', text: 'posting…', fix: '', detail: '' };
    case 'posted':
      return {
        tone: 'ok',
        text:
          s.rank !== undefined && s.total !== undefined
            ? `posted — #${s.rank} of ${s.total}`
            : 'posted',
        fix: '',
        detail: '',
      };
    case 'needs-name':
      return {
        tone: 'warn',
        text: 'not posted yet: you have not picked a name',
        fix: 'Press B and type one. The run is banked — it posts the moment you do.',
        detail: '',
      };
    case 'no-server':
      return { tone: '', text: '', fix: '', detail: '' };
    case 'offline':
      return {
        tone: 'warn',
        text: 'not posted: the leaderboard is offline',
        fix: 'The time is yours locally and the game is unaffected. Ride on; it will post next time you finish with the server up.',
        detail,
      };
    case 'not-posted':
      return {
        tone: 'warn',
        text: 'not posted: this bike is not the shipped one',
        fix: 'You are riding a tuned bike, so the time is a real run of a different sport. Press H and hit "reset spec" — and turn live tune off if it is on — then ride it again.',
        detail,
      };
    case 'refused':
      return refusalMessage(s.code ?? '', detail);
    default:
      return { tone: '', text: '', fix: '', detail: '' };
  }
}

function refusalMessage(code: string, detail: string): SubmitMessage {
  const m = (text: string, fix: string): SubmitMessage => ({ tone: 'warn', text: `not posted: ${text}`, fix, detail });
  switch (code) {
    case 'unknown-bike':
      return m(
        'this bike is not the shipped one',
        'The board only holds times set on the bike as shipped. Press H and hit "reset spec" — and turn live tune off if it is on — then ride it again.',
      );
    case 'sim-rev-mismatch':
      return m(
        'the physics moved under you',
        'This page is running a different sim rev from the server. Reload, and the run after that posts normally. The run you just rode cannot be carried across.',
      );
    case 'unknown-level':
      return m(
        'the server does not have this level',
        'Boards exist only for levels the server ships. Nothing to fix from here.',
      );
    case 'not-a-finish':
      return m(
        're-simulating your inputs did not produce a finish',
        'Ride it again. If it keeps happening, press E to export the run and keep the file — that is a real bug.',
      );
    case 'verification-failed':
      return {
        tone: 'bad',
        text: 'not posted: the server re-ran your inputs and got a different result',
        fix: 'This is a determinism bug and it is not your fault. Press E to export the run and keep the file — it is the whole evidence.',
        detail,
      };
    case 'rate-limited':
      return m('too many runs posted in the last minute', 'Wait a moment. Your next finish posts normally.');
    case 'busy':
      return m('the server had too many runs waiting to verify', 'Press ↻ on the leaderboard in a moment, or just finish it again.');
    case 'timeout':
      return m(
        'verification ran out of time and was abandoned',
        'A run this long is close to the server’s budget. Finishing it faster also fixes this.',
      );
    case 'too-large':
    case 'bad-replay':
      return m(
        'the run is longer than the board accepts',
        'Runs are capped at ten minutes. A shorter one posts normally.',
      );
    case 'bad-shape':
    case 'bad-json':
      return {
        tone: 'bad',
        text: 'not posted: the server did not understand the submission',
        fix: 'That is a bug in this client rather than in your run. Press E to export it and keep the file.',
        detail,
      };
    default:
      return {
        tone: 'warn',
        text: detail ? `not posted: ${detail}` : 'not posted',
        fix: '',
        detail: '',
      };
  }
}

// --- where you stand ---------------------------------------------------------

export interface StandingLine {
  rank: number | null;
  total: number;
  aboveName: string | null;
  /** How far behind the entry above, in ticks. Positive. */
  gapTicks: number | null;
  text: string;
}

/**
 * Your position and the gap to the entry above it.
 *
 * The gap is the number that makes a board a race. With a field of two it is the
 * entire content of the screen: "0.618s behind krrl" is a thing you go and do
 * something about, and "#2 of 2" on its own is not.
 */
export function standingLine(board: BoardPayload | null): StandingLine | null {
  if (!board) return null;
  if (!board.you || board.rank === null) {
    return {
      rank: null,
      total: board.total,
      aboveName: null,
      gapTicks: null,
      text: board.total === 0 ? 'no times on this board yet' : `not on the board — ${board.total} ahead of you`,
    };
  }
  const head = `#${board.rank} of ${board.total}`;
  if (!board.above) {
    return { rank: board.rank, total: board.total, aboveName: null, gapTicks: null, text: `${head} — nobody ahead of you` };
  }
  const gap = board.you.timeTicks - board.above.timeTicks;
  return {
    rank: board.rank,
    total: board.total,
    aboveName: board.above.name,
    gapTicks: gap,
    text: `${head} — ${fmtTime(gap)}s behind ${board.above.name}`,
  };
}

// --- the compact board -------------------------------------------------------

export interface ResultRow {
  rank: number;
  name: string;
  timeTicks: number;
  replayId: string;
  you: boolean;
  /**
   * True for the row appended because the player is OUTSIDE the slice shown.
   * The renderer draws a break above it, so "#12" under "#5" does not read as a
   * board with holes in it.
   */
  detached: boolean;
}

/**
 * The top `limit` rows, with the player's own row present either way.
 *
 * Being outside the top N is the common case for a new player and it is the case
 * where a leaderboard most needs to say something. Dropping their row would make
 * the screen a list of strangers.
 */
export function boardRows(board: BoardPayload | null, playerId: string, limit: number): ResultRow[] {
  if (!board) return [];
  const rows: ResultRow[] = board.top.slice(0, limit).map((e: BoardEntry, i: number) => ({
    rank: i + 1,
    name: e.name,
    timeTicks: e.timeTicks,
    replayId: e.replayId,
    you: e.playerId === playerId,
    detached: false,
  }));
  if (board.you && board.rank !== null && !rows.some((r) => r.you)) {
    rows.push({
      rank: board.rank,
      name: board.you.name,
      timeTicks: board.you.timeTicks,
      replayId: board.you.replayId,
      you: true,
      detached: true,
    });
  }
  return rows;
}

// --- the actions -------------------------------------------------------------

export type ActionId = 'next' | 'retry' | 'watchRun' | 'watchGhost' | 'montage' | 'board' | 'levels' | 'dismiss';

export interface ResultAction {
  id: ActionId;
  /** What the panel prints, and what the key handler matches on. */
  key: string;
  label: string;
  /** Exactly one action is primary: the one Enter does. */
  primary: boolean;
}

export interface ActionInput {
  /** Label of the level Enter goes to, when there is one. */
  nextLabel: string | null;
  /** True when there is a banked replay of the run just finished. */
  canWatchRun: boolean;
  /**
   * Whose human line can be watched, when one is loadable.
   *
   * Human is the only kind there is. There is deliberately no TAS field here:
   * the panel shows the TAS TIME (see `ResultsModel.tasTime`) and offers no way
   * whatsoever to play the line, because route choice is this game's depth and a
   * searched optimal line deletes the puzzle permanently.
   */
  ghostName: string | null;
  /**
   * How many of this session's attempts on this level can ride at once, or
   * null when there is nothing worth showing.
   *
   * OFFERED, NEVER FORCED, and that is why it is an action rather than
   * something the panel does on its own. The montage is a reward — every
   * attempt of the session replayed over the line that worked — and this
   * screen's standing rule is that the fastest path back into the game is the
   * default. So it sits below `retry` in the list, on its own key, and a player
   * who wants Enter never learns it is there.
   */
  montageCount: number | null;
}

/**
 * The action list, in the order the panel prints it.
 *
 * Order is the interface here. `next` is first and primary because it is what
 * Enter does and what most finishes want; `retry` is second because R is the
 * key this game is actually played with. Everything after those two is a detour
 * and is printed as one.
 *
 * There is NO action that plays a TAS line, on any condition. This screen once
 * grew a `watchTas` on C, gated on having finished the level, and the gate was
 * the wrong shape of answer: it still shipped the thing. A time is information;
 * a line is a solution. `results.test.ts` asserts the string "TAS" never reaches
 * an action list, whatever is passed in.
 */
export function actionsFor(a: ActionInput): ResultAction[] {
  const out: ResultAction[] = [];
  if (a.nextLabel) out.push({ id: 'next', key: 'Enter', label: `next: ${a.nextLabel}`, primary: true });
  out.push({ id: 'retry', key: 'R', label: 'retry this level', primary: false });
  if (a.canWatchRun) out.push({ id: 'watchRun', key: 'T', label: 'watch your run', primary: false });
  if (a.montageCount !== null && a.montageCount >= 2) {
    out.push({
      id: 'montage',
      key: 'F',
      label: `watch all ${a.montageCount} attempts at once`,
      primary: false,
    });
  }
  if (a.ghostName) out.push({ id: 'watchGhost', key: 'G', label: `watch ${a.ghostName}'s run`, primary: false });
  out.push({ id: 'board', key: 'B', label: 'leaderboard', primary: false });
  out.push({ id: 'levels', key: 'L', label: 'level select', primary: false });
  out.push({ id: 'dismiss', key: 'Esc', label: 'close', primary: false });
  return out;
}

/** Key code -> action, for the panel's own key handling. `null` for anything else. */
export function actionForKey(code: string, actions: ResultAction[]): ActionId | null {
  const by = (id: ActionId): ActionId | null => (actions.some((a) => a.id === id) ? id : null);
  switch (code) {
    case 'Enter':
    case 'NumpadEnter':
    case 'KeyN':
      return by('next');
    case 'KeyR':
      return 'retry';
    case 'Escape':
      return 'dismiss';
    case 'KeyT':
      return by('watchRun');
    case 'KeyG':
      return by('watchGhost');
    case 'KeyF':
      return by('montage');
    case 'KeyB':
      return 'board';
    case 'KeyL':
      return by('levels');
    default:
      return null;
  }
}

// --- the whole model ---------------------------------------------------------

export interface ResultsInput {
  levelName: string;
  timeTicks: number;
  applesTaken: number;
  applesTotal: number;
  previousBestTicks: number | null;
  submit: SubmitState;
  /** The HUMAN board. The TAS board is never the one shown here. */
  board: BoardPayload | null;
  /** Shown as a number and nothing else — there is no way to play its line. */
  tasTimeTicks: number | null;
  playerId: string;
  rowLimit: number;
  actions: ActionInput;
}

export interface ResultsModel {
  levelName: string;
  /** The headline, already formatted. It is the thing they came for. */
  time: string;
  apples: string;
  pb: PbLine;
  submit: SubmitMessage;
  standing: StandingLine | null;
  rows: ResultRow[];
  /** The TAS time, as information. Its LINE is not reachable from anywhere. */
  tasTime: string | null;
  actions: ResultAction[];
}

export function buildResults(i: ResultsInput): ResultsModel {
  return {
    levelName: i.levelName,
    time: fmtTime(i.timeTicks),
    apples: `${i.applesTaken}/${i.applesTotal}`,
    pb: pbLine(i.timeTicks, i.previousBestTicks),
    submit: submitMessage(i.submit),
    standing: standingLine(i.board),
    rows: boardRows(i.board, i.playerId, i.rowLimit),
    tasTime: i.tasTimeTicks === null ? null : fmtTime(i.tasTimeTicks),
    actions: actionsFor(i.actions),
  };
}
