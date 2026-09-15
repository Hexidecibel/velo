// The spatial primitives every clearance rule is built on.
//
// props.test.ts asserts the rules against the real levels; this file asserts
// that the measurements those rules consult are actually measuring what they
// claim to. They are the whole safety argument for the prop system, and one of
// them was silently wrong in the first version in a way that disabled the
// entire feature rather than breaking it loudly — see the note on `rayGap`.
import { describe, it, expect } from 'vitest';
import { parseLevel } from '@/sim/level.ts';
import { buildField, CELL, clearanceAt, isSolidAt, playSolidFraction, rayGap, solidFraction, worstClearance } from './space.ts';

/** A cave: a 40 x 20 m room with solid everywhere outside it. */
const ROOM = parseLevel({
  format: 'velo-level',
  start: { x: 20, y: 2 },
  flower: { x: 30, y: 2 },
  polygons: [{ kind: 'cave', points: [[0, 0], [40, 0], [40, 20], [0, 20]] }],
});

/** The same room with a 2 m-thick slab hung across the middle of it. */
const SPLIT = parseLevel({
  format: 'velo-level',
  start: { x: 5, y: 2 },
  flower: { x: 35, y: 2 },
  polygons: [
    { kind: 'cave', points: [[0, 0], [40, 0], [40, 20], [0, 20]] },
    { kind: 'ground', points: [[10, 9], [30, 9], [30, 11], [10, 11]] },
  ],
});

describe('the solid field', () => {
  it('knows the inside of a cave from the outside', () => {
    const f = buildField(ROOM);
    expect(isSolidAt(f, 20, 10)).toBe(false);
    expect(isSolidAt(f, -1.5, 10)).toBe(true);
    expect(isSolidAt(f, 41.5, 10)).toBe(true);
  });

  it('measures clearance as distance to the nearest material', () => {
    const f = buildField(ROOM);
    // The middle of a 40 x 20 room: the nearest wall is the floor or ceiling,
    // 10 m away.
    expect(clearanceAt(f, 20, 10)).toBeGreaterThan(9);
    expect(clearanceAt(f, 20, 10)).toBeLessThan(11);
    // Half a metre off the floor is half a metre of clearance.
    expect(clearanceAt(f, 20, 0.5)).toBeGreaterThan(0.2);
    expect(clearanceAt(f, 20, 0.5)).toBeLessThan(0.9);
    expect(clearanceAt(f, 20, 0)).toBe(0);
  });

  it('counts anything outside the grid as solid', () => {
    // So a prop can never be placed hanging off the edge of the world.
    const f = buildField(ROOM);
    expect(isSolidAt(f, -500, 0)).toBe(true);
    expect(clearanceAt(f, -500, 0)).toBe(0);
  });

  it('does not let a wall thinner than the grid fall through it', () => {
    // A cell is solid if its CENTRE is inside material OR an edge crosses it.
    // Without the second pass, a slab thinner than the half-metre pitch has no
    // centres inside it and reads as open air — which is the one error that
    // could put a prop inside a wall.
    const thin = parseLevel({
      format: 'velo-level',
      start: { x: 5, y: 2 },
      flower: { x: 35, y: 2 },
      polygons: [
        { kind: 'cave', points: [[0, 0], [40, 0], [40, 20], [0, 20]] },
        { kind: 'ground', points: [[10, 9.9], [30, 9.9], [30, 10.1], [10, 10.1]] },
      ],
    });
    const f = buildField(thin);
    expect(CELL).toBeGreaterThan(0.2); // the slab really is thinner than a cell
    let hit = 0;
    for (let x = 11; x < 29; x += 0.5) if (isSolidAt(f, x, 10)) hit++;
    expect(hit).toBeGreaterThan(30);
  });

  it('reads a slab as material and the space under it as air', () => {
    const f = buildField(SPLIT);
    expect(isSolidAt(f, 20, 10)).toBe(true);
    expect(isSolidAt(f, 20, 5)).toBe(false);
  });
});

