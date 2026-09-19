// What the board browser SHOWS, in plain node. No DOM, by house rule — and
// because the DOM is not what could be wrong here.
//
// What could be wrong is every claim the screen makes: a gap measured against
// the wrong row, par placed at a rank it has not earned, a `watch` button on a
// TAS row, a level shown as unrated with no reason, a board that is loading
// rendered as a board that is empty. Every one of those is a lie on a
// leaderboard and every one of them is decidable from plain objects.
import { describe, expect, it } from 'vitest';
import { INPUT_HZ, TICKS_PER_FRAME } from '@/sim/consts.ts';
import type { BoardEntry, BoardPayload, Category } from './api.ts';
import type { ChooserItem } from './chooser.ts';
import { buildBrowse, buildLines, createBoardCache, standingText } from './browse.ts';
import type { BoardSlot, BrowseRow, ParRow } from './browse.ts';

const SEC = INPUT_HZ * TICKS_PER_FRAME;

function entry(name: string, seconds: number, over: Partial<BoardEntry> = {}): BoardEntry {
  return {
    replayId: `r${name}`,
    playerId: `p${name}`,
    name,
    timeTicks: Math.round(seconds * SEC),
    frames: 100,
    simRev: 4,
    specHash: 'spec',
    bike: 'scrambler',
    category: 'human',
    at: `2026-09-18T00:00:0${name.length}Z`,
    ...over,
  };
}

function board(top: BoardEntry[], over: Partial<BoardPayload> = {}): BoardPayload {
  return {
    simHash: 'aaaaaaaaaaaaaaaa',
    rev: 4,
    liveRev: 4,
    category: 'human',
    levelId: '01-first-light',
    levelName: '01 — First Light',
    total: top.length,
    accepted: top.length,
    top,
    you: null,
    rank: null,
    above: null,
    best: null,
    otherRevs: [],
    note: '',
    ...over,
  };
}

function item(over: Partial<ChooserItem> = {}): ChooserItem {
  return {
    id: '01-first-light',
    label: '01 — First Light',
    number: 1,
    simHash: 'aaaaaaaaaaaaaaaa',
    broken: false,
    error: null,
    bestTicks: null,
    bestText: '',
    completed: false,
    apples: 7,
    spanX: 120,
    spanY: 30,
    rating: { score: 24, band: 'gentle', minHeadClearance: 0.5, solveSeconds: 10.3 },
    unratedNote: '',
    unratedCode: null,
    parSeconds: 10.32,
    current: false,
    tier: null,
    ...over,
  };
}

const ready = (b: BoardPayload | null): BoardSlot => ({ state: 'ready', payload: b, error: '' });

function opts(slot: BoardSlot, over: Partial<Parameters<typeof buildBrowse>[1]> = {}) {
  return { playerId: 'pme', category: 'human' as Category, at: 3, of: 24, board: slot, ...over };
}

const entries = (lines: ReturnType<typeof buildLines>): BrowseRow[] =>
  lines.filter((l): l is BrowseRow => l.kind === 'entry');
const pars = (lines: ReturnType<typeof buildLines>): ParRow[] =>
  lines.filter((l): l is ParRow => l.kind === 'par');

describe('the ladder', () => {
  it('measures each row against the one above it, not against the leader', () => {
    // THE NUMBER A PER-LEVEL POPUP NEVER SHOWED. An absolute time says nothing
    // you can act on; "0.400s behind" says whether the next place is one clean
    // corner away or a different league. Both are printed and they are
    // different numbers, so getting them the same way round matters.
    const lines = buildLines(board([entry('a', 10), entry('b', 10.4), entry('c', 12)]), 'pme', null);
    const rows = entries(lines);
    expect(rows.map((r) => r.behindText)).toEqual(['', '0.400s', '1.600s']);
    expect(rows.map((r) => r.leaderText)).toEqual(['', '0.400s', '2.000s']);
  });

  it('marks exactly the row that is you', () => {
    const lines = buildLines(board([entry('a', 10), entry('me', 11, { playerId: 'pme' })]), 'pme', null);
    expect(entries(lines).map((r) => r.you)).toEqual([false, true]);
  });

  it('is empty rather than wrong when there is no board', () => {
    expect(buildLines(null, 'pme', 10)).toEqual([]);
  });
});

