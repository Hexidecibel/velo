// What the end-of-level panel decides to show, in plain node.
//
// No DOM, by house rule and because the DOM is not what could be wrong here. A
// PB delta with its sign backwards, a refusal rendered as a shrug, your own row
// missing because you are outside the top five, an action offered that the key
// handler does not answer — those are the failures, and every one of them is
// decidable from plain objects.
import { describe, expect, it } from 'vitest';
import { INPUT_HZ, TICKS_PER_FRAME } from '@/sim/consts.ts';
import type { BoardEntry, BoardPayload } from './api.ts';
import {
  actionForKey,
  actionsFor,
  boardRows,
  buildResults,
  pbLine,
  standingLine,
  submitMessage,
} from './results.ts';
import type { ResultAction, SubmitState } from './results.ts';

/** One second of run, in the ticks a replay counts in. */
const SEC = INPUT_HZ * TICKS_PER_FRAME;

function entry(playerId: string, name: string, ticks: number): BoardEntry {
  return {
    replayId: `${playerId}0000000000000000`.slice(0, 16),
    playerId,
    name,
    timeTicks: ticks,
    frames: 100,
    simRev: 4,
    specHash: 'aaaaaaaaaaaaaaaa',
    bike: 'default',
    category: 'human',
    at: '2026-09-16T00:00:00.000Z',
  };
}

function board(over: Partial<BoardPayload>): BoardPayload {
  return {
    simHash: 'bbbbbbbbbbbbbbbb',
    rev: 4,
    liveRev: 4,
    category: 'human',
    levelId: '01-first-light',
    levelName: '01 — First Light',
    total: 0,
    accepted: 0,
    top: [],
    you: null,
    rank: null,
    above: null,
    best: null,
    otherRevs: [],
    note: '',
    ...over,
  };
}

describe('versus your best', () => {
  it('calls a first finish a first finish rather than a personal best of nothing', () => {
    const p = pbLine(10 * SEC, null);
    expect(p.kind).toBe('first');
    expect(p.newPb).toBe(true);
    expect(p.text).toMatch(/time to beat/);
  });

  it('signs a faster run NEGATIVE and marks it a PB', () => {
    // The sign is the information. A delta that reads "+1.000s" for a run that
    // was a second quicker is the single most misreadable thing this screen
    // could print.
    const p = pbLine(11 * SEC, 12 * SEC);
    expect(p.kind).toBe('faster');
    expect(p.newPb).toBe(true);
    expect(p.deltaTicks).toBe(-SEC);
    expect(p.text).toMatch(/^-1\.000s on your best of 12\.000s$/);
  });

  it('signs a slower run POSITIVE and does not claim a PB', () => {
    const p = pbLine(13 * SEC, 12 * SEC);
    expect(p.kind).toBe('slower');
    expect(p.newPb).toBe(false);
    expect(p.text).toMatch(/^\+1\.000s off your best of 12\.000s$/);
  });

  it('has a branch for an exact tie', () => {
    // Not hypothetical: input is sampled on a 128 Hz grid, and two clean runs of
    // the same line on an early level tie routinely. Folded into "slower" it
    // would read as a loss.
    const p = pbLine(12 * SEC, 12 * SEC);
    expect(p.kind).toBe('same');
    expect(p.newPb).toBe(false);
    expect(p.text).not.toMatch(/[+-]/);
  });
});

