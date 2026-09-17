// The montage, in plain node. No DOM, by house rule and because the DOM is not
// what could be wrong here.
//
// What could be wrong is all selection and arithmetic: the winning line evicted
// by its own cap, a run from another sim rev quietly drawn as if it were yours,
// forty bikes composited into an opaque block that the winner cannot read
// against, a cull that hides a rider who is on screen. Every one of those is
// decidable from plain objects, and every one of them would be invisible in a
// screenshot until somebody who knew the level looked at it.
import { describe, expect, it } from 'vitest';
import { createSim } from '@/sim/sim.ts';
import { buildReplay, decodeInputs, verifyReplay } from '@/sim/replay.ts';
import type { Replay } from '@/sim/replay.ts';
import { SIM_REV } from '@/sim/rev.ts';
import { TEST_LEVEL } from '@/sim/testlevel.ts';
import { parseLevel } from '@/sim/level.ts';
import { cloneSpec, DEFAULT_SPEC, specHash } from '@/sim/spec.ts';
import { IN_LEAN_R, IN_THROTTLE } from '@/sim/consts.ts';
import { createRider } from './ghost.ts';
import { createAttemptLog } from './recorder.ts';
import type { Attempt, AttemptLog } from './recorder.ts';
import {
  MONTAGE_ALPHA_MAX,
  MONTAGE_ALPHA_MIN,
  MONTAGE_CAP,
  montageAlpha,
  montageLabel,
  selectMontage,
  visibleRiders,
} from './montage.ts';

const LEVEL = parseLevel(TEST_LEVEL);
const SPEC = cloneSpec(DEFAULT_SPEC);
const SPEC_HASH = specHash(SPEC);
const HASH_EVERY = 32;

/** A short, real run, recorded exactly the way the client records one. */
function record(frames: number, seed = 0): Replay {
  const sim = createSim(LEVEL, SPEC);
  const masks: number[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < frames; i++) {
    const mask = IN_THROTTLE | ((i + seed) % 16 < 4 ? IN_LEAN_R : 0);
    sim.advance(mask);
    masks.push(mask);
    if (masks.length % HASH_EVERY === 0) hashes.push(sim.hash());
  }
  return buildReplay({ level: LEVEL, spec: SPEC, masks, hashEvery: HASH_EVERY, hashes, state: sim.state });
}

/** A replay that is only a shape — enough for selection, which reads no physics. */
function fake(over: Partial<Replay> = {}): Replay {
  return {
    format: 'velo-replay',
    simRev: SIM_REV,
    simHash: LEVEL.simHash,
    bike: 'default',
    specHash: SPEC_HASH,
    frames: 100,
    inputs: '1*100',
    hashEvery: HASH_EVERY,
    hashes: [],
    finished: false,
    dead: true,
    timeTicks: 400,
    applesLeft: 1,
    ...over,
  };
}

function logOf(replays: Replay[]): AttemptLog {
  const log = createAttemptLog();
  for (const r of replays) log.add(r);
  return log;
}

const query = (winner: Replay | null = null, cap?: number) => ({
  simHash: LEVEL.simHash,
  specHash: SPEC_HASH,
  winner,
  cap,
});

