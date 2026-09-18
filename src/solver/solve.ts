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
import { getEngine, SIM_REV } from '@/sim/rev.ts';
import type { SimState } from '@/sim/step.ts';
import { buildField, geodesic, distAt, nearestFree } from './field.ts';
import type { Field } from './field.ts';
import { Nodes, search, diverseGoals, DEFAULT_SEARCH } from './search.ts';
import type { SearchOpts, SearchStats } from './search.ts';

export interface SolveOpts {
  /**
   * Which physics to search. Defaults to SIM_REV, the LIVE rev — a solver that
   * quietly searched the newest physics would report a level completable that
   * nobody playing the game could complete.
   */
  rev: number;
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
  /**
   * Wall clock ONE leg may spend, milliseconds. Zero is unlimited.
   *
   * The gate does not need this: it rides a leg until something works and then
   * moves on, so a leg that is going to take four minutes takes four minutes
   * and that is the level's cost. An optimising round does need it, because a
   * round that spends its entire clock making leg two a tenth of a second
   * faster never reaches leg three and returns nothing at all — the ceiling
   * means a partial route is worth exactly zero. Capping the leg turns that
   * into a complete route that improved a little, which is worth something and
   * tightens the ceiling for the round after it.
   */
  maxLegMs: number;
  /** Occupancy grid resolution, metres. */
  fieldCell: number;
  /** Search knobs; anything omitted comes from DEFAULT_SEARCH. */
  search: Partial<Omit<SearchOpts, 'budget' | 'deadline'>>;
  /**
   * Look for a FAST run rather than for a run.
   *
   * Off, this file satisfices at all three levels of the decision and says so
   * in its header: the first apple order that completes wins, the first
   * strategy that gets a leg done wins, and the first arrival the search trips
   * over is the arrival it hands on. That is exactly right for the
   * completability gate — "can this be done at all" is answered by one run and
   * the gate is run on every generated level — and it is why the solver loses
   * to a person on sixteen of the seventeen levels where both have a time.
   *
   * On, three things change and nothing else does:
   *
   *   a leg keeps trying strategies after one works and takes the fastest;
   *   the apple-order DFS keeps going after one order completes and takes the
   *     fastest;
   *   every search prunes against `timeCeil` — a run already in hand — so the
   *     near-Dijkstra weight that finding a fast line requires is affordable.
   *
   * The gate path is untouched by design: with `optimise` false the ceiling is
   * Infinity, `boundFramesPerMetre` is zero, and not one comparison in the hot
   * loop changes its answer.
   */
  optimise: boolean;
  /**
   * Input frames. A run counts only if it finishes in STRICTLY fewer, which is
   * what makes an optimising round monotone: it either beats what you had or it
   * returns nothing. Infinity disables the ceiling.
   */
  timeCeil: number;
  /**
   * Metres per second the CEILING assumes, converting "metres still to go" into
   * the most optimistic frame count that could cover them.
   *
   * Deliberately not `search.vref`, which is a steering constant and wants to
   * be about the speed a bike really travels. This one decides what is thrown
   * away, so it wants to be a speed no bike on the level exceeds. Too low and
   * a faster route gets pruned before it is found; too high and nothing is
   * pruned and the optimising round runs out of clock.
   */
  boundVref: number;
  /**
   * Collect the apples in exactly this order rather than searching the order.
   *
   * This is how route tension is measured: solve once with the order searched
   * and once with the obvious order forced, and the difference is what the
   * route choice is worth. Opportunistic pickups still count — an apple driven
   * over early is collected and simply skipped when the list reaches it.
   */
  forceOrder?: number[];
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
  /**
   * Tried only when nothing before it got the leg done.
   *
   * It exists for the optimising rounds. Each of those rides one strategy, on
   * purpose — an optimising round that ran the whole ladder on every leg would
   * spend four times the clock to learn three times over what the first pass
   * already knew — but a leg the round's own weight cannot ride at all takes
   * the route down with it, and the run in hand proves the leg IS rideable. So
   * the gate's ladder rides behind as a fallback: never touched while the fast
   * weight is working, and there the moment it is not.
   */
  fallback?: boolean;
}

