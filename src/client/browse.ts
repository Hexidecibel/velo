// WHAT A LEADERBOARD LOOKS LIKE WHEN YOU ARE NOT PLAYING THE LEVEL.
//
// The board panel in the corner answers one question — where do I stand on the
// thing I am riding — and it can only ever answer it about the level that is
// loaded. The question this file is about is the other one: what is going on
// across the whole set, and who is on which level, without riding twenty-four
// levels to find out. That was the ask, in the user's words: "some leaderboards
// page? where you can skip through levels, see leaderboards without having to
// load each one".
//
// PURE, AND THEREFORE TESTABLE IN PLAIN NODE. There is no jsdom in this repo, so
// everything that DECIDES lives here and chooserui.ts only turns it into
// elements — the same split chooser.ts, results.ts and board.ts already make.
// The one thing here that touches the network is `createBoardCache`, and it
// takes its fetch as an argument for exactly that reason.
//
// THREE RULES ABOUT WHAT A ROW SHOWS.
//
//   1. A ROW IS A PERSON. Rank, bike, name, time — and the bike is the half
//      that was missing until customisation shipped. `avatarImg` draws it from
//      the appearance that travelled with the submission, and a row written
//      before appearances existed resolves to a stable derivation from the
//      playerId, so an old board is still a board of different people.
//   2. EVERY NUMBER IS A GAP TO SOMETHING. A column of absolute times tells you
//      nothing you can act on; "0.412s behind the row above" tells you whether
//      the next place is one clean corner away or a different league. The board
//      panel never showed this because a top-N list with `you` bolted on the
//      bottom has no "above" to measure against for most people.
//   3. PAR IS A ROW. It is the only number in this game that is a property of
//      the LEVEL rather than of a run — the fastest line anything has found —
//      and it beats the best posted human time on 7 of the 24 rated levels. So
//      it sits IN the ladder at the position its time earns, which turns "is
//      this level solved as well as it can be" into something you can see.
//
// AND THE RULE ABOUT WHAT A ROW NEVER OFFERS. A TAS row has no `watch`, on any
// condition, on any category, for anybody. The times are information and ship on
// purpose; the LINE is the solution to the puzzle, and being able to watch a
// programmatically defined best path is the thing this game deliberately does
// not have. `watchableCategory` is the one place that is decided and this file
// asks it rather than re-deciding it.
import { ticksToSeconds } from '@/sim/replay.ts';
import type { BoardEntry, BoardPayload, Category } from './api.ts';
import { watchableCategory } from './ghost.ts';
import type { Band, ChooserItem, UnratedCode } from './chooser.ts';
import { UNRATED_WORDS } from './chooser.ts';

/** Board times, as everything else in this client prints them. */
export function fmtTicks(ticks: number): string {
  return `${ticksToSeconds(ticks).toFixed(3)}s`;
}

/**
 * Par and gaps to it, at TWO decimals and not three.
 *
 * Par comes out of a search with a macro-action grid under it, so its third
 * decimal is noise; a posted time is a re-simulated tick count and its third
 * decimal is real. Printing both at three would claim a precision one of them
 * does not have, which is the same dishonesty as a hand-written difficulty star.
 */
export function fmtSeconds(s: number): string {
  return `${s.toFixed(2)}s`;
}

/** A signed gap, for "behind" and "ahead" lines. Always positive; the words carry the sign. */
function gapText(ticks: number): string {
  return `${ticksToSeconds(ticks).toFixed(3)}s`;
}

/** One posted time. */
export interface BrowseRow {
  kind: 'entry';
  rank: number;
  name: string;
  timeText: string;
  /** Behind the row above it. '' on the first row — there is nothing above it. */
  behindText: string;
  /** Behind the leader. '' on the first row. */
  leaderText: string;
  /** This is you. The one row the browser is allowed to shout about. */
  you: boolean;
  /**
   * Whether a `watch` may be offered. FALSE on every TAS row, unconditionally.
   * See the header.
   */
  watchable: boolean;
  entry: BoardEntry;
}

/** PAR, sitting in the ladder at the position its time earns. */
export interface ParRow {
  kind: 'par';
  timeText: string;
  /** How many posted times are faster than par. 0 means nobody has beaten it. */
  beatenBy: number;
  /** What that count means, in words. */
  note: string;
}

export type BrowseLine = BrowseRow | ParRow;

/** Where one level's board has got to. The API never throws; it degrades. */
export type BoardState = 'loading' | 'ready' | 'offline';

export interface BoardSlot {
  state: BoardState;
  payload: BoardPayload | null;
  /** Why, when it did not come. Plain words, straight off `ApiError`. */
  error: string;
}

export const LOADING: BoardSlot = { state: 'loading', payload: null, error: '' };