describe('rayGap: the head-clearance measurement', () => {
  // THE MEASUREMENT THE PROP SYSTEM ACTUALLY TURNS ON, and the one the first
  // version got wrong. It used `clearanceAt` a metre out from the surface —
  // which measures the distance to the NEAREST solid, and a point one metre off
  // a wall is one metre from that wall. Every wall in every level reported
  // about 1.0, every fixture failed its clearance test, and the feature simply
  // produced nothing. A rule that silently refuses everything looks a lot like
  // a rule that is working.
  it('measures the whole way across a room, not the distance to the wall behind you', () => {
    const f = buildField(ROOM);
    // From the floor, straight up: 20 m to the ceiling.
    expect(rayGap(f, 20, 0.1, 0, 1).gap).toBeGreaterThan(18);
    // From the left wall, straight across: 40 m, though the default cap is 20 —
    // "nothing for twenty metres" and "nothing for forty" mean the same thing
    // to a prop, so the cap is deliberate.
    expect(rayGap(f, 0.1, 10, 1, 0).gap).toBe(20);
    expect(rayGap(f, 0.1, 10, 1, 0, 60).gap).toBeGreaterThan(38);
  });

  it('reports the true corridor under a slab', () => {
    const f = buildField(SPLIT);
    // Under the slab at y=9, floor at y=0: nine metres, reported a little SHORT
    // because the edge stamp marks every cell a boundary crosses. That error is
    // in the safe direction by construction — the field can only ever think
    // there is less room than there is, and every rule refuses placement when
    // there is not enough.
    expect(rayGap(f, 20, 8.9, 0, -1).gap).toBeGreaterThan(7.8);
    expect(rayGap(f, 20, 8.9, 0, -1).gap).toBeLessThanOrEqual(9);
    // Above the slab at y=11, ceiling at y=20: nine.
    expect(rayGap(f, 20, 11.1, 0, 1).gap).toBeGreaterThan(7.8);
  });

  it('caps rather than running forever', () => {
    const f = buildField(ROOM);
    expect(rayGap(f, 20, 10, 0, 1, 4).gap).toBeLessThanOrEqual(4);
  });
});

describe('worstClearance: the box test', () => {
  it('is zero when any part of the box is material', () => {
    // Which is exactly the test a `paint` prop has to pass in reverse: its whole
    // box must be solid, so this must be 0.
    const f = buildField(SPLIT);
    expect(worstClearance(f, 19, 9.5, 21, 10.5)).toBe(0);
    expect(worstClearance(f, 19, 4, 21, 6)).toBeGreaterThan(0);
  });

  it('samples the box rather than its centre', () => {
    // A lamp mounted where the anchor has room but the box does not is exactly
    // the failure this exists to catch.
    const f = buildField(SPLIT);
    // Centre at y=6 is clear; a tall box from there reaches into the slab.
    expect(clearanceAt(f, 20, 6)).toBeGreaterThan(1);
    expect(worstClearance(f, 19.5, 6, 20.5, 10)).toBe(0);
  });
});

describe('solid fraction: the cost predictor', () => {
  it('reads an open viewport as open and a buried one as solid', () => {
    const f = buildField(ROOM);
    expect(solidFraction(f, { minX: 10, minY: 5, maxX: 30, maxY: 15 })).toBe(0);
    expect(solidFraction(f, { minX: -30, minY: -30, maxX: -10, maxY: -10 })).toBe(1);
  });

  it('play-time fraction only counts frames the player can be in', () => {
    // Averaging over a level's bounding box is meaningless on a 290 x 11 m
    // level, where most of the box is the margin above and below. Centring the
    // windows on air the bike can occupy is what makes the number mean "what a
    // frame looks like while driving", which is what the prop budget consults.
    const open = playSolidFraction(buildField(ROOM), ROOM);
    const split = playSolidFraction(buildField(SPLIT), SPLIT);
    expect(open).toBeGreaterThanOrEqual(0);
    expect(split).toBeGreaterThan(open);
  });
});