describe('selectMontage', () => {
  it('takes every attempt on this level and none from another', () => {
    const mine = [fake(), fake(), fake()];
    const theirs = fake({ simHash: 'ffffffffffffffff' });
    const sel = selectMontage(logOf([...mine, theirs]).all, query());
    expect(sel.picks).toHaveLength(3);
    expect(sel.total).toBe(3);
  });

  it('PREFERS THE MOST RECENT and says how many it left out', () => {
    // Recency is the right bias and not an arbitrary one: the last attempts are
    // the ones on the part of the level that was actually hard. The first ten
    // are you learning the ramp exists, and they all die in the same
    // uninteresting place.
    const all = Array.from({ length: 10 }, (_, i) => fake({ timeTicks: i }));
    const sel = selectMontage(logOf(all).all, query(null, 4));
    expect(sel.picks.map((p) => p.replay.timeTicks)).toEqual([6, 7, 8, 9]);
    expect(sel.dropped).toBe(6);
    expect(sel.total).toBe(10);
  });

  it('KEEPS THE WINNER WHATEVER THE CAP SAYS', () => {
    // A montage without the line that worked is a pile of failures. The winner
    // is the oldest thing in this log and the cap is one, so an eviction by
    // recency would drop exactly the run the whole picture is told against.
    const winner = fake({ finished: true, dead: false, timeTicks: 1 });
    const all = [winner, ...Array.from({ length: 9 }, () => fake())];
    const sel = selectMontage(logOf(all).all, query(winner, 1));
    expect(sel.picks).toHaveLength(1);
    expect(sel.picks[0].winner).toBe(true);
    expect(sel.picks[0].replay).toBe(winner);
  });

  it('puts the winner last, so it is drawn over the failures', () => {
    const winner = fake({ finished: true, dead: false });
    const sel = selectMontage(logOf([fake(), winner, fake()]).all, query(winner));
    expect(sel.picks.map((p) => p.winner)).toEqual([false, false, true]);
  });

  it('marks exactly one winner, and none at all outside a finish', () => {
    const winner = fake({ finished: true, dead: false });
    expect(selectMontage(logOf([fake(), winner]).all, query(winner)).picks.filter((p) => p.winner)).toHaveLength(1);
    expect(selectMontage(logOf([fake(), winner]).all, query(null)).picks.filter((p) => p.winner)).toHaveLength(0);
  });

  it('REFUSES a run from another sim rev, and counts it rather than hiding it', () => {
    // The same rule the leaderboard ghost runs under, for the same reason:
    // replaying those inputs under this build's physics would draw a line
    // nobody rode. Counting it is what lets the client explain an empty
    // montage instead of shrugging at one.
    const sel = selectMontage(logOf([fake(), fake({ simRev: SIM_REV - 1 })]).all, query());
    expect(sel.picks).toHaveLength(1);
    expect(sel.incompatible).toBe(1);
  });

  it('refuses a run recorded on another bike', () => {
    const sel = selectMontage(logOf([fake({ specHash: 'ffffffffffffffff' })]).all, query());
    expect(sel.picks).toHaveLength(0);
    expect(sel.incompatible).toBe(1);
  });

  it('skips an empty stream without counting it as incompatible', () => {
    const sel = selectMontage(logOf([fake({ frames: 0, inputs: '' })]).all, query());
    expect(sel.picks).toHaveLength(0);
    expect(sel.incompatible).toBe(0);
  });

  it('counts the three outcomes, because the mix is the caption', () => {
    const log = createAttemptLog();
    log.add(fake({ dead: true }));
    log.add(fake({ dead: false, finished: false }));
    log.add(fake({ dead: false, finished: true }));
    const sel = selectMontage(log.all, query());
    expect(sel.deaths).toBe(1);
    expect(sel.abandoned).toBe(1);
    expect(sel.finishes).toBe(1);
    expect(montageLabel(sel)).toBe('3 attempts (1 dead, 1 given up on, 1 finished)');
  });

  it('defaults to the measured cap rather than to everything ever ridden', () => {
    const all = Array.from({ length: MONTAGE_CAP + 25 }, () => fake());
    expect(selectMontage(logOf(all).all, query()).picks).toHaveLength(MONTAGE_CAP);
  });
});

describe('montageAlpha', () => {
  it('matches the single ghost at the low end — one idiom, not two', () => {
    expect(montageAlpha(1)).toBe(MONTAGE_ALPHA_MAX);
    expect(montageAlpha(0)).toBe(MONTAGE_ALPHA_MAX);
  });

  it('FADES AS THE CROWD GROWS, so the winning line still reads', () => {
    // Alpha composites. Forty bikes at 0.3 stacked on the same three metres of
    // a hard section is an opaque block, and the winner then reads against a
    // wall rather than against a crowd.
    expect(montageAlpha(40)).toBeLessThan(montageAlpha(10));
    expect(montageAlpha(10)).toBeLessThan(montageAlpha(4));
  });

  it('never fades to nothing — a lone rider at the far end is still a rider', () => {
    for (const n of [1, 2, 8, 40, 200, 5000]) {
      expect(montageAlpha(n)).toBeGreaterThanOrEqual(MONTAGE_ALPHA_MIN);
      expect(montageAlpha(n)).toBeLessThanOrEqual(MONTAGE_ALPHA_MAX);
    }
  });
});

