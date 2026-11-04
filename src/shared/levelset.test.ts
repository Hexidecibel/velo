// The rule that decides which files in levels/ a published build lists, held
// against the directory itself and against the client's glob — which has to
// repeat the rule as a literal pattern and so could drift from it.
import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEV_LEVEL_PREFIX, isDevLevelId } from './levelset.ts';
import { DEV_LEVELS_ON, LEVELS, SHIPPED_LEVEL_IDS } from '@/client/levels.ts';

const DIR = fileURLToPath(new URL('../../levels/', import.meta.url));
const ON_DISK = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

describe('which levels are tooling', () => {
  it('is the two test levels and nothing a player was meant to ride', () => {
    expect(ON_DISK.filter(isDevLevelId)).toEqual(['test01', 'test02-bowl']);
    expect(isDevLevelId('01-first-light')).toBe(false);
    expect(isDevLevelId('35-window')).toBe(false);
    expect(DEV_LEVEL_PREFIX).toBe('test');
  });

  it('leaves every numbered level listed', () => {
    const listed = ON_DISK.filter((id) => !isDevLevelId(id));
    expect(listed.length).toBeGreaterThanOrEqual(35);
    for (const id of listed) expect(id).toMatch(/^\d\d-/);
  });
});

describe("the client's literal glob agrees with the rule", () => {
  it('ships exactly the files the rule lists', () => {
    expect([...SHIPPED_LEVEL_IDS]).toEqual(ON_DISK.filter((id) => !isDevLevelId(id)));
    expect(SHIPPED_LEVEL_IDS.some(isDevLevelId)).toBe(false);
  });

  it('still hands the tooling levels to anything running under dev (this test included)', () => {
    // vitest's MODE is `test`, which takes the same branch bin/dev does.
    expect(DEV_LEVELS_ON).toBe(true);
    expect(LEVELS.map((l) => l.id).sort()).toEqual(ON_DISK);
  });
});
