import { describe, it, expect } from 'vitest';
import { parseLevel } from './level.ts';
import { buildGrid, queryCircle } from './broadphase.ts';
import { circleEdge, compareContacts, makeContact } from './collide.ts';
import { DEFAULT_SPEC } from './spec.ts';
import { createWorld, collectContacts } from './world.ts';

const room = (extra: unknown[] = []) =>
  parseLevel({
    format: 'velo-level',
    start: { x: 0, y: 5 },
    flower: { x: 1, y: 5 },
    polygons: [
      { kind: 'cave', points: [[-20, 0], [20, 0], [20, 20], [-20, 20]] },
      ...(extra as { kind: string; points: [number, number][] }[]),
    ],
  });

function contactsFor(cx: number, cy: number, r: number, extra: unknown[] = []) {
  const w = createWorld(room(extra), DEFAULT_SPEC);
  w.contactCount = 0;
  collectContacts(w, 0, cx, cy, r);
  return w.contacts.slice(0, w.contactCount);
}

describe('circle vs polygon', () => {
  it('rests on a floor with the normal pointing up', () => {
    const cs = contactsFor(0, 0.2, 0.25);
    expect(cs.length).toBe(1);
    expect(cs[0].ny).toBeCloseTo(1, 12);
    expect(cs[0].nx).toBeCloseTo(0, 12);
    expect(cs[0].depth).toBeCloseTo(0.05, 12);
    expect(cs[0].py).toBeCloseTo(0, 12);
  });

  it('reports nothing when clear of every surface', () => {
    expect(contactsFor(0, 5, 0.25).length).toBe(0);
  });

  it('pushes out of a ceiling downward', () => {
    const cs = contactsFor(0, 19.9, 0.25);
    expect(cs.length).toBe(1);
    expect(cs[0].ny).toBeCloseTo(-1, 12);
  });

  it('produces ONE contact on a convex corner, not two', () => {
    // A vertex is owned by exactly one of its two edges. Without that rule the
    // corner gets double the impulse and the bike pings off it — and worse, the
    // duplicate is geometry-dependent, so it appears on some levels and not
    // others.
    const cs = contactsFor(
      5, 1.1, 0.25,
      [{ kind: 'ground', points: [[4, 0], [6, 0], [6, 1], [4, 1]] }],
    );
    const onBox = cs.filter((c) => c.polyIdx === 1);
    expect(onBox.length).toBe(1);
    expect(onBox[0].ny).toBeCloseTo(1, 12);
  });

  it('uses the vertex pseudo-normal outside a corner', () => {
    // Diagonally off the top-right corner of a box: the push-out direction is
    // radial, roughly 45 degrees, and must not be either face's normal.
    const d = 0.15;
    const cs = contactsFor(6 + d, 1 + d, 0.3, [{ kind: 'ground', points: [[4, 0], [6, 0], [6, 1], [4, 1]] }]);
    const onBox = cs.filter((c) => c.polyIdx === 1);
    expect(onBox.length).toBe(1);
    expect(onBox[0].nx).toBeCloseTo(Math.SQRT1_2, 6);
    expect(onBox[0].ny).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('inverts the normal once the centre is inside solid', () => {
    const cs = contactsFor(5, 0.9, 0.25, [{ kind: 'ground', points: [[4, 0], [6, 0], [6, 1], [4, 1]] }]);
    const onBox = cs.filter((c) => c.polyIdx === 1);
    expect(onBox.length).toBeGreaterThan(0);
    expect(onBox[0].ny).toBeCloseTo(1, 12);
    expect(onBox[0].depth).toBeGreaterThan(0.25);
  });
});

describe('broadphase', () => {
  it('is conservative: it returns every edge a brute-force scan would', () => {
    // The invariant this file exists for. A broadphase that misses a contact on
    // one machine and not another is a desync nobody will ever find, so the
    // test is not "it is fast" but "it is exactly equivalent to no broadphase".
    const lvl = room([
      { kind: 'ground', points: [[4, 0], [6, 0], [6, 1], [4, 1]] },
      { kind: 'ground', points: [[-8, 0], [-7, 3], [-6, 0]] },
    ]);
    const grid = buildGrid(lvl.polys);
    const stamp = new Int32Array(grid.totalEdges);
    const op = new Int32Array(grid.totalEdges);
    const oe = new Int32Array(grid.totalEdges);
    const probe = makeContact();
    let q = 0;

    for (let x = -21; x <= 21; x += 0.37) {
      for (let y = -1; y <= 21; y += 0.41) {
        // brute force
        const brute: string[] = [];
        for (let p = 0; p < lvl.polys.length; p++) {
          for (let e = 0; e < lvl.polys[p].vx.length; e++) {
            if (circleEdge(lvl.polys[p], p, e, x, y, 0.3, 0, probe)) brute.push(`${p}:${e}`);
          }
        }
        // broadphase
        const got: string[] = [];
        const n = queryCircle(grid, x, y, 0.3, ++q, stamp, op, oe);
        for (let i = 0; i < n; i++) {
          if (circleEdge(lvl.polys[op[i]], op[i], oe[i], x, y, 0.3, 0, probe)) got.push(`${op[i]}:${oe[i]}`);
        }
        expect(got.sort()).toEqual(brute.sort());
      }
    }
  });

  it('returns each edge at most once', () => {
    const lvl = room();
    const grid = buildGrid(lvl.polys);
    const stamp = new Int32Array(grid.totalEdges);
    const op = new Int32Array(grid.totalEdges);
    const oe = new Int32Array(grid.totalEdges);
    // A radius far larger than a cell, so every edge lands in many cells.
    const n = queryCircle(grid, 0, 10, 30, 1, stamp, op, oe);
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) seen.add(`${op[i]}:${oe[i]}`);
    expect(seen.size).toBe(n);
  });
});

describe('contact ordering', () => {
  it('is a total order on (collider, poly, edge)', () => {
    const mk = (c: number, p: number, e: number) => ({ ...makeContact(), colliderIdx: c, polyIdx: p, edgeIdx: e });
    const list = [mk(2, 0, 5), mk(0, 1, 0), mk(0, 0, 9), mk(0, 0, 2), mk(1, 0, 0)];
    const sorted = [...list].sort(compareContacts).map((c) => `${c.colliderIdx}/${c.polyIdx}/${c.edgeIdx}`);
    expect(sorted).toEqual(['0/0/2', '0/0/9', '0/1/0', '1/0/0', '2/0/5']);
    // Shuffled input, same output — which is the property the solver relies on.
    const other = [...list].reverse().sort(compareContacts).map((c) => `${c.colliderIdx}/${c.polyIdx}/${c.edgeIdx}`);
    expect(other).toEqual(sorted);
  });
});
