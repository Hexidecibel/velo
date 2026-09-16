// Ghosts, in plain node. No DOM: a ghost is two sims and an index, and
// `interpolate` is arithmetic — the drawing happens elsewhere and is not what
// could be wrong here.
import { describe, expect, it } from 'vitest';
import { createSim } from '@/sim/sim.ts';
import { buildReplay, decodeInputs } from '@/sim/replay.ts';
import type { Replay } from '@/sim/replay.ts';
import { SIM_REV } from '@/sim/rev.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { parseLevel } from '@/sim/level.ts';
import { cloneSpec, DEFAULT_SPEC } from '@/sim/spec.ts';
import { IN_LEAN_R, IN_THROTTLE } from '@/sim/consts.ts';
import { canWatchLine, chooseGhost, createGhost, ghostCompat, ghostNoteFor, GHOST_KINDS } from './ghost.ts';
import type { Standing } from './ghost.ts';

const LEVEL = parseLevel(TEST_LEVEL);
const SPEC = cloneSpec(DEFAULT_SPEC);
const HASH_EVERY = 32;

/** A short, real run: throttle with a lean, recorded exactly as the client does. */
function record(frames: number): Replay {
  const sim = createSim(LEVEL, SPEC);
  const masks: number[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < frames; i++) {
    const mask = IN_THROTTLE | (i % 16 < 4 ? IN_LEAN_R : 0);
    sim.advance(mask);
    masks.push(mask);
    if (masks.length % HASH_EVERY === 0) hashes.push(sim.hash());
  }
  return buildReplay({ level: LEVEL, spec: SPEC, masks, hashEvery: HASH_EVERY, hashes, state: sim.state });
}

const REPLAY = record(200);

const meta = { kind: 'above' as const, name: 'Somebody', replayId: 'ab12cd34ef567890', rank: 2 };

