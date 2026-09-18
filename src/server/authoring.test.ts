import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCore, listLevels, writeAllowed } from './authoring.ts';

const SHIPPED = fileURLToPath(new URL('../../levels/01-first-light.json', import.meta.url));

let root = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'velo-authoring-'));
  mkdirSync(join(root, 'levels'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (id: string, patch: Record<string, unknown>): void => {
  const raw = JSON.parse(readFileSync(SHIPPED, 'utf8')) as Record<string, unknown>;
  writeFileSync(join(root, 'levels', id + '.json'), JSON.stringify({ ...raw, ...patch }, null, 2));
};

describe('absent tier is core', () => {
  it('reads the missing case the safe way', () => {
    // The twenty shipped levels carry no tier. If "absent" meant anything other
    // than core, every one of them would be writable on the day this shipped.
    expect(isCore(null)).toBe(true);
    expect(isCore(undefined)).toBe(true);
    expect(isCore('')).toBe(true);
    expect(isCore('core')).toBe(true);
    expect(isCore('draft')).toBe(false);
    expect(isCore('community')).toBe(false);
    expect(isCore('featured-2027')).toBe(false);
  });
});

describe('what the endpoint will write', () => {
  it('allows a new file', () => {
    expect(writeAllowed(root, '21-the-jump', 'draft')).toEqual({ ok: true });
  });

  it('refuses to write anything with a core tier, existing or not', () => {
    // Not only "do not overwrite core" — do not CREATE core either. Promotion
    // is a hand edit and a curation decision, deliberately not a workflow, and
    // an editor that could mint core levels would make it neither.
    const a = writeAllowed(root, '21-the-jump', 'core');
    expect(a.ok).toBe(false);
    expect(a.ok === false && a.why).toContain('core');
    expect(writeAllowed(root, '21-the-jump', null).ok).toBe(false);
  });

  it('refuses to overwrite a level that carries no tier', () => {
    // This is the shipped set, and it is the whole point. No list of protected
    // filenames to keep up to date: the rule reads the file.
    put('01-first-light', {});
    const r = writeAllowed(root, '01-first-light', 'draft');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.why).toContain('CORE');
  });

  it('refuses to overwrite a level explicitly marked core', () => {
    put('21-promoted', { tier: 'core' });
    expect(writeAllowed(root, '21-promoted', 'draft').ok).toBe(false);
  });

  it('allows overwriting your own draft, which is the ordinary case', () => {
    put('21-the-jump', { tier: 'draft' });
    expect(writeAllowed(root, '21-the-jump', 'draft')).toEqual({ ok: true });
    put('21-shared', { tier: 'community' });
    expect(writeAllowed(root, '21-shared', 'draft')).toEqual({ ok: true });
  });

  it('refuses when the existing file does not load, because the tier cannot be read', () => {
    writeFileSync(join(root, 'levels', 'broken.json'), '{ not json');
    const r = writeAllowed(root, 'broken', 'draft');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.why).toContain('does not load');
  });

  it('refuses an id that is not a filename', () => {
    for (const id of ['', '../escape', 'Caps', 'has space', 'a/b', '-leading']) {
      expect(writeAllowed(root, id, 'draft').ok).toBe(false);
    }
  });
});

describe('it is not part of the deployed server', () => {
  it('is not reachable from src/server/index.ts', () => {
    // THE WHOLE SAFETY STORY RESTS ON THIS SENTENCE, so it is checked rather
    // than asserted in a comment: the process that serves velo.cush.rocks must
    // have no route that writes a level. The editor's save path is a Vite
    // dev-server middleware and authoring happens on the machine the repo is
    // on. One `import` added here in a hurry would make that false silently.
    const serverDir = fileURLToPath(new URL('.', import.meta.url));
    const seen = new Set<string>();
    const reaches = (file: string): boolean => {
      if (seen.has(file)) return false;
      seen.add(file);
      let text: string;
      try {
        text = readFileSync(join(serverDir, file), 'utf8');
      } catch {
        return false;
      }
      for (const m of text.matchAll(/from\s*['"]\.\/([^'"]+)['"]/g)) {
        if (m[1] === 'authoring.ts') return true;
        if (m[1].endsWith('.ts') && reaches(m[1])) return true;
      }
      return false;
    };
    expect(reaches('index.ts')).toBe(false);
  });

  it('IS reachable from vite.config.ts, which is where it belongs', () => {
    // The other half of the same claim: if this ever stops being true the
    // editor silently loses its save button, which is a much friendlier
    // failure and therefore one nobody would investigate.
    const cfg = readFileSync(fileURLToPath(new URL('../../vite.config.ts', import.meta.url)), 'utf8');
    expect(cfg).toContain('authoring.ts');
  });
});

describe('listing', () => {
  it('reports the tier and the lock for every level', () => {
    put('01-first-light', {});
    put('21-the-jump', { tier: 'draft', name: 'The Jump' });
    writeFileSync(join(root, 'levels', 'broken.json'), '{ not json');
    const rows = listLevels(root);
    expect(rows.map((r) => r.id)).toEqual(['01-first-light', '21-the-jump', 'broken']);
    expect(rows[0].locked).toBe(true);
    expect(rows[0].tier).toBeNull();
    expect(rows[1].locked).toBe(false);
    expect(rows[1].name).toBe('The Jump');
    // A file that will not load is locked too: "cannot tell" resolves the same
    // way "absent" does.
    expect(rows[2].locked).toBe(true);
    expect(rows[2].error).not.toBeNull();
  });

  it('is empty rather than throwing when there is no levels directory', () => {
    rmSync(join(root, 'levels'), { recursive: true });
    expect(listLevels(root)).toEqual([]);
  });
});
