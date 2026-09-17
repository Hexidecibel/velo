// The montage: every attempt of the session, at once, over the one that worked.
//
// Super Meat Boy's trick, and it is the single most-loved thing in that game
// because it turns a grind into a visible story — fifty of you dying in fifty
// different wrong ways while one of you gets through. What it costs here is
// almost nothing, and that is a consequence of a decision made on day one
// rather than of anything clever in this file: a replay is an INPUT STREAM of
// about a kilobyte, not a trajectory, so a hundred attempts is ~100 KB and
// playback is N sims stepping in parallel. `createSim` is roughly a microsecond
// and the sim was built snapshot/restore-able and headless for the solver.
//
// NO DOM AND NO SIM IN THIS FILE'S DECISIONS. Which attempts are shown, how
// faint they are drawn and which of them are worth drawing at all is arithmetic
// over plain objects, tested in plain node; `main.ts` owns the riders and the
// frame. The split is the same one results.ts makes, for the same reason.
//
// THREE RULES FROM THE PLAN, AND EACH IS LOAD-BEARING:
//
//   1. FADE THE GHOSTS SO THE WINNING LINE READS. The successful run is the
//      player's own sim at full strength; everything else is faint, and gets
//      fainter as the crowd grows, because forty bikes at a readable alpha
//      composite into a solid smear and the readability rule outranks the
//      spectacle.
//   2. A GHOST STOPS AT ITS DEATH TICK RATHER THAN VANISHING. That is in
//      `createRider` and it is the whole point: the pile of stopped bikes at
//      the hard part is a heat map of where the level beat you, and a rider
//      that disappeared when it died would erase exactly the thing worth
//      showing.
//   3. IT IS OFFERED, NEVER FORCED. The results screen's standing rule is that
//      the fastest path back into the game is the default and dismissal is
//      instant, so the montage is a key you press, printed on the panel like
//      every other action. Nothing plays at you before you can hit Enter.
import { SIM_REV } from '@/sim/rev.ts';
import type { Replay } from '@/sim/replay.ts';
import type { Attempt, Outcome } from './recorder.ts';

/**
 * How many attempts ride at once, at most.
 *
 * MEASURED, NOT GUESSED — `bin/montagebench`, on 20-close-quarters, at
 * 900x500, with the art's adaptive detail forced OFF so the number cannot be
 * bought by quietly turning the game down, each rider on its own input stream
 * so the crowd is spread the way a real one is:
 *
 *   riders   sim step (ms/input frame)   draw delta p50   total @60 fps
 *        6                      0.055           8.3 ms         8.4 ms
 *       12                      0.078           5.4 ms         5.6 ms
 *       24                      0.121           9.7 ms        10.0 ms
 *       40                      0.190          10.8 ms        11.2 ms
 *
 * The rows are +-2-3 ms of scheduler noise apiece — this box runs at a load
 * average around 15 and an EMPTY frame of the same scene measured between 6
 * and 12 ms across runs, which is why the 6-rider row can come out above the
 * 12-rider one. Across every run the marginal cost is about 0.25 ms of draw per
 * rider, and drawing is the binding term by an order of magnitude over the
 * riders' own sims.
 *
 * THE PLAN'S ESTIMATE WAS RIGHT ABOUT THE HALF IT MEASURED AND THE OTHER HALF
 * IS THE BILL. 8.8 us per sim-tick predicted ~3.7 ms for fifty riders, and the
 * sim half here is far better than that — a fifth of a millisecond of a
 * rendered frame for forty. It is the DRAWING that costs, even on the
 * renderer's cheap silhouette tier.
 *
 * 24, NOT THE 50 THE PLAN SKETCHED, and the level that decided it is
 * 20-close-quarters — the densest in the set, the one the user can already
 * feel, and the one where CULLING SAVES LEAST because the crowd dies inside
 * the same few metres and most of it is on screen at once. 24 costs about
 * 10 ms there.
 *
 * And those milliseconds are a FLOOR, not a ceiling: this box has no GPU, so
 * Chrome rasterises on the CPU. A machine with a GPU is faster, never slower.
 * The cap is conservative on purpose — the montage is a reward at the end of a
 * level, and a reward that stutters is not one.
 */
export const MONTAGE_CAP = 24;