describe('ghostCompat', () => {
  it('accepts a matching replay', () => {
    expect(ghostCompat(LEVEL, SPEC, REPLAY).ok).toBe(true);
  });

  it('REFUSES a replay from another sim rev, and says why', () => {
    // The failure the whole rev mechanism exists to prevent: playing rev-2
    // inputs under rev-3 physics draws a line nobody rode, with somebody's name
    // and time on it. An empty screen is better than that.
    const r = ghostCompat(LEVEL, SPEC, { ...REPLAY, simRev: SIM_REV - 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/sim rev/);
    expect(r.reason).toMatch(/cannot be shown/);
  });

  it('refuses a replay for another level', () => {
    expect(ghostCompat(LEVEL, SPEC, { ...REPLAY, simHash: 'ffffffffffffffff' }).ok).toBe(false);
  });

  it('refuses a replay recorded on another bike', () => {
    const r = ghostCompat(LEVEL, SPEC, { ...REPLAY, specHash: 'ffffffffffffffff' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/bike spec/);
  });

  it('createGhost throws rather than drawing something wrong', () => {
    expect(() => createGhost(LEVEL, SPEC, { ...REPLAY, simRev: 99 }, meta)).toThrow(/sim rev/);
  });
});

describe('a ghost is a second, independent sim', () => {
  it('CANNOT affect the player\'s run — the hash chains are identical', () => {
    // The assertion the ghost feature stands on. Two runs of the same input
    // stream: one alone, one with a ghost stepped alongside it frame for frame.
    // Every periodic state hash must agree, and so must the final one. If a
    // ghost could ever touch the player's state, this is what would catch it.
    const masks = decodeInputs(REPLAY.inputs);

    const alone = createSim(LEVEL, SPEC);
    const aloneHashes: string[] = [];
    for (let i = 0; i < masks.length; i++) {
      alone.advance(masks[i]);
      aloneHashes.push(alone.hash());
    }

    const withGhost = createSim(LEVEL, SPEC);
    const ghost = createGhost(LEVEL, SPEC, REPLAY, meta);
    const ghostedHashes: string[] = [];
    for (let i = 0; i < masks.length; i++) {
      withGhost.advance(masks[i]);
      ghost.advance();
      ghostedHashes.push(withGhost.hash());
    }

    expect(ghostedHashes).toEqual(aloneHashes);
    expect(withGhost.hash()).toBe(alone.hash());
  });

  it('does not share the spec object the player is riding', () => {
    // `createWorld` clones the spec, so mutating the ghost's cannot reach the
    // player's bike. Checked rather than assumed, because the day somebody
    // "optimises away" that clone, this is the test that fails.
    const spec = cloneSpec(DEFAULT_SPEC);
    const player = createSim(LEVEL, spec);
    const ghost = createGhost(LEVEL, spec, REPLAY, meta);
    expect(ghost).toBeTruthy();
    expect(player.world.spec).not.toBe(spec);
  });

  it('reproduces the recorded run exactly', () => {
    const ghost = createGhost(LEVEL, SPEC, REPLAY, meta);
    while (!ghost.done) ghost.advance();
    const straight = createSim(LEVEL, SPEC);
    for (const m of decodeInputs(REPLAY.inputs)) straight.advance(m);
    expect(ghost.x).toBe(straight.state.px);
    expect(ghost.y).toBe(straight.state.py);
  });
});

describe('lifecycle', () => {
  it('stops at its last frame rather than vanishing or looping', () => {
    const ghost = createGhost(LEVEL, SPEC, REPLAY, meta);
    for (let i = 0; i < REPLAY.frames + 50; i++) ghost.advance();
    expect(ghost.at).toBe(REPLAY.frames);
    expect(ghost.done).toBe(true);
    const x = ghost.x;
    ghost.advance();
    expect(ghost.x).toBe(x);
  });

  it('restarts with the player, back to the start line', () => {
    const ghost = createGhost(LEVEL, SPEC, REPLAY, meta);
    for (let i = 0; i < 60; i++) ghost.advance();
    const mid = ghost.x;
    ghost.reset();
    expect(ghost.at).toBe(0);
    expect(ghost.done).toBe(false);
    expect(ghost.x).toBe(LEVEL.start.x);
    // And it plays the same run again, not a different one.
    for (let i = 0; i < 60; i++) ghost.advance();
    expect(ghost.x).toBe(mid);
  });

  it('gives a pose that is pinned once it is done', () => {
    const ghost = createGhost(LEVEL, SPEC, REPLAY, meta);
    while (!ghost.done) ghost.advance();
    expect(ghost.pose(0).px).toBe(ghost.pose(1).px);
  });

  it('carries its OWN facing, not the player\'s', () => {
    const ghost = createGhost(LEVEL, SPEC, REPLAY, meta);
    expect(ghost.facing === 1 || ghost.facing === -1).toBe(true);
  });
});

describe('chooseGhost', () => {
  const entry = (playerId: string, ticks: number): { replayId: string; name: string; timeTicks: number; playerId: string } => ({
    replayId: `${playerId}00000000000`.slice(0, 16),
    name: playerId,
    timeTicks: ticks,
    playerId,
  });

  const human: Standing = { above: entry('bb', 4000), you: entry('cc', 5000), best: entry('aa', 3000), rank: 3, total: 9 };
  const empty: Standing = { above: null, you: null, best: null, rank: null, total: 0 };

  it('defaults to the run just above you', () => {
    const r = chooseGhost('above', { human });
    expect(r.kind).toBe('above');
    expect(r.entry?.playerId).toBe('bb');
    expect(r.rank).toBe(2);
  });

  it('falls back to your own PB when nobody is above you', () => {
    const r = chooseGhost('above', { human: { ...human, above: null, rank: 1 } });
    expect(r.kind).toBe('pb');
    expect(r.entry?.playerId).toBe('cc');
  });

  it('does NOT fall back to the world record', () => {
    // Silently showing somebody a record forty seconds faster than anything
    // they have ridden is discouraging, not motivating. It stays available in
    // the selector and is never chosen for you.
    const r = chooseGhost('above', { human: { ...empty, best: entry('aa', 3000) } });
    expect(r.entry).toBeNull();
  });

  it('honours an explicit pick', () => {
    expect(chooseGhost('wr', { human }).entry?.playerId).toBe('aa');
    expect(chooseGhost('pb', { human }).entry?.playerId).toBe('cc');
    expect(chooseGhost('off', { human }).entry).toBeNull();
  });

  it('offers exactly the four kinds the UI lists, and none of them is TAS', () => {
    expect(GHOST_KINDS).toEqual(['off', 'above', 'pb', 'wr']);
    expect(GHOST_KINDS).not.toContain('tas');
  });

  it('survives a board that has not arrived', () => {
    expect(chooseGhost('above', { human: null }).entry).toBeNull();
    expect(chooseGhost('wr', { human: null, tas: human }).entry).toBeNull();
  });
});

describe('a machine run is never a ghost', () => {
  // THE RULE, asserted directly rather than implied by a missing parameter.
  //
  // Route choice is this game's depth — apples come in any order and the orders
  // differ. A TAS entry is the output of a search over exactly that space, so
  // watching its line does not merely discourage, it deletes the puzzle for
  // good. 13 of the 20 shipped levels currently have a TAS entry and no human
  // one, which is precisely the situation a "fall back to whatever exists"
  // policy would turn into a walkthrough.
  const tasEntry = { replayId: 'tas0000000000000', name: 'the pilot', timeTicks: 1000, playerId: 'velobot0000' };
  const tas: Standing = { above: tasEntry, you: null, best: tasEntry, rank: null, total: 1 };
  const empty: Standing = { above: null, you: null, best: null, rank: null, total: 0 };

  it('shows NO ghost on a level with a TAS entry and no human entry', () => {
    for (const kind of GHOST_KINDS) {
      expect(chooseGhost(kind, { human: empty, tas }).entry).toBeNull();
    }
  });

  it('says "be the first" rather than naming what is being withheld', () => {
    const pick = chooseGhost('above', { human: empty, tas });
    const note = ghostNoteFor('above', pick, { human: empty, tas });
    expect(note).toMatch(/be the first/);
    // A note that explains a machine run is being held back IS the hint. The
    // absence has to be a plain absence.
    expect(note.toLowerCase()).not.toMatch(/tas|solver|machine|bot/);
  });

  it('says nothing at all when the player asked for no ghost', () => {
    const pick = chooseGhost('off', { human: empty, tas });
    expect(ghostNoteFor('off', pick, { human: empty, tas })).toBe('');
  });

  it('names the missing kind when the board is not empty', () => {
    const human: Standing = { above: null, you: null, best: null, rank: null, total: 4 };
    const pick = chooseGhost('pb', { human, tas });
    expect(ghostNoteFor('pb', pick, { human, tas })).toMatch(/personal best/);
  });
});

describe('canWatchLine', () => {
  it('always allows a human line', () => {
    expect(canWatchLine('human', false)).toBe(true);
    expect(canWatchLine('human', true)).toBe(true);
  });

  it('allows a TAS line only after you have finished the level yourself', () => {
    // Before: a walkthrough nobody asked for. After: a reward, and a good way
    // to find out what you left on the table.
    expect(canWatchLine('tas', false)).toBe(false);
    expect(canWatchLine('tas', true)).toBe(true);
  });
});
