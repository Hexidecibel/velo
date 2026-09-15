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
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIM_DIR = fileURLToPath(new URL('.', import.meta.url));

/** Import specifiers that resolve inside this directory and nowhere else. */
function isLocal(spec: string): boolean {
  if (!spec.startsWith('./')) return false;
  // './foo.ts' is local; './sub/foo.ts' is not (there are no subdirectories,
  // and allowing one would let the rule be evaded by mkdir).
  return !spec.slice(2).includes('/');
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
  const files = readdirSync(SIM_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort();

  it('has source files to check (guards against a silently-empty scan)', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it('imports nothing that leaves src/sim/', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(SIM_DIR, f), 'utf8');
      for (const spec of allImportSpecifiers(text)) {
        if (!isLocal(spec)) offenders.push(`${f} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('references no DOM, node or timer global', () => {
    const banned = [
      'document', 'window', 'navigator', 'localStorage', 'fetch', 'XMLHttpRequest',
      'process', 'require', 'Buffer', '__dirname', 'import.meta',
      'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask',
      'Date', 'performance', 'crypto',
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(SIM_DIR, f), 'utf8')
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