describe('a TAS row never offers a line', () => {
  // THE HARD RULE, and it is asserted here rather than trusted because this
  // screen is the second place in the client that draws board rows and the
  // first one to draw them for a level you are not on. A time is information; a
  // line is the solution to the puzzle, and route choice is this game's depth.
  it('offers `watch` on every human row and on no TAS row, whatever else is true', () => {
    const human = buildLines(board([entry('a', 10), entry('b', 11)]), 'pme', 9);
    expect(entries(human).every((r) => r.watchable)).toBe(true);

    for (const par of [null, 5, 50]) {
      for (const total of [0, 1, 9]) {
        const tas = buildLines(
          board([entry('solver', 9, { category: 'tas' })], { category: 'tas', total }),
          'pme',
          par,
        );
        expect(entries(tas).some((r) => r.watchable)).toBe(false);
      }
    }
  });

  it('puts no par marker on the TAS board, because every row there is already one', () => {
    const tas = buildLines(board([entry('solver', 9, { category: 'tas' })], { category: 'tas' }), 'pme', 10.32);
    expect(pars(tas)).toEqual([]);
  });
});

describe('par, in the ladder', () => {
  it('sits at the rank its time earns', () => {
    // Two people under it, one over. Par is the fastest line ANYTHING has
    // found, so "who has beaten the search" is a thing you can see rather than
    // a thing you work out.
    const lines = buildLines(board([entry('a', 9), entry('b', 10), entry('c', 11)]), 'pme', 10.32);
    expect(lines.map((l) => (l.kind === 'par' ? 'PAR' : l.name))).toEqual(['a', 'b', 'PAR', 'c']);
    expect(pars(lines)[0].beatenBy).toBe(2);
  });

  it('sits at the top when nobody has beaten it, and says so', () => {
    const lines = buildLines(board([entry('a', 12), entry('b', 13)]), 'pme', 10.32);
    expect(lines[0].kind).toBe('par');
    const par = pars(lines)[0];
    expect(par.beatenBy).toBe(0);
    expect(par.note).toContain('Nobody here has beaten it');
  });

  it('sits at the bottom when everybody has', () => {
    const lines = buildLines(board([entry('a', 8), entry('b', 9)]), 'pme', 10.32);
    expect(lines[lines.length - 1].kind).toBe('par');
    expect(pars(lines)[0].note).toContain('2 people');
  });

  it('is on an empty board too — a target with nobody on it is still a target', () => {
    const lines = buildLines(board([]), 'pme', 10.32);
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe('par');
  });

  it('is absent, rather than zero, when nothing has solved the level', () => {
    // A par of 0 would sort to the top of every ladder as the fastest time
    // anybody ever set. `buildItem` refuses to produce one; this is the other
    // end of the same guarantee.
    expect(pars(buildLines(board([entry('a', 10)]), 'pme', null))).toEqual([]);
  });

  it('prints at two decimals, because its third is search noise', () => {
    // A posted time is a re-simulated tick count and its third decimal is real;
    // par comes off a macro-action grid and its third is not. Printing both the
    // same way would claim a precision one of them does not have.
    const lines = buildLines(board([entry('a', 20)]), 'pme', 10.3249);
    expect(pars(lines)[0].timeText).toBe('10.32s');
    expect(entries(lines)[0].timeText).toBe('20.000s');
  });
});

describe('where you stand', () => {
  it('names the gap and the person when you are on the board', () => {
    const you = entry('me', 12, { playerId: 'pme' });
    const b = board([entry('a', 10), you], { you, rank: 2, total: 2, above: entry('a', 10) });
    expect(standingText(b, 'human')).toBe('you: #2 of 2, 12.000s — 2.000s behind a');
  });

  it('says so plainly when nobody is ahead of you', () => {
    const you = entry('me', 9, { playerId: 'pme' });
    const b = board([you], { you, rank: 1, total: 1 });
    expect(standingText(b, 'human')).toContain('nobody ahead of you');
  });

  it('always says something when you are not on it', () => {
    expect(standingText(board([]), 'human')).toContain('be first');
    expect(standingText(board([entry('a', 10), entry('b', 11)]), 'human')).toContain('2 people have one');
    expect(standingText(board([entry('a', 10)]), 'human')).toContain('1 person has one');
    // And the TAS board never invites you onto it: you cannot post there from
    // a browser, so "no time here yet" would be a nag for something impossible.
    expect(standingText(board([], { category: 'tas' }), 'tas')).toContain('machine board');
  });
});

