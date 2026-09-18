// What the level chooser lists, in plain node. No DOM, by house rule — and
// because the DOM is not what could be wrong here. A level shown as easy
// because a stale difficulty row matched by NAME, a best time attached to the
// wrong level, an unsolved level ranked as the hardest in the set, a
// twenty-first level falling out of the grouping: every one of those is
// decidable from plain objects, and every one of them is a lie on a card.
import { describe, expect, it } from 'vitest';
import { INPUT_HZ, TICKS_PER_FRAME } from '@/sim/consts.ts';
import type { Level } from '@/sim/level.ts';
import type { MeasuredLevel } from '@/solver/measured.ts';
import { MEASURED, measuredFor } from '@/solver/measured.ts';
import { buildChooser, buildItem, chooserSummary, difficultyBand, flatten, levelNumber } from './chooser.ts';
import type { ChooserOpts } from './chooser.ts';
import type { LevelEntry } from './levels.ts';

const SEC = INPUT_HZ * TICKS_PER_FRAME;

function level(simHash: string, over: Partial<Level> = {}): Level {
  return {
    name: 'a level',
    start: { x: 0, y: 0 },
    flower: { x: 10, y: 0 },
    apples: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
    polys: [],
    decor: [],
    sagTolerance: 0.01,
    arcCount: 0,
    arcSegments: 0,
    minX: -5,
    minY: -2,
    maxX: 45,
    maxY: 18,
    simHash,
    contentHash: `c${simHash}`,
    style: null,
    ...over,
  } as Level;
}

function entry(id: string, simHash: string | null, over: Partial<LevelEntry> = {}): LevelEntry {
  return {
    id,
    label: id,
    path: `../../levels/${id}.json`,
    raw: {},
    level: simHash === null ? null : level(simHash),
    error: simHash === null ? 'polygon 0: needs at least 3 vertices' : null,
    ...over,
  };
}

function measured(simHash: string, over: Partial<MeasuredLevel> = {}): MeasuredLevel {
  return {
    simHash,
    name: 'a level',
    simRev: 4,
    solved: true,
    score: 40,
    precision: 0.1,
    clearance: 0.5,
    effort: 0.5,
    lethality: 0.5,
    minHeadClearance: 0.1,
    solveSeconds: 30,
    searchSeconds: 60,
    ...over,
  };
}

function opts(rows: MeasuredLevel[], over: Partial<ChooserOpts> = {}): ChooserOpts {
  return {
    bests: {},
    currentId: '',
    sort: 'number',
    rev: 4,
    lookup: (h, rev) => rows.find((m) => m.simHash === h && m.simRev === rev) ?? null,
    ...over,
  };
}

describe('levelNumber', () => {
  it('reads the leading number off the id and nothing else', () => {
    expect(levelNumber('01-first-light')).toBe(1);
    expect(levelNumber('20-close-quarters')).toBe(20);
    expect(levelNumber('test01')).toBe(null);
    expect(levelNumber('replay-12b377bf')).toBe(null);
  });
});

describe('difficultyBand', () => {
  it('separates the set rather than piling it into one word', () => {
    // Real scores from the shipped set under SCORE_REV 2, which spans 13-85.
    // These moved when the composite did: the old sample (8/20/35/43/56) was
    // drawn against a 8-56 scale and every one of those values now means
    // something different. A band table and its scale are one thing.
    expect(difficultyBand(13)).toBe('gentle'); // 02 the long climb
    expect(difficultyBand(38)).toBe('steady'); // 15 feather
    expect(difficultyBand(52)).toBe('tricky'); // 21 rollers
    expect(difficultyBand(62)).toBe('hard'); // 23 pump
    expect(difficultyBand(84)).toBe('brutal'); // 08 needle
  });

  it('is monotonic — a higher score never reads as easier', () => {
    const order = ['gentle', 'steady', 'tricky', 'hard', 'brutal'];
    let at = 0;
    for (let s = 0; s <= 100; s += 0.5) {
      const i = order.indexOf(difficultyBand(s));
      expect(i).toBeGreaterThanOrEqual(at);
      at = i;
    }
  });
});

