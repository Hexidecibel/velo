// The real work behind bin/difficulty-import. Underscore-prefixed because it is
// run BY a bin/ script rather than by hand.
//
// It turns a `bin/solve --json` payload into `src/solver/measured.ts`, the one
// place the CLIENT can read a measured difficulty score and a par time from.
//
// WHY THIS EXISTS AT ALL. The numbers are real — they come out of
// `src/solver/difficulty.ts`, measured on the best line anything has found —
// but producing them costs hours of CPU across the set, so the client cannot
// compute them and there is nothing to import at runtime. Until this existed
// they lived only as console output and a table in the README, which is exactly
// the shape of thing that rots: somebody edits a level, the number in the
// README stays, and the game shows a confident rating for geometry that no
// longer exists.
//
// THREE THINGS STOP THAT HERE.
//
//   1. EVERY ROW IS KEYED BY `simHash` AND `simRev`, not by filename. simHash
//      covers exactly the fields the sim reads, so moving one apple re-keys the
//      level and the row silently stops matching — the chooser then shows
//      "unrated" rather than a stale number. A rename or a recolour keeps it,
//      which is the same split the leaderboard already trusts.
//   2. EVERY ROW RECORDS THE MODE IT WAS MEASURED IN. This is the newer
//      guarantee and it comes from a real failure: the same geometry scores up
//      to fourteen composite points apart depending on whether the line came
//      from the satisficing gate or from the optimiser, and on 21-rollers the
//      FAST line is the roomier one. A row that says only `simHash` and
//      `simRev` cannot be compared to another row, because it does not say what
//      it is. `MeasuredRow.mode` is not optional and the writer below cannot
//      emit a row without one.
//   3. The file is GENERATED and says so, so the honest way to change a number
//      is to re-run the solver rather than to edit a literal.
//
// Usage is in bin/difficulty-import.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseLevel } from '../src/sim/level.ts';
// The noise floor lives with the measurement, not here, so there is one of it.
import { tensionOf as makeTension } from '../src/solver/difficulty.ts';

interface SolveDifficulty {
  score?: unknown;
  scoreRev?: unknown;
  measuredOn?: unknown;
  slip?: unknown;
  clearance?: unknown;
  nudge?: unknown;
  effort?: unknown;
  lethality?: unknown;
  line?: { minHeadClearance?: unknown };
  humanSlip?: { lethal?: unknown; trials?: unknown };
}

interface SolveTension {
  searchedSeconds?: unknown;
  greedySeconds?: unknown;
  greedyOrder?: unknown;
  spreadSeconds?: unknown;
  real?: unknown;
}

interface SolveMode {
  line?: unknown;
  hands?: unknown;
  budgetSeconds?: unknown;
  slipTrials?: unknown;
  slipSigmaMs?: unknown;
  nudgeTrials?: unknown;
  seed?: unknown;
  effort?: unknown;
}

interface SolveRow {
  file?: unknown;
  forcedOrder?: unknown;
  name?: unknown;
  simRev?: unknown;
  solved?: unknown;
  seconds?: unknown;
  wallMs?: unknown;
  par?: unknown;
  parMode?: unknown;
  gateSeconds?: unknown;
  unrated?: unknown;
  mode?: SolveMode | null;
  tension?: SolveTension | null;
  difficulty?: SolveDifficulty | null;
}

const argv = process.argv.slice(2);
// One free-text line stamped into the generated header. It is here because the
// provenance of a number matters more than the number: a file that says only
// "generated" cannot tell you whether it came from a full solve, a partial one,
// or a transcription of an older run.
const noteAt = argv.indexOf('--note');
const note = noteAt >= 0 ? (argv[noteAt + 1] ?? '') : '';
let args = noteAt >= 0 ? [...argv.slice(0, noteAt), ...argv.slice(noteAt + 2)] : argv;
// Route tension is a SEPARATE, FLAGGED run — it costs a second whole solve per
// level — so it arrives as its own payload and is merged in by simHash rather
// than being expected on the main one.
// A SECOND MEASURING RUN OF THE SAME LEVELS, merged per level by the same rules
// the solver applies inside one run: the FASTEST par wins the time, the MOST
// FORGIVING line wins the score. It exists because the two runs are hours apart
// in cost and an interrupted set should not have to be re-measured whole — and
// because scoring the most forgiving line is only as good as the number of
// lines that were offered to it.
const alsoAt = args.indexOf('--also');
const alsoFiles: string[] = [];
if (alsoAt >= 0) {
  let i = alsoAt + 1;
  while (i < args.length && !args[i].startsWith('--')) alsoFiles.push(args[i++]);
  args = [...args.slice(0, alsoAt), ...args.slice(i)];
}
const tenAt = args.indexOf('--tension');
const tensionFile = tenAt >= 0 ? args[tenAt + 1] : undefined;
args = tenAt >= 0 ? [...args.slice(0, tenAt), ...args.slice(tenAt + 2)] : args;
const inFile = args[0];
const outFile = args[1] ?? 'src/solver/measured.ts';
if (inFile === undefined) {
  console.error('usage: bin/difficulty-import <solved.json> [out.ts] [--also <more.json> ...] [--tension <tension.json>] [--note "where these came from"]');
  process.exit(2);
}