describe('the header', () => {
  it('says WHY a level is unrated rather than leaving a blank', () => {
    for (const [code, word] of [
      ['unsolved', 'has not completed it'],
      ['zero-apples', 'no apples'],
      ['unverified', 'did not re-simulate'],
      ['unmeasured', 'no solver run'],
      ['broken', 'does not load'],
    ] as const) {
      const m = buildBrowse(item({ rating: null, unratedCode: code }), opts(ready(board([]))));
      expect(m.bandText, code).toContain('unrated');
      expect(m.bandText, code).toContain(word);
    }
  });

  it('measures your best against par and never against whoever is top', () => {
    // What your best is worth is a question about the LEVEL. Comparing it to
    // the current leader would make the answer move when somebody else rides.
    const under = buildBrowse(
      item({ bestTicks: Math.round(9 * SEC), completed: true, parSeconds: 10.32 }),
      opts(ready(board([entry('a', 8)]))),
    );
    expect(under.parGapText).toContain('1.32s under par');
    const over = buildBrowse(
      item({ bestTicks: Math.round(12 * SEC), completed: true, parSeconds: 10.32 }),
      opts(ready(board([entry('a', 8)]))),
    );
    expect(over.parGapText).toBe('1.68s over par');
    // Neither half without the other: there is nothing to compare.
    expect(buildBrowse(item({ parSeconds: null, bestTicks: 100 }), opts(ready(board([])))).parGapText).toBe('');
    expect(buildBrowse(item({ bestTicks: null }), opts(ready(board([])))).parGapText).toBe('');
  });

  it('carries its place in the order, which is what the stepper prints', () => {
    const m = buildBrowse(item(), opts(ready(board([])), { at: 7, of: 24 }));
    expect([m.at, m.of]).toEqual([7, 24]);
  });
});

describe('a board that is not there', () => {
  it('distinguishes loading from empty, which is the whole of not lying about it', () => {
    const loading = buildBrowse(item(), opts({ state: 'loading', payload: null, error: '' }));
    expect(loading.note).toBe('loading…');
    expect(loading.lines).toEqual([]);
    const empty = buildBrowse(item(), opts(ready(board([]))));
    expect(empty.note).toContain('be first');
  });

  it('degrades rather than fails when the server is not there', () => {
    const off = buildBrowse(item(), opts({ state: 'offline', payload: null, error: 'fetch failed' }));
    expect(off.note).toContain('offline');
    expect(off.note).toContain('game works fine without it');
    expect(off.note).toContain('fetch failed');
  });

  it('says a broken level is broken, in the loader’s own words', () => {
    const m = buildBrowse(
      item({ broken: true, error: 'polygon 0: needs at least 3 vertices', simHash: null }),
      opts(ready(null)),
    );
    expect(m.note).toContain('polygon 0');
  });

  it('never hides times on an older rev behind an empty board', () => {
    const m = buildBrowse(
      item(),
      opts(ready(board([], { otherRevs: [{ rev: 3, entries: 11 }] }))),
    );
    expect(m.revNote).toContain('rev 3: 11');
    expect(m.revNote).toContain('never deleted');
  });
});

describe('the board cache', () => {
  it('fetches a level once and serves every later look from memory', async () => {
    let calls = 0;
    const changed: string[] = [];
    const cache = createBoardCache(
      (simHash) => {
        calls++;
        return Promise.resolve(ready(board([entry('a', 10)], { simHash })));
      },
      (simHash) => changed.push(simHash),
    );
    expect(cache.get('h1', 'human').state).toBe('loading');
    expect(cache.get('h1', 'human').state).toBe('loading');
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(changed).toEqual(['h1']);
    expect(cache.get('h1', 'human').state).toBe('ready');
    // STEPPING BACK ONE IS FREE, which is the entire reason this exists: the
    // ask was to see leaderboards "without having to load each one".
    expect(calls).toBe(1);
  });

  it('keys on the category too, because they are different boards', async () => {
    let calls = 0;
    const cache = createBoardCache(() => {
      calls++;
      return Promise.resolve(ready(board([])));
    }, () => undefined);
    cache.get('h1', 'human');
    cache.get('h1', 'tas');
    await Promise.resolve();
    expect(calls).toBe(2);
  });

  it('refetches exactly what was dropped, and nothing else', async () => {
    let calls = 0;
    const cache = createBoardCache(() => {
      calls++;
      return Promise.resolve(ready(board([])));
    }, () => undefined);
    cache.get('h1', 'human');
    cache.get('h2', 'human');
    await Promise.resolve();
    expect(calls).toBe(2);
    cache.drop('h1', 'human');
    cache.get('h2', 'human');
    expect(calls).toBe(2);
    cache.get('h1', 'human');
    expect(calls).toBe(3);
  });

  it('lands on offline rather than on a spinner nobody can clear', async () => {
    const cache = createBoardCache(() => Promise.reject(new Error('boom')), () => undefined);
    cache.get('h1', 'human');
    await Promise.resolve();
    await Promise.resolve();
    const slot = cache.get('h1', 'human');
    expect(slot.state).toBe('offline');
    expect(slot.error).toBe('boom');
  });

  it('is emptied wholesale, which is its entire staleness policy', async () => {
    const cache = createBoardCache(() => Promise.resolve(ready(board([]))), () => undefined);
    cache.get('h1', 'human');
    cache.get('h2', 'human');
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
