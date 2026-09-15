import { describe, expect, it } from 'vitest';
import { createKeyedMutex } from './mutex.ts';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('createKeyedMutex', () => {
  it('serialises jobs on the same key', async () => {
    // The failure this exists to prevent, written as a test: two read-modify-
    // write cycles interleaving and the second erasing the first. Without the
    // mutex, both jobs read `value` as 0 and the counter ends at 1.
    const mutex = createKeyedMutex();
    let value = 0;
    const bump = async (): Promise<void> => {
      const read = value;
      await tick();
      value = read + 1;
    };
    await Promise.all([mutex.run('k', bump), mutex.run('k', bump), mutex.run('k', bump)]);
    expect(value).toBe(3);
  });

  it('does NOT serialise different keys', async () => {
    // Two people finishing two different levels must not wait on each other.
    const mutex = createKeyedMutex();
    const order: string[] = [];
    await Promise.all([
      mutex.run('a', async () => {
        order.push('a-start');
        await tick();
        order.push('a-end');
      }),
      mutex.run('b', async () => {
        order.push('b-start');
        await tick();
        order.push('b-end');
      }),
    ]);
    expect(order).toEqual(['a-start', 'b-start', 'a-end', 'b-end']);
  });

  it('runs in FIFO order', async () => {
    const mutex = createKeyedMutex();
    const seen: number[] = [];
    await Promise.all([1, 2, 3, 4].map((n) => mutex.run('k', async () => {
      await tick();
      seen.push(n);
    })));
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it('does not wedge the key when a job throws', async () => {
    const mutex = createKeyedMutex();
    await expect(mutex.run('k', () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    // The chain must still run. A failed submission cannot be allowed to lock
    // a level's board for the lifetime of the process.
    await expect(mutex.run('k', () => 'fine')).resolves.toBe('fine');
  });

  it('forgets a key once its chain drains', async () => {
    const mutex = createKeyedMutex();
    await mutex.run('k', () => 1);
    expect(mutex.active).toBe(0);
    expect(mutex.depth('k')).toBe(0);
  });

  it('reports depth while jobs are queued', async () => {
    const mutex = createKeyedMutex();
    const a = mutex.run('k', () => tick());
    const b = mutex.run('k', () => tick());
    expect(mutex.depth('k')).toBe(2);
    await Promise.all([a, b]);
    expect(mutex.depth('k')).toBe(0);
  });
});
