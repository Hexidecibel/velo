// The leaderboard, as data and as arithmetic. No filesystem in this file — the
// whole point is that "what does submitting this time do to the board" is a
// pure function you can test in plain node, and `store.ts` is only the part
// that gets bytes onto a disk.
//
// PARTITIONING WAS DECIDED ON DAY ONE AND IS NOT RE-LITIGATED HERE.
//
//   * Boards key on `level.simHash` — the hash over only the fields the sim
//     reads. Retitle a level, recolour it, move a decor polygon: the board
//     survives. Move an apple by 1e-12 and it does not, because that is a
//     different level to ride.
//   * Boards PARTITION BY `simRev`. A time set under different physics is not a
//     time on the same level, so it is neither silently invalidated nor wrongly
//     compared: it sits on the rev-2 board, labelled, forever. Through
//     milestone 1 the rev bumps freely and the live board therefore empties —
//     the UI says so rather than letting anyone think their time was deleted.
//   * Boards PARTITION BY CATEGORY, and there are two from the start: `human`
//     and `tas`. Deterministic verification means any input stream the sim
//     accepts is legitimate BY DEFINITION, so a solver-generated optimal run
//     verifies perfectly and there is no test that could ever tell it from a
//     human's. That is unfixable in principle. A separate category turns it
//     from an exploit into a feature — and `bin/level-drive --save` already
//     produces exactly such runs. Retrofitting the split after people have
//     competed is a fight; doing it now costs one string field.
//
//     Be honest about what the split IS: the category is DECLARED by the
//     submitter, never detected, because detecting it is the impossible thing.
//     It is a convention among people who can already see each other's names.
//   * Every entry records the bike's `specHash`. Only one bike ships, so it does
//     not partition anything yet; recording it from day one is what makes a
//     stat-varying bike a migration rather than an archaeology project.
import type { VerifyResult } from '@/sim/replay.ts';
import type { Appearance } from '@/shared/appearance.ts';

/** The two categories, and there will not quietly be a third. */
export const CATEGORIES = ['human', 'tas'] as const;
export type Category = (typeof CATEGORIES)[number];

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}

/** How many entries the stored `top` slice holds. Reads are served from it. */
export const TOP_N = 50;

export interface Entry {
  /** Content address of the input stream. The ghost is fetched by this. */
  replayId: string;
  /**
   * THE IDENTITY. Opaque, stable, generated once on the device and never
   * derived from anything the player typed. Everything keys on this.
   */
  playerId: string;
  /**
   * Denormalised for rendering, and PRESENTATION ONLY — never a key, never
   * matched on, and self-asserted rather than authenticated (see the README).
   * Changing it must not be able to fork or orphan a player's history, which is
   * exactly what keying on it would do.
   */
  name: string;
  timeTicks: number;
  frames: number;
  simRev: number;
  specHash: string;
  bike: string;
  /**
   * WHAT THEIR BIKE LOOKS LIKE. Denormalised for rendering, exactly like `name`
   * above, and with exactly the same status: PRESENTATION ONLY, never a key,
   * never matched on, self-asserted, and entirely outside `specHash`.
   *
   * This is the field that makes a ghost look like the person who set it and a
   * board row show a face instead of a number. It cannot affect whether a time
   * counts: `preflight` compares `specHash` against the shipped bike and this
   * is not in it, which is asserted in runs.test.ts rather than promised here.
   *
   * OPTIONAL ON THE WIRE, because every board file written before today has no
   * appearance on any row and rewriting them to add one would be a migration
   * for a colour. A row without it resolves to the stable derivation from the
   * playerId, so an old board still renders as a set of different people —
   * `resolveAppearance` is the one place that decision is made.
   */
  appearance?: Appearance;
  category: Category;
  /** ISO-8601, server clock. Presentation and tie-breaking only. */
  at: string;
}

export interface BoardSection {
  /**
   * AUTHORITATIVE: every player's personal best, keyed by playerId. Small by
   * construction — this is a device-gated friend group, not a public ladder —
   * so it is kept whole rather than truncated, which is what makes "what rank
   * am I" answerable for somebody who is not in the top N.
   */
  best: Record<string, Entry>;
  /** DERIVED on write from `best`: the sorted top N, so a read is just a read. */
  top: Entry[];
  /** Submissions that verified, including the ones that did not beat a PB. */
  accepted: number;
}

export interface BoardFile {
  format: 'velo-board';
  version: 1;
  simHash: string;
  /** Last seen level name. Cosmetic: identity is the hash, never the name. */
  levelName: string;
  updatedAt: string;
  /** `rev<N>` -> category -> section. Partitioning, made literal. */
  revs: Record<string, Record<string, BoardSection>>;
}