describe('buildItem', () => {
  it('carries the best time, the completion flag and the level facts', () => {
    const it0 = buildItem(entry('05-airtime', 'aaaa'), opts([measured('aaaa')], { bests: { aaaa: 12 * SEC } }));
    expect(it0.completed).toBe(true);
    expect(it0.bestText).toBe('12.000');
    expect(it0.apples).toBe(2);
    expect(it0.spanX).toBe(50);
    expect(it0.spanY).toBe(20);
    expect(it0.number).toBe(5);
    expect(it0.rating?.score).toBe(40);
    expect(it0.rating?.band).toBe('steady');
  });

  it('is uncompleted with no best, and says nothing about a time it does not have', () => {
    const it0 = buildItem(entry('05-airtime', 'aaaa'), opts([measured('aaaa')]));
    expect(it0.completed).toBe(false);
    expect(it0.bestTicks).toBe(null);
    expect(it0.bestText).toBe('');
  });

  it('matches a difficulty row by simHash, never by name', () => {
    // The row is for a level that has since been edited: same name, different
    // geometry. Matching on the name would show a confident rating for a level
    // nobody has ever solved.
    const row = measured('OLDHASH', { name: '05 — Airtime' });
    const it0 = buildItem(entry('05-airtime', 'NEWHASH', { label: '05 — Airtime' }), opts([row]));
    expect(it0.rating).toBe(null);
    expect(it0.unratedNote).toContain('unrated');
  });

  it('drops a score measured under different physics', () => {
    const it0 = buildItem(entry('05-airtime', 'aaaa'), opts([measured('aaaa', { simRev: 3 })], { rev: 4 }));
    expect(it0.rating).toBe(null);
  });

  it('shows an unsolved level as unrated, never as hard', () => {
    const it0 = buildItem(
      entry('16-one-way', 'bbbb'),
      opts([measured('bbbb', { solved: false, score: null })]),
    );
    expect(it0.rating).toBe(null);
    expect(it0.unratedNote).toContain('has not completed it');
  });

  it('keeps a broken level in the list, with the loader message', () => {
    const it0 = buildItem(entry('99-broken', null), opts([]));
    expect(it0.broken).toBe(true);
    expect(it0.error).toContain('3 vertices');
    expect(it0.rating).toBe(null);
  });
});

describe('buildChooser, by number', () => {
  const levels = [
    entry('01-a', 'h01'),
    entry('10-j', 'h10'),
    entry('11-k', 'h11'),
    entry('20-t', 'h20'),
    entry('21-u', 'h21'),
    entry('test01', 'hts'),
  ];

  it('groups by decade, in order, with the unnumbered ones last', () => {
    const g = buildChooser(levels, opts([]));
    expect(g.map((x) => x.label)).toEqual(['01 – 10', '11 – 20', '21 – 30', 'unnumbered']);
    expect(g[0].items.map((i) => i.id)).toEqual(['01-a', '10-j']);
    expect(g[1].items.map((i) => i.id)).toEqual(['11-k', '20-t']);
    expect(g[3].items.map((i) => i.id)).toEqual(['test01']);
  });

  it('sorts numerically, not as text — 10 comes after 9', () => {
    const g = buildChooser([entry('10-j', 'h10'), entry('09-i', 'h09'), entry('02-b', 'h02')], opts([]));
    expect(g[0].items.map((i) => i.id)).toEqual(['02-b', '09-i', '10-j']);
  });

  it('counts completion per group and shows the difficulty range it has', () => {
    const g = buildChooser(levels, opts([measured('h01', { score: 20 }), measured('h10', { score: 42 })], {
      bests: { h01: 5 * SEC },
    }));
    expect(g[0].note).toBe('1/2 completed  ·  difficulty 20–42');
    expect(g[1].note).toBe('0/2 completed');
  });

  it('marks exactly the current level', () => {
    const g = buildChooser(levels, opts([], { currentId: '11-k' }));
    const cur = flatten(g).filter((i) => i.current);
    expect(cur.map((i) => i.id)).toEqual(['11-k']);
  });
});

describe('buildChooser, by difficulty', () => {
  const levels = [entry('01-a', 'h01'), entry('02-b', 'h02'), entry('03-c', 'h03'), entry('16-p', 'h16')];
  const rows = [
    measured('h01', { score: 20 }),
    measured('h02', { score: 8 }),
    measured('h03', { score: 56 }),
    measured('h16', { solved: false, score: null }),
  ];

  it('is one ramp, easiest first, with the unrated kept out of it', () => {
    const g = buildChooser(levels, opts(rows, { sort: 'difficulty' }));
    expect(g.map((x) => x.key)).toEqual(['rated', 'unrated']);
    expect(g[0].items.map((i) => i.id)).toEqual(['02-b', '01-a', '03-c']);
    expect(g[1].items.map((i) => i.id)).toEqual(['16-p']);
  });

  it('lists every level exactly once, whichever order is chosen', () => {
    const byNumber = flatten(buildChooser(levels, opts(rows))).map((i) => i.id).sort();
    const byDiff = flatten(buildChooser(levels, opts(rows, { sort: 'difficulty' }))).map((i) => i.id).sort();
    expect(byDiff).toEqual(byNumber);
    expect(byDiff.length).toBe(levels.length);
  });
});

describe('chooserSummary', () => {
  it('says local and says which rev, because both retire a best time', () => {
    const g = buildChooser([entry('01-a', 'h01'), entry('02-b', 'h02')], opts([], { bests: { h01: SEC } }));
    expect(chooserSummary(g, 4)).toBe('1/2 completed — local to this browser, rev 4');
  });
});

describe('the generated difficulty table', () => {
  it('has a row per shipped level, keyed by a hash rather than a name', () => {
    expect(MEASURED.length).toBeGreaterThan(0);
    for (const m of MEASURED) expect(m.simHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('never carries a score for a level it could not solve', () => {
    for (const m of MEASURED) if (!m.solved) expect(m.score).toBe(null);
  });

  it('only answers for the rev it was measured under', () => {
    const m = MEASURED[0];
    expect(measuredFor(m.simHash, m.simRev)?.simHash).toBe(m.simHash);
    expect(measuredFor(m.simHash, m.simRev + 1)).toBe(null);
    expect(measuredFor('0000000000000000', m.simRev)).toBe(null);
  });
});
