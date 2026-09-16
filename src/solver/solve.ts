// Solving a level: the route is an outer problem, the riding is an inner one,
// and the riding is cut into segments short enough to search properly.
//
// Three nested decisions, outermost first:
//
//   APPLE ORDER. Depth-first over "which apple next", tried nearest-geodesic
//   first, with backtracking. Nearest-first is a good guess and usually right;
//   the backtracking is what makes the reported order a FINDING rather than an
//   assumption, and route choice is where this game's depth lives.
//
//   HOW HARD TO TRY. A leg is attempted by a list of STRATEGIES in order, and
//   the list is the honest record of what was measured rather than a design:
//
//     1. one search over the whole leg, greedy-ish;
//     2. the same, near-Dijkstra, with more budget — for the legs where the
//        greedy weight threw away the run-up it needed;
//     3. the leg cut into segments on the geodesic distance to the target
//        ("get 14 m closer, then 14 m closer again"), each its own search
//        seeded from several diverse arrivals of the one before.
//
//   Segmenting was the FIRST thing tried and it was a mistake as a default. It
//   does what it promises — the hard bit gets a fresh dedupe archive and a full
//   budget instead of arriving at a saturated one — but every segment boundary
//   is a place the search stops, and a bike handed forward through six of them
//   has been asked six times to arrive rather than to keep going. Measured
//   across the set it cost more levels than it won: 03-mind-your-head solves
//   whole in 79 s and does not solve segmented at all. It stays as the last
//   strategy because the thing it is good at — precision at one specific
//   obstacle — is exactly what the first two are bad at.
//
//   Thresholds rather than positional waypoints, because the threshold is
//   exactly "progress along the route" and needs no capture radius, no
//   guessing which side of a waypoint counts, and no extra distance field. One
//   Dijkstra per apple serves every segment of every leg to it.
//
//   RIDING. search.ts. Macro-actions over held input masks, best-first, and a
//   dedupe archive rich enough that two genuinely different situations never
//   collapse onto each other.
//
// Every node lives in ONE table rooted at the level start, so the mask chain
// from the start to any node is always walkable and the solution is one
// continuous input stream by construction. It is re-simulated from scratch and
// verified before anything is written out.
import { IN_MASK } from '@/sim/consts.ts';
import type { Level } from '@/sim/level.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import { createSim } from '@/sim/sim.ts';
import type { SimState } from '@/sim/step.ts';
import { buildField, geodesic, distAt, nearestFree } from './field.ts';
import type { Field } from './field.ts';
import { Nodes, search, diverseGoals, DEFAULT_SEARCH } from './search.ts';
import type { SearchOpts, SearchStats } from './search.ts';

export interface SolveOpts {
  /** Wall-clock ceiling for the whole solve, milliseconds. */
  timeBudgetMs: number;
  /** How hard to try, in order. The first that works wins. */
  strategies: Strategy[];
  /** Alternative next-apples tried per leg before giving up on the order. */
  targetTries: number;
  /**
   * Metres an apple may sit below the bike before it counts as "down a tier",
   * and so gets tried only after everything at this level.
   */
  descendTolerance: number;
  /**
   * How many times a leg may block the place it kept stalling at and re-route.
   * Zero disables it.
   */
  reroutes: number;
  /** Radius of the patch of map a re-route gives up on, metres. */
  rerouteRadius: number;
  /** Arrival states carried from one segment into the next as seeds. */
  branch: number;
  /** Occupancy grid resolution, metres. */
  fieldCell: number;
  /** Search knobs; anything omitted comes from DEFAULT_SEARCH. */
  search: Partial<Omit<SearchOpts, 'budget' | 'deadline'>>;
  onProgress?: (line: string) => void;
}

export interface Strategy {
  name: string;
  /** Geodesic metres one search is asked to cover. Infinity = the whole leg. */
  segmentMetres: number;
  /** Node expansions ONE search in this strategy may spend. */
  budget: number;
  hWeight: number;
  /** Priority credit per m/s of closing speed; see SearchOpts.speedBonus. */
  speedBonus?: number;
}

