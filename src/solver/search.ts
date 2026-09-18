// The search.
//
// Two previous attempts at this are on the record and both failed the same way,
// so the design starts from why:
//
//   * "a coarse dedupe grid collapsed the frontier onto 'do nothing' and it
//     never left the start line" — the dedupe key was POSITION only, so a
//     stationary bike and a bike doing 12 m/s through the same square were the
//     same node, and the stationary one always got there first.
//   * "a top-N-by-x beam filled with the fastest states, which all crashed into
//     the same wall" — one scalar of selection pressure, and the beam converged
//     on a single doomed situation.
//
// Both are the same mistake: SELECTION ON A SINGLE SCALAR DESTROYS THE
// DIVERSITY A SEARCH NEEDS. So there is no beam here and no truncation at all.
// The frontier is a priority queue, and the only thing ever discarded is a node
// that another node ALREADY DOMINATES in a state cell that includes position,
// velocity, chassis attitude, rider-arm attitude, contact state, facing and the
// set of apples collected. Two states share a cell only when they are
// genuinely the same situation; a slow one and a fast one never do.
//
// Three other decisions carry the tractability:
//
//   MACRO-ACTIONS. Five buttons at 128 Hz is 32 branches per input frame and
//   hopeless. Humans hold inputs for tenths of a second, so the search branches
//   over (held mask, duration) pairs instead. The side effect is the good part:
//   the streams it produces look like somebody playing rather than like noise,
//   and they replay legibly.
//
//   SHARED PREFIXES. The durations are nested — 3, 8, 18, 40 frames — so one
//   simulation of the longest duration emits all four children at its
//   checkpoints. Four nodes for the price of one, exactly.
//
//   THE INPUT FRAME IS THE UNIT. `advance(mask)` is the only way time moves
//   here. `stepTick` is never reached past the sim's own door, which is what
//   structurally guarantees that anything found is expressible as a replay.
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '@/sim/consts.ts';
import type { Sim } from '@/sim/sim.ts';
import type { SimState } from '@/sim/step.ts';
import { Heap } from './heap.ts';
import { StatePool, OFF_PX, OFF_PY, OFF_VX, OFF_VY } from './pack.ts';

/**
 * The held-mask alphabet. Lean-left and lean-right together are a no-op in the
 * sim (`leanL !== leanR`), so that pair is absent rather than wasted.
 */
export const HELD_MASKS: readonly number[] = [
  0,
  IN_THROTTLE,
  IN_BRAKE,
  IN_LEAN_L,
  IN_LEAN_R,
  IN_THROTTLE | IN_LEAN_L,
  IN_THROTTLE | IN_LEAN_R,
  IN_BRAKE | IN_LEAN_L,
  IN_BRAKE | IN_LEAN_R,
];

/**
 * Masks that also get a flip-on-the-first-frame variant. Flip is free, legal
 * mid-air and edge-triggered, so it costs one frame of the held mask and
 * nothing else — but giving EVERY held mask a flip twin would nearly double the
 * branching for a control whose only job is choosing which end is the nose.
 * These four cover "turn round and go", "turn round and coast", and the two
 * lean-while-turning combinations that set up a landing.
 */
export const FLIP_MASKS: readonly number[] = [0, IN_THROTTLE, IN_THROTTLE | IN_LEAN_L, IN_THROTTLE | IN_LEAN_R];

/**
 * Nested so one simulation emits all four children. Frames at 128 Hz, so this
 * spans 16 ms to 310 ms of held input.
 *
 * BOTH ENDS ARE LOAD-BEARING and they pull against each other, which is why the
 * list is wide rather than tight:
 *
 *   The short end decides what can be TIMED. With a 3-frame floor the search
 *   could not clear the 8 m gap on 13-reservoir; with a 2-frame floor it can. A
 *   take-off that has to be hit within 16 ms is findable and one that has to be
 *   hit within 23 ms is not.
 *
 *   The long end decides how far a node REACHES. Capping at 24 frames made the
 *   search cover ground so slowly that 09-runaway — a 250 m level it used to
 *   solve in half a minute — stopped finishing at all inside two and a half.
 *
 * Nesting is what makes having both cheap: one 40-frame rollout emits all four
 * children, so the fine resolution costs one extra node per mask and not an
 * extra rollout.
 */