const load = (f: string): SolveRow[] => {
  const p: unknown = JSON.parse(readFileSync(f, 'utf8'));
  if (!Array.isArray(p)) {
    console.error('==> ' + f + ' is not a bin/solve --json payload (expected an array)');
    process.exit(2);
  }
  return p as SolveRow[];
};

const rawPayload = load(inFile);

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const r2 = (v: number, dp: number): number => Number(v.toFixed(dp));

interface Mode {
  line: string;
  hands: string;
  budgetSeconds: number;
  slipTrials: number;
  slipSigmaMs: number;
  nudgeTrials: number;
  seed: number;
  effort: number;
}

interface TensionRow {
  searchedSeconds: number;
  greedySeconds: number | null;
  greedyOrder: number[];
  spreadSeconds: number | null;
  real: boolean;
}

interface Row {
  simHash: string;
  name: string;
  simRev: number;
  solved: boolean;
  score: number | null;
  precision: number | null;
  clearance: number | null;
  effort: number | null;
  lethality: number | null;
  minHeadClearance: number | null;
  solveSeconds: number | null;
  searchSeconds: number | null;
  scoreRev: number;
  mode: Mode;
  par: number | null;
  parMode: string;
  gateSeconds: number | null;
  slip: number | null;
  nudge: number | null;
  unrated: string | null;
  tension: TensionRow | null;
}

const DEFAULT_MODE: Mode = {
  line: 'gate', hands: 'solver', budgetSeconds: 0,
  slipTrials: 0, slipSigmaMs: 0, nudgeTrials: 0, seed: 0, effort: 1,
};

function modeOf(raw: SolveMode | null | undefined, file: string): Mode {
  if (!raw) {
    console.error('==> ' + file + ': the row carries no `mode`. Re-solve with a bin/solve that emits one —');
    console.error('    a row that does not say how it was measured is a row nobody can trust later.');
    process.exit(2);
  }
  return {
    line: str(raw.line) ?? DEFAULT_MODE.line,
    hands: str(raw.hands) ?? DEFAULT_MODE.hands,
    budgetSeconds: num(raw.budgetSeconds) ?? 0,
    slipTrials: num(raw.slipTrials) ?? 0,
    slipSigmaMs: num(raw.slipSigmaMs) ?? 0,
    nudgeTrials: num(raw.nudgeTrials) ?? 0,
    seed: num(raw.seed) ?? 0,
    effort: num(raw.effort) ?? 1,
  };
}

function tensionOf(raw: SolveTension | null | undefined): TensionRow | null {
  if (!raw) return null;
  const searched = num(raw.searchedSeconds);
  if (searched === null) return null;
  const spread = num(raw.spreadSeconds);
  return {
    searchedSeconds: searched,
    greedySeconds: num(raw.greedySeconds),
    greedyOrder: Array.isArray(raw.greedyOrder) ? (raw.greedyOrder as number[]) : [],
    // Infinity does not survive JSON and "the obvious order cannot do this
    // level at all" is not a number anyway, so it is stored as null with
    // `real` true beside it.
    spreadSeconds: spread === null ? null : spread,
    real: raw.real === true,
  };
}

