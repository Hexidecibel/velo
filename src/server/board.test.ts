import { describe, expect, it } from 'vitest';
import {
  compareEntries,
  emptyBoard,
  emptyPlayer,
  entryFrom,
  isCategory,
  place,
  ranked,
  recordPb,
  revKey,
  sectionOf,
  standing,
  TOP_N,
} from './board.ts';
import type { Category, Entry } from './board.ts';
import type { VerifyResult } from '@/sim/replay.ts';
import { DEFAULT_APPEARANCE } from '@/shared/appearance.ts';

function verified(timeTicks: number): VerifyResult {
  return { ok: true, finished: true, dead: false, timeTicks, applesLeft: 0, finalHash: 'deadbeefdeadbeef' };
}

function entry(o: {
  player: string;
  name?: string;
  ticks: number;
  at?: string;
  cat?: Category;
  rev?: number;
  id?: string;
}): Entry {
  return entryFrom(
    {
      replayId: o.id ?? `${o.player}-${o.ticks}`,
      playerId: o.player,
      name: o.name ?? o.player,
      category: o.cat ?? 'human',
      simRev: o.rev ?? 3,
      specHash: 'c911d20c1e1fc095',
      bike: 'default',
      appearance: DEFAULT_APPEARANCE,
      frames: 100,
      at: o.at ?? '2026-09-15T00:00:00.000Z',
    },
    verified(o.ticks),
  );
}

const BOARD = emptyBoard('e0a770da780095df', 'First Light', '2026-09-15T00:00:00.000Z');

describe('categories', () => {
  it('accepts exactly human and tas', () => {
    expect(isCategory('human')).toBe(true);
    expect(isCategory('tas')).toBe(true);
    expect(isCategory('TAS')).toBe(false);
    expect(isCategory('speedrun')).toBe(false);
    expect(isCategory(3)).toBe(false);
  });
});

describe('place', () => {
  it('takes the time from the VERIFIER and never from the submission', () => {
    // entryFrom is handed a claim of 100 frames and a verified 5989 ticks; the
    // entry must carry the verified number. This is the whole architecture in
    // one assertion: a client's claim is checked, and the checked value wins.
    const e = entryFrom(
      {
        replayId: 'a', playerId: 'p', name: 'p', category: 'human',
        simRev: 3, specHash: 's', bike: 'default', appearance: DEFAULT_APPEARANCE, frames: 100, at: 'z',
      },
      verified(5989),
    );
    expect(e.timeTicks).toBe(5989);
  });

  it('keeps one entry per player — their best', () => {
    let b = BOARD;
    b = place(b, entry({ player: 'aa', ticks: 6000 }), 'First Light').board;
    b = place(b, entry({ player: 'aa', ticks: 5500 }), 'First Light').board;
    const r = place(b, entry({ player: 'aa', ticks: 5800 }), 'First Light');
    const section = sectionOf(r.board, 3, 'human');
    expect(Object.keys(section.best)).toEqual(['aa']);
    expect(section.best.aa.timeTicks).toBe(5500);
    // A slower run still counted as an accepted submission: it verified, it
    // happened. It just did not displace anything.
    expect(section.accepted).toBe(3);
    expect(r.placement.pb).toBe(false);
    expect(r.placement.previousTicks).toBe(5500);
  });

  it('orders by time and breaks ties by who got there first', () => {
    const early = entry({ player: 'aa', ticks: 5000, at: '2026-01-01T00:00:00.000Z' });
    const late = entry({ player: 'bb', ticks: 5000, at: '2026-02-01T00:00:00.000Z' });
    expect(compareEntries(early, late)).toBeLessThan(0);
    let b = place(BOARD, late, 'x').board;
    b = place(b, early, 'x').board;
    expect(ranked(sectionOf(b, 3, 'human')).map((e) => e.playerId)).toEqual(['aa', 'bb']);
  });

  it('caps the derived top slice but never the authoritative best map', () => {
    let b = BOARD;
    for (let i = 0; i < TOP_N + 5; i++) b = place(b, entry({ player: `p${i}`, ticks: 5000 + i }), 'x').board;
    const s = sectionOf(b, 3, 'human');
    expect(s.top.length).toBe(TOP_N);
    expect(Object.keys(s.best).length).toBe(TOP_N + 5);
  });
});

describe('partitioning', () => {
  it('keeps human and TAS on separate boards', () => {
    let b = place(BOARD, entry({ player: 'aa', ticks: 6000, cat: 'human' }), 'x').board;
    b = place(b, entry({ player: 'bot', ticks: 3000, cat: 'tas' }), 'x').board;
    expect(ranked(sectionOf(b, 3, 'human')).map((e) => e.playerId)).toEqual(['aa']);
    expect(ranked(sectionOf(b, 3, 'tas')).map((e) => e.playerId)).toEqual(['bot']);
  });

  it('keeps old revs and never lets them compete with the live one', () => {
    let b = place(BOARD, entry({ player: 'aa', ticks: 4000, rev: 2 }), 'x').board;
    b = place(b, entry({ player: 'aa', ticks: 6000, rev: 3 }), 'x').board;
    // The rev-2 time is FASTER and must still not outrank anything on rev 3 —
    // it was set under different physics, so it is not a time on this level as
    // it is ridden now. It is kept, labelled, on its own board.
    expect(sectionOf(b, 2, 'human').best.aa.timeTicks).toBe(4000);
    expect(sectionOf(b, 3, 'human').best.aa.timeTicks).toBe(6000);
    expect(Object.keys(b.revs).sort()).toEqual([revKey(2), revKey(3)]);
  });

  it('reports an empty section rather than throwing for a rev nobody has played', () => {
    expect(sectionOf(BOARD, 99, 'human')).toEqual({ best: {}, top: [], accepted: 0 });
  });
});