export const DURATIONS: readonly number[] = [2, 6, 16, 40];

export interface SearchOpts {
  /** Node expansions before the search gives up. */
  budget: number;
  /** Absolute `Date.now()` past which it stops, whatever the budget says. */
  deadline: number;
  /** Cost is `g + hWeight * h`, both in input frames. Above 1 = weighted A*. */
  hWeight: number;
  /**
   * Input frames of priority credit per m/s of CLOSING SPEED — how fast the
   * node is eating route distance, measured against its own parent.
   *
   * It exists for jumps. A gap that has to be cleared at a particular speed is
   * a question about the run-up, and both of the obvious priorities get it
   * wrong: a greedy weight prefers the state nearer the far lip to the state
   * that will still be moving when it arrives, and plain Dijkstra explores
   * every way of being slow first. Crediting momentum says "keep carrying
   * speed" in the only currency the frontier understands.
   *
   * Zero disables it and the search is a plain weighted A*.
   */
  speedBonus: number;
  /** Metres per second the heuristic assumes, converting distance to frames. */
  vref: number;
  /** Input frames a single run may last before a node is abandoned. */
  maxFrames: number;
  /** Dedupe cell size: metres, m/s, chassis sectors, arm sectors. */
  cellXY: number;
  cellV: number;
  attSectors: number;
  armSectors: number;
  /** Stop this many expansions after the first goal, to gather alternatives. */
  goalExtra: number;
  /**
   * Input frames a goal state must be able to survive before it counts. 0
   * disables the check.
   *
   * It is a PREFERENCE, not a veto: if a search finds only goals nothing simple
   * survives, it returns those rather than reporting failure. A veto here is
   * how a low-ceiling level becomes unsolvable — every arrival under a roof
   * fails a probe that does not know the one input that gets you out.
   *
   * WITHOUT THIS THE SOLVER LIES TO ITSELF. Reaching an apple is satisfied by
   * ANY part of the bike touching it, including the rider's head on the way
   * round a backflip — and the fastest way to touch an apple a metre off the
   * floor turns out to be exactly that. The search duly "reached" it, handed
   * the next segment four arrival states that were each a tenth of a second
   * from planting the head, and every one of them died within two expansions.
   * The frontier emptied and the level was reported uncompletable.
   *
   * So a goal only counts if SOME simple continuation survives it. It does not
   * have to be the continuation that gets used — this is a viability filter,
   * not a plan — it only has to prove the arrival is a situation a rider could
   * still be riding out of.
   */
  survivalFrames: number;
  /** Stop once this many goal states are in hand. */
  goalsWanted: number;
  /**
   * Total-run frame ceiling. A node is discarded when the most optimistic
   * completion reachable through it is no faster than this.
   *
   * THIS IS WHAT MAKES OPTIMISING AFFORDABLE. Searching for a *fast* line
   * rather than *a* line means a near-Dijkstra weight, and a near-Dijkstra
   * weight over this branching factor is hopeless on its own. Given a run that
   * already works, though, every node can be asked "could anything through here
   * beat the run we have" — and on a level where the incumbent is close, most
   * of the state space answers no and costs one subtraction to reject.
   *
   * Infinity disables it, which is the default and is the completability gate's
   * behaviour: a gate that pruned against a bound it does not have would report
   * levels uncompletable that are merely slow.
   */
  costCeil: number;
  /**
   * Frames the run must still spend AFTER this search's goal, at the most
   * optimistic rate. The rest of the route, in other words — without it the
   * ceiling would only bind on the last leg.
   */
  tailFrames: number;
  /**
   * Frames per metre used for the CEILING only, and deliberately not `vref`.
   * `vref` is a steering constant and wants to be about the speed a bike really
   * travels; this one wants to be a speed no bike exceeds, because it decides
   * what gets thrown away. Zero ignores the heuristic's contribution to the
   * bound and leaves `g + tailFrames >= costCeil` as the only test.
   */
  boundFramesPerMetre: number;
  masks: readonly number[];
  flipMasks: readonly number[];
  durations: readonly number[];
}