/**
 * simHash -> tension, from the separate run.
 *
 * TWO SHAPES ARE ACCEPTED, because there are two honest ways to pay for this.
 * `bin/solve --tension` does both solves in one job and puts a whole `tension`
 * object on the row. `bin/solve --order greedy` does only the forced half, which
 * is HALF THE COST when the searched half already exists in the main payload —
 * and that is the usual case, because the main payload is exactly a run with the
 * order searched. In the second shape the row carries a `forcedOrder` and a
 * `par`, and the spread is computed here against the main payload's par.
 */
const tensions = new Map<string, TensionRow>();
const forcedPars = new Map<string, { seconds: number | null; order: number[] }>();
if (tensionFile !== undefined) {
  for (const raw of load(tensionFile)) {
    const file = str(raw.file);
    if (file === null) continue;
    const hash = parseLevel(JSON.parse(readFileSync(file, 'utf8'))).simHash;
    const t = tensionOf(raw.tension);
    if (t !== null) { tensions.set(hash, t); continue; }
    const order = Array.isArray(raw.forcedOrder) ? (raw.forcedOrder as number[]) : null;
    if (order === null) continue;
    forcedPars.set(hash, { seconds: raw.solved === true ? num(raw.par) : null, order });
  }
}

/** The half-cost shape: a forced-order par against this payload's searched par. */
function tensionFromForced(hash: string, searched: number | null): TensionRow | null {
  const f = forcedPars.get(hash);
  if (f === undefined || searched === null) return null;
  const t = makeTension(searched, f.seconds, f.order);
  return {
    searchedSeconds: t.searchedSeconds,
    greedySeconds: t.greedySeconds,
    greedyOrder: [...t.greedyOrder],
    spreadSeconds: Number.isFinite(t.spreadSeconds) ? t.spreadSeconds : null,
    real: t.real,
  };
}

/**
 * Merge the extra payloads into the main one, level by level.
 *
 *   par        the SMALLEST, because par is a minimum over every line found.
 *   difficulty the one whose line a fumble kills you on LEAST often, because
 *              difficulty is a minimum too — see src/solver/difficulty.ts.
 *
 * They can come from different runs of the same level and that is the point:
 * 02-the-long-climb's gate line is six times more forgiving than its optimised
 * one, and taking the optimised one because it is faster reports the second
 * tutorial as harder than 24-kickback.
 */
const slipOf = (r: SolveRow): number =>
  typeof r.difficulty?.humanSlip?.lethal === 'number' ? r.difficulty.humanSlip.lethal : Infinity;

const merged = new Map<string, SolveRow>();
for (const r of rawPayload) if (typeof r.file === 'string') merged.set(r.file, r);
for (const f of alsoFiles) {
  for (const extra of load(f)) {
    const file = str(extra.file);
    if (file === null) continue;
    const cur = merged.get(file);
    if (cur === undefined) { merged.set(file, extra); continue; }
    if (extra.solved !== true) continue;
    if (cur.solved !== true) { merged.set(file, extra); continue; }
    const take = { ...cur };
    const curPar = num(cur.par);
    const extraPar = num(extra.par);
    if (extraPar !== null && (curPar === null || extraPar < curPar)) {
      take.par = extraPar;
      take.parMode = extra.parMode;
      take.seconds = extra.seconds;
      // The search cost travels with the run it paid for, or the row would
      // report how long a search that did not produce this par took.
      take.wallMs = extra.wallMs;
    }
    if (slipOf(extra) < slipOf(cur)) {
      take.difficulty = extra.difficulty;
      take.mode = extra.mode;
    }
    take.tension = cur.tension ?? extra.tension;
    merged.set(file, take);
  }
}
const payload = [...merged.values()];

