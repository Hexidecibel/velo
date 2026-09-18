// EVERY ADVERTISED KEY REACHES A HANDLER.
//
// THIS TEST IS OVERDUE BY THREE BUGS, and it is worth more than any of the
// three fixes:
//
//   1. The montage was bound to `A`. `A` is LEAN LEFT, and `input.ts` returns
//      on a sim binding BEFORE command dispatch runs — so the key was dead on
//      both the play path and the results screen from the day it shipped, while
//      the legend and the results panel both printed it. It was found by a
//      human reading main.ts, months later.
//   2. The zoom keys were suspected dead on the same grounds, and a grep said
//      `setZoomBias` was unreachable from main.ts. The grep was WRONG (main.ts
//      has a byte in it that makes GNU grep treat the file as binary, so a
//      plain `grep -n` silently matches nothing and exits 1). Two people read
//      the file by hand to establish that `+`, `-` and `0` are fine.
//   3. The README, the legend and the dispatch were three hand-maintained
//      copies of the same list, agreeing by luck.
//
// So: `keys.ts` is the one list the legend renders, and this asserts three
// things about it that no amount of care will keep true on its own.
//
//   * REACHABILITY — every advertised code appears in a handler.
//   * THE SHADOW RULE — no command key may also be a sim binding. This is the
//     exact shape of bug 1, and it is invisible at every call site.
//   * THE README AGREES — its Controls table is parsed, not read.
//
// The handler scan is over SOURCE TEXT, which is the honest thing here:
// `main.ts` boots the game on import — it grabs elements out of the document
// and starts a loop — so a node test cannot import it to ask what it handles.
// The guard against a regex that silently matches nothing is an assertion on
// the size of what it found.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { DEV, DRIVE, PLAY, advertisedCodes } from './keys.ts';
import type { Control } from './keys.ts';
import { actionForKey } from './results.ts';
import type { ActionId, ResultAction } from './results.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

/** The sim bindings, straight out of `input.ts`'s `BINDINGS` table. */
function simBindings(): Set<string> {
  const src = read('input.ts');
  const block = /const BINDINGS: Record<string, number> = \{([\s\S]*?)\n\};/.exec(src);
  expect(block, 'input.ts no longer has a BINDINGS table this test can read').not.toBeNull();
  const out = new Set<string>();
  for (const m of (block as RegExpExecArray)[1].matchAll(/^\s*([A-Za-z0-9]+):\s*IN_/gm)) out.add(m[1]);
  return out;
}

/** Every `case '<code>':` label in a file. How both dispatchers are written. */
function caseLabels(rel: string): Set<string> {
  const out = new Set<string>();
  for (const m of read(rel).matchAll(/\bcase '([A-Za-z0-9]+)':/g)) out.add(m[1]);
  return out;
}

describe('the key tables', () => {
  it('has a readable BINDINGS table, and it is the five sim bits', () => {
    const sim = simBindings();
    // Ten codes for five bits: arrows and WASD, space and shift.
    expect(sim.size).toBeGreaterThanOrEqual(10);
    expect(sim.has('Space')).toBe(true);
    expect(sim.has('KeyA')).toBe(true);
  });

  it('finds a command dispatch in main.ts that is actually a dispatch', () => {
    // The guard against the regex silently matching nothing — which is exactly
    // how a source-scanning test rots into a test that passes for free.
    const cases = caseLabels('main.ts');
    expect(cases.size).toBeGreaterThan(15);
    expect(cases.has('KeyR')).toBe(true);
  });

  it('EVERY ADVERTISED KEY REACHES A HANDLER', () => {
    const handled = new Set<string>([
      ...simBindings(),
      ...caseLabels('main.ts'),
      ...caseLabels('results.ts'),
    ]);
    // NOT the editor's own dispatch. It takes the keyboard in the capture phase
    // while it is open and binds A, S, D, Z and the arrows to its own tools, so
    // folding it in would say "handled" about any letter the editor happens to
    // use — which is how a reachability test quietly stops catching anything.
    const dead = advertisedCodes().filter((c) => !handled.has(c));
    expect(dead, 'advertised in keys.ts, handled nowhere').toEqual([]);
  });

  it('NO COMMAND KEY IS ALSO A SIM BINDING — the bug that killed the montage', () => {
    const sim = simBindings();
    const shadowed: string[] = [];
    for (const c of [...PLAY, ...DEV]) {
      for (const code of c.codes) if (sim.has(code)) shadowed.push(`${c.id}: ${code}`);
    }
    // `input.ts` returns on a sim binding before any command handler is called,
    // so a command bound to one of these can never fire, anywhere, ever — and
    // nothing at the call site looks wrong.
    expect(shadowed, 'a command key that input.ts eats as a sim bit').toEqual([]);
  });

  it('every DRIVE key really is a sim binding', () => {
    const sim = simBindings();
    const missing: string[] = [];
    for (const c of DRIVE) for (const code of c.codes) if (!sim.has(code)) missing.push(`${c.id}: ${code}`);
    expect(missing).toEqual([]);
  });

  it('no two controls claim the same key', () => {
    const seen = new Map<string, string>();
    const clash: string[] = [];
    for (const c of [...DRIVE, ...PLAY, ...DEV]) {
      for (const code of c.codes) {
        const prev = seen.get(code);
        if (prev !== undefined) clash.push(`${code}: ${prev} and ${c.id}`);
        else seen.set(code, c.id);
      }
    }
    expect(clash).toEqual([]);
  });

  it('every control says what it is and how to press it', () => {
    const bad: string[] = [];
    for (const c of [...DRIVE, ...PLAY, ...DEV] as Control[]) {
      if (!c.title.trim()) bad.push(`${c.id}: no title`);
      // A control with neither a key nor a pad is a control nobody can reach.
      if (c.codes.length === 0 && !c.pad) bad.push(`${c.id}: no key and no pad`);
      if (c.codes.length > 0 && c.caps.length === 0) bad.push(`${c.id}: keys but no keycap to print`);
    }
    expect(bad).toEqual([]);
  });
});

// --- the results screen ------------------------------------------------------
//
// Its keys are a different dispatch with different meanings for the same
// letters — G is the ghost here and the collision overlay everywhere else — so
// it is asserted against the real function rather than against source text.

const ALL_ACTIONS: ResultAction[] = (
  ['next', 'retry', 'watchRun', 'watchGhost', 'montage', 'board', 'levels', 'dismiss'] as ActionId[]
).map((id) => ({ id, label: id, key: id } as unknown as ResultAction));

describe('the results screen prints keys that work', () => {
  it.each([
    ['Enter', 'next'],
    ['KeyN', 'next'],
    ['KeyR', 'retry'],
    ['Escape', 'dismiss'],
    ['KeyT', 'watchRun'],
    ['KeyG', 'watchGhost'],
    ['KeyF', 'montage'],
    ['KeyB', 'board'],
    ['KeyL', 'levels'],
  ])('%s reaches %s', (code, want) => {
    expect(actionForKey(code, ALL_ACTIONS)).toBe(want);
  });

  it('none of them is a sim binding either', () => {
    const sim = simBindings();
    const shadowed = ['Enter', 'KeyN', 'KeyR', 'Escape', 'KeyT', 'KeyG', 'KeyF', 'KeyB', 'KeyL']
      .filter((c) => sim.has(c));
    expect(shadowed).toEqual([]);
  });
});

// --- the README --------------------------------------------------------------
//
// The third copy. Parsed rather than read, so a row added there for a key that
// does not exist fails here instead of being believed by a player.

/** A key name as the README prints it, to `KeyboardEvent.code`s. */
function codesForCell(cell: string): string[] {
  const t = cell.replace(/`/g, '').replace(/\*\*/g, '').replace(/\(hold\)/g, '').trim();
  switch (t) {
    case 'arrows': return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    case 'WASD': return ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
    case 'space': return ['Space'];
    case 'TAB': return ['Tab'];
    case '[': return ['BracketLeft'];
    case ']': return ['BracketRight'];
    case '+': return ['Equal'];
    case '-': return ['Minus'];
    case '0': return ['Digit0'];
    case '?': return ['Slash'];
    case 'backtick': return ['Backquote'];
    case '': return [];
    default:
      if (/^[A-Z]$/.test(t)) return [`Key${t}`];
      // Deliberately a failure and not a skip: an unrecognised key name in the
      // README is either a new key that must be added to keys.ts, or prose that
      // has drifted into the table. Both want a human.
      throw new Error(`README Controls: no idea what key "${cell}" is`);
  }
}

function readmeControlKeys(): string[] {
  const md = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const start = md.indexOf('\n## Controls\n');
  expect(start, 'README has no "## Controls" section any more').toBeGreaterThan(0);
  // Only the first table: the second one is the results screen, whose keys mean
  // something else and are asserted above against `actionForKey`.
  const body = md.slice(start).split('\n**On the end-of-level screen**')[0];
  const out = new Set<string>();
  for (const line of body.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1);
    if (cells.length < 2) continue;
    const key = cells[0].trim();
    if (key === 'Key' || /^-+$/.test(key)) continue;
    for (const part of key.split('/')) for (const c of codesForCell(part)) out.add(c);
  }
  return [...out].sort();
}

describe('the README Controls table', () => {
  it('parses, and is not empty', () => {
    expect(readmeControlKeys().length).toBeGreaterThan(20);
  });

  it('advertises nothing keys.ts does not', () => {
    const known = new Set(advertisedCodes());
    expect(readmeControlKeys().filter((c) => !known.has(c))).toEqual([]);
  });

  it('advertises every key the legend does', () => {
    const inReadme = new Set(readmeControlKeys());
    // The numpad aliases are real bindings and deliberately not in the README —
    // nobody looks up "NumpadAdd". Everything else has to be in both.
    const missing = advertisedCodes()
      .filter((c) => !c.startsWith('Numpad') && c !== 'ShiftLeft')
      .filter((c) => !inReadme.has(c));
    expect(missing, 'in the legend, missing from the README').toEqual([]);
  });
});