export const DEFAULT_SEARCH: Omit<SearchOpts, 'budget' | 'deadline'> = {
  hWeight: 1.6,
  speedBonus: 0,
  vref: 8,
  maxFrames: 128 * 150,
  cellXY: 0.6,
  cellV: 1.5,
  attSectors: 12,
  armSectors: 6,
  goalExtra: 2500,
  goalsWanted: 6,
  survivalFrames: 40,
  costCeil: Infinity,
  tailFrames: 0,
  boundFramesPerMetre: 0,
  masks: HELD_MASKS,
  flipMasks: FLIP_MASKS,
  durations: DURATIONS,
};

/**
 * Held masks tried as survival probes. The whole held alphabet, cheapest first:
 * a narrower set rejects states that ARE rideable, which on a low-ceiling level
 * is most of them — the first version tried five and turned 03-mind-your-head
 * from solvable into impossible on its own.
 */
const PROBES: readonly number[] = [
  0, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE, IN_BRAKE,
  IN_THROTTLE | IN_LEAN_L, IN_THROTTLE | IN_LEAN_R, IN_BRAKE | IN_LEAN_L, IN_BRAKE | IN_LEAN_R,
];

/**
 * Can this state still be ridden? Restores the sim to exactly where it was
 * either way — a viability check that moved the state would corrupt the node
 * being built from it.
 */
export function viable(sim: Sim, frames: number): boolean {
  if (frames <= 0) return true;
  const snap = sim.snapshot();
  for (const p of PROBES) {
    sim.restore(snap);
    let alive = true;
    for (let i = 0; i < frames; i++) {
      sim.advance(p);
      if (sim.state.dead) { alive = false; break; }
      if (sim.state.finished) break;
    }
    if (alive) { sim.restore(snap); return true; }
  }
  sim.restore(snap);
  return false;
}

/** Distance in metres from a state to the goal, however the caller defines it. */
export type Heuristic = (s: SimState) => number;
export type GoalTest = (s: SimState) => boolean;

export interface SearchStats {
  expansions: number;
  generated: number;
  /** Children discarded because an existing node already dominated their cell. */
  deduped: number;
  deaths: number;
  /** Input frames simulated. The honest measure of what the search cost. */
  frames: number;
  /** Goal states rejected because nothing could be ridden out of them. */
  nonviable: number;
  /** Children discarded because nothing through them could beat `costCeil`. */
  pruned: number;
  ms: number;
  poolBytes: number;
  /** Smallest heuristic distance any node reached, metres. */
  closest: number;
  /** Where that happened. */
  closestX: number;
  closestY: number;
  exhausted: boolean;
  timedOut: boolean;
}

export interface SearchResult {
  found: boolean;
  /** Node ids of states satisfying the goal, best (earliest) first. */
  goals: number[];
  /** True when `goals` are all states nothing simple could be ridden out of. */
  weak: boolean;
  stats: SearchStats;
}

/**
 * The node table. Parallel typed arrays rather than objects: a long search
 * holds a million of these and an object per node is both slower to make and
 * something the collector has to walk on every minor GC.
 */
export class Nodes {
  readonly pool: StatePool;
  parent: Int32Array;
  /** Held mask, with bit 4 (IN_FLIP) meaning "flip on the first frame". */
  code: Uint8Array;
  dur: Uint16Array;
  /** Input frames from the root of this search. */
  g: Int32Array;
  private cap: number;

  constructor(apples: number, cap = 1 << 16) {
    this.pool = new StatePool(apples);
    this.cap = cap;
    this.parent = new Int32Array(cap);
    this.code = new Uint8Array(cap);
    this.dur = new Uint16Array(cap);
    this.g = new Int32Array(cap);
  }

  get size(): number {
    return this.pool.size;
  }