export const DEFAULT_SOLVE: SolveOpts = {
  timeBudgetMs: 5 * 60 * 1000,
  targetTries: 3,
  descendTolerance: 3,
  reroutes: 5,
  rerouteRadius: 2.5,
  branch: 4,
  fieldCell: 0.5,
  search: {},
  strategies: [
    { name: 'whole', segmentMetres: Infinity, budget: 25000, hWeight: 1.7 },
    // Momentum credit, and the strategy that actually clears gaps. Measured on
    // 13-reservoir, whose two pits are 8 m and 12 m across: the greedy weight
    // needs 117 000 expansions for the first and never gets the second, plain
    // Dijkstra gets the first in 13 500 and never gets the second, and this
    // gets BOTH — the far one in 20 700 expansions and half a minute.
    { name: 'carry', segmentMetres: Infinity, budget: 60000, hWeight: 1.2, speedBonus: 20 },
    // The one that cracks jumps, and by far the biggest budget. A gap that has
    // to be cleared at a particular speed is a question about the RUN-UP, and
    // a greedy weight throws the run-up away — it prefers the state nearer the
    // far lip to the state that will still be moving when it gets there. Near
    // Dijkstra the search explores speeds instead of positions and finds it.
    { name: 'patient', segmentMetres: Infinity, budget: 120000, hWeight: 1.08 },
    { name: 'segmented', segmentMetres: 14, budget: 16000, hWeight: 1.7 },
  ],
};

export interface SegmentReport {
  /** Apple index, or -1 for the flower. */
  target: number;
  /** Which strategy ran this one. */
  strategy: string;
  /** Geodesic metres still to go when the segment was declared done. */
  threshold: number;
  ok: boolean;
  /** The arrival was one nothing simple could be ridden out of. */
  weak: boolean;
  stats: SearchStats;
}

export interface SolveResult {
  solved: boolean;
  /** The full input-frame stream from the level start. Empty if unsolved. */
  masks: number[];
  /** Apple indices in the order the winning run collected them. */
  appleOrder: number[];
  frames: number;
  segments: SegmentReport[];
  totals: { expansions: number; frames: number; deaths: number; generated: number; deduped: number; ms: number };
  poolBytes: number;
  ms: number;
  /** Populated when unsolved: what stopped it and where. */
  failure?: {
    target: number;
    targetX: number;
    targetY: number;
    /** Geodesic metres from the target the search never got inside. */
    closest: number;
    closestX: number;
    closestY: number;
    reason: 'budget' | 'timeout' | 'exhausted';
  };
  field: Field;
  /** Geodesic route length through the winning order, metres. */
  routeMetres: number;
}