export interface BrowseOpts {
  playerId: string;
  category: Category;
  /** 1-based position in the browse order, and how long that order is. */
  at: number;
  of: number;
  board: BoardSlot;
}

export interface BrowseModel {
  /**
   * The level, as the GRID already describes it. One source for both views: the
   * card you ride from and the header you browse from cannot disagree about a
   * level's difficulty if there is only one of them.
   */
  item: ChooserItem;
  at: number;
  of: number;
  category: Category;
  state: BoardState;
  /** Off the level itself, exactly as the card prints it. */
  facts: string;
  band: Band | null;
  /** The band and the score, or the unrated reason in the player's words. */
  bandText: string;
  unratedCode: UnratedCode | null;
  /** 'par 10.32s', or '' when nothing has solved it. */
  parText: string;
  /** Your own best on this browser, or ''. */
  bestText: string;
  /** What your best is worth against par. '' unless you have both. */
  parGapText: string;
  lines: BrowseLine[];
  /** How many people have a time here, in words. */
  entriesText: string;
  /** Where YOU stand, in one line. Always says something. */
  standing: string;
  /** Everything that needs saying when there is nothing to list. '' otherwise. */
  note: string;
  /** Older physics revs that still hold times here. '' when there are none. */
  revNote: string;
}

/**
 * The ladder, with par in it.
 *
 * Par goes in ONLY on the human board. On the TAS board it is the same kind of
 * number as every row around it — a machine's best — so a marker saying so
 * would be a marker saying nothing. On the human board it is the whole point:
 * the first row below the par line is the first person to have been beaten by
 * the search, and the rows above it are the people who beat it.
 */
export function buildLines(
  board: BoardPayload | null,
  playerId: string,
  parSeconds: number | null,
): BrowseLine[] {
  if (!board) return [];
  const watchable = watchableCategory(board.category);
  const rows: BrowseRow[] = board.top.map((e, i) => ({
    kind: 'entry',
    rank: i + 1,
    name: e.name,
    timeText: fmtTicks(e.timeTicks),
    behindText: i === 0 ? '' : gapText(e.timeTicks - board.top[i - 1].timeTicks),
    leaderText: i === 0 ? '' : gapText(e.timeTicks - board.top[0].timeTicks),
    you: e.playerId === playerId,
    watchable,
    entry: e,
  }));
  if (parSeconds === null || board.category !== 'human') return rows;

  const beatenBy = rows.filter((r) => ticksToSeconds(r.entry.timeTicks) < parSeconds).length;
  const par: ParRow = {
    kind: 'par',
    timeText: fmtSeconds(parSeconds),
    beatenBy,
    note:
      beatenBy === 0
        ? 'par — the fastest line anything has found. Nobody here has beaten it yet.'
        : beatenBy === 1
          ? 'par — one person here is faster than the best line the solver found.'
          : `par — ${beatenBy} people here are faster than the best line the solver found.`,
  };
  const out: BrowseLine[] = [...rows];
  out.splice(beatenBy, 0, par);
  return out;
}

/** Your own standing, in one line that always says something. */
export function standingText(board: BoardPayload | null, category: Category): string {
  if (!board) return '';
  if (board.you && board.rank !== null) {
    const gap = board.above ? fmtTicks(board.you.timeTicks - board.above.timeTicks) : '';
    const chase = board.above ? ` — ${gap} behind ${board.above.name}` : ' — nobody ahead of you';
    return `you: #${board.rank} of ${board.total}, ${fmtTicks(board.you.timeTicks)}${chase}`;
  }
  if (category === 'tas') return 'this is the machine board — you are not on it, and that is the point';
  if (board.total === 0) return 'no times here yet — be first';
  return `no time here yet — ${board.total} ${board.total === 1 ? 'person has' : 'people have'} one`;
}

/** What a level's board is doing, when it has nothing to list. */
function noteFor(o: BrowseOpts, item: ChooserItem): string {
  if (item.broken) return `this level does not load: ${item.error ?? '?'}`;
  if (o.board.state === 'loading') return 'loading…';
  if (o.board.state === 'offline') {
    return o.board.error
      ? `leaderboard offline — ${o.board.error}. The game works fine without it; times are banked locally.`
      : 'leaderboard offline — the game works fine without it; times are banked locally.';
  }
  const b = o.board.payload;
  if (!b) return 'leaderboard offline — the game works fine without it; times are banked locally.';
  if (b.top.length === 0) {
    return o.category === 'tas'
      ? 'no machine run has been posted on this level'
      : 'no times on this board yet — be first';
  }
  return '';
}