describe('did it post', () => {
  const msg = (s: SubmitState) => submitMessage(s);

  it('resolves rather than hiding: every state says something', () => {
    const kinds: SubmitState['kind'][] = [
      'posting',
      'posted',
      'needs-name',
      'refused',
      'offline',
      'not-posted',
    ];
    for (const kind of kinds) expect(msg({ kind }).text).not.toBe('');
  });

  it('names the rank when it posted', () => {
    expect(msg({ kind: 'posted', rank: 2, total: 2 }).text).toBe('posted — #2 of 2');
  });

  it('explains the shipped-bike refusal AND how to fix it', () => {
    // This exact refusal has confused this user once already. "Not posted: this
    // bike is not the shipped one" is a true sentence that tells you nothing to
    // do, and the panel to reset it is one key away.
    const m = msg({ kind: 'refused', code: 'unknown-bike', reason: 'that run was recorded on bike spec …' });
    expect(m.text).toMatch(/not the shipped one/);
    expect(m.fix).toMatch(/reset spec/);
    expect(m.fix).toMatch(/live tune/);
  });

  it('gives a fix for every refusal a player can act on', () => {
    const fixable = [
      'unknown-bike',
      'sim-rev-mismatch',
      'not-a-finish',
      'verification-failed',
      'rate-limited',
      'busy',
      'timeout',
      'too-large',
      'bad-replay',
      'bad-shape',
      'bad-json',
    ];
    for (const code of fixable) {
      const m = msg({ kind: 'refused', code, reason: 'server said so' });
      expect(m.text.startsWith('not posted:'), code).toBe(true);
      expect(m.fix.length, code).toBeGreaterThan(0);
    }
  });

  it('marks a determinism failure as BAD rather than as a shrug', () => {
    expect(msg({ kind: 'refused', code: 'verification-failed' }).tone).toBe('bad');
    expect(msg({ kind: 'refused', code: 'rate-limited' }).tone).toBe('warn');
  });

  it('falls back to the server\'s own words for a code it has never heard of', () => {
    const m = msg({ kind: 'refused', code: 'invented-later', reason: 'the moon was wrong' });
    expect(m.text).toMatch(/the moon was wrong/);
  });

  it('says the game is unaffected when the server is simply not there', () => {
    const m = msg({ kind: 'offline', reason: 'fetch failed' });
    expect(m.text).toMatch(/offline/);
    expect(m.fix).toMatch(/yours locally/);
  });
});

describe('where you stand', () => {
  it('is null with no board at all, so the panel simply omits the line', () => {
    expect(standingLine(null)).toBeNull();
  });

  it('leads with the gap to the entry above — the number that makes it a race', () => {
    // With a field of two this line IS the screen: "#2 of 2" alone is trivia,
    // and "0.500s behind krrl" is a thing you go and do something about.
    const you = entry('cc', 'Cush', 42 * SEC);
    const above = entry('kk', 'krrl', 41.5 * SEC);
    const s = standingLine(board({ total: 2, rank: 2, you, above, best: above, top: [above, you] }))!;
    expect(s.rank).toBe(2);
    expect(s.gapTicks).toBe(0.5 * SEC);
    expect(s.text).toBe('#2 of 2 — 0.500s behind krrl');
  });

  it('says so plainly when you are top', () => {
    const you = entry('cc', 'Cush', 41 * SEC);
    const s = standingLine(board({ total: 2, rank: 1, you, above: null, best: you, top: [you] }))!;
    expect(s.text).toMatch(/nobody ahead of you/);
    expect(s.gapTicks).toBeNull();
  });

  it('handles an empty board and an unranked player differently', () => {
    expect(standingLine(board({ total: 0 }))!.text).toMatch(/no times/);
    expect(standingLine(board({ total: 3 }))!.text).toMatch(/3 ahead of you/);
  });
});

