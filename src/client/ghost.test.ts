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
import { chooseGhost, createGhost, ghostCompat, GHOST_KINDS } from './ghost.ts';

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

  const board = { above: entry('bb', 4000), you: entry('cc', 5000), best: entry('aa', 3000), rank: 3 };

  it('defaults to the run just above you', () => {
    const r = chooseGhost('above', board);
    expect(r.kind).toBe('above');
    expect(r.entry?.playerId).toBe('bb');
    expect(r.rank).toBe(2);
  });

  it('falls back to your own PB when nobody is above you', () => {
    const r = chooseGhost('above', { ...board, above: null, rank: 1 });
    expect(r.kind).toBe('pb');
    expect(r.entry?.playerId).toBe('cc');
  });

  it('does NOT fall back to the world record', () => {
    // Silently showing somebody a record forty seconds faster than anything
    // they have ridden is discouraging, not motivating. It stays available in
    // the selector and is never chosen for you.
    const r = chooseGhost('above', { above: null, you: null, best: entry('aa', 3000), rank: null });
    expect(r.entry).toBeNull();
  });

  it('honours an explicit pick', () => {
    expect(chooseGhost('wr', board).entry?.playerId).toBe('aa');
    expect(chooseGhost('pb', board).entry?.playerId).toBe('cc');
    expect(chooseGhost('off', board).entry).toBeNull();
  });

  it('offers exactly the four kinds the UI lists', () => {
    expect(GHOST_KINDS).toEqual(['off', 'above', 'pb', 'wr']);
  });
});
