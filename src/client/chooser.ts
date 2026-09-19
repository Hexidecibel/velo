// What the level chooser SHOWS. Pure, and therefore testable in plain node —
// chooserui.ts turns this into elements and thumbs.ts draws the pictures.
//
// The level bar stayed a dropdown for a long time because it is genuinely good
// at one job: `[` and `]` step levels instantly and the bar says which one you
// are on. Nothing here touches that. This is the other job — deciding WHICH
// level to ride out of twenty, which a list of names cannot help with, because
// the two questions a player actually has ("how hard is it" and "have I done
// it") are not in a name.
//
// THREE RULES ABOUT WHAT GOES ON A CARD.
//
//   1. Every number on it is measured. The best time is your own local best,
//      the difficulty is the solver's measured score (src/solver/measured.ts,
//      keyed by simHash so it cannot describe geometry that has changed), and
//      the size and apple count are read off the level itself. There is no
//      hand-written "difficulty: 3 stars" anywhere, and no blurb — the level
//      format has no description field, and inventing one per level would be
//      twenty sentences of filler that nobody maintains.
//   2. A level with no score is UNRATED and says why. An unrated level is never
//      shown as easy, and an unsolved one is never shown as hard: the solver
//      failing to find a route is an honest "could not", and it has been wrong
//      in that direction twice.
//   3. A broken level still appears, marked, with the loader's own message —
//      the same rule the level bar already follows.
import { ticksToSeconds } from '@/sim/replay.ts';
import { measuredFor } from '@/solver/measured.ts';
import type { MeasuredLevel } from '@/solver/measured.ts';
import type { LevelEntry } from './levels.ts';

/**
 * Order. `number` is the shipped curriculum order and the default, because the
 * set was authored as one — 01-10 teach, 11-20 build on them — and a chooser
 * that hides that ordering throws away real design. `difficulty` is the other
 * question people ask of a set this size, and the solver can answer it.
 */
export type ChooserSort = 'number' | 'difficulty';
export const CHOOSER_SORTS: readonly ChooserSort[] = ['number', 'difficulty'];

export type Band = 'gentle' | 'steady' | 'tricky' | 'hard' | 'brutal';

/**
 * Where the band edges sit on the solver's 0-100 scale.
 *
 * Chosen against the twenty levels the set actually contains, which span 8 to
 * 56, so that the words separate levels a player would agree are different
 * rather than piling nineteen of them into one band. They are PRESENTATION —
 * the score is the measurement and re-cutting these changes no ordering.
 */
// RECUT for SCORE_REV 2. The old edges (15/28/38/48) were cut for a set that
// spanned 8-56 under the previous composite. Scoring on the most forgiving line
// with the human-slip term spans 13-85 instead, and against the old edges
// SIXTEEN of twenty-four levels read "brutal" -- a band every level is in is not
// a band. These are cut against the real distribution: the two tutorials are
// gentle, and only Needle, Mind Your Head and Whoops are brutal.
//
// They will need recutting again if the composite changes. That is the cost of
// words rather than numbers, and it is worth paying -- but a band table is only
// ever right for the scale it was drawn against, so check it when SCORE_REV moves.
export const BAND_EDGES: readonly { max: number; band: Band }[] = [
  { max: 25, band: 'gentle' },
  { max: 42, band: 'steady' },
  { max: 55, band: 'tricky' },
  { max: 68, band: 'hard' },
  { max: Infinity, band: 'brutal' },
];

export function difficultyBand(score: number): Band {
  for (const e of BAND_EDGES) if (score < e.max) return e.band;
  return 'brutal';
}

/**
 * WHY A LEVEL HAS NO RATING, as a code rather than as a sentence.
 *
 * Three of these are the solver's own `unrated` reason, recorded on the row when
 * it was measured; the other two are the client's own dead ends. It is a code
 * and not prose because two screens now render it — the card in the grid and the
 * header of the board browser — and two hand-written copies of the same excuse
 * is the bug at the top of keys.ts wearing different clothes.
 *
 * A LEVEL WITH NO RATING SAYS WHY. That rule predates this type; what it adds is
 * that "why" is now specific: `zero-apples` is a level the search cannot steer
 * on, `unverified` is a bug in the solver, and `unsolved` is an honest could-not
 * that has been wrong twice. Reading all three as one grey "unrated" threw away
 * the only interesting half.
 */
export type UnratedCode = 'unsolved' | 'zero-apples' | 'unverified' | 'unmeasured' | 'broken';

/** The code, in the player's words. One copy, read by every screen that shows it. */
export const UNRATED_WORDS: Record<UnratedCode, string> = {
  // NEVER SHOWN AS HARD. The solver failing to find a route inside its cap is a
  // "could not", and bin/solve's own notes say it has been wrong that way twice.
  unsolved: 'unrated — the solver has not completed it yet',
  'zero-apples': 'unrated — no apples, so the search has nothing to steer by',
  unverified: 'unrated — the run it found did not re-simulate, which is a bug',
  unmeasured: 'unrated — no solver run for this level on this rev',
  broken: 'unrated — it does not load',
};