describe('the compact board', () => {
  const rows = [
    entry('aa', 'krrl', 40 * SEC),
    entry('bb', 'Cush', 41 * SEC),
    entry('cc', 'c', 42 * SEC),
    entry('dd', 'd', 43 * SEC),
    entry('ee', 'e', 44 * SEC),
    entry('ff', 'f', 45 * SEC),
  ];

  it('marks your row in place when you are inside the slice', () => {
    const out = boardRows(board({ top: rows, total: 6, rank: 2, you: rows[1] }), 'bb', 5);
    expect(out).toHaveLength(5);
    expect(out.filter((r) => r.you)).toHaveLength(1);
    expect(out.find((r) => r.you)!.rank).toBe(2);
    expect(out.every((r) => !r.detached)).toBe(true);
  });

  it('appends your row, marked detached, when you are outside it', () => {
    // Being outside the top N is the common case for a new player and it is
    // exactly when a board most needs to say something. Dropping the row makes
    // the screen a list of strangers.
    const you = entry('zz', 'newcomer', 90 * SEC);
    const out = boardRows(board({ top: rows, total: 12, rank: 12, you }), 'zz', 5);
    expect(out).toHaveLength(6);
    const mine = out[out.length - 1];
    expect(mine.you).toBe(true);
    expect(mine.detached).toBe(true);
    expect(mine.rank).toBe(12);
  });

  it('is empty rather than throwing when there is no server', () => {
    expect(boardRows(null, 'zz', 5)).toEqual([]);
  });
});

describe('the actions', () => {
  const base = {
    nextLabel: '02 — The Long Climb',
    canWatchRun: true,
    ghostName: 'krrl' as string | null,
    montageCount: null as number | null,
  };

  it('puts next level first and makes it the one and only primary', () => {
    // The rule the whole screen serves: the fastest path back into the game is
    // the default. Enter goes onward.
    const acts = actionsFor(base);
    expect(acts[0].id).toBe('next');
    expect(acts[0].key).toBe('Enter');
    expect(acts.filter((a) => a.primary)).toHaveLength(1);
  });

  it('puts retry second, on R', () => {
    const acts = actionsFor(base);
    expect(acts[1].id).toBe('retry');
    expect(acts[1].key).toBe('R');
  });

  it('always offers a way out, even on a one-level build with nothing banked', () => {
    const acts = actionsFor({ nextLabel: null, canWatchRun: false, ghostName: null, montageCount: null });
    expect(acts.map((a) => a.id)).toEqual(['retry', 'board', 'levels', 'dismiss']);
  });

  it('NEVER offers a TAS line — not locked, not unlockable, absent', () => {
    // This test used to assert a gate ("locked until you finish the level").
    // The gate is gone and so is the action, because a gate keeps the thing it
    // gates: route choice is this game's depth and a searched optimal line
    // deletes the puzzle permanently. A time is information; a line is a
    // solution. The panel still PRINTS the TAS time — see `the whole model`.
    //
    // There is no input to this function that can bring it back, which is the
    // point: `ActionInput` has no TAS field at all, so the assertion is over
    // every possible call rather than over a chosen one.
    for (const a of [
      base,
      { ...base, ghostName: null },
      { nextLabel: null, canWatchRun: false, ghostName: null, montageCount: null },
    ]) {
      const acts = actionsFor(a);
      expect(JSON.stringify(acts)).not.toMatch(/tas/i);
      expect(acts.every((x) => x.key !== 'C')).toBe(true);
    }
  });

  it('OFFERS the montage rather than forcing it, below retry, on its own key', () => {
    // The screen's standing rule: the fastest path back into the game is the
    // default. The montage is a reward, so it is an action you choose — never
    // something that plays at you before you can hit Enter — and it must not
    // displace `next` or `retry` at the top of the list.
    const acts = actionsFor({ ...base, montageCount: 37 });
    const m = acts.find((a) => a.id === 'montage')!;
    expect(m.key).toBe('A');
    expect(m.primary).toBe(false);
    expect(m.label).toBe('watch all 37 attempts at once');
    expect(acts.findIndex((a) => a.id === 'montage')).toBeGreaterThan(
      acts.findIndex((a) => a.id === 'retry'),
    );
    expect(acts[0].id).toBe('next');
  });

  it('does not offer a montage of one attempt, or of none', () => {
    for (const n of [null, 0, 1]) {
      expect(actionsFor({ ...base, montageCount: n }).some((a) => a.id === 'montage')).toBe(false);
    }
  });

  it('binds A to the montage only when the montage is on the panel', () => {
    expect(actionForKey('KeyA', actionsFor({ ...base, montageCount: 4 }))).toBe('montage');
    expect(actionForKey('KeyA', actionsFor(base))).toBe(null);
  });

  it('names the ghost it offers, so "watch" is not a guess', () => {
    expect(actionsFor(base).find((a) => a.id === 'watchGhost')!.label).toBe("watch krrl's run");
  });

  describe('key bindings', () => {
    const acts = actionsFor(base);

    it('binds Enter to next and Escape to dismissal', () => {
      expect(actionForKey('Enter', acts)).toBe('next');
      expect(actionForKey('NumpadEnter', acts)).toBe('next');
      expect(actionForKey('Escape', acts)).toBe('dismiss');
    });

    it('answers R whatever else is on the panel', () => {
      // R is the key this game is played with. It is the one binding the results
      // screen may not make conditional on anything.
      for (const set of [acts, actionsFor({ nextLabel: null, canWatchRun: false, ghostName: null, montageCount: null })]) {
        expect(actionForKey('KeyR', set)).toBe('retry');
      }
    });

    it('answers exactly the keys it prints, and no others', () => {
      const printed = new Map<string, ResultAction>(acts.map((a) => [a.key, a]));
      const codes: Record<string, string> = {
        Enter: 'Enter',
        KeyR: 'R',
        KeyT: 'T',
        KeyG: 'G',
        KeyB: 'B',
        KeyL: 'L',
        Escape: 'Esc',
      };
      for (const [code, key] of Object.entries(codes)) {
        expect(actionForKey(code, acts), code).toBe(printed.get(key)!.id);
      }
    });

    it('does not answer a key for an action that is not offered', () => {
      // G is the collision-debug toggle in play. It may only be stolen while the
      // panel is actually showing a ghost to watch.
      const noGhost = actionsFor({ ...base, ghostName: null });
      expect(actionForKey('KeyG', noGhost)).toBeNull();
      expect(actionForKey('KeyX', acts)).toBeNull();
    });

    it('does not bind C at all — the key the TAS line used to live on is free', () => {
      // Asserted on a FULL action list, not a stripped one: the claim is that
      // the binding is gone from the switch, not that this particular panel
      // happens not to be offering it.
      expect(actionForKey('KeyC', acts)).toBeNull();
    });
  });
});