/** Minimum attempts before the montage is worth offering at all. */
export const MONTAGE_MIN = 2;

export interface MontagePick {
  /** The attempt's session number, 1-based, as the recorder assigned it. */
  n: number;
  outcome: Outcome;
  replay: Replay;
  /**
   * True for the run that finished — the line the montage is told against.
   *
   * It is in the selection rather than filtered out of it so that a caller can
   * skip building a rider for it (the player's own sim already rides that line
   * at full strength) without having to know which one it was.
   */
  winner: boolean;
}

export interface MontageSelection {
  /** Oldest first, so the draw order is the order they happened. */
  picks: MontagePick[];
  /** Attempts on this level in the log, whatever their state. */
  total: number;
  /** Eligible, but over the cap. Named so the panel can say "the last 40 of 97". */
  dropped: number;
  /**
   * Eligible in every way except that they were ridden under different physics
   * or a different bike. Counted, never shown — the same rule the leaderboard
   * ghost runs under, and for the same reason: replaying those inputs here
   * would draw a line nobody rode.
   */
  incompatible: number;
  deaths: number;
  finishes: number;
  /** Gave up and pressed R. Part of the story, and it is honest about it. */
  abandoned: number;
}

export interface MontageQuery {
  /** The level's identity. Attempts are already filtered by it; this re-checks. */
  simHash: string;
  /** The bike being ridden RIGHT NOW. */
  specHash: string;
  /** The finishing run, so it can be marked. Null outside a finish. */
  winner: Replay | null;
  cap?: number;
}

/**
 * Choose which attempts ride.
 *
 * PREFER THE MOST RECENT, and keep the winner whatever happens. Recency is the
 * right bias because the last forty attempts are the ones on the part of the
 * level that was actually hard — the first ten are you learning that the ramp
 * exists, and they all die in the same uninteresting place. The winner is
 * exempt from the cap because a montage without the line that worked is just a
 * pile of failures.
 */
export function selectMontage(
  attempts: readonly Attempt[],
  q: MontageQuery,
): MontageSelection {
  const cap = Math.max(1, q.cap ?? MONTAGE_CAP);
  let total = 0;
  let incompatible = 0;
  const eligible: Attempt[] = [];
  for (const a of attempts) {
    const r = a.replay;
    if (r.simHash !== q.simHash) continue;
    total++;
    if (r.frames <= 0) continue;
    // The same three fields `ghostCompat` checks, checked here rather than
    // imported, because a Replay is all there is at this point — there is no
    // level and no spec object in this file, and there should not be.
    if (r.simRev !== SIM_REV || r.specHash !== q.specHash) {
      incompatible++;
      continue;
    }
    eligible.push(a);
  }

  // The winner first, out of the pool, so the cap can never evict it.
  const winnerIdx = q.winner ? eligible.findIndex((a) => a.replay === q.winner) : -1;
  const winner = winnerIdx >= 0 ? eligible[winnerIdx] : null;
  const rest = winnerIdx >= 0 ? eligible.filter((_, i) => i !== winnerIdx) : eligible;

  const room = winner ? cap - 1 : cap;
  const kept = room <= 0 ? [] : rest.slice(Math.max(0, rest.length - room));
  const dropped = rest.length - kept.length;

  const picks: MontagePick[] = kept.map((a) => ({
    n: a.n,
    outcome: a.outcome,
    replay: a.replay,
    winner: false,
  }));
  if (winner) {
    picks.push({ n: winner.n, outcome: winner.outcome, replay: winner.replay, winner: true });
  }
  // Oldest first. `kept` is already in log order and the winner is the newest
  // thing in the log by construction, so appending it keeps that true.

  let deaths = 0;
  let finishes = 0;
  let abandoned = 0;
  for (const p of picks) {
    if (p.outcome === 'dead') deaths++;
    else if (p.outcome === 'finished') finishes++;
    else abandoned++;
  }
  return { picks, total, dropped, incompatible, deaths, finishes, abandoned };
}