export function unratedWords(code: UnratedCode): string {
  return UNRATED_WORDS[code];
}

/**
 * What the chooser READS off a measured row.
 *
 * `MeasuredRow` satisfies it, which is what `measuredFor` returns; the two extra
 * fields are optional so a test can keep handing in a bare `MeasuredLevel`. They
 * are optional in the TYPE and mandatory in the FILE — every generated row
 * carries a `par` and an `unrated` — so an absent one here means a stub, and a
 * stub gets the honest "no par yet" rather than a made-up number.
 */
export type MeasuredRead = MeasuredLevel & {
  /**
   * PAR: the fastest run anything has found, seconds. `parFor(simHash, rev)` is
   * the one-call accessor for it; this is the same number off the same row,
   * taken here because the row is already in hand.
   *
   * It is THE ONLY NUMBER IN THIS FILE THAT IS A PROPERTY OF THE LEVEL rather
   * than of a run — your best is yours, the board's best is somebody's, and par
   * is the level's. It beats the best posted human time on 7 of the 24 rated
   * levels, so it is a target and not a curiosity.
   */
  par?: number | null;
  /** The solver's own reason, when it did not rate the level. */
  unrated?: string | null;
};

export interface Rating {
  /** The solver's composite, 0-100, rounded for display. */
  score: number;
  band: Band;
  /** Metres of head clearance at the tightest point of the winning line. */
  minHeadClearance: number | null;
  /** How long the run the solver found takes. Not a competitive time. */
  solveSeconds: number | null;
}

export interface ChooserItem {
  id: string;
  label: string;
  /** The leading number in the id, when there is one. Drives the grouping. */
  number: number | null;
  simHash: string | null;
  broken: boolean;
  /** The loader's own message, when it would not load. */
  error: string | null;
  /** Your local best, in ticks, or null. */
  bestTicks: number | null;
  /** The same, as seconds to 3 dp, or ''. */
  bestText: string;
  completed: boolean;
  apples: number;
  /** Level size in metres, rounded. Read off the level, not invented. */
  spanX: number;
  spanY: number;
  rating: Rating | null;
  /** Why there is no rating, when there is none. Never empty if rating is null. */
  unratedNote: string;
  /** The same, as a code. Null exactly when `rating` is not. */
  unratedCode: UnratedCode | null;
  /**
   * PAR, seconds: the fastest run anything has found on this level.
   *
   * Beside your own best on the card, and the line the board browser measures
   * everybody against. Null when nothing has solved it — never zero, because a
   * zero would sort to the top of a ladder as the best time ever set.
   */
  parSeconds: number | null;
  current: boolean;
  /**
   * Curation tier. Null — which is what every shipped level carries — means
   * CORE, so only the non-core ones are worth a badge: while somebody is
   * authoring their way from twenty levels to fifty, "which of these is mine
   * and still in progress" is the one thing a list of names cannot answer.
   * See `Level.tier`; it is not in simHash, so a promotion keeps the board.
   */
  tier: string | null;
}

export interface ChooserGroup {
  key: string;
  label: string;
  /** Completion and difficulty range, both derived. */
  note: string;
  items: ChooserItem[];
}

export interface ChooserOpts {
  bests: Record<string, number>;
  currentId: string;
  sort: ChooserSort;
  /** The live sim rev. A score from another rev is not a score on this game. */
  rev: number;
  /** Injectable for the tests; defaults to the generated table. */
  lookup?: (simHash: string, rev: number) => MeasuredRead | null;
}