describe('the whole model', () => {
  const input = {
    levelName: '13 — Reservoir',
    timeTicks: 42 * SEC,
    applesTaken: 7,
    applesTotal: 7,
    previousBestTicks: 43 * SEC,
    submit: { kind: 'posting' } as SubmitState,
    board: null,
    tasTimeTicks: null as number | null,
    playerId: 'cc',
    rowLimit: 5,
    actions: { nextLabel: null, canWatchRun: true, ghostName: null, montageCount: null },
  };

  it('is complete with NO SERVER: the summary and the actions both survive it', () => {
    // The game works offline and times bank locally. The panel must show the
    // summary and the way onward rather than erroring or waiting on a fetch.
    const m = buildResults(input);
    expect(m.time).toBe('42.000');
    expect(m.apples).toBe('7/7');
    expect(m.pb.newPb).toBe(true);
    expect(m.standing).toBeNull();
    expect(m.rows).toEqual([]);
    expect(m.tasTime).toBeNull();
    expect(m.actions.some((a) => a.id === 'retry')).toBe(true);
  });

  it('shows a TAS TIME and offers no way whatsoever to play its line', () => {
    // The whole of what survives the removal, asserted in one place: the time is
    // information and proves the level is completable — which has already
    // mattered twice here — while the line is the answer to the level and is
    // not reachable from this screen on any condition.
    const m = buildResults({ ...input, tasTimeTicks: 38 * SEC });
    expect(m.tasTime).toBe('38.000');
    expect(JSON.stringify(m.actions)).not.toMatch(/tas/i);
  });
});