describe('visibleRiders', () => {
  const view = { x: 0, y: 0, halfW: 10, halfH: 5 };

  it('keeps what is on screen and drops what is not', () => {
    const riders = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: -40 }, { x: -9, y: 4 }];
    expect(visibleRiders(riders, view)).toEqual([0, 3]);
  });

  it('is GENEROUS at the edge, because a bike is drawn from its middle', () => {
    // 1.7 m of bike hangs off a chassis centre. A cull tight to the frame would
    // pop a rider's wheels out of existence a metre before the rider.
    expect(visibleRiders([{ x: 11, y: 0 }], view)).toEqual([0]);
    expect(visibleRiders([{ x: 11, y: 0 }], view, 0)).toEqual([]);
  });

  it('returns indices into the original list, not a filtered copy', () => {
    // The caller reads facing and pose off the SAME rider it culled on. An
    // index that had been renumbered would pose the wrong bike, which looks
    // like a physics bug and is not one.
    const riders = [{ x: 99, y: 0 }, { x: 1, y: 1 }];
    expect(visibleRiders(riders, view)).toEqual([1]);
  });
});

describe('a montage rider is a real, independent sim', () => {
  it('reproduces the run it was built from, frame for frame', () => {
    const replay = record(120, 3);
    const masks = decodeInputs(replay.inputs);
    const truth = createSim(LEVEL, SPEC);
    const rider = createRider(LEVEL, SPEC, masks);
    for (let i = 0; i < masks.length; i++) {
      truth.advance(masks[i]);
      rider.advance();
      expect(rider.x).toBe(truth.state.px);
      expect(rider.y).toBe(truth.state.py);
    }
    expect(rider.done).toBe(true);
  });

  it('CANNOT touch the player it rides beside — the hash chains are identical', () => {
    // The assertion the whole feature stands on, made over forty riders rather
    // than one. `createWorld` clones the spec and the level is read-only to
    // everybody, so nothing here can reach the player's bike; this is what
    // keeps that true as the file changes.
    const replay = record(80, 1);
    const masks = decodeInputs(replay.inputs);

    const alone = createSim(LEVEL, SPEC);
    const aloneHashes: string[] = [];
    for (const m of masks) {
      alone.advance(m);
      aloneHashes.push(alone.hash());
    }

    const crowded = createSim(LEVEL, SPEC);
    const riders = Array.from({ length: 40 }, (_, i) =>
      createRider(LEVEL, SPEC, decodeInputs(record(60, i).inputs)),
    );
    const crowdedHashes: string[] = [];
    for (const m of masks) {
      crowded.advance(m);
      for (const r of riders) r.advance();
      crowdedHashes.push(crowded.hash());
    }
    expect(crowdedHashes).toEqual(aloneHashes);
  });

  it('STOPS where it stopped rather than vanishing', () => {
    // The cluster of halted bikes at the hard part IS the story, so a rider
    // past its last frame holds its final pose forever and reports it.
    const rider = createRider(LEVEL, SPEC, decodeInputs(record(40, 7).inputs));
    for (let i = 0; i < 40; i++) rider.advance();
    const at = { x: rider.x, y: rider.y };
    for (let i = 0; i < 500; i++) rider.advance();
    expect(rider.x).toBe(at.x);
    expect(rider.y).toBe(at.y);
    expect(rider.at).toBe(40);
    // And it holds ONE pose rather than interpolating between two — a stopped
    // bike that still shimmered would read as a rendering fault.
    expect(rider.pose(0)).toEqual(rider.pose(0.75));
  });

  it('still verifies as a replay after a montage has ridden it', () => {
    // The compatibility claim in one line: a run shown in the montage is the
    // same bytes the leaderboard would accept, and riding it changed nothing.
    const replay = record(90, 2);
    const rider = createRider(LEVEL, SPEC, decodeInputs(replay.inputs));
    for (let i = 0; i < 200; i++) rider.advance();
    expect(verifyReplay(LEVEL, SPEC, replay).ok).toBe(true);
  });
});

describe('the attempt log the montage reads', () => {
  it('keeps every attempt of the session rather than overwriting', () => {
    // The groundwork the whole feature rests on. If this ever regresses to
    // keeping only the last run, the montage becomes a data-model migration
    // again rather than a rendering job.
    const log = createAttemptLog();
    for (let i = 0; i < 25; i++) log.add(fake({ timeTicks: i }));
    expect(log.forLevel(LEVEL.simHash)).toHaveLength(25);
    expect(log.all.map((a: Attempt) => a.n)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });
});