/** `07-the-chimney` -> 7. Null for `test01` and for adopted replay levels. */
export function levelNumber(id: string): number | null {
  const m = /^(\d+)/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function isUnratedCode(v: unknown): v is UnratedCode {
  return typeof v === 'string' && v in UNRATED_WORDS;
}

function ratingOf(m: MeasuredRead | null): { rating: Rating | null; code: UnratedCode | null } {
  if (m === null) return { rating: null, code: 'unmeasured' };
  if (!m.solved || m.score === null) {
    // NEVER shown as hard. The solver not finding a route inside its cap is a
    // "could not", and bin/solve's own notes say it has been wrong that way.
    // The ROW's own reason wins when it carries one — `zero-apples` and
    // `unverified` are different things to say and the row is the only place
    // that knows which — and `unsolved` is the honest default for a stub.
    return { rating: null, code: isUnratedCode(m.unrated) ? m.unrated : 'unsolved' };
  }
  return {
    rating: {
      score: Math.round(m.score),
      band: difficultyBand(m.score),
      minHeadClearance: m.minHeadClearance,
      solveSeconds: m.solveSeconds,
    },
    code: null,
  };
}

export function buildItem(entry: LevelEntry, o: ChooserOpts): ChooserItem {
  const lookup = o.lookup ?? measuredFor;
  const lvl = entry.level;
  const simHash = lvl?.simHash ?? null;
  const best = simHash !== null ? o.bests[simHash] : undefined;
  const row = lvl === null ? null : lookup(lvl.simHash, o.rev);
  const { rating, code } = lvl === null ? { rating: null, code: 'broken' as UnratedCode } : ratingOf(row);
  // Par is read off the row already in hand rather than through a second
  // `parFor` scan of the same table. A par of 0 is not a par — it is a row that
  // was never measured — and letting it through would put "0.00s" at the top of
  // every ladder as the fastest time anybody ever set.
  const par = typeof row?.par === 'number' && row.par > 0 ? row.par : null;
  return {
    id: entry.id,
    label: entry.label,
    number: levelNumber(entry.id),
    simHash,
    broken: lvl === null,
    error: entry.error,
    bestTicks: best ?? null,
    bestText: best === undefined ? '' : ticksToSeconds(best).toFixed(3),
    completed: best !== undefined,
    apples: lvl?.apples.length ?? 0,
    spanX: lvl ? Math.round(lvl.maxX - lvl.minX) : 0,
    spanY: lvl ? Math.round(lvl.maxY - lvl.minY) : 0,
    rating,
    unratedNote: code === null ? '' : UNRATED_WORDS[code],
    unratedCode: code,
    parSeconds: par,
    current: entry.id === o.currentId,
    tier: lvl?.tier ?? null,
  };
}

function groupNote(items: ChooserItem[]): string {
  const done = items.filter((i) => i.completed).length;
  const scores = items.map((i) => i.rating?.score).filter((s): s is number => s !== undefined);
  const range = scores.length
    ? `  ·  difficulty ${Math.min(...scores)}–${Math.max(...scores)}`
    : '';
  return `${done}/${items.length} completed${range}`;
}

/**
 * Twenty entries in one flat list is a wall. The set has a shape — the first ten
 * teach and the second ten build on them — and the filenames already carry it,
 * so the grouping is DERIVED from the leading number rather than declared in a
 * table that a twenty-first level would silently fall out of. Anything without
 * a leading number (the two test levels, a level adopted from a replay file)
 * goes in its own group at the end.
 */
export function buildChooser(levels: readonly LevelEntry[], o: ChooserOpts): ChooserGroup[] {
  const items = levels.map((e) => buildItem(e, o));

  if (o.sort === 'difficulty') {
    // One list, easiest first: the point of this order is the ramp, and slicing
    // a ramp into decades destroys it. Unrated levels sit at the end in their
    // own group rather than being given a position they have not earned.
    const rated = items.filter((i) => i.rating !== null);
    const rest = items.filter((i) => i.rating === null);
    rated.sort((a, b) => (a.rating?.score ?? 0) - (b.rating?.score ?? 0) || a.id.localeCompare(b.id));
    rest.sort((a, b) => a.id.localeCompare(b.id));
    const out: ChooserGroup[] = [];
    if (rated.length) out.push({ key: 'rated', label: 'easiest first', note: groupNote(rated), items: rated });
    if (rest.length) out.push({ key: 'unrated', label: 'unrated', note: groupNote(rest), items: rest });
    return out;
  }

  const byKey = new Map<string, ChooserItem[]>();
  for (const it of items) {
    const key = it.number === null ? 'other' : String(Math.floor((it.number - 1) / 10));
    const list = byKey.get(key);
    if (list) list.push(it);
    else byKey.set(key, [it]);
  }
  const keys = [...byKey.keys()].sort((a, b) => {
    if (a === 'other') return 1;
    if (b === 'other') return -1;
    return Number(a) - Number(b);
  });
  return keys.map((key) => {
    const list = (byKey.get(key) ?? []).slice();
    list.sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.id.localeCompare(b.id));
    const label = key === 'other'
      ? 'unnumbered'
      : `${String(Number(key) * 10 + 1).padStart(2, '0')} – ${String(Number(key) * 10 + 10).padStart(2, '0')}`;
    return { key, label, note: groupNote(list), items: list };
  });
}

/** Flat, in the order the groups put them. What the arrow keys walk. */
export function flatten(groups: readonly ChooserGroup[]): ChooserItem[] {
  const out: ChooserItem[] = [];
  for (const g of groups) for (const i of g.items) out.push(i);
  return out;
}

/**
 * The line under the title: how much of the set is done, on this browser and
 * this rev. Both qualifiers are load-bearing — local bests are not the
 * leaderboard and a rev bump retires them — and saying so here is cheaper than
 * a support conversation about vanished times.
 */
export function chooserSummary(groups: readonly ChooserGroup[], rev: number): string {
  const all = flatten(groups);
  const done = all.filter((i) => i.completed).length;
  return `${done}/${all.length} completed — local to this browser, rev ${rev}`;
}
