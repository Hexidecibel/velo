// src/sim imports NOTHING. No `node:*`, no DOM, no npm package, nothing from a
// sibling source directory.
//
// That single constraint is what lets the identical code run under
// Vite-bundled V8, `tsx` on Node, a Web Worker, a headless solver, and
// eventually a Playwright-driven SpiderMonkey for cross-engine verification. A
// leaderboard that re-simulates an uploaded replay is only trustworthy if the
// server runs the same bytes the browser did; one stray `node:crypto` import
// for a hash and the sim is no longer portable, and you find out at launch.
//
// Like purity.test.ts this has zero coupling to the physics constants, so it
// never churns while tuning.
//
// A REV DIRECTORY IS HELD TO A STRICTER VERSION OF THE SAME RULE, and that is
// the entire freezing mechanism. `src/sim/rev5/` and every rev directory after
// it may import only from ITSELF — not from a sibling rev, and not upward into
// `src/sim/`. A rev that cannot reach out cannot be changed by an edit made
// anywhere else, so "rev 4 still verifies" stops being a promise somebody has
// to keep and becomes a property of the import graph. The one edge allowed in
// the other direction is the dispatcher: `rev.ts`, and only `rev.ts`, may
// import a rev directory's `index.ts`, because somebody has to hand the engines
// out.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIM_DIR = fileURLToPath(new URL('.', import.meta.url));

/** Import specifiers that resolve inside this directory and nowhere else. */
function isLocal(spec: string): boolean {
  if (!spec.startsWith('./')) return false;
  // './foo.ts' is local; './sub/foo.ts' is not — the subdirectory exemption is
  // granted by name below and nowhere else, so the rule cannot be evaded by
  // mkdir.
  return !spec.slice(2).includes('/');
}

/** `src/sim/revN` for every frozen-or-in-progress rev directory present. */
function revDirs(): string[] {
  return readdirSync(SIM_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^rev[0-9]+$/.test(d.name))
    .map((d) => d.name)
    .sort();
}

function sourcesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort();
}

function allImportSpecifiers(text: string): string[] {
  const out: string[] = [];
  // static `import ... from 'x'`, bare `import 'x'`, `export ... from 'x'`
  for (const m of text.matchAll(/\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of text.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  // dynamic import()
  for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  // require(), just in case someone reaches for it
  for (const m of text.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

describe('sim isolation', () => {
  const files = sourcesIn(SIM_DIR);
  const revs = revDirs();

  it('has source files to check (guards against a silently-empty scan)', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it('has a rev directory for every rev past the live one', () => {
    // Guards the scans below against passing because they found nothing.
    expect(revs.length).toBeGreaterThan(0);
  });

  it('imports nothing that leaves src/sim/', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(SIM_DIR, f), 'utf8');
      for (const spec of allImportSpecifiers(text)) {
        if (isLocal(spec)) continue;
        // The dispatcher, and only the dispatcher, reaches into a rev
        // directory — and only as far as its index.
        if (f === 'rev.ts' && revs.some((r) => spec === `./${r}/index.ts`)) continue;
        offenders.push(`${f} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a rev directory imports nothing outside itself', () => {
    const offenders: string[] = [];
    for (const rev of revs) {
      const dir = join(SIM_DIR, rev);
      const revFiles = sourcesIn(dir);
      // A rev that copied nothing is a rev that silently runs the live physics.
      expect(revFiles.length, `${rev} has no sources`).toBeGreaterThan(8);
      for (const f of revFiles) {
        const text = readFileSync(join(dir, f), 'utf8');
        for (const spec of allImportSpecifiers(text)) {
          if (!isLocal(spec)) offenders.push(`${rev}/${f} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every rev directory carries its own copy of the whole physics core', () => {
    // The point of the copy is that a rev is complete. A rev missing `step.ts`
    // is a rev that never diverged; a rev missing `level.ts` is a rev running
    // somebody else's collision geometry, which is the subtler and worse of the
    // two because nothing about it looks wrong.
    const core = [
      'arc.ts', 'broadphase.ts', 'collide.ts', 'consts.ts', 'hash.ts', 'level.ts',
      'replay.ts', 'rev.ts', 'rot.ts', 'sim.ts', 'spec.ts', 'step.ts', 'world.ts',
      'index.ts',
    ];
    for (const rev of revs) {
      const have = new Set(sourcesIn(join(SIM_DIR, rev)));
      expect(core.filter((f) => !have.has(f)), `${rev} is missing files`).toEqual([]);
    }
  });

  it('references no DOM, node or timer global', () => {
    const banned = [
      'document', 'window', 'navigator', 'localStorage', 'fetch', 'XMLHttpRequest',
      'process', 'require', 'Buffer', '__dirname', 'import.meta',
      'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask',
      'Date', 'performance', 'crypto',
    ];
    const offenders: string[] = [];
    const all = [
      ...files.map((f) => ({ label: f, path: join(SIM_DIR, f) })),
      ...revs.flatMap((r) =>
        sourcesIn(join(SIM_DIR, r)).map((f) => ({ label: `${r}/${f}`, path: join(SIM_DIR, r, f) })),
      ),
    ];
    for (const { label: f, path } of all) {
      const text = readFileSync(path, 'utf8')
        // strip comments so prose about `Date.now` does not fail the test
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      for (const b of banned) {
        const re = new RegExp(`(?<![A-Za-z0-9_$.])${b.replace('.', '\\.')}(?![A-Za-z0-9_$])`);
        if (re.test(text)) offenders.push(`${f} -> ${b}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