export function revKey(simRev: number): string {
  return `rev${simRev}`;
}

export function emptySection(): BoardSection {
  return { best: {}, top: [], accepted: 0 };
}

export function emptyBoard(simHash: string, levelName: string, at: string): BoardFile {
  return { format: 'velo-board', version: 1, simHash, levelName, updatedAt: at, revs: {} };
}

/**
 * Sort order, and the tie-break is the interesting half: equal times are
 * ordered by WHO GOT THERE FIRST. On a 128 Hz input grid exact ties are not
 * hypothetical — two people riding the same clean line on an early level tie
 * routinely — and "first to set it holds the rank" is the only tie-break that
 * does not silently reshuffle a board every time it is rewritten.
 */
export function compareEntries(a: Entry, b: Entry): number {
  if (a.timeTicks !== b.timeTicks) return a.timeTicks - b.timeTicks;
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.replayId < b.replayId ? -1 : a.replayId > b.replayId ? 1 : 0;
}

/** Every player's best, in board order. */
export function ranked(section: BoardSection): Entry[] {
  return Object.values(section.best).sort(compareEntries);
}

export function sectionOf(board: BoardFile, simRev: number, category: Category): BoardSection {
  return board.revs[revKey(simRev)]?.[category] ?? emptySection();
}

export interface Placement {
  /** False when the run did not beat this player's existing PB. */
  pb: boolean;
  /** 1-based rank after this submission, in the player's own section. */
  rank: number;
  total: number;
  /** The entry that now holds this player's PB — theirs either way. */
  entry: Entry;
  /** Their previous PB time, when they had one. */
  previousTicks: number | null;
}

/**
 * Apply one verified submission. Returns a NEW board — the caller writes it —
 * plus where the player ended up.
 *
 * A slower run than the player's own PB is still `accepted`: it verified, it
 * happened, and counting it is how "attempts" means anything. It just does not
 * displace their entry.
 */
export function place(board: BoardFile, entry: Entry, levelName: string): { board: BoardFile; placement: Placement } {
  const rk = revKey(entry.simRev);
  const revs: BoardFile['revs'] = { ...board.revs };
  const byCat: Record<string, BoardSection> = { ...(revs[rk] ?? {}) };
  const prev = byCat[entry.category] ?? emptySection();

  const existing = prev.best[entry.playerId];
  const pb = existing === undefined || entry.timeTicks < existing.timeTicks;
  const best = { ...prev.best };
  if (pb) {
    best[entry.playerId] = entry;
  } else {
    // Identity does not move: the key is still the playerId and `existing` is
    // still the same run.
    // NOT a personal best, so the time, the replay and the timestamp all stay
    // exactly as they were — but the NAME and the APPEARANCE are refreshed,
    // because both are denormalised presentation and a change that left every
    // existing row showing the old one would make renaming, or repainting, look
    // broken while the data underneath was perfectly correct.
    best[entry.playerId] = { ...existing, name: entry.name, appearance: entry.appearance };
  }

  const section: BoardSection = {
    best,
    top: Object.values(best).sort(compareEntries).slice(0, TOP_N),
    accepted: prev.accepted + 1,
  };
  byCat[entry.category] = section;
  revs[rk] = byCat;

  const order = Object.values(best).sort(compareEntries);
  const held = best[entry.playerId];
  const rank = order.findIndex((e) => e.playerId === entry.playerId) + 1;

  return {
    board: { ...board, levelName: levelName || board.levelName, updatedAt: entry.at, revs },
    placement: {
      pb,
      rank,
      total: order.length,
      entry: held,
      previousTicks: existing ? existing.timeTicks : null,
    },
  };
}

export interface Standing {
  /** This player's entry in the section, when they have one. */
  you: Entry | null;
  /** 1-based, or null when they have no time here. */
  rank: number | null;
  total: number;
  /**
   * THE ENTRY JUST ABOVE YOU — the one this whole feature is for.
   *
   * Trials' insight, and it holds here: the world record is a number, but the
   * person one place ahead of you is a race. So this is the SLOWEST entry that
   * is still faster than yours.
   *
   * When you have no time at all it is the slowest entry on the board, which is
   * the right answer rather than a degenerate one: with no time, everybody is
   * ahead of you, and the nearest of them is the one you can actually catch.
   */
  above: Entry | null;
  /** Rank 1. Null on an empty board. */
  best: Entry | null;
}

