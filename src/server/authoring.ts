// THE AUTHORING ENDPOINT, AND THE HONEST ANSWER TO "HOW DOES A BROWSER WRITE A
// FILE INTO THE REPO".
//
// It cannot. So this does, and it is deliberately wired into `bin/dev` ONLY —
// vite.config.ts installs it as dev middleware, and `src/server/index.ts`, the
// process that actually serves velo.cush.rocks, never imports this file. The
// deployed game therefore has no route that writes a level, which is the right
// shape: authoring happens on the machine the repo is on, and the thing in
// front of the public is a game.
//
// The client knows which world it is in by asking, and falls back to a download
// plus a clipboard copy when the answer is no. That fallback is not a
// consolation prize — it is what makes the editor usable over a cush-tools
// tunnel from a phone — but it is a step, and the whole value of this editor is
// that there are no steps.
//
// ---------------------------------------------------------------------------
// THE ONE HARD REFUSAL: A CORE LEVEL CANNOT BE OVERWRITTEN.
//
// The twenty shipped levels are the curriculum and they carry the global
// leaderboard. Editing one is how a set of levels quietly stops being the set
// of levels people have times on. So the editor forks instead: opening
// `03-mind-your-head` and adding a jump produces a NEW file, and "what if there
// was a jump here" costs nothing and destroys nothing.
//
// That is enforced HERE and not only in the UI, because a save path that CAN
// overwrite a core level eventually will. The rule is structural and needs no
// list of protected filenames to keep up to date:
//
//   a write is allowed to a path that does not exist, or to one whose file on
//   disk declares a tier that is not "core". Absent tier IS core.
//
// The twenty shipped levels carry no `tier`, so they are core by that rule
// without anybody having to remember them. A level this editor wrote carries
// `"tier": "draft"`, so saving over your own draft is the ordinary case it
// looks like. And promoting a level to core — a hand edit, a curation decision,
// deliberately not a workflow — takes it out of the editor's reach in the same
// motion, which is what promotion should mean.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
// Relative, not the '@' alias: vite.config.ts imports this module to install
// the authoring middleware, and the config is loaded by node before any Vite
// alias exists. specfile.ts carries the same note for the same reason.
import { parseLevel } from '../sim/level.ts';
import type { Level } from '../sim/level.ts';

/** Filenames are ids. Mirrors `ID_RE` in the editor, which checks it live. */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A body bigger than this is not a level. 4 MB is ~50x the biggest shipped one. */
const MAX_BODY = 4 * 1024 * 1024;

/** Cap on a solve, seconds. `bin/solve`'s own default is 300. */
const MAX_SOLVE_SECONDS = 3600;

export interface AuthoringOpts {
  /** Repo root. Everything is resolved under it and nothing escapes it. */
  root: string;
}

export interface SolveJob {
  id: number;
  levelId: string;
  startedAt: number;
  state: 'running' | 'done' | 'failed';
  /** Every line bin/solve has printed, in order. The progress report. */
  lines: string[];
  /** The `--json` report for this level, once there is one. */
  report: unknown;
  /** The replay file bin/solve saved, once there is one. Watchable. */
  replay: unknown;
  error: string | null;
  proc: ChildProcess | null;
  dir: string;
}

const jobs = new Map<number, SolveJob>();
let nextJob = 1;

export interface LevelSummary {
  id: string;
  name: string;
  /** Null means the file carries no tier, which means core. */
  tier: string | null;
  /** True when the endpoint would refuse to write over it. */
  locked: boolean;
  simHash: string;
  error: string | null;
}

function levelsDir(root: string): string {
  return join(root, 'levels');
}

