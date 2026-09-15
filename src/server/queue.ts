// Verification, off the request handler, with a wall-clock budget.
//
// WHAT "OFF THE REQUEST THREAD" MEANS HERE, PRECISELY.
//
// Node is one thread. Re-simulating a submission is ~0.15 s of straight-line
// arithmetic for a three-minute run, and a straight-line 0.15 s inside a
// handler is 0.15 s during which the health probe does not answer, the static
// bundle does not serve, and every other player's poll waits. That is small,
// and it is exactly the kind of small that becomes a mystery when three people
// finish a level at the same moment.
//
// So the work runs in a queue of one, and the verifier is driven in SLICES:
// `verifyReplaySteps` yields every few thousand input frames, the runner awaits
// a macrotask, and the event loop gets a turn. The slice size cannot change a
// verdict — it only decides where the loop pauses.
//
// WHY NOT `worker_threads`. It is the textbook answer and it is worse here.
// The server runs under `tsx`; a worker would have to inherit the TypeScript
// loader, which works by accident of `execArgv` inheritance rather than by
// design, and a transpile hook that silently fails in a worker turns the
// leaderboard off in a way that passes every test on this machine. The
// measured cost does not justify that fragility — this is 0.15 s of arithmetic,
// not video encoding. If verification ever grows teeth (a solver-assisted
// plausibility pass, say), a worker pool is the migration, and it goes here.
//
// The budget is real because of the yields. A synchronous loop cannot be timed
// out from inside the same thread; a sliced one checks the clock at every pause
// and abandons. That is the only reason a cap on tick count is not the sole
// defence against a pathological input.

export interface JobResult<T> {
  ok: true;
  value: T;
  /** Wall-clock the job actually took, including time spent yielded. */
  ms: number;
}

export interface JobTimeout {
  ok: false;
  reason: 'timeout';
  ms: number;
}

export interface JobRejected {
  ok: false;
  reason: 'busy';
  depth: number;
}

export type Outcome<T> = JobResult<T> | JobTimeout | JobRejected;

/**
 * A sliced job: a generator that yields whenever it is willing to be paused or
 * abandoned, and returns its result. The runner never resumes one that has
 * overrun, so a generator's `finally` is where cleanup belongs.
 */
export type SlicedJob<T> = () => Generator<unknown, T, void>;

export interface Queue {
  /** Enqueue. Resolves with the outcome; never rejects for a job's own failure. */
  run<T>(job: SlicedJob<T>): Promise<Outcome<T>>;
  readonly depth: number;
  readonly running: boolean;
  /** Jobs completed, timed out and refused since boot. For `bin/status`. */
  readonly stats: { done: number; timedOut: number; refused: number; busiest: number };
}

/**
 * `setImmediate` rather than `await null` or a resolved promise: a microtask
 * yield does NOT let I/O run, so a loop that awaits resolved promises starves
 * the event loop exactly as badly as one that never yields while looking like
 * it does not. This is the single easiest thing to get wrong in this file.
 */
function macrotask(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

export function createQueue(opts: { budgetMs: number; maxDepth: number }): Queue {
  let depth = 0;
  let running = false;
  let tail: Promise<unknown> = Promise.resolve();
  const stats = { done: 0, timedOut: 0, refused: 0, busiest: 0 };

  async function execute<T>(job: SlicedJob<T>): Promise<Outcome<T>> {
    running = true;
    const t0 = Date.now();
    try {
      const it = job();
      for (;;) {
        const step = it.next();
        if (step.done) {
          stats.done++;
          return { ok: true, value: step.value, ms: Date.now() - t0 };
        }
        if (Date.now() - t0 > opts.budgetMs) {
          // Abandoned, not cancelled: the generator is simply never resumed and
          // is garbage. Its `return` is called so any `finally` runs.
          it.return?.(undefined as never);
          stats.timedOut++;
          return { ok: false, reason: 'timeout', ms: Date.now() - t0 };
        }
        await macrotask();
      }
    } finally {
      running = false;
    }
  }

  return {
    get depth() {
      return depth;
    },
    get running() {
      return running;
    },
    get stats() {
      return { ...stats };
    },

    run<T>(job: SlicedJob<T>): Promise<Outcome<T>> {
      if (depth >= opts.maxDepth) {
        stats.refused++;
        return Promise.resolve({ ok: false, reason: 'busy', depth });
      }
      depth++;
      if (depth > stats.busiest) stats.busiest = depth;
      const started = tail.then(
        () => execute(job),
        () => execute(job),
      );
      tail = started.then(
        () => undefined,
        () => undefined,
      );
      return started.then(
        (v) => {
          depth--;
          return v;
        },
        (e: unknown) => {
          depth--;
          throw e;
        },
      );
    },
  };
}