export function solveLevel(level: Level, spec: BikeSpec, userOpts: Partial<SolveOpts> = {}): SolveResult {
  const opts: SolveOpts = { ...DEFAULT_SOLVE, ...userOpts, search: { ...DEFAULT_SOLVE.search, ...userOpts.search } };
  const t0 = Date.now();
  const deadline = t0 + opts.timeBudgetMs;
  const say = opts.onProgress ?? ((): void => {});

  const field = buildField(level, opts.fieldCell, 0.3);
  const nApples = level.apples.length;
  const FLOWER = nApples;
  const pts = [...level.apples.map((a) => ({ x: a.x, y: a.y })), { x: level.flower.x, y: level.flower.y }];
  const fields = pts.map((p) => geodesic(field, p.x, p.y));
  const blocked = pts.map(() => null as Uint8Array | null);
  const distTo = (t: number, x: number, y: number): number => distAt(field, fields[t], x, y, pts[t].x, pts[t].y);

  /**
   * The search kept stalling in the same place, so stop believing the map there.
   *
   * The occupancy grid is deliberately optimistic — it answers "does a disc fit
   * here", which is the right question for a bike that can be anywhere in the
   * air, and the wrong one for "can a bike GET here". On 17-backswing that costs
   * the whole level: a 3 m wall two metres wide sits at the end of the start
   * platform, the grid routes straight over it because there is air above it,
   * and every strategy spends its whole budget failing to climb it 31 m from
   * the apple. The level's actual route is 200 m the other way, and no amount of
   * searching finds it while the heuristic is pointing at the wall.
   *
   * So: block the cells around where it stalled, recompute that target's field,
   * and try again. This is the search correcting the map with what it learned,
   * and it is a LAST RESORT — every strategy has already failed — because the
   * same patch might have been passable with more budget.
   *
   * Refused if it makes the target unreachable from here, which is the failure
   * mode that would turn "could not" into a false "cannot".
   */
  const reroute = (t: number, x: number, y: number, fromX: number, fromY: number): boolean => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const mask = blocked[t] ?? new Uint8Array(field.w * field.h);
    const before = mask.slice();

    // Walk DOWNHILL on the target's distance field from where the search
    // stalled — that is precisely the route the heuristic was pointing at —
    // and block a corridor along it. Blocking the stall point alone does not
    // work and the failure is instructive: the bike stalls standing on the
    // platform NEXT to the wall it cannot climb, so blocking where the bike is
    // blocks the platform, the field re-routes half a metre over and aims at
    // the same wall again. What has to stop being a route is the route.
    let c = nearestFree(field, x, y);
    if (c < 0) return false;
    const corridor: number[] = [];
    const walk = Math.ceil(12 / field.cell);
    for (let k = 0; k < walk; k++) {
      corridor.push(c);
      const cx = c % field.w;
      const cy = (c - cx) / field.w;
      let best = -1;
      let bestD = fields[t][c];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const gx = cx + dx;
          const gy = cy + dy;
          if (gx < 0 || gy < 0 || gx >= field.w || gy >= field.h) continue;
          const j = gy * field.w + gx;
          if (field.free[j] === 0 || mask[j] !== 0) continue;
          if (fields[t][j] < bestD) { bestD = fields[t][j]; best = j; }
        }
      }
      if (best < 0) break;
      c = best;
    }

    const r = Math.ceil(opts.rerouteRadius / field.cell);
    let added = 0;
    for (const cell of corridor) {
      const cx = cell % field.w;
      const cy = (cell - cx) / field.w;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const gx = cx + dx;
          const gy = cy + dy;
          if (gx < 0 || gy < 0 || gx >= field.w || gy >= field.h) continue;
          const i = gy * field.w + gx;
          if (mask[i] === 0) { mask[i] = 1; added++; }
        }
      }
    }
    if (added === 0) return false;
    const next = geodesic(field, pts[t].x, pts[t].y, mask);
    if (!Number.isFinite(distAt(field, next, fromX, fromY, pts[t].x, pts[t].y))) {
      mask.set(before);
      return false;
    }
    blocked[t] = mask;
    fields[t] = next;
    return true;
  };

  const sim = createSim(level, spec);
  const nodes = new Nodes(nApples);
  // Node 0 is the level start. `masksTo` walks back to it and stops, so every
  // chain is rooted at "the moment the run begins".
  const root = nodes.add(sim.state, -1, 0, 0, 0);

  const base: Omit<SearchOpts, 'budget' | 'deadline'> = { ...DEFAULT_SEARCH, ...opts.search };
  const segments: SegmentReport[] = [];
  const totals = { expansions: 0, frames: 0, deaths: 0, generated: 0, deduped: 0, ms: 0 };
  let poolBytes = 0;
  let failure: SolveResult['failure'];

  const tally = (st: SearchStats): void => {
    totals.expansions += st.expansions;
    totals.frames += st.frames;
    totals.deaths += st.deaths;
    totals.generated += st.generated;
    totals.deduped += st.deduped;
    totals.ms += st.ms;
    if (st.poolBytes > poolBytes) poolBytes = st.poolBytes;
  };

  /**
   * One leg under one strategy: from a set of seed states to apple `t` (or the
   * flower). Returns the arrival states, or null.
   */
  const rideWith = (seeds: number[], t: number, st: Strategy): { arrivals: number[]; weak: boolean } | null => {
    nodes.pool.load(seeds[0], sim.state);
    const d0 = distTo(t, sim.state.px, sim.state.py);
    const thresholds: number[] = [];
    if (Number.isFinite(d0) && Number.isFinite(st.segmentMetres)) {
      for (let d = d0 - st.segmentMetres; d > st.segmentMetres * 0.6; d -= st.segmentMetres) thresholds.push(d);
    }
    thresholds.push(0);

    let cur = seeds;
    let weak = false;
    for (const th of thresholds) {
      if (Date.now() > deadline) return null;
      const goal = th === 0
        ? t === FLOWER
          ? (s: SimState): boolean => s.finished
          : (s: SimState): boolean => s.applesTaken[t] !== 0
        : (s: SimState): boolean => distTo(t, s.px, s.py) <= th;
      const h = (s: SimState): number => {
        const d = distTo(t, s.px, s.py) - th;
        return d > 0 ? d : 0;
      };

      const res = search(sim, nodes, cur, goal, h, {
        ...base, hWeight: st.hWeight, speedBonus: st.speedBonus ?? base.speedBonus,
        budget: st.budget, deadline,
      });
      tally(res.stats);
      segments.push({ target: t, strategy: st.name, threshold: th, ok: res.found, weak: res.weak, stats: res.stats });

      if (!res.found) {
        const name = t === FLOWER ? 'flower' : `apple ${t}`;
        say(`    ${name} [${st.name}]: stalled ${res.stats.closest.toFixed(1)} m short of the ${th.toFixed(0)} m mark at (${res.stats.closestX.toFixed(1)}, ${res.stats.closestY.toFixed(1)}) — ${res.stats.expansions} expansions, ${(res.stats.ms / 1000).toFixed(0)} s`);
        const reach = th + res.stats.closest;
        if (!failure || reach < failure.closest) {
          failure = {
            target: t === FLOWER ? -1 : t,
            targetX: pts[t].x,
            targetY: pts[t].y,
            closest: reach,
            closestX: res.stats.closestX,
            closestY: res.stats.closestY,
            reason: res.stats.timedOut ? 'timeout' : res.stats.exhausted ? 'exhausted' : 'budget',
          };
        }
        return null;
      }
      if (res.weak) weak = true;
      cur = diverseGoals(nodes, res.goals, Math.max(1, opts.branch));
    }
    return { arrivals: cur, weak };
  };

  /**
   * Legs and sub-problems already proved hopeless.
   *
   * The apple-order search backtracks, and without this it backtracks straight
   * into work it has already done: on 13-reservoir it spent 45 000 expansions
   * failing to reach apple 2 from a state, backed up, came back to the SAME
   * state and spent the same 45 000 again, three times over. Memoising on the
   * arrival node makes a failure cost once. It is exact, not a heuristic —
   * the same node and the same target is literally the same search.
   */
  const deadLeg = new Set<string>();
  const deadPlan = new Set<string>();

  /** One leg, trying each strategy until one works, then re-routing. */
  const ride = (seeds: number[], t: number, depth: number): number[] | null => {
    const name = t === FLOWER ? 'flower' : `apple ${t}`;
    const memo = seeds[0] + '|' + t;
    if (deadLeg.has(memo)) return null;
    nodes.pool.load(seeds[0], sim.state);
    const fromX = sim.state.px;
    const fromY = sim.state.py;
    let weakFallback: number[] | null = null;

    for (let round = 0; round <= opts.reroutes; round++) {
      let stallX = NaN;
      let stallY = NaN;
      let stallReach = Infinity;
      // After a re-route the heuristic is a different heuristic, so the cheapest
      // strategy is worth another go — but running the whole ladder every round
      // costs four minutes a round and buys almost nothing: the expensive ones
      // failed against a map that has since changed, and if the new route is
      // real the greedy one will find it.
      const ladder = round === 0 ? opts.strategies : opts.strategies.slice(0, 1);
      // A search that ran out of ROOM rather than out of budget — the frontier
      // emptied in a handful of expansions — is not telling you about the map.
      // It is telling you the states it was handed are dead ends, and blocking
      // a corridor because of it throws away a perfectly good route.
      let sawRealSearch = false;
      for (const st of ladder) {
        if (Date.now() > deadline) return weakFallback ?? null;
        const got = rideWith(seeds, t, st);
        if (got) {
          const secs = (nodes.g[got.arrivals[0]] - nodes.g[seeds[0]]) / 128;
          // An arrival nothing simple can be ridden out of is accepted only if
          // no strategy does better. Handing one forward is how a leg poisons
          // every leg after it: the next search expands four doomed seeds, the
          // frontier empties in four expansions, and the level reads as
          // impossible when the real problem is upstream.
          if (!got.weak) {
            say(`    leg ${depth}: ${name} in ${secs.toFixed(2)} s [${st.name}${round > 0 ? ' +' + round + ' reroute' : ''}] (${((Date.now() - t0) / 1000).toFixed(0)} s elapsed)`);
            return got.arrivals;
          }
          if (!weakFallback) weakFallback = got.arrivals;
          continue;
        }
        const last = segments[segments.length - 1];
        if (last.stats.expansions >= 500) sawRealSearch = true;
        const reach = last.threshold + last.stats.closest;
        if (reach < stallReach) { stallReach = reach; stallX = last.stats.closestX; stallY = last.stats.closestY; }
      }
      if (round === opts.reroutes || Date.now() > deadline || !sawRealSearch) break;
      if (!reroute(t, stallX, stallY, fromX, fromY)) break;
      say(`    ${name}: blocked the map around (${stallX.toFixed(1)}, ${stallY.toFixed(1)}) and re-routed — the grid said that was a way through and it is not`);
    }
    if (weakFallback) {
      say(`    leg ${depth}: ${name} reached, but only into a state nothing simple rides out of (${((Date.now() - t0) / 1000).toFixed(0)} s elapsed)`);
      return weakFallback;
    }
    if (Date.now() <= deadline) deadLeg.add(memo);
    return null;
  };

  /** Depth-first over apple order. */
  const attempt = (from: number[], remaining: number[], order: number[], depth: number): { node: number; order: number[] } | null => {
    if (Date.now() > deadline) return null;
    const plan = from[0] + '|' + remaining.join(',');
    if (deadPlan.has(plan)) return null;
    nodes.pool.load(from[0], sim.state);
    const fx = sim.state.px;
    const fy = sim.state.py;

    // Nearest-first, but FINISH YOUR TIER FIRST. Gravity is one-way: an apple
    // you rode past on the way down is usually gone for good, and pure
    // nearest-first strands them constantly. On 04-switchback it collected the
    // middle shelf's left end, dropped to the bottom shelf because that was
    // nearest, rode the bottom shelf to the far end, and then spent the entire
    // remaining budget failing to climb 5 m back up to the one apple it had
    // left behind — which is exactly what the level is called switchback for.
    //
    // Apples below the bike are not removed from the list, only sorted after
    // the ones at this level, so a level that really does want a descend-and-
    // return still has the option; it just is not the first guess.
    const targets = remaining.length === 0
      ? [FLOWER]
      : (() => {
          const scored = remaining.map((i) => ({ i, d: distTo(i, fx, fy), y: level.apples[i].y }));
          const here = scored.filter((e) => e.y >= fy - opts.descendTolerance).sort((a, b) => a.d - b.d);
          const below = scored.filter((e) => e.y < fy - opts.descendTolerance).sort((a, b) => a.d - b.d);
          return [...here, ...below].slice(0, Math.max(1, opts.targetTries)).map((e) => e.i);
        })();

    for (const t of targets) {
      const arrivals = ride(from, t, depth);
      if (!arrivals) {
        if (Date.now() > deadline) return null;
        continue;
      }
      if (t === FLOWER) return { node: arrivals[0], order };

      // Opportunistic pickups count. A leg aimed at apple 3 that drives over
      // apple 5 on the way has collected apple 5, and pretending otherwise
      // would send the next leg back for something already in the bag.
      nodes.pool.load(arrivals[0], sim.state);
      const taken = [...sim.state.applesTaken];
      const got = remaining.filter((i) => taken[i] !== 0);
      const rest = remaining.filter((i) => taken[i] === 0);
      const sub = attempt(arrivals, rest, [...order, t, ...got.filter((i) => i !== t)], depth + 1);
      if (sub) return sub;
      if (Date.now() > deadline) return null;
    }
    if (Date.now() <= deadline) deadPlan.add(plan);
    return null;
  };

  const all = level.apples.map((_, i) => i);
  for (const i of all) {
    if (!Number.isFinite(distTo(i, level.start.x, level.start.y))) {
      say(`    apple ${i} at (${level.apples[i].x}, ${level.apples[i].y}) does not route to the start on the occupancy grid`);
    }
  }

  const win = attempt([root], all, [], 1);
  const ms = Date.now() - t0;

  if (!win) {
    return {
      solved: false, masks: [], appleOrder: [], frames: 0, segments, totals, poolBytes, ms,
      failure: failure ?? {
        target: -1, targetX: level.flower.x, targetY: level.flower.y,
        closest: Infinity, closestX: NaN, closestY: NaN, reason: 'timeout',
      },
      field, routeMetres: 0,
    };
  }

  const masks = nodes.masksTo(win.node).map((m) => m & IN_MASK);
  let routeMetres = 0;
  {
    let x = level.start.x;
    let y = level.start.y;
    for (const t of [...win.order, FLOWER]) {
      const d = distTo(t, x, y);
      if (Number.isFinite(d)) routeMetres += d;
      x = pts[t].x;
      y = pts[t].y;
    }
  }
  return {
    solved: true, masks, appleOrder: win.order, frames: masks.length,
    segments, totals, poolBytes, ms, field, routeMetres,
  };
}
