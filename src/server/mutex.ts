// A keyed async mutex. About twenty lines, and it is the only concurrency
// control the leaderboard has.
//
// WHY THIS AND NOT A DATABASE LOCK. The board for one level is one JSON file
// that is read, modified and written back. Two submissions to the same level
// landing in the same event-loop turn would both read the old file and the
// second write would erase the first — the classic read-modify-write race, and
// it is entirely real here because a friend group all hammering `04-switchback`
// at once is the expected usage, not a pathological one.
//
// The fix is cheap because velo is ONE Node process: serialising per level key
// inside the process is sufficient and total. An `fcntl` advisory lock would be
// the answer across processes, and it is exactly the mechanism that does not
// work on this box's mergerfs pool — the failure that drove the standing
// no-SQLite-on-mergerfs rule. The repo is on NVMe so a lock would work here,
// but building a cross-process story for a single-process app is inventing a
// problem. If a second writer ever appears, THIS is the file that has to
// change, and the comment is here so that is obvious.
//
// Fairness is FIFO because the queue is an array: two submissions from the same
// player arrive in the order they were sent, which is what makes "did my second
// run beat my first" answerable.

type Job<T> = () => Promise<T> | T;

export interface KeyedMutex {
  /** Run `job` with exclusive access to `key`. Resolves/rejects with its result. */
  run<T>(key: string, job: Job<T>): Promise<T>;
  /** How many keys currently have a chain in flight. Diagnostics only. */
  readonly active: number;
  /** Queue depth for one key, including the job currently running. */
  depth(key: string): number;
}

export function createKeyedMutex(): KeyedMutex {
  // key -> the tail of that key's promise chain. Deleted once the chain drains,
  // so a process that has seen ten thousand levels does not hold ten thousand
  // resolved promises forever.
  const chains = new Map<string, Promise<unknown>>();
  const depths = new Map<string, number>();

  return {
    get active(): number {
      return chains.size;
    },

    depth(key: string): number {
      return depths.get(key) ?? 0;
    },

    run<T>(key: string, job: Job<T>): Promise<T> {
      depths.set(key, (depths.get(key) ?? 0) + 1);
      const prev = chains.get(key) ?? Promise.resolve();
      // `.then(run, run)` rather than `.then(run)`: a job that THREW must not
      // wedge the key forever. The rejection is delivered to its own caller
      // below and swallowed here.
      const next = prev.then(job, job);
      // The chain tail must never be a rejected promise nobody awaits, or Node
      // logs an unhandled rejection for a failure that was in fact handled.
      chains.set(
        key,
        next.then(
          () => undefined,
          () => undefined,
        ),
      );
      const settle = (): void => {
        const d = (depths.get(key) ?? 1) - 1;
        if (d <= 0) {
          depths.delete(key);
          // Only drop the chain when nothing else is waiting on it, or the next
          // caller would start a fresh chain in parallel with this one.
          chains.delete(key);
        } else {
          depths.set(key, d);
        }
      };
      return next.then(
        (v) => {
          settle();
          return v as T;
        },
        (e) => {
          settle();
          throw e;
        },
      );
    },
  };
}