export const DEFAULT_SOLVE: SolveOpts = {
  rev: SIM_REV,
  timeBudgetMs: 5 * 60 * 1000,
  targetTries: 3,
  descendTolerance: 3,
  reroutes: 5,
  rerouteRadius: 2.5,
  branch: 4,
  fieldCell: 0.5,
  maxLegMs: 0,
  optimise: false,
  timeCeil: Infinity,
  boundVref: 18,
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

/**
 * The ladder an optimising round rides with, and it is a different ladder for a
 * different question.
 *
 * DEFAULT_SOLVE's strategies are ordered by how likely they are to get a leg
 * DONE, cheapest first, and the greedy weight at the top of that list is what
 * makes the gate fast. It is also what makes the gate slow, in seconds of game
 * time: a weight of 1.7 tells the frontier that a state one metre nearer the
 * apple is worth thirteen input frames, so the search happily spends a quarter
 * of a second creeping when it could have spent a tenth arriving carrying
 * speed. The line it returns is a line that works.
 *
 * Near 1.0 the frontier is ordered by something much closer to elapsed time and
 * the arrival it finds first is close to the earliest arrival there is. That is
 * unaffordable on its own — it is most of a Dijkstra over a nine-mask, four-
 * duration alphabet — and it is affordable here only because an optimising
 * round always has a run in hand to prune against. The two entries are one
 * pass that keeps a little momentum credit and one that is almost pure elapsed
 * time; the second is much the more expensive and much the more often right.
 */
export const OPT_STRATEGIES: Strategy[] = [
  // The greedy end is here on purpose and it is not the weak entry. Measured on
  // 01-first-light: 'quick' takes the gate's 13.69 s to 10.98 s and neither of
  // the patient weights below it ever improves on that, because what actually
  // drives an optimising round is the CEILING, and the ceiling rewards a
  // strategy that can finish a whole route inside the leg cap over one that
  // rides two legs beautifully and runs out of clock.
  { name: 'rush', segmentMetres: Infinity, budget: 25000, hWeight: 1.6, speedBonus: 26 },
  { name: 'quick', segmentMetres: Infinity, budget: 30000, hWeight: 1.4, speedBonus: 16 },
  { name: 'fast', segmentMetres: Infinity, budget: 60000, hWeight: 1.2, speedBonus: 8 },
  { name: 'fastest', segmentMetres: Infinity, budget: 120000, hWeight: 1.06, speedBonus: 3 },
];

/** Search knobs an optimising round wants regardless of strategy. */
export const OPT_SEARCH: Partial<Omit<SearchOpts, 'budget' | 'deadline'>> = {
  // The gate stops 2 500 expansions after the first arrival because it only
  // needs one, and it keeps six. An optimising round wants the arrivals that
  // come AFTER the first — with a weight above 1 the first is the one the
  // weight walked straight into — and it wants to hand more of them forward,
  // because the arrival the fast line wants is often not the earliest one.
  goalExtra: 4000,
  // Effectively no cap, and the cap is what it replaces.
  //
  // `goalsWanted` ends a search the moment it has that many arrivals, which for
  // the gate is right — six arrivals is a wide enough hand-off and the sooner
  // the leg is over the better. For an optimising round it is a trap: an easy
  // leg produces fourteen arrivals within a few hundred expansions, they are
  // all the same arrival with different noise on it, the search stops, and the
  // `goalExtra` expansions that were supposed to go looking for a FASTER one
  // are never spent. Here the budget is the only thing that ends a leg.
  goalsWanted: 100000,
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
   * The ceiling, as input frames, and it MOVES. It starts at whatever run the
   * caller already has and drops every time a faster one completes, so the
   * second half of an optimising round searches against the first half's best
   * rather than against where it started.
   */
  let ceil = opts.timeCeil;
  const boundFpm = opts.optimise && Number.isFinite(opts.timeCeil) ? 128 / opts.boundVref : 0;

  /**
   * Geodesic metres between two of the points of interest, symmetrised.
   *
   * The grid Dijkstra is very nearly symmetric and the small asymmetry is
   * discretisation; taking the smaller of the two directions keeps this a lower
   * bound, which is the only property the ceiling needs from it.
   */
  const pairMetres = (a: number, b: number): number => {
    if (a === b) return 0;
    const ab = distTo(b, pts[a].x, pts[a].y);
    const ba = distTo(a, pts[b].x, pts[b].y);
    const d = ab < ba ? ab : ba;
    return Number.isFinite(d) ? d : 0;
  };

  /**
   * A lower bound, in metres, on the route still to ride after arriving at `t`
   * with `rest` uncollected — the minimum spanning tree over the points that
   * remain.
   *
   * An MST over a set of points is never longer than the shortest path visiting
   * all of them, so this cannot claim more distance than the route really has,
   * which is what keeps the ceiling from pruning away a run that would have
   * been faster. The 0.9 is slack against the one place the argument leaks: an
   * apple collected opportunistically on the way past is one this bound still
   * charges for.
   */
  const TAIL_SLACK = 0.9;
  const tailMetres = (t: number, rest: readonly number[]): number => {
    if (t === FLOWER) return 0;
    const set = [t, ...rest, FLOWER];
    const n = set.length;
    if (n <= 1) return 0;
    const inTree = new Array<boolean>(n).fill(false);
    const best = new Array<number>(n).fill(Infinity);
    best[0] = 0;
    let total = 0;
    for (let k = 0; k < n; k++) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
      if (u < 0 || !Number.isFinite(best[u])) break;
      inTree[u] = true;
      total += best[u];
      for (let i = 0; i < n; i++) {
        if (inTree[i]) continue;
        const d = pairMetres(set[u], set[i]);
        if (d < best[i]) best[i] = d;
      }
    }
    return total * TAIL_SLACK;
  };

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

  const sim = getEngine(opts.rev).createSim(level, spec);
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
  const rideWith = (seeds: number[], t: number, st: Strategy, tailFr: number): { arrivals: number[]; weak: boolean } | null => {
    nodes.pool.load(seeds[0], sim.state);
    const d0 = distTo(t, sim.state.px, sim.state.py);
    const thresholds: number[] = [];
    if (Number.isFinite(d0) && Number.isFinite(st.segmentMetres)) {
      for (let d = d0 - st.segmentMetres; d > st.segmentMetres * 0.6; d -= st.segmentMetres) thresholds.push(d);
    }
    thresholds.push(0);

    let cur = seeds;
    let weak = false;
    const legDeadline = opts.maxLegMs > 0
      ? Math.min(deadline, Date.now() + opts.maxLegMs)
      : deadline;
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
        budget: st.budget, deadline: legDeadline,
        costCeil: ceil, tailFrames: tailFr, boundFramesPerMetre: boundFpm,
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

  /**
   * One leg: from a set of seed states to apple `t` (or the flower).
   *
   * Gating and optimising want opposite things from this function and it does
   * both. Gating wants the first strategy that works, because a leg that is
   * done is a leg that is done and the next one is waiting. Optimising wants
   * the fastest of them, because "it worked" is the one thing about a leg that
   * carries no information about the run's time — and the cheap strategy's
   * greedy weight is precisely the one that trades seconds for certainty.
   */
  const ride = (seeds: number[], t: number, depth: number, tailFr: number): number[] | null => {
    const name = t === FLOWER ? 'flower' : `apple ${t}`;
    const memo = seeds[0] + '|' + t;
    if (deadLeg.has(memo)) return null;
    nodes.pool.load(seeds[0], sim.state);
    const fromX = sim.state.px;
    const fromY = sim.state.py;
    let weakFallback: number[] | null = null;
    let bestArrivals: number[] | null = null;
    let bestG = Infinity;
    // A leg the per-leg clock cut off is not a leg that failed, and memoising
    // it as dead would write it off for the whole round on the strength of a
    // stopwatch. `deadLeg` is meant to be EXACT — the same node and the same
    // target is literally the same search — and a search that was stopped is
    // not the same search.
    let cutShort = false;

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

        if (st.fallback && (bestArrivals || weakFallback)) continue;
        if (Date.now() > deadline) return bestArrivals ?? weakFallback ?? null;
        const got = rideWith(seeds, t, st, tailFr);
        if (got) {
          const secs = (nodes.g[got.arrivals[0]] - nodes.g[seeds[0]]) / 128;
          // An arrival nothing simple can be ridden out of is accepted only if
          // no strategy does better. Handing one forward is how a leg poisons
          // every leg after it: the next search expands four doomed seeds, the
          // frontier empties in four expansions, and the level reads as
          // impossible when the real problem is upstream.
          if (!got.weak) {
            if (!opts.optimise) {
              say(`    leg ${depth}: ${name} in ${secs.toFixed(2)} s [${st.name}${round > 0 ? ' +' + round + ' reroute' : ''}] (${((Date.now() - t0) / 1000).toFixed(0)} s elapsed)`);
              return got.arrivals;
            }
            const g = nodes.g[got.arrivals[0]];
            if (g < bestG) {
              bestG = g;
              bestArrivals = got.arrivals;
              say(`    leg ${depth}: ${name} in ${secs.toFixed(2)} s [${st.name}${round > 0 ? ' +' + round + ' reroute' : ''}] (${((Date.now() - t0) / 1000).toFixed(0)} s elapsed)`);
            }
            continue;
          }
          if (!weakFallback) weakFallback = got.arrivals;
          continue;
        }
        const last = segments[segments.length - 1];
        if (last.stats.timedOut) cutShort = true;
        if (last.stats.expansions >= 500) sawRealSearch = true;
        const reach = last.threshold + last.stats.closest;
        if (reach < stallReach) { stallReach = reach; stallX = last.stats.closestX; stallY = last.stats.closestY; }
      }
      // A strategy got there. Blocking the map now would be blocking a route
      // that demonstrably works, which is the one thing re-routing must never
      // do — it exists for legs nothing can ride.
      if (bestArrivals) break;
      if (round === opts.reroutes || Date.now() > deadline || !sawRealSearch) break;
      if (!reroute(t, stallX, stallY, fromX, fromY)) break;
      say(`    ${name}: blocked the map around (${stallX.toFixed(1)}, ${stallY.toFixed(1)}) and re-routed — the grid said that was a way through and it is not`);
    }
    if (bestArrivals) return bestArrivals;
    if (weakFallback) {
      say(`    leg ${depth}: ${name} reached, but only into a state nothing simple rides out of (${((Date.now() - t0) / 1000).toFixed(0)} s elapsed)`);
      return weakFallback;
    }
    if (Date.now() <= deadline && !cutShort) deadLeg.add(memo);
    return null;
  };

  /**
   * Depth-first over apple order.
   *
   * Gating takes the first order that completes. Optimising takes the fastest
   * one it can reach inside the clock, which is the same walk with three
   * differences: it does not stop at the first complete route, it drops the
   * ceiling every time a faster one lands, and before it spends a search on a
   * leg it asks whether anything through that leg could still beat the ceiling.
   *
   * The ordering of `targets` matters much more here than it does for the gate.
   * Depth-first with a moving ceiling only prunes what it has already beaten,
   * so the first order walked decides how much of the rest survives — and the
   * tier rule below is a good guess, which is why it is kept as the order of
   * exploration even where every branch is explored.
   */
  const attempt = (from: number[], remaining: number[], order: number[], depth: number): { node: number; order: number[] } | null => {
    if (Date.now() > deadline) return null;
    const plan = from[0] + '|' + remaining.join(',');
    if (deadPlan.has(plan)) return null;
    nodes.pool.load(from[0], sim.state);
    const fx = sim.state.px;
    const fy = sim.state.py;
    const g0 = nodes.g[from[0]];

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
      : opts.forceOrder
        ? [opts.forceOrder.find((i) => remaining.includes(i)) ?? remaining[0]]
        : (() => {
            const scored = remaining.map((i) => ({ i, d: distTo(i, fx, fy), y: level.apples[i].y }));
            const here = scored.filter((e) => e.y >= fy - opts.descendTolerance).sort((a, b) => a.d - b.d);
            const below = scored.filter((e) => e.y < fy - opts.descendTolerance).sort((a, b) => a.d - b.d);
            const width = Math.max(1, opts.optimise ? Math.max(opts.targetTries, 3) : opts.targetTries);
            return [...here, ...below].slice(0, width).map((e) => e.i);
          })();

    let best: { node: number; order: number[] } | null = null;

    for (const t of targets) {
      if (Date.now() > deadline) break;
      const rest0 = remaining.filter((i) => i !== t);
      const tailM = tailMetres(t, rest0);
      const tailFr = tailM * boundFpm;

      // Could anything through this leg still beat the run in hand? Frames
      // already spent, plus the fastest anything could cover the leg, plus the
      // fastest anything could cover what is left after it. Cheap, and it is
      // what stops "try every order" from meaning "search every order".
      if (opts.optimise && Number.isFinite(ceil)) {
        const dHere = distTo(t, fx, fy);
        const lb = g0 + (Number.isFinite(dHere) ? dHere : 0) * boundFpm + tailFr;
        if (lb >= ceil) continue;
      }

      const arrivals = ride(from, t, depth, tailFr);
      if (!arrivals) {
        if (Date.now() > deadline) break;
        continue;
      }
      if (t === FLOWER) {
        const g = nodes.g[arrivals[0]];
        if (!best || g < nodes.g[best.node]) best = { node: arrivals[0], order };
        if (opts.optimise) {
          if (g < ceil) {
            ceil = g;
            say(`    route complete in ${(g / 128).toFixed(2)} s — ceiling is now ${(ceil / 128).toFixed(2)} s`);
          }
          continue;
        }
        return best;
      }

      // Opportunistic pickups count. A leg aimed at apple 3 that drives over
      // apple 5 on the way has collected apple 5, and pretending otherwise
      // would send the next leg back for something already in the bag.
      nodes.pool.load(arrivals[0], sim.state);
      const taken = [...sim.state.applesTaken];
      const got = remaining.filter((i) => taken[i] !== 0);
      const rest = remaining.filter((i) => taken[i] === 0);
      const sub = attempt(arrivals, rest, [...order, t, ...got.filter((i) => i !== t)], depth + 1);
      if (sub) {
        if (!best || nodes.g[sub.node] < nodes.g[best.node]) best = sub;
        if (!opts.optimise) return best;
      }
      if (Date.now() > deadline) break;
    }
    if (!best && Date.now() <= deadline) deadPlan.add(plan);
    return best;
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