export function buildBrowse(item: ChooserItem, o: BrowseOpts): BrowseModel {
  const b = o.board.payload;
  const par = item.parSeconds;
  const best = item.bestTicks;
  // Against par, and only ever against par: what your best is worth is a
  // question about the level, and comparing it to whoever happens to be top of
  // a five-person board would make the answer move when somebody else rides.
  const parGap =
    par === null || best === null
      ? ''
      : ticksToSeconds(best) <= par
        ? `${fmtSeconds(par - ticksToSeconds(best))} under par — you are faster than the best line found`
        : `${fmtSeconds(ticksToSeconds(best) - par)} over par`;
  const revNote =
    b && b.otherRevs.length > 0
      ? `older physics revs hold times here (${b.otherRevs.map((r) => `rev ${r.rev}: ${r.entries}`).join(', ')}). `
        + 'They are kept and labelled, never deleted, and cannot be compared with this board.'
      : '';
  return {
    item,
    at: o.at,
    of: o.of,
    category: o.category,
    state: o.board.state,
    facts: item.broken ? '' : `${item.apples} apples · ${item.spanX} × ${item.spanY} m`,
    band: item.rating?.band ?? null,
    bandText: item.rating
      ? `${item.rating.band} ${item.rating.score}`
      : UNRATED_WORDS[item.unratedCode ?? 'unmeasured'],
    unratedCode: item.unratedCode,
    parText: par === null ? '' : `par ${fmtSeconds(par)}`,
    bestText: best === null ? '' : `your best ${fmtTicks(best)}`,
    parGapText: parGap,
    lines: buildLines(b, o.playerId, par),
    entriesText: !b
      ? ''
      : b.total === 0
        ? 'nobody yet'
        : `${b.total} ${b.total === 1 ? 'rider' : 'riders'}`,
    standing: standingText(b, o.category),
    note: noteFor(o, item),
    revNote,
  };
}

// --- one board per level, fetched once ---------------------------------------
//
// WHY THERE IS A CACHE AT ALL, when the board panel has never needed one: this
// screen's entire reason to exist is stepping through twenty-four levels, and a
// refetch per step would make `next` feel like a page load — which is the exact
// thing the user asked to be rid of ("without having to load each one"). Two
// dozen small GETs against a loopback server are cheap; doing them again every
// time somebody steps back one is not.
//
// IT IS CLEARED WHEN THE SCREEN OPENS, and that is the whole of its staleness
// policy. A board can change while you are looking at it only if somebody else
// posts a time in the next few seconds, and the price of being wrong about that
// is a number that is a few seconds old. The price of NOT clearing on open is a
// board that is a session old, which is a different and much worse kind of
// wrong — and `drop` exists for the refresh button, which is the honest answer
// for anybody who suspects either.

export type BoardFetch = (simHash: string, category: Category) => Promise<BoardSlot>;

export interface BoardCache {
  /**
   * The slot for a level, starting the fetch if it has not been started.
   *
   * Synchronous by design: a render must never await. It returns `LOADING` on
   * the first call and calls `onChange` when the answer lands, which is the
   * same shape `thumbs.ts` uses for exactly the same reason.
   */
  get(simHash: string, category: Category): BoardSlot;
  /** Warm a level's board without wanting to look at it yet. */
  want(simHash: string, category: Category): void;
  /** Forget one level's board, so the next `get` refetches. The refresh button. */
  drop(simHash: string, category: Category): void;
  clear(): void;
  /** How many boards are in hand. For the tests, and for a status line. */
  readonly size: number;
}

export function createBoardCache(
  fetch: BoardFetch,
  onChange: (simHash: string, category: Category) => void,
): BoardCache {
  const slots = new Map<string, BoardSlot>();
  const keyOf = (simHash: string, category: Category): string => `${simHash}|${category}`;

  function start(simHash: string, category: Category): BoardSlot {
    const key = keyOf(simHash, category);
    slots.set(key, LOADING);
    void fetch(simHash, category).then(
      (slot) => {
        slots.set(key, slot);
        onChange(simHash, category);
      },
      (e: unknown) => {
        // The api layer does not throw — it returns a result object — so this
        // can only fire if a caller's wrapper does. Landing in `offline`
        // rather than leaving the slot on `loading` forever is the difference
        // between a screen that says something and a spinner nobody can clear.
        slots.set(key, {
          state: 'offline',
          payload: null,
          error: e instanceof Error ? e.message : String(e),
        });
        onChange(simHash, category);
      },
    );
    return LOADING;
  }

  return {
    get(simHash: string, category: Category): BoardSlot {
      return slots.get(keyOf(simHash, category)) ?? start(simHash, category);
    },
    want(simHash: string, category: Category): void {
      if (!slots.has(keyOf(simHash, category))) start(simHash, category);
    },
    drop(simHash: string, category: Category): void {
      slots.delete(keyOf(simHash, category));
    },
    clear(): void {
      slots.clear();
    },
    get size(): number {
      return slots.size;
    },
  };
}
