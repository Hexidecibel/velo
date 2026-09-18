// THE DELIBERATE FEEDBACK TIER: `bin/solve`, fired on purpose, reported while
// it runs, and watchable when it lands.
//
// WHY IT IS NOT LIVE. A solve is one to fourteen minutes on one core. There is
// no version of that which belongs in a pointermove handler, and there is no
// cheaper search that answers the same question — the whole reason the solver
// exists is that the scripted pilot `bin/level-drive` GUESSES, and it has told
// us a level was uncompletable when it was not TWICE. Telling an author their
// level is broken when it is not is worse than telling them nothing, so this
// tier stays explicit, slow and honest rather than fast and wrong.
//
// WHAT COMES BACK IS WORTH THE WAIT, AND IT IS FOUR THINGS:
//   completable      or an honest "could not, and here is where it stalled"
//   the apple order   route choice is where this game's depth lives
//   a difficulty score measured from the search, on the same 0-100 scale the
//                    level chooser already shows for the shipped twenty
//   a watchable replay the solver's own line, loadable like any other replay
//
// This file is the client half: start a job, poll it, and turn what comes back
// into something a panel can print. The pure functions are the interesting
// ones and they are what the tests cover; the two fetches are not.
import type { EditDoc } from './doc.ts';
import { docToFileText } from './doc.ts';

export interface SolveDifficulty {
  score: number;
  precision: number;
  clearance: number;
  effort: number;
  lethality: number;
  line: { minHeadClearance: number; atX: number; atY: number; airFraction: number; maxSpeed: number; flips: number };
}

/** One element of `bin/solve --json`. Deliberately a subset of what it writes. */
export interface SolveReport {
  name?: string;
  solved?: boolean;
  verified?: boolean;
  seconds?: number;
  frames?: number;
  appleOrder?: number[];
  apples?: number;
  difficulty?: SolveDifficulty | null;
  routeMetres?: number;
  expansions?: number;
  deaths?: number;
  wallMs?: number;
  failure?: string | null;
  simRev?: number;
}

export interface SolveState {
  id: number;
  state: 'running' | 'done' | 'failed';
  lines: string[];
  report: SolveReport | null;
  replay: unknown;
  error: string | null;
  elapsedMs: number;
}

export interface SolveSummary {
  /** The headline. */
  verdict: 'solved' | 'unsolved' | 'failed' | 'running';
  headline: string;
  /** Lines for the panel, in order. Already formatted. */
  rows: { label: string; value: string }[];
  /** True when there is a replay to watch. */
  watchable: boolean;
}

/** How often to ask. Two seconds: this thing takes minutes. */
export const POLL_MS = 2000;

export async function startSolve(
  doc: EditDoc,
  seconds: number,
  effort: number,
  fetchFn: typeof fetch = fetch,
): Promise<{ job: number | null; error: string | null }> {
  try {
    const r = await fetchFn('/api/authoring/solve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: doc.id, level: JSON.parse(docToFileText(doc)) as unknown, seconds, effort }),
    });
    const j = (await r.json()) as { job?: number; error?: string };
    if (!r.ok) return { job: null, error: j.error ?? `HTTP ${r.status}` };
    return { job: j.job ?? null, error: null };
  } catch (e) {
    return { job: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function pollSolve(job: number, fetchFn: typeof fetch = fetch): Promise<SolveState | null> {
  try {
    const r = await fetchFn(`/api/authoring/solve?job=${job}`);
    if (!r.ok) return null;
    return (await r.json()) as SolveState;
  } catch {
    return null;
  }
}

export async function stopSolve(job: number, fetchFn: typeof fetch = fetch): Promise<void> {
  try {
    await fetchFn(`/api/authoring/solve?job=${job}`, { method: 'DELETE' });
  } catch { /* the job is the server's problem from here */ }
}

/**
 * The most recent line of the solver's own log that says something.
 *
 * `bin/solve --progress` streams the search's segment-by-segment log, which is
 * the only honest progress signal there is: the search has no total to be a
 * fraction of, so a percentage bar would be a lie with a shape.
 */
export function progressNote(s: SolveState): string {
  const last = [...s.lines].reverse().find((l) => l.trim().length > 0 && !l.startsWith('==>'));
  const mins = Math.floor(s.elapsedMs / 60000);
  const secs = Math.floor((s.elapsedMs % 60000) / 1000);
  const clock = `${mins}:${String(secs).padStart(2, '0')}`;
  return last ? `${clock}  ${last.trim()}` : `${clock}  searching`;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** What the panel prints. Pure, so the interesting half is testable. */
export function summarise(s: SolveState | null): SolveSummary {
  if (!s) return { verdict: 'running', headline: 'no answer from the solver', rows: [], watchable: false };
  if (s.state === 'running') {
    return { verdict: 'running', headline: progressNote(s), rows: [], watchable: false };
  }
  if (s.state === 'failed') {
    return { verdict: 'failed', headline: s.error ?? 'the solver failed', rows: [], watchable: false };
  }
  const r = s.report;
  if (!r) return { verdict: 'failed', headline: 'the solver finished without a report', rows: [], watchable: false };

  if (!r.solved) {
    // AN HONEST "COULD NOT", NEVER A "CANNOT". The solver has been wrong in
    // this direction twice, and a level called impossible when it is merely
    // hard is the most expensive wrong answer this tool can give.
    return {
      verdict: 'unsolved',
      headline: 'no route found — which is "could not", not "cannot"',
      rows: [
        { label: 'stopped at', value: r.failure ?? 'unknown' },
        { label: 'searched', value: `${fmtInt(r.expansions)} expansions, ${fmtInt(r.deaths)} deaths, ${fmtSecs(r.wallMs)}` },
        { label: 'try', value: 'a longer budget or more effort before believing it' },
      ],
      watchable: false,
    };
  }

  const d = r.difficulty ?? null;
  const rows: { label: string; value: string }[] = [
    { label: 'time', value: `${(r.seconds ?? 0).toFixed(2)} s${r.verified ? ', re-verified' : ', NOT verified'}` },
    { label: 'apple order', value: (r.appleOrder?.length ? r.appleOrder.join(' → ') : '(none)') },
  ];
  if (d) {
    rows.push({ label: 'difficulty', value: `${d.score.toFixed(0)}/100` });
    rows.push({
      label: 'why',
      value: `precision ${d.precision.toFixed(2)}  clearance ${d.clearance.toFixed(2)}  effort ${d.effort.toFixed(2)}  lethality ${d.lethality.toFixed(2)}`,
    });
    rows.push({
      label: 'head clearance',
      value: `${d.line.minHeadClearance.toFixed(2)} m at (${d.line.atX.toFixed(0)}, ${d.line.atY.toFixed(0)})`,
    });
    rows.push({
      label: 'the line',
      value: `${pct(d.line.airFraction)} airborne, peak ${d.line.maxSpeed.toFixed(1)} m/s, ${d.line.flips} flips`,
    });
  }
  rows.push({ label: 'search', value: `${fmtInt(r.expansions)} expansions, ${fmtSecs(r.wallMs)}` });
  return {
    verdict: 'solved',
    headline: `completable in ${(r.seconds ?? 0).toFixed(2)} s`,
    rows,
    watchable: s.replay !== null && s.replay !== undefined,
  };
}

function fmtInt(v: number | undefined): string {
  return (v ?? 0).toLocaleString('en-US');
}

function fmtSecs(ms: number | undefined): string {
  const s = (ms ?? 0) / 1000;
  return s >= 90 ? `${(s / 60).toFixed(1)} min` : `${s.toFixed(0)} s`;
}