const rows: Row[] = [];
const revs = new Set<number>();
const scoreRevs = new Set<number>();
for (const raw of payload) {
  const file = str(raw.file);
  if (file === null) {
    console.error('==> skipped a row with no `file`');
    continue;
  }
  // Through the REAL loader, so the hash is the hash the game will look up and
  // a level that no longer parses fails here rather than shipping a row that
  // can never match anything.
  const level = parseLevel(JSON.parse(readFileSync(file, 'utf8')));
  const rev = num(raw.simRev);
  if (rev === null) {
    console.error('==> ' + file + ': no simRev on the row — which physics was this?');
    process.exit(2);
  }
  revs.add(rev);
  const d = raw.difficulty ?? null;
  const solved = raw.solved === true;
  const mode = modeOf(raw.mode, file);
  const scoreRev = d ? num(d.scoreRev) : null;
  if (d && scoreRev === null) {
    console.error('==> ' + file + ': the difficulty carries no `scoreRev` — which formula produced it?');
    process.exit(2);
  }
  if (scoreRev !== null) scoreRevs.add(scoreRev);
  rows.push({
    simHash: level.simHash,
    name: level.name,
    simRev: rev,
    solved,
    score: d ? num(d.score) : null,
    // LEGACY FIELD, and it holds exactly what it always held: the one-frame
    // nudge. It was the scoreRev-1 primary axis and is a diagnostic now, so
    // `nudge` below is the name to read it by; this one stays because it is
    // part of the shape the client already compiles against.
    precision: d ? num(d.nudge) : null,
    clearance: d ? num(d.clearance) : null,
    effort: d ? num(d.effort) : null,
    lethality: d ? num(d.lethality) : null,
    minHeadClearance: d?.line ? num(d.line.minHeadClearance) : null,
    solveSeconds: num(raw.seconds),
    searchSeconds: (() => {
      const ms = num(raw.wallMs);
      return ms === null ? null : Math.round(ms / 1000);
    })(),
    scoreRev: scoreRev ?? 0,
    mode,
    par: num(raw.par),
    parMode: str(raw.parMode) ?? mode.line,
    gateSeconds: num(raw.gateSeconds),
    slip: d ? num(d.slip) : null,
    nudge: d ? num(d.nudge) : null,
    unrated: solved ? null : (str(raw.unrated) ?? 'unsolved'),
    tension: tensionOf(raw.tension)
      ?? tensions.get(level.simHash)
      ?? tensionFromForced(level.simHash, num(raw.par))
      ?? null,
  });
}

rows.sort((a, b) => a.name.localeCompare(b.name));
if (revs.size > 1) {
  console.error('==> refusing: the payload mixes sim revs (' + [...revs].join(', ') + ').');
  console.error('    A score measured under different physics is not a score on the same level.');
  process.exit(2);
}
if (scoreRevs.size > 1) {
  console.error('==> refusing: the payload mixes scoreRevs (' + [...scoreRevs].join(', ') + ').');
  console.error('    A score from a different formula is not on the same scale as one from this formula.');
  process.exit(2);
}

const lit = (v: number | null, dp: number): string => (v === null ? 'null' : String(r2(v, dp)));
const q = (s: string): string => JSON.stringify(s);
const qn = (s: string | null): string => (s === null ? 'null' : JSON.stringify(s));

const modeLit = (m: Mode): string =>
  `{ line: ${q(m.line)}, hands: ${q(m.hands)}, budgetSeconds: ${m.budgetSeconds}, ` +
  `slipTrials: ${m.slipTrials}, slipSigmaMs: ${m.slipSigmaMs}, nudgeTrials: ${m.nudgeTrials}, ` +
  `seed: ${m.seed}, effort: ${m.effort} }`;

const tensionLit = (t: TensionRow | null): string =>
  t === null
    ? 'null'
    : `{ searchedSeconds: ${r2(t.searchedSeconds, 2)}, ` +
      `greedySeconds: ${t.greedySeconds === null ? 'null' : r2(t.greedySeconds, 2)}, ` +
      `greedyOrder: [${t.greedyOrder.join(', ')}], ` +
      `spreadSeconds: ${t.spreadSeconds === null ? 'null' : r2(t.spreadSeconds, 2)}, ` +
      `real: ${t.real} }`;

const body = rows
  .map((r) =>
    '  {\n' +
    `    simHash: ${q(r.simHash)},\n` +
    `    name: ${q(r.name)},\n` +
    `    simRev: ${r.simRev},\n` +
    `    scoreRev: ${r.scoreRev},\n` +
    `    mode: ${modeLit(r.mode)},\n` +
    `    solved: ${r.solved},\n` +
    `    unrated: ${qn(r.unrated)},\n` +
    `    par: ${lit(r.par, 2)},\n` +
    `    parMode: ${q(r.parMode)},\n` +
    `    gateSeconds: ${lit(r.gateSeconds, 2)},\n` +
    `    score: ${lit(r.score, 1)},\n` +
    `    slip: ${lit(r.slip, 3)},\n` +
    `    clearance: ${lit(r.clearance, 3)},\n` +
    `    nudge: ${lit(r.nudge, 3)},\n` +
    `    effort: ${lit(r.effort, 3)},\n` +
    `    lethality: ${lit(r.lethality, 3)},\n` +
    `    precision: ${lit(r.precision, 3)},\n` +
    `    minHeadClearance: ${lit(r.minHeadClearance, 3)},\n` +
    `    solveSeconds: ${lit(r.solveSeconds, 1)},\n` +
    `    searchSeconds: ${lit(r.searchSeconds, 0)},\n` +
    `    tension: ${tensionLit(r.tension)},\n` +
    '  },',
  )
  .join('\n');