export function standing(section: BoardSection, playerId: string | null): Standing {
  const order = ranked(section);
  const total = order.length;
  const best = order[0] ?? null;
  if (!playerId) return { you: null, rank: null, total, above: order[total - 1] ?? null, best };
  const i = order.findIndex((e) => e.playerId === playerId);
  if (i < 0) return { you: null, rank: null, total, above: order[total - 1] ?? null, best };
  return { you: order[i], rank: i + 1, total, above: i > 0 ? order[i - 1] : null, best };
}

// --- the player file ---------------------------------------------------------
//
// IDENTITY IS THE OPAQUE `playerId` AND NEVER THE DISPLAY NAME. Every board
// entry, every PB and this file itself key on it; the name is denormalised onto
// an entry purely so a board can be rendered without a second lookup.
//
// Three things follow, and they are the whole reason the rule is stated rather
// than assumed:
//
//   * Renaming is free. It rewrites presentation and touches no identity, so a
//     player's history does not fork when they change what they are called, and
//     `board.test.ts` asserts exactly that rather than trusting this paragraph.
//   * Two people picking the same name is a cosmetic clash, not data
//     corruption. Keyed on the name it would be a silent merge of two people's
//     times.
//   * A real signup later is a CLAIM, not a migration. An account takes over an
//     existing playerId and every row that already references it transfers
//     untouched. Keyed on the name, that same step means rewriting every entry
//     on every board and guessing at collisions.

export interface PlayerFile {
  format: 'velo-player';
  version: 1;
  /** The identity. Opaque, generated once on the device, never derived. */
  playerId: string;
  /** Most recent name they submitted under. PRESENTATION ONLY. Never a key. */
  name: string;
  /**
   * Most recent bike they submitted on. PRESENTATION ONLY, exactly like the
   * name, and kept here for one reason: a second device claiming this player
   * should come up looking like them rather than posting under their id wearing
   * somebody else's livery. Optional, because every player file written before
   * today has none.
   */
  appearance?: Appearance;
  updatedAt: string;
  /**
   * The slot a real account claims, when there is one. Absent or null means
   * "local identity only", which is every player today.
   *
   * Shipped now, unused, for the same reason the level format's `style` and
   * `provenance` blocks were: the cheap half of a one-way door. When signup
   * arrives it holds whatever the account system's key is, and nothing else in
   * the store has to move. There is deliberately NO email field here and will
   * not be one until an account system needs it — storing personal data carries
   * obligations that a local display name does not, and accepting them early
   * buys nothing.
   */
  claimedBy?: string | null;
  /** simHash -> `rev<N>` -> category -> their PB there. */
  pbs: Record<string, Record<string, Record<string, Entry>>>;
}

export function emptyPlayer(playerId: string, name: string, at: string): PlayerFile {
  return { format: 'velo-player', version: 1, playerId, name, updatedAt: at, claimedBy: null, pbs: {} };
}

export function recordPb(player: PlayerFile, simHash: string, entry: Entry): PlayerFile {
  const rk = revKey(entry.simRev);
  const byLevel = { ...player.pbs };
  const byRev = { ...(byLevel[simHash] ?? {}) };
  const byCat = { ...(byRev[rk] ?? {}) };
  const existing = byCat[entry.category];
  // Same rule as the board: a faster run replaces the PB, a slower one only
  // refreshes the label on it.
  if (existing === undefined || entry.timeTicks < existing.timeTicks) byCat[entry.category] = entry;
  else byCat[entry.category] = { ...existing, name: entry.name, appearance: entry.appearance };
  byRev[rk] = byCat;
  byLevel[simHash] = byRev;
  return {
    ...player,
    name: entry.name || player.name,
    appearance: entry.appearance ?? player.appearance,
    updatedAt: entry.at,
    pbs: byLevel,
  };
}

// --- turning a verified run into an entry ------------------------------------

export interface EntryInput {
  replayId: string;
  playerId: string;
  name: string;
  category: Category;
  simRev: number;
  specHash: string;
  bike: string;
  appearance: Appearance;
  frames: number;
  at: string;
}

/**
 * The time on the entry comes from the VERIFIER, never from the submission.
 * That is the whole architecture in one line: the client's claim is an
 * assertion to be checked, and once it is checked the checked value is the one
 * that gets stored. A submission whose claim disagreed never reaches here.
 */
export function entryFrom(input: EntryInput, verified: VerifyResult): Entry {
  return {
    replayId: input.replayId,
    playerId: input.playerId,
    name: input.name,
    timeTicks: verified.timeTicks,
    frames: input.frames,
    simRev: input.simRev,
    specHash: input.specHash,
    bike: input.bike,
    appearance: input.appearance,
    category: input.category,
    at: input.at,
  };
}