  add(s: SimState, parent: number, code: number, dur: number, g: number): number {
    if (this.pool.size === this.cap) this.grow();
    const id = this.pool.push(s);
    this.parent[id] = parent;
    this.code[id] = code;
    this.dur[id] = dur;
    this.g[id] = g;
    return id;
  }

  private grow(): void {
    this.cap *= 2;
    const p = new Int32Array(this.cap); p.set(this.parent); this.parent = p;
    const c = new Uint8Array(this.cap); c.set(this.code); this.code = c;
    const d = new Uint16Array(this.cap); d.set(this.dur); this.dur = d;
    const g = new Int32Array(this.cap); g.set(this.g); this.g = g;
  }

  /** The input-frame masks that lead from the search root to `id`. */
  masksTo(id: number): number[] {
    const chain: number[] = [];
    for (let i = id; i > 0; i = this.parent[i]) chain.push(i);
    chain.reverse();
    const out: number[] = [];
    for (const i of chain) {
      const code = this.code[i];
      const held = code & ~IN_FLIP;
      const n = this.dur[i];
      for (let k = 0; k < n; k++) out.push(k === 0 ? code : held);
    }
    return out;
  }
}

/**
 * The dedupe key.
 *
 * Every axis here earned its place by being a thing two states can differ in
 * while sitting in the same square metre, and that the next second of physics
 * cares about. Drop the velocity buckets and the frontier collapses onto "do
 * nothing" — that is the recorded failure, not a hypothetical.
 *
 * It is one integer rather than a string because the search computes millions
 * of them; the product of the ranges is checked against 2^52 at setup, so the
 * arithmetic is exact.
 */
function makeKeyFn(opts: SearchOpts, minX: number, minY: number, nx: number, ny: number, apples: number) {
  const invXY = 1 / opts.cellXY;
  const invV = 1 / opts.cellV;
  const NV = 32;
  const AT = opts.attSectors;
  const AR = opts.armSectors;
  // Capped at twelve apples: beyond that the mask stops distinguishing states
  // and two runs that differ only in a late apple share a cell. No level in
  // this set is near it, and the alternative — an unbounded factor on the key
  // space — trades a rare loss of resolution for a guaranteed overflow.
  const AM = 1 << Math.min(apples, 12);
  const space = AM * nx * ny * NV * NV * AT * AR * 4 * 2;
  if (!(space < 2 ** 52)) {
    throw new Error(`solver: dedupe key space ${space} exceeds exact integer range — coarsen cellXY/cellV`);
  }
  const TAU = Math.PI * 2;
  return (s: SimState): number => {
    let ix = ((s.px - minX) * invXY) | 0;
    if (ix < 0) ix = 0; else if (ix >= nx) ix = nx - 1;
    let iy = ((s.py - minY) * invXY) | 0;
    if (iy < 0) iy = 0; else if (iy >= ny) iy = ny - 1;
    let ivx = (s.vx * invV + 16) | 0;
    if (ivx < 0) ivx = 0; else if (ivx >= NV) ivx = NV - 1;
    let ivy = (s.vy * invV + 16) | 0;
    if (ivy < 0) ivy = 0; else if (ivy >= NV) ivy = NV - 1;
    let iat = (((Math.atan2(s.oy, s.ox) + Math.PI) / TAU) * AT) | 0;
    if (iat < 0) iat = 0; else if (iat >= AT) iat = AT - 1;
    let iar = (((Math.atan2(s.ay, s.ax) + Math.PI) / TAU) * AR) | 0;
    if (iar < 0) iar = 0; else if (iar >= AR) iar = AR - 1;
    let am = 0;
    const n = s.applesTaken.length < 12 ? s.applesTaken.length : 12;
    for (let i = 0; i < n; i++) if (s.applesTaken[i] !== 0) am |= 1 << i;
    let k = am;
    k = k * nx + ix;
    k = k * ny + iy;
    k = k * NV + ivx;
    k = k * NV + ivy;
    k = k * AT + iat;
    k = k * AR + iar;
    k = k * 4 + s.grounded;
    k = k * 2 + (s.facing > 0 ? 1 : 0);
    return k;
  };
}

