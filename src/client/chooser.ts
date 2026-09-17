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
export const BAND_EDGES: readonly { max: number; band: Band }[] = [
  { max: 15, band: 'gentle' },
  { max: 28, band: 'steady' },
  { max: 38, band: 'tricky' },
  { max: 48, band: 'hard' },
  { max: Infinity, band: 'brutal' },
];

export function difficultyBand(score: number): Band {
  for (const e of BAND_EDGES) if (score < e.max) return e.band;
  return 'brutal';
}

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
  current: boolean;
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
  lookup?: (simHash: string, rev: number) => MeasuredLevel | null;
}

/** `07-the-chimney` -> 7. Null for `test01` and for adopted replay levels. */
export function levelNumber(id: string): number | null {
  const m = /^(\d+)/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function ratingOf(m: MeasuredLevel | null): { rating: Rating | null; note: string } {
  if (m === null) {
    return {
      rating: null,
      note: 'unrated — no solver run for this level on this rev',
    };
  }
  if (!m.solved || m.score === null) {
    // NEVER shown as hard. The solver not finding a route inside its cap is a
    // "could not", and bin/solve's own notes say it has been wrong that way.
    return { rating: null, note: 'unrated — the solver has not completed it yet' };
  }
  return {
    rating: {
      score: Math.round(m.score),
      band: difficultyBand(m.score),
      minHeadClearance: m.minHeadClearance,
      solveSeconds: m.solveSeconds,
    },
    note: '',
  };
}

export function buildItem(entry: LevelEntry, o: ChooserOpts): ChooserItem {
  const lookup = o.lookup ?? measuredFor;
  const lvl = entry.level;
  const simHash = lvl?.simHash ?? null;
  const best = simHash !== null ? o.bests[simHash] : undefined;
  const { rating, note } = lvl === null
    ? { rating: null, note: 'unrated — it does not load' }
    : ratingOf(lookup(lvl.simHash, o.rev));
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
    unratedNote: note,
    current: entry.id === o.currentId,
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