/**
 * How faint one ghost is drawn, given how many of them there are.
 *
 * A single ghost draws at 0.3 in the art renderer and that is the number to
 * match at the low end — the montage must not introduce a second idiom for
 * "another bike". But alpha COMPOSITES: forty bikes at 0.3 stacked on the same
 * three metres of a hard section is opaque, and the winning line then reads
 * against a solid block rather than against a crowd.
 *
 * So it falls off as 1/sqrt(n), which is the curve that keeps the apparent
 * density of the crowd roughly constant, with a floor so a rider alone at the
 * far end of the level does not fade to nothing. The floor is the reason this
 * is a function and not a division.
 */
export const MONTAGE_ALPHA_MAX = 0.3;
export const MONTAGE_ALPHA_MIN = 0.075;

export function montageAlpha(count: number): number {
  if (count <= 1) return MONTAGE_ALPHA_MAX;
  const a = MONTAGE_ALPHA_MAX * Math.sqrt(4 / count);
  if (a < MONTAGE_ALPHA_MIN) return MONTAGE_ALPHA_MIN;
  return a > MONTAGE_ALPHA_MAX ? MONTAGE_ALPHA_MAX : a;
}

/**
 * THE CROWD IS ALWAYS DRAWN AS SILHOUETTES, and this is why.
 *
 * It is the renderer's OWN coarse tier — the one a bike already drops to when
 * it is small on screen — asked for explicitly rather than invented here, so
 * nothing about this is a second way to draw a motorbike.
 *
 * READABILITY FIRST. A dozen full-detail bikes, chrome and panel lines and
 * exhaust smoke times twelve, is a texture rather than a crowd, and the winning
 * line then has to read against noise instead of against bikes. The whole
 * picture only works if the one that made it is unmistakable.
 *
 * AND IT IS THE DIFFERENCE BETWEEN FITTING AND NOT. `bin/montagebench`, on
 * 20-close-quarters where nothing culls: a full-detail rider costs about
 * 2.2 ms of a frame on this GPU-less box, a silhouette about 0.45 ms. Roughly
 * five times, and drawing is the binding term by an order of magnitude over the
 * riders' sims.
 *
 * It was briefly a THRESHOLD — full detail below a dozen riders, silhouettes
 * above — and that was worse than either rule on its own, because it put a
 * CLIFF in the middle: twelve attempts measured at 26 ms and twenty-four at
 * 12 ms, so watching fewer of your failures cost more than watching more of
 * them. A cost curve that goes down as you ask for more is the kind of thing
 * nobody ever thinks to look for.
 */

/** The view a cull is done against, in METRES. Half-extents, not corners. */
export interface ViewBox {
  x: number;
  y: number;
  halfW: number;
  halfH: number;
}

/**
 * Which riders are worth drawing.
 *
 * THEY ALL KEEP STEPPING. This culls the DRAW and never the sim: a rider whose
 * sim was paused because it went off screen would come back at the wrong place
 * and at the wrong moment, which is a desync you would see and not be able to
 * explain. Stepping is the cheap half anyway — on the art renderer, drawing a
 * bike costs more than advancing one.
 *
 * The margin is in metres and generous on purpose: a bike is 1.7 m long and is
 * drawn from its chassis centre, so a cull tight to the frame would clip wheels
 * off riders at the edge.
 */
export function visibleRiders(
  riders: readonly { x: number; y: number }[],
  view: ViewBox,
  margin = 2.5,
): number[] {
  const out: number[] = [];
  const hw = view.halfW + margin;
  const hh = view.halfH + margin;
  for (let i = 0; i < riders.length; i++) {
    const r = riders[i];
    if (r.x < view.x - hw || r.x > view.x + hw) continue;
    if (r.y < view.y - hh || r.y > view.y + hh) continue;
    out.push(i);
  }
  return out;
}

/** One line for the HUD and the results action, in the game's plain voice. */
export function montageLabel(sel: MontageSelection): string {
  const n = sel.picks.length;
  const bits: string[] = [];
  if (sel.deaths > 0) bits.push(`${sel.deaths} dead`);
  if (sel.abandoned > 0) bits.push(`${sel.abandoned} given up on`);
  if (sel.finishes > 0) bits.push(`${sel.finishes} finished`);
  const tail = bits.length ? ` (${bits.join(', ')})` : '';
  const of = sel.dropped > 0 ? ` of ${sel.total}` : '';
  return `${n} attempt${n === 1 ? '' : 's'}${of}${tail}`;
}