/**
 * Best-first search from one or more seed states to a goal predicate.
 *
 * `nodes` is passed in rather than created here so that a multi-stage solve can
 * chain: stage 2's root is a node stage 1 produced, and the mask chain back to
 * the very start is still walkable.
 */
export function search(
  sim: Sim,
  nodes: Nodes,
  seeds: readonly number[],
  goal: GoalTest,
  h: Heuristic,
  opts: SearchOpts,
): SearchResult {
  const t0 = Date.now();
  const lvl = sim.world.level;
  const minX = lvl.minX - 4;
  const minY = lvl.minY - 4;
  const nx = Math.max(1, Math.ceil((lvl.maxX - lvl.minX + 8) / opts.cellXY));
  const ny = Math.max(1, Math.ceil((lvl.maxY - lvl.minY + 8) / opts.cellXY));
  const key = makeKeyFn(opts, minX, minY, nx, ny, lvl.apples.length);

  const archive = new Map<number, number>();
  const frontier = new Heap();
  const st = sim.state;
  const framesPerMetre = 128 / opts.vref;

  const stats: SearchStats = {
    expansions: 0, generated: 0, deduped: 0, deaths: 0, frames: 0, nonviable: 0, pruned: 0, ms: 0,
    poolBytes: 0, closest: Infinity, closestX: NaN, closestY: NaN,
    exhausted: false, timedOut: false,
  };

  for (const seed of seeds) {
    nodes.pool.load(seed, st);
    const hm = h(st);
    if (hm < stats.closest) { stats.closest = hm; stats.closestX = st.px; stats.closestY = st.py; }
    archive.set(key(st), seed);
    frontier.push(nodes.g[seed] + opts.hWeight * hm * framesPerMetre, seed);
  }

  const goals: number[] = [];
  const weakGoals: number[] = [];
  let stopAt = opts.budget;
  const maxDur = Math.max(...opts.durations);

  while (frontier.size > 0) {
    if (stats.expansions >= stopAt) { stats.exhausted = true; break; }
    if ((stats.expansions & 255) === 0 && Date.now() > opts.deadline) { stats.timedOut = true; break; }

    const parent = frontier.pop();
    stats.expansions++;
    const pg = nodes.g[parent];
    if (pg >= opts.maxFrames) continue;
    // Nothing through here can beat the run we already have. The parent test is
    // the cheap half — one comparison rejects a whole subtree.
    if (pg + opts.tailFrames >= opts.costCeil) { stats.pruned++; continue; }
    let ph = 0;
    if (opts.speedBonus !== 0) {
      nodes.pool.load(parent, st);
      ph = h(st);
    }

    for (let mi = 0; mi < opts.masks.length + opts.flipMasks.length; mi++) {
      const flip = mi >= opts.masks.length;
      const held = flip ? opts.flipMasks[mi - opts.masks.length] : opts.masks[mi];
      const code = flip ? held | IN_FLIP : held;

      nodes.pool.load(parent, st);
      let di = 0;
      for (let step = 1; step <= maxDur; step++) {
        sim.advance(step === 1 ? code : held);
        stats.frames++;
        if (st.dead) { stats.deaths++; break; }
        const hit = goal(st);
        // A checkpoint, or the frame the goal was reached. Cutting the macro at
        // the pickup rather than running it out is what keeps arrival times
        // honest — and the apple is collected either way, so the extra frames
        // would be pure noise on the end of the stream.
        const atCheckpoint = di < opts.durations.length && step === opts.durations[di];
        if (!hit && !atCheckpoint) continue;
        if (atCheckpoint) di++;

        const g = pg + step;
        if (g >= opts.maxFrames) break;
        const hm = h(st);
        if (hm < stats.closest) { stats.closest = hm; stats.closestX = st.px; stats.closestY = st.py; }
        // The optimistic completion through this child: what it has spent, the
        // fastest anything could cover what is left of this leg, and the
        // fastest anything could cover the rest of the route after it.
        if (g + hm * opts.boundFramesPerMetre + opts.tailFrames >= opts.costCeil) { stats.pruned++; continue; }

        if (!hit) {
          const k = key(st);
          const prev = archive.get(k);
          if (prev !== undefined && nodes.g[prev] <= g) { stats.deduped++; continue; }
          const id = nodes.add(st, parent, code, step, g);
          archive.set(k, id);
          stats.generated++;
          const closing = opts.speedBonus !== 0 ? ((ph - hm) * 128) / step : 0;
          frontier.push(g + opts.hWeight * hm * framesPerMetre - opts.speedBonus * closing, id);
          continue;
        }

        // A goal that cannot be ridden out of is not a goal. Checked here and
        // not by the caller, because the caller sees only the node id and would
        // have to reconstruct the state to ask.
        if (!viable(sim, opts.survivalFrames)) {
          stats.nonviable++;
          const nid = nodes.add(st, parent, code, step, g);
          stats.generated++;
          // Kept as a fallback answer AND left on the frontier: the search may
          // yet ride out of it, and if nothing better turns up it is still a
          // truer report than "not reached".
          if (weakGoals.length < opts.goalsWanted * 4) weakGoals.push(nid);
          const k = key(st);
          const prev = archive.get(k);
          if (prev === undefined || nodes.g[prev] > g) archive.set(k, nid);
          frontier.push(g + opts.hWeight * hm * framesPerMetre, nid);
          break;
        }
        const id = nodes.add(st, parent, code, step, g);
        stats.generated++;
        goals.push(id);
        if (goals.length === 1) {
          // Keep going a little: the first route found is rarely the one the
          // next stage can leave from, and a stage that hands its successor a
          // single arrival state is a beam of width one.
          stopAt = Math.min(opts.budget, stats.expansions + opts.goalExtra);
        }
        break;
      }
      if (goals.length >= opts.goalsWanted) break;
    }
    if (goals.length >= opts.goalsWanted) break;
  }
  if (frontier.size === 0) stats.exhausted = true;

  const weak = goals.length === 0 && weakGoals.length > 0;
  const out = weak ? weakGoals : goals;
  out.sort((a, b) => nodes.g[a] - nodes.g[b]);
  stats.ms = Date.now() - t0;
  stats.poolBytes = nodes.pool.bytes;
  return { found: out.length > 0, goals: out, weak, stats };
}

