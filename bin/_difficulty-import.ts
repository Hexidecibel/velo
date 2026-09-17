// The real work behind bin/difficulty-import. Underscore-prefixed because it is
// run BY a bin/ script rather than by hand.
//
// It turns a `bin/solve --json` payload into `src/solver/measured.ts`, the one
// place the CLIENT can read a difficulty score from.
//
// WHY THIS EXISTS AT ALL. The difficulty numbers are real — they come out of
// `src/solver/difficulty.ts`, measured from what the search experienced — but
// producing them costs about an hour of CPU across the twenty levels, so the
// client cannot compute them and there is nothing to import at runtime. Until
// now they existed only as console output and a table in the README, which is
// exactly the shape of thing that rots: somebody edits a level, the number in
// the README stays, and the game shows a confident rating for geometry that no
// longer exists.
//
// TWO THINGS STOP THAT HERE.
//
//   1. EVERY ROW IS KEYED BY `simHash` AND `simRev`, not by filename. simHash
//      covers exactly the fields the sim reads, so moving one apple re-keys the
//      level and the row silently stops matching — the chooser then shows
//      "unrated" rather than a stale number. A rename or a recolour keeps it,
//      which is the same split the leaderboard already trusts.
//   2. The file is GENERATED and says so, so the honest way to change a number
//      is to re-run the solver rather than to edit a literal.
//
// Usage is in bin/difficulty-import.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLevel } from '../src/sim/level.ts';

interface SolveDifficulty {
  score?: unknown;
  precision?: unknown;
  clearance?: unknown;
  effort?: unknown;
  lethality?: unknown;
  line?: { minHeadClearance?: unknown };
}

interface SolveRow {
  file?: unknown;
  name?: unknown;
  simRev?: unknown;
  solved?: unknown;
  seconds?: unknown;
  wallMs?: unknown;
  difficulty?: SolveDifficulty | null;
}

const argv = process.argv.slice(2);
// One free-text line stamped into the generated header. It is here because the
// provenance of a number matters more than the number: a file that says only
// "generated" cannot tell you whether it came from a full solve, a partial one,
// or a transcription of an older run.
const noteAt = argv.indexOf('--note');
const note = noteAt >= 0 ? (argv[noteAt + 1] ?? '') : '';
const args = noteAt >= 0 ? [...argv.slice(0, noteAt), ...argv.slice(noteAt + 2)] : argv;
const inFile = args[0];
const outFile = args[1] ?? 'src/solver/measured.ts';
if (inFile === undefined) {
  console.error('usage: bin/difficulty-import <solved.json> [out.ts] [--note "where these came from"]');
  process.exit(2);
}

const payload: unknown = JSON.parse(readFileSync(inFile, 'utf8'));
if (!Array.isArray(payload)) {
  console.error('==> ' + inFile + ' is not a bin/solve --json payload (expected an array)');
  process.exit(2);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r2 = (v: number, dp: number): number => Number(v.toFixed(dp));

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
}

const rows: Row[] = [];
const revs = new Set<number>();
for (const raw of payload as SolveRow[]) {
  const file = typeof raw.file === 'string' ? raw.file : null;
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
  rows.push({
    simHash: level.simHash,
    name: level.name,
    simRev: rev,
    solved: raw.solved === true,
    score: d ? num(d.score) : null,
    precision: d ? num(d.precision) : null,
    clearance: d ? num(d.clearance) : null,
    effort: d ? num(d.effort) : null,
    lethality: d ? num(d.lethality) : null,
    minHeadClearance: d?.line ? num(d.line.minHeadClearance) : null,
    solveSeconds: num(raw.seconds),
    searchSeconds: (() => {
      const ms = num(raw.wallMs);
      return ms === null ? null : Math.round(ms / 1000);
    })(),
  });
}

rows.sort((a, b) => a.name.localeCompare(b.name));
if (revs.size > 1) {
  console.error('==> refusing: the payload mixes sim revs (' + [...revs].join(', ') + ').');
  console.error('    A score measured under different physics is not a score on the same level.');
  process.exit(2);
}

const lit = (v: number | null, dp: number): string => (v === null ? 'null' : String(r2(v, dp)));
const str = (s: string): string => JSON.stringify(s);

const body = rows
  .map((r) =>
    '  {\n' +
    `    simHash: ${str(r.simHash)},\n` +
    `    name: ${str(r.name)},\n` +
    `    simRev: ${r.simRev},\n` +
    `    solved: ${r.solved},\n` +
    `    score: ${lit(r.score, 1)},\n` +
    `    precision: ${lit(r.precision, 3)},\n` +
    `    clearance: ${lit(r.clearance, 3)},\n` +
    `    effort: ${lit(r.effort, 3)},\n` +
    `    lethality: ${lit(r.lethality, 3)},\n` +
    `    minHeadClearance: ${lit(r.minHeadClearance, 3)},\n` +
    `    solveSeconds: ${lit(r.solveSeconds, 1)},\n` +
    `    searchSeconds: ${lit(r.searchSeconds, 0)},\n` +
    '  },',
  )
  .join('\n');

const out = `// GENERATED by bin/difficulty-import. Do not edit by hand.
//
// Measured difficulty for the levels this build ships, from \`bin/solve\`. The
// numbers come from src/solver/difficulty.ts — precision, clearance, effort and
// lethality, measured from what the search actually experienced — and not from
// level statistics. Producing them costs about an hour of CPU across the set,
// which is why they are a build-time artefact rather than something the client
// computes.
//
// EVERY ROW IS KEYED BY simHash AND simRev, and that is the whole anti-rot
// mechanism. simHash covers exactly the fields the sim reads, so editing a
// level's geometry re-keys it, this row stops matching, and the chooser shows
// "unrated" instead of a confident number about geometry that no longer exists.
// A rename or a recolour keeps the row, which is the same split the leaderboard
// already keys on. A rev bump retires the whole file for the same reason it
// retires every local best.
//
// To regenerate:
//
//     bin/solve levels/*.json --jobs 7 --time 1200 --json /tmp/solved.json
//     bin/difficulty-import /tmp/solved.json
//
// ${rows.length} level(s), sim rev ${[...revs][0] ?? '?'}.
// Source: ${inFile}${note ? '\n// ' + note.split('\n').join('\n// ') : ''}

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
  /** The four normalised components, each 0-1. */
  precision: number | null;
  clearance: number | null;
  effort: number | null;
  lethality: number | null;
  /** Metres between the head sphere and solid, at its worst on the winning line. */
  minHeadClearance: number | null;
  /** How long the run the solver FOUND takes. Not a competitive time. */
  solveSeconds: number | null;
  /** How long the search itself took, seconds. */
  searchSeconds: number | null;
}

export const MEASURED: readonly MeasuredLevel[] = [
${body}
];

/**
 * The row for a level, or null when there is not one for THIS rev — an
 * unmeasured level, an edited one, or a physics change since the solve.
 */
export function measuredFor(simHash: string, rev: number): MeasuredLevel | null {
  for (const m of MEASURED) if (m.simHash === simHash && m.simRev === rev) return m;
  return null;
}
`;

writeFileSync(outFile, out);
console.log('==> wrote ' + outFile);
console.log('    ' + rows.length + ' level(s), sim rev ' + ([...revs][0] ?? '?'));
const unsolved = rows.filter((r) => !r.solved).length;
if (unsolved > 0) console.log('    ' + unsolved + ' unsolved — shown as unrated, never as hard');
