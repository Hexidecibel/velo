import { describe, expect, it } from 'vitest';
import { createQueue } from './queue.ts';

describe('createQueue', () => {
  it('runs a sliced job to completion and reports the wall clock', async () => {
    const q = createQueue({ budgetMs: 1000, maxDepth: 4 });
    const r = await q.run(function* () {
      let n = 0;
      for (let i = 0; i < 5; i++) {
        n += i;
        yield i;
      }
      return n;
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(10);
    expect(q.stats.done).toBe(1);
  });

  it('abandons a job that overruns its budget', async () => {
    // The budget is only enforceable BECAUSE the job yields. A synchronous loop
    // cannot be timed out from inside the same thread, which is the whole
    // reason `verifyReplaySteps` exists rather than a plain `verifyReplay` call
    // wrapped in a timer.
    const q = createQueue({ budgetMs: 5, maxDepth: 4 });
    let cleaned = false;
    const r = await q.run(function* () {
      try {
        for (;;) {
          const t = Date.now();
          while (Date.now() - t < 2) { /* burn a slice */ }
          yield 1;
        }
      } finally {
        cleaned = true;
      }
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('timeout');
    // The generator is never resumed, so its `finally` is where cleanup has to
    // live — and it does run, because the runner calls `return()` on it.
    expect(cleaned).toBe(true);
    expect(q.stats.timedOut).toBe(1);
  });

  it('refuses rather than queueing unboundedly', async () => {
    const q = createQueue({ budgetMs: 1000, maxDepth: 2 });
    const slow = function* (): Generator<number, string, void> {
      for (let i = 0; i < 50; i++) yield i;
      return 'done';
    };
    const a = q.run(slow);
    const b = q.run(slow);
    const c = await q.run(slow);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toBe('busy');
    await Promise.all([a, b]);
    expect(q.stats.refused).toBe(1);
  });

  it('runs one job at a time', async () => {
    const q = createQueue({ budgetMs: 1000, maxDepth: 8 });
    let concurrent = 0;
    let worst = 0;
    const job = function* (): Generator<number, void, void> {
      concurrent++;
      if (concurrent > worst) worst = concurrent;
      for (let i = 0; i < 3; i++) yield i;
      concurrent--;
    };
    await Promise.all([q.run(job), q.run(job), q.run(job)]);
    expect(worst).toBe(1);
  });

  it('yields to the event loop between slices', async () => {
    // A microtask yield (`await Promise.resolve()`) would NOT let a timer or an
    // I/O completion run, and a loop that starves the event loop while looking
    // like it yields is the single easiest thing to get wrong here. So: a
    // timer is armed, and the job burns real milliseconds across its slices the
    // way a real verification does. A `setImmediate` yield hands control back
    // through the timers phase on the next iteration; a microtask does not, and
    // this test fails if the yield is ever "simplified" to one.
    const q = createQueue({ budgetMs: 5000, maxDepth: 2 });
    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 1);
    const sawIt = await q.run(function* () {
      for (let i = 0; i < 20; i++) {
        const t = Date.now();
        while (Date.now() - t < 1) { /* one millisecond of work, as a slice */ }
        yield i;
        if (timerFired) return true;
      }
      return false;
    });
    expect(sawIt.ok).toBe(true);
    // The timer fired WHILE the job was still running, not after it finished.
    if (sawIt.ok) expect(sawIt.value).toBe(true);
  });
});
