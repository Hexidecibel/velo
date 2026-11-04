// What the server OFFERS versus what it merely still knows about.
//
// The two tooling levels (src/shared/levelset.ts) are unlisted, and the claim
// that matters is that unlisting is ALL that happened: no level's identity
// moved, and the levels with stored runs are still resolvable for bin/board.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseLevel } from '@/sim/level.ts';
import { isDevLevelId } from '@/shared/levelset.ts';
import {
  allKnownLevels,
  allLevels,
  devLevelsEnabled,
  knownLevelBySimHash,
  levelBySimHash,
  levelsDir,
} from './levels.ts';

afterEach(() => {
  delete process.env.VELO_DEV_LEVELS;
});

/** simHash straight off each file, with no registry in the way. */
function hashesOnDisk(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(levelsDir()).filter((x) => x.endsWith('.json')).sort()) {
    out.set(f.slice(0, -5), parseLevel(JSON.parse(readFileSync(join(levelsDir(), f), 'utf8'))).simHash);
  }
  return out;
}

describe('the offered set', () => {
  it('is the numbered levels only, by default', () => {
    expect(devLevelsEnabled()).toBe(false);
    const ids = allLevels().map((l) => l.id);
    expect(ids.length).toBeGreaterThanOrEqual(35);
    expect(ids.some(isDevLevelId)).toBe(false);
    expect(ids).toEqual([...hashesOnDisk().keys()].filter((id) => !isDevLevelId(id)));
  });

  it('will not take a time on a tooling level, and still knows it for stored data', () => {
    const disk = hashesOnDisk();
    for (const id of ['test01', 'test02-bowl']) {
      const simHash = disk.get(id)!;
      expect(levelBySimHash(simHash)).toBeNull();
      expect(knownLevelBySimHash(simHash)?.id).toBe(id);
    }
    expect(allKnownLevels().map((l) => l.id)).toEqual([...disk.keys()]);
  });

  it('puts them back when tooling asks', () => {
    process.env.VELO_DEV_LEVELS = '1';
    const disk = hashesOnDisk();
    expect(allLevels().map((l) => l.id)).toEqual([...disk.keys()]);
    expect(levelBySimHash(disk.get('test01')!)?.id).toBe('test01');
  });
});

describe('unlisting moves no identity', () => {
  it('reports the same simHash for every level, listed or not, in either mode', () => {
    const disk = hashesOnDisk();
    for (const mode of ['', '1']) {
      if (mode) process.env.VELO_DEV_LEVELS = mode;
      for (const l of allLevels()) expect(l.simHash).toBe(disk.get(l.id));
      for (const l of allKnownLevels()) expect(l.simHash).toBe(disk.get(l.id));
    }
  });
});