/** Everything in levels/, with the one fact the editor needs about each. */
export function listLevels(root: string): LevelSummary[] {
  const dir = levelsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const id = f.slice(0, -5);
    try {
      const lvl = parseLevel(JSON.parse(readFileSync(join(dir, f), 'utf8')));
      return { id, name: lvl.name, tier: lvl.tier ?? null, locked: isCore(lvl.tier), simHash: lvl.simHash, error: null };
    } catch (e) {
      // A file that does not load is still locked: we cannot read its tier, and
      // "cannot tell" resolves the same way "absent" does.
      return { id, name: id, tier: null, locked: true, simHash: '', error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** Absent tier is core. The safe reading of "no tier" is the one that protects. */
export function isCore(tier: string | null | undefined): boolean {
  return tier === null || tier === undefined || tier === '' || tier === 'core';
}

/**
 * May this write happen? The whole rule, in one function, so it can be tested
 * and so there is exactly one place that decides.
 */
export function writeAllowed(root: string, id: string, incomingTier: string | null): { ok: true } | { ok: false; why: string } {
  if (!ID_RE.test(id)) return { ok: false, why: `"${id}" is not a level id: lower-case letters, digits and dashes` };
  if (isCore(incomingTier)) {
    return { ok: false, why: 'the editor cannot write a level with tier "core". Save it as a draft; promoting it is a hand edit, on purpose.' };
  }
  const path = join(levelsDir(root), id + '.json');
  if (!existsSync(path)) return { ok: true };
  let existing: Level;
  try {
    existing = parseLevel(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return { ok: false, why: `levels/${id}.json exists and does not load, so its tier cannot be read. Refusing to overwrite it.` };
  }
  if (isCore(existing.tier ?? null)) {
    return { ok: false, why: `levels/${id}.json is a CORE level. Core levels are never overwritten — fork it and save under a new id.` };
  }
  return { ok: true };
}

// --- the handler -------------------------------------------------------------

type Handled = boolean;

export function createAuthoringHandler(opts: AuthoringOpts): (req: IncomingMessage, res: ServerResponse) => Promise<Handled> {
  const { root } = opts;

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<Handled> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (!path.startsWith('/api/authoring')) return false;

    try {
      if (path === '/api/authoring' && req.method === 'GET') {
        return json(res, 200, { enabled: true, root, levels: listLevels(root) });
      }
      if (path === '/api/authoring/save' && req.method === 'POST') {
        return json(res, ...save(root, await body(req)));
      }
      if (path === '/api/authoring/solve' && req.method === 'POST') {
        return json(res, ...startSolve(root, await body(req)));
      }
      if (path === '/api/authoring/solve' && req.method === 'GET') {
        const job = jobs.get(Number(url.searchParams.get('job')));
        if (!job) return json(res, 404, { error: 'no such job' });
        return json(res, 200, {
          id: job.id, state: job.state, lines: job.lines, report: job.report,
          replay: job.replay, error: job.error, elapsedMs: Date.now() - job.startedAt,
        });
      }
      if (path === '/api/authoring/solve' && req.method === 'DELETE') {
        const job = jobs.get(Number(url.searchParams.get('job')));
        if (job?.proc) job.proc.kill('SIGTERM');
        return json(res, 200, { stopped: Boolean(job) });
      }
      return json(res, 404, { error: 'no such authoring route' });
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

function save(root: string, raw: unknown): [number, unknown] {
  const b = raw as { id?: unknown; level?: unknown };
  const id = typeof b.id === 'string' ? b.id : '';
  let level: Level;
  try {
    level = parseLevel(b.level);
  } catch (e) {
    // The loader gets the last word on what a level is, here as everywhere. A
    // file that would not load must never reach levels/, because the level bar
    // shows broken levels and a broken level in the set is somebody's bug
    // report.
    return [400, { error: `that is not a level the loader accepts: ${e instanceof Error ? e.message : String(e)}` }];
  }
  const allowed = writeAllowed(root, id, level.tier ?? null);
  if (!allowed.ok) return [403, { error: allowed.why }];

  const dir = levelsDir(root);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, id + '.json');
  const created = !existsSync(path);
  // Written to a sibling and renamed. A half-written level file is a level that
  // does not load, and the dev server globs this directory on every change.
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(b.level, null, 2) + '\n');
  renameSync(tmp, path);
  return [200, { path: `levels/${id}.json`, created, simHash: level.simHash, contentHash: level.contentHash, tier: level.tier ?? null }];
}

function startSolve(root: string, raw: unknown): [number, unknown] {
  const b = raw as { id?: unknown; level?: unknown; seconds?: unknown; effort?: unknown };
  const id = typeof b.id === 'string' && ID_RE.test(b.id) ? b.id : 'draft';
  try {
    // Compiled and thrown away: the point is that `bin/solve` is never handed a
    // file the loader would refuse, which it would report as a crash rather
    // than as the authoring mistake it is.
    parseLevel(b.level);
  } catch (e) {
    return [400, { error: `that is not a level the loader accepts: ${e instanceof Error ? e.message : String(e)}` }];
  }
  const seconds = clampNum(b.seconds, 10, MAX_SOLVE_SECONDS, 300);
  const effort = clampNum(b.effort, 0.25, 8, 1);

  // Under data/, which is gitignored and on NVMe. The level being solved is
  // written out whole rather than referenced, so solving an UNSAVED draft is
  // the normal case — which it has to be, or the deliberate tier would force a
  // save before every check and the fork-on-edit rule would make that a new
  // file every time.
  const jobId = nextJob++;
  const job: SolveJob = {
    id: jobId, levelId: id, startedAt: Date.now(), state: 'running',
    lines: [], report: null, replay: null, error: null, proc: null,
    dir: join(root, 'data', 'authoring', `solve-${jobId}`),
  };
  jobs.set(jobId, job);
  mkdirSync(job.dir, { recursive: true });
  const levelPath = join(job.dir, `${id}.json`);
  const reportPath = join(job.dir, 'report.json');
  writeFileSync(levelPath, JSON.stringify(b.level, null, 2) + '\n');

  // THROUGH bin/solve, not through an in-process call to the solver. It is the
  // documented entry point, it already handles the rev choice, the re-verify
  // and the replay envelope, and a second caller of the search would be a
  // second place for those to drift. It also keeps a three-minute CPU burn out
  // of the dev server's event loop.
  const proc = spawn(join(root, 'bin', 'solve'), [
    levelPath, '--json', reportPath, '--save', job.dir + '/',
    '--time', String(seconds), '--effort', String(effort), '--progress',
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  job.proc = proc;

  const take = (chunk: Buffer): void => {
    for (const line of chunk.toString('utf8').split('\n')) {
      const t = line.replace(/\s+$/, '');
      if (t) job.lines.push(t);
    }
    // A runaway solver must not be able to eat the dev server's memory through
    // its own progress log.
    if (job.lines.length > 4000) job.lines.splice(0, job.lines.length - 2000);
  };
  proc.stdout?.on('data', take);
  proc.stderr?.on('data', take);
  proc.on('error', (e) => {
    job.state = 'failed';
    job.error = e.message;
  });
  proc.on('close', (code) => {
    job.proc = null;
    try {
      if (existsSync(reportPath)) job.report = (JSON.parse(readFileSync(reportPath, 'utf8')) as unknown[])[0] ?? null;
      const replayFile = readdirSync(job.dir).find((f) => f.endsWith('.velo.json') || (f.endsWith('.json') && f !== 'report.json' && f !== `${id}.json`));
      if (replayFile) job.replay = JSON.parse(readFileSync(join(job.dir, replayFile), 'utf8'));
    } catch (e) {
      job.error = e instanceof Error ? e.message : String(e);
    }
    // Exit 1 means "did not solve", which is a RESULT and not a failure — the
    // solver has been wrong in that direction twice and the report says so in
    // its own words. Only a crash is a failure.
    job.state = job.report === null && code !== 0 ? 'failed' : 'done';
    if (job.state === 'failed' && !job.error) job.error = `bin/solve exited ${code} without a report`;
    // The level and the replay are both in the payload by now; the directory is
    // scratch and dev machines fill up.
    try {
      rmSync(job.dir, { recursive: true, force: true });
    } catch { /* scratch */ }
  });

  return [200, { job: job.id, seconds, effort }];
}

function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return n < lo ? lo : n > hi ? hi : n;
}

function json(res: ServerResponse, status: number, payload: unknown): true {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
  return true;
}

function body(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    req.on('error', reject);
  });
}
