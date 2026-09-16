// One level, solved on a worker thread.
//
// The worker is a thread and not a process because `World` is immutable and the
// state is flat — but nothing is shared here anyway: each worker parses its own
// level and owns its own everything. The parallelism is across LEVELS, which is
// the honest place for it. Parallelising one search would mean sharing the
// dedupe archive and the frontier, and a search whose result depends on thread
// interleaving is not a search you can re-run.
//
// THE LOADER IS PASSED EXPLICITLY. A worker started under `tsx` inherits the
// loader through `execArgv`, and dropping it — which `execArgv: []` does, and
// which is easy to reach for when quieting a worker's flags — makes the worker
// fail to resolve `@/sim/...` and die before it runs a line. That failure is
// silent from the parent's side unless someone is listening, so the parent
// requires a handshake within a timeout and says so out loud. See bin/_solve.ts.
import { parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { parseLevel } from '@/sim/level.ts';
import { parseSpec } from '@/sim/spec.ts';
import { solveOne } from './_solve-run.ts';
import type { Job, Done } from './_solve-run.ts';

const port = parentPort;
if (!port) throw new Error('_solve-worker.ts must be run as a worker thread');
port.postMessage({ kind: 'ready' });

port.on('message', (job: Job | { kind: 'stop' }) => {
  if ('kind' in job && job.kind === 'stop') { port.close(); return; }
  const j = job as Job;
  try {
    const raw: unknown = JSON.parse(readFileSync(j.file, 'utf8'));
    const level = parseLevel(raw);
    const spec = parseSpec(j.spec);
    const out = solveOne(j, level, spec, raw);
    port.postMessage({ kind: 'done', file: j.file, result: out } satisfies Done);
  } catch (e) {
    port.postMessage({ kind: 'done', file: j.file, error: e instanceof Error ? e.message : String(e) } satisfies Done);
  }
});