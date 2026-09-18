import { describe, expect, it } from 'vitest';
import { progressNote, summarise } from './solve.ts';
import type { SolveState } from './solve.ts';

const base: SolveState = { id: 1, state: 'running', lines: [], report: null, replay: null, error: null, elapsedMs: 0 };

describe('progress', () => {
  it('shows the clock and the solver own last word', () => {
    // There is no total for the search to be a fraction of, so a percentage bar
    // would be a lie with a shape. The log line is the honest signal.
    const s = { ...base, elapsedMs: 95_000, lines: ['==> solving', '    apple 2: carry, 41k expansions'] };
    expect(progressNote(s)).toBe('1:35  apple 2: carry, 41k expansions');
  });

  it('says something even before the solver has', () => {
    expect(progressNote({ ...base, elapsedMs: 3000 })).toBe('0:03  searching');
    expect(progressNote({ ...base, elapsedMs: 3000, lines: ['==> solving 1 level'] })).toBe('0:03  searching');
  });
});

describe('the answer', () => {
  it('reports a solve with the route, the score and the line', () => {
    const s: SolveState = {
      ...base, state: 'done', replay: { any: 'thing' },
      report: {
        solved: true, verified: true, seconds: 38.25, frames: 4896, appleOrder: [2, 0, 1], apples: 3,
        expansions: 412_345, deaths: 9021, wallMs: 214_000, routeMetres: 410,
        difficulty: {
          score: 46.4, precision: 0.51, clearance: 0.77, effort: 0.44, lethality: 0.72,
          line: { minHeadClearance: 0.162, atX: 118.4, atY: 6.2, airFraction: 0.31, maxSpeed: 19.4, flips: 7 },
        },
      },
    };
    const out = summarise(s);
    expect(out.verdict).toBe('solved');
    expect(out.headline).toContain('38.25');
    expect(out.watchable).toBe(true);
    const rows = Object.fromEntries(out.rows.map((r) => [r.label, r.value]));
    expect(rows['apple order']).toBe('2 → 0 → 1');
    expect(rows.difficulty).toBe('46/100');
    expect(rows['head clearance']).toContain('0.16 m');
    expect(rows.time).toContain('re-verified');
    expect(rows.search).toContain('3.6 min');
  });

  it('says COULD NOT and never CANNOT', () => {
    // The solver has been wrong in this direction twice. A level called
    // impossible when it is merely hard is the most expensive wrong answer
    // this tool can give.
    const out = summarise({
      ...base, state: 'done',
      report: { solved: false, failure: 'apple 3 at (91, 12): stopped 4.2 m short — budget', expansions: 900_000, deaths: 40_000, wallMs: 300_000 },
    });
    expect(out.verdict).toBe('unsolved');
    expect(out.headline).toContain('could not');
    expect(out.headline).not.toContain('cannot ');
    expect(out.rows[0].value).toContain('4.2 m short');
    expect(out.watchable).toBe(false);
  });

  it('distinguishes a crash from a level it could not solve', () => {
    const out = summarise({ ...base, state: 'failed', error: 'bin/solve exited 2 without a report' });
    expect(out.verdict).toBe('failed');
    expect(out.headline).toContain('exited 2');
  });

  it('is not watchable without a replay, however well it went', () => {
    const out = summarise({ ...base, state: 'done', replay: null, report: { solved: true, seconds: 10, appleOrder: [] } });
    expect(out.verdict).toBe('solved');
    expect(out.watchable).toBe(false);
  });

  it('survives a report with nothing in it', () => {
    expect(summarise(null).verdict).toBe('running');
    expect(summarise({ ...base, state: 'done', report: null }).verdict).toBe('failed');
  });
});