describe('standing — and the entry just above you', () => {
  const build = (): ReturnType<typeof sectionOf> => {
    let b = BOARD;
    for (const [p, t] of [['aa', 4000], ['bb', 5000], ['cc', 6000]] as const) {
      b = place(b, entry({ player: p, ticks: t }), 'x').board;
    }
    return sectionOf(b, 3, 'human');
  };

  it('gives the slowest entry that is still faster than yours', () => {
    const s = standing(build(), 'cc');
    expect(s.rank).toBe(3);
    expect(s.above?.playerId).toBe('bb');
    expect(s.best?.playerId).toBe('aa');
  });

  it('gives nobody above the leader', () => {
    expect(standing(build(), 'aa').above).toBeNull();
  });

  it('gives the SLOWEST entry on the board to a player with no time', () => {
    // With no time, everybody is ahead of you and the nearest of them is the
    // one you can actually catch. This is the new-player case and it is the
    // right answer rather than a degenerate one.
    const s = standing(build(), 'newcomer');
    expect(s.you).toBeNull();
    expect(s.rank).toBeNull();
    expect(s.above?.playerId).toBe('cc');
  });

  it('has nothing to offer on an empty board', () => {
    expect(standing(sectionOf(BOARD, 3, 'human'), 'aa')).toEqual({
      you: null, rank: null, total: 0, above: null, best: null,
    });
  });
});

describe('identity is the playerId and never the display name', () => {
  it('survives a rename with every entry and PB intact', () => {
    // The invariant a future signup depends on: an account claims a playerId
    // and the rows transfer untouched. Keyed on the name, this same change
    // would fork one player's history into two.
    let b = BOARD;
    let p = emptyPlayer('aa', 'Hexi', 'z');
    const first = entry({ player: 'aa', name: 'Hexi', ticks: 6000, id: 'r1' });
    b = place(b, first, 'x').board;
    p = recordPb(p, BOARD.simHash, first);

    const renamed = entry({ player: 'aa', name: 'somebody else entirely', ticks: 5000, id: 'r2' });
    b = place(b, renamed, 'x').board;
    p = recordPb(p, BOARD.simHash, renamed);

    const section = sectionOf(b, 3, 'human');
    expect(Object.keys(section.best)).toEqual(['aa']);
    expect(section.best.aa.timeTicks).toBe(5000);
    expect(section.best.aa.name).toBe('somebody else entirely');
    expect(section.accepted).toBe(2);
    expect(p.playerId).toBe('aa');
    expect(p.name).toBe('somebody else entirely');
    expect(p.pbs[BOARD.simHash][revKey(3)].human.timeTicks).toBe(5000);
  });

  it('does not merge two players who chose the same name', () => {
    let b = place(BOARD, entry({ player: 'aa', name: 'hexi', ticks: 6000 }), 'x').board;
    b = place(b, entry({ player: 'bb', name: 'hexi', ticks: 5000 }), 'x').board;
    const s = sectionOf(b, 3, 'human');
    expect(Object.keys(s.best).sort()).toEqual(['aa', 'bb']);
    expect(standing(s, 'aa').rank).toBe(2);
    expect(standing(s, 'bb').rank).toBe(1);
  });

  it('ships an unused claimedBy slot and no email field', () => {
    const p = emptyPlayer('aa', 'Hexi', 'z');
    expect(p.claimedBy).toBeNull();
    expect(Object.keys(p)).not.toContain('email');
  });
});

describe('recordPb', () => {
  it('keeps the best per level, per rev, per category', () => {
    let p = emptyPlayer('aa', 'Hexi', 'z');
    p = recordPb(p, 'lvl1', entry({ player: 'aa', ticks: 6000 }));
    p = recordPb(p, 'lvl1', entry({ player: 'aa', ticks: 7000 }));
    p = recordPb(p, 'lvl1', entry({ player: 'aa', ticks: 3000, cat: 'tas' }));
    p = recordPb(p, 'lvl1', entry({ player: 'aa', ticks: 100, rev: 2 }));
    expect(p.pbs.lvl1[revKey(3)].human.timeTicks).toBe(6000);
    expect(p.pbs.lvl1[revKey(3)].tas.timeTicks).toBe(3000);
    expect(p.pbs.lvl1[revKey(2)].human.timeTicks).toBe(100);
  });
});