/**
 * Pick up to `k` arrival states that are actually DIFFERENT from each other.
 *
 * The earliest arrival is always in, because it is the fast line. The rest are
 * chosen farthest-point-first over (position, velocity, attitude), which is the
 * same anti-monoculture argument the dedupe key makes, applied to what gets
 * handed to the next stage. A stage that passes on six variations of the same
 * arrival is the "top-N by one scalar" failure wearing a different hat.
 */
export function diverseGoals(nodes: Nodes, goals: readonly number[], k: number): number[] {
  if (goals.length <= k) return [...goals];
  // Velocity is in the feature vector and it is the half that matters. Two
  // arrivals at the same lip one metre apart but four metres a second apart are
  // completely different propositions for whatever has to be jumped next, and a
  // position-only spread would call them the same and keep one.
  const feat = (id: number): number[] => [
    nodes.pool.at(id, OFF_PX), nodes.pool.at(id, OFF_PY),
    nodes.pool.at(id, OFF_VX) * 0.8, nodes.pool.at(id, OFF_VY) * 0.8,
    nodes.g[id] * 0.05,
  ];
  const picked = [goals[0]];
  const rest = goals.slice(1);
  while (picked.length < k && rest.length > 0) {
    let best = 0;
    let bestD = -1;
    for (let i = 0; i < rest.length; i++) {
      const f = feat(rest[i]);
      let near = Infinity;
      for (const p of picked) {
        const q = feat(p);
        let d = 0;
        for (let j = 0; j < f.length; j++) d += (f[j] - q[j]) * (f[j] - q[j]);
        if (d < near) near = d;
      }
      if (near > bestD) { bestD = near; best = i; }
    }
    picked.push(rest[best]);
    rest.splice(best, 1);
  }
  return picked;
}