const out = `// GENERATED by bin/difficulty-import. Do not edit by hand.
//
// Measured difficulty and par for the levels this build ships, from \`bin/solve\`.
// The numbers come from src/solver/difficulty.ts — slip and clearance, measured
// on the best line anything has found — and not from level statistics. Producing
// them costs hours of CPU across the set, which is why they are a build-time
// artefact rather than something the client computes.
//
// EVERY ROW IS KEYED BY simHash AND simRev, and that is the anti-rot mechanism.
// simHash covers exactly the fields the sim reads, so editing a level's geometry
// re-keys it, this row stops matching, and the chooser shows "unrated" instead
// of a confident number about geometry that no longer exists. A rename or a
// recolour keeps the row, which is the same split the leaderboard already keys
// on. A rev bump retires the whole file for the same reason it retires every
// local best.
//
// EVERY ROW ALSO RECORDS THE MODE IT WAS MEASURED IN, which is the newer and
// harder-won guarantee. The same geometry scores up to fourteen composite points
// apart depending on whether the line came from the cheap satisficing gate or
// from the optimiser — and on 21-rollers the FAST line is the ROOMIER one, head
// clearance 0.282 m against 0.586 m. So \`mode\` is not optional: a row that does
// not say how it was measured is a row nobody can trust later.
//
// To regenerate:
//
//     bin/solve levels/*.json --jobs 5 --optimise --time 720 --json /tmp/par.json
//     bin/difficulty-import /tmp/par.json
//
// ${rows.length} level(s), sim rev ${[...revs][0] ?? '?'}, scoreRev ${[...scoreRevs][0] ?? '?'}.
// Source: ${basename(inFile)}${alsoFiles.length > 0 ? '\n// Merged with: ' + alsoFiles.map((f) => basename(f)).join(', ') : ''}${tensionFile !== undefined ? '\n// Tension: ' + basename(tensionFile) : ''}${note ? '\n// ' + note.split('\n').join('\n// ') : ''}

/** How a row was measured. Not optional — see the header. */
export interface Measurement {
  /** 'gate' — one cheap satisficing pass. 'optimised' — the fastest run the optimiser found. */
  line: string;
  /** 'solver' — frame-perfect. 'human' — the rate-limited macro alphabet. */
  hands: string;
  /** Wall clock the search was allowed per level, seconds. Par converges with this. */
  budgetSeconds: number;
  /** Human-sized fumbles behind the slip axis, and the timing error they used. */
  slipTrials: number;
  slipSigmaMs: number;
  /** One-frame nudges behind the \`nudge\` diagnostic. */
  nudgeTrials: number;
  /** Every random draw in the scoring came from this. */
  seed: number;
  /** Multiplier on every search strategy's expansion budget. */
  effort: number;
}

/** Route tension: what the apple ORDER is worth, in seconds. Depth, not difficulty. */
export interface MeasuredTension {
  /** Seconds with the order searched. */
  searchedSeconds: number;
  /** Seconds with plain nearest-apple-first forced. Null when that order cannot finish. */
  greedySeconds: number | null;
  greedyOrder: readonly number[];
  /** The spread. Null means the obvious order cannot do the level at all, which is unbounded tension. */
  spreadSeconds: number | null;
  /** True only when the spread clears the ~3 s run-to-run noise floor. */
  real: boolean;
}

/**
 * The shape the CLIENT reads. Deliberately narrow: a chooser needs a score, a
 * par, a clearance and an honest unrated state, and nothing else here is its
 * business.
 */
export interface MeasuredLevel {
  /** The only identity that counts. See the header. */
  simHash: string;
  /** What the level called itself when it was measured. Presentation only. */
  name: string;
  simRev: number;
  /**
   * False when the solver could not complete the level inside its cap. That is
   * an honest "could not", never a "cannot" — the solver has been wrong in that
   * direction twice — so such a level is shown as unrated rather than as hard.
   */
  solved: boolean;
  /** 0-100 composite, or null when the level was not solved. */
  score: number | null;
  /**
   * DIAGNOSTICS, none of them in the score since scoreRev 2. \`precision\` is the
   * old name for \`nudge\` and carries the same value; \`effort\` and \`lethality\`
   * measure the SEARCH rather than the level. See src/solver/difficulty.ts.
   */
  precision: number | null;
  clearance: number | null;
  effort: number | null;
  lethality: number | null;
  /** Metres between the head sphere and solid, at its worst on the measured line. */
  minHeadClearance: number | null;
  /** How long the measured run takes. Same number as \`par\`; see \`MeasuredRow.par\`. */
  solveSeconds: number | null;
  /** How long the search itself took, seconds. */
  searchSeconds: number | null;
}

/**
 * The shape the GENERATOR writes: a MeasuredLevel plus the provenance that makes
 * it worth trusting. \`MEASURED\` is typed as this, so a row cannot be emitted
 * without a mode, a scoreRev or an honest unrated reason.
 */
export interface MeasuredRow extends MeasuredLevel {
  /** Which formula produced \`score\`. Rows from different scoreRevs are not comparable. */
  scoreRev: number;
  mode: Measurement;
  /**
   * PAR — the fastest run anything has found, seconds.
   *
   * This is the one number in the file that is about the level and nothing else,
   * and it is what a level chooser shows next to your own best. Read \`parMode\`
   * with it: from an optimising run it is a target, from a bare satisficing gate
   * it is only an upper bound.
   */
  par: number | null;
  parMode: string;
  /** What the cheap satisficing pass got, for the before/after. */
  gateSeconds: number | null;
  /** The two axes of the composite, each 0-1. */
  slip: number | null;
  /** The one-frame nudge. A diagnostic. Same value as \`precision\`. */
  nudge: number | null;
  /**
   * Why there is no score, for a chooser to render. Null when the level is rated.
   *
   *   'unsolved'     the search did not finish it inside its budget.
   *   'zero-apples'  no apples, so the search is one leg steered by the distance
   *                  to the flower — which is hopeless on a level that wants you
   *                  to ride away from it first.
   *   'unverified'   a run was found and did not re-simulate. That is a bug.
   */
  unrated: string | null;
  /** Route tension, when a --tension run measured it. Depth, not difficulty. */
  tension: MeasuredTension | null;
}

export const MEASURED: readonly MeasuredRow[] = [
${body}
];

/**
 * The row for a level, or null when there is not one for THIS rev — an
 * unmeasured level, an edited one, or a physics change since the solve.
 */
export function measuredFor(simHash: string, rev: number): MeasuredRow | null {
  for (const m of MEASURED) if (m.simHash === simHash && m.simRev === rev) return m;
  return null;
}

/**
 * Par for a level, seconds, or null when nothing has a run on it.
 *
 * Separate from \`measuredFor\` because par is what a level chooser wants and
 * difficulty is not: "pic, description, time, best, completed" needs this one
 * number and none of the rest of the row.
 */
export function parFor(simHash: string, rev: number): number | null {
  return measuredFor(simHash, rev)?.par ?? null;
}
`;

writeFileSync(outFile, out);
console.log('==> wrote ' + outFile);
console.log('    ' + rows.length + ' level(s), sim rev ' + ([...revs][0] ?? '?') + ', scoreRev ' + ([...scoreRevs][0] ?? '?'));
const unsolved = rows.filter((r) => !r.solved);
if (unsolved.length > 0) {
  console.log('    ' + unsolved.length + ' unrated — shown as unrated, never as hard:');
  for (const r of unsolved) console.log('      ' + r.name + '  (' + (r.unrated ?? 'unsolved') + ')');
}
const withTension = rows.filter((r) => r.tension?.real === true);
if (withTension.length > 0) {
  console.log('    ' + withTension.length + ' with real route tension:');
  for (const r of withTension) {
    const t = r.tension as TensionRow;
    console.log('      ' + r.name + '  ' + (t.spreadSeconds === null ? 'nearest-first cannot finish it' : t.spreadSeconds.toFixed(2) + ' s'));
  }
}
