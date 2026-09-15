// The second test level, and the reason arcs exist.
//
// test01 is a polyline of deliberate straight edges and hard corners, and it is
// still the compatibility fixture — its simHash must never move. This one is
// the opposite: every surface is a circular arc, and the whole point is that
// you cannot feel where one ends and the next begins.
//
// Hand-written as line segments at the 2 mm sag the loader tessellates to, this
// floor would be about 500 vertices. As written it is 17 entries, and moving a
// feature is editing one number. That ratio is the entire argument for the
// primitive.
//
// The floor is an ARC SPLINE: each bulge was chosen so the arc's tangent
// matches its neighbour's at the join, which is what makes the surface smooth
// rather than merely curved. The numbers are rounded to three decimals, leaving
// tangent mismatches of a few hundredths of a degree — invisible, and a fair
// demonstration that the format does not demand exactness to behave well.
//
// Feature radii run from 20 m (the rollers) down to 5 m (the compression dip),
// which is the range that makes a sag TOLERANCE rather than a segment count the
// right knob: at a fixed 32 segments per arc the dip would be over-tessellated
// and the rollers under-tessellated, and here each gets what it needs.
//
// One deliberate omission: there is no hard convex crest taken at speed. Not
// because arcs cannot express one, but because drive torque is reacted on the
// chassis and an airborne wheel gives that reaction nothing to push against —
// so a level with a fast crest is only completable by a rider who knows to shut
// the throttle in the air, and this level's job is to demonstrate a surface,
// not to be difficult.
import type { RawLevel } from './level.ts';

export const CURVE_LEVEL: RawLevel = {
  format: 'velo-level',
  rev: 1,
  name: 'test02 — the bowl',
  author: 'm1',

  // Same 5 cm settle as test01, for the same reason: holding the throttle
  // through even a small spawn drop builds enough backward rotation to commit
  // to a backflip.
  start: { x: -10, y: 0.42 },
  flower: { x: 71, y: -0.6 },

  apples: [
    { x: 6.14, y: -1.7 }, //    the floor of the bowl
    { x: 27.77, y: 1.3 }, //    the top of the roller
    { x: 41.37, y: 0.2 }, //    over the compression dip
    { x: 61, y: -0.55 }, //     over the boulder
  ],

  polygons: [
    {
      // The cave. Floor left-to-right as an arc spline, then up the right wall,
      // then the ceiling right-to-left.
      //
      // Bulge is measured against the direction you WROTE the points in, and
      // tessellation happens before the loader normalises winding, so this
      // reading order is the contract and reversing the list cannot silently
      // mirror a curve.
      kind: 'cave',
      points: [
        [-12, 0],
        [-4, 0], //                                         flat run-up
        { arcTo: [2.339, -1.405], bulge: 0.356 }, //        drop in     R 15  -25°
        { arcTo: [9.946, -1.405], bulge: -0.843 }, //       bowl floor  R  9  +50°
        { arcTo: [16.286, 0], bulge: 0.356 }, //            out again   R 15  -25°
        [20.286, 0],
        { arcTo: [24.444, 0.437], bulge: -0.11 }, //        roller up   R 20  +12°
        { arcTo: [31.097, 0.437], bulge: 0.35 }, //         its crest   R 16  -24°
        { arcTo: [35.255, 0], bulge: -0.11 }, //            roller down R 20  +12°
        [38.255, 0],
        { arcTo: [40.334, -0.219], bulge: 0.055 }, //       into the dip R 10 -12°
        { arcTo: [42.414, -0.219], bulge: -0.109 }, //      the dip     R  5  +24°
        { arcTo: [44.493, 0], bulge: 0.055 }, //            out of it   R 10 -12°
        [47.493, 0],
        { arcTo: [52.331, -0.594], bulge: 0.149 }, //       long roll   R 20  -14°
        { arcTo: [57.17, -1.188], bulge: -0.149 }, //       and settle  R 20  +14°
        [74, -1.188], //                                    run-out to the flower
        [74.4, -1.188],
        [74.4, 12], //                                      right wall
        [-12, 12], //                                       ceiling, right to left
      ],
    },
    {
      // A perfect circle, half buried in the run-out, in two entries. This is
      // the case that pays for the authoring shape: the ring is [A, B], the
      // edge A->B is the arc carried by B and the closing edge B->A is the arc
      // carried by A. Both bulge left of their OWN travel direction, and on
      // opposite headings that is opposite sides of the diameter — so two equal
      // bulges make a circle rather than a lens. A radius-and-flags form needs
      // the same two entries plus two booleans nobody remembers the meaning of.
      kind: 'ground',
      points: [
        { arcTo: [60.1, -1.888], bulge: 0.9 },
        { arcTo: [61.9, -1.888], bulge: 0.9 },
      ],
    },
    {
      // Decor never collides, so its tessellation can be as coarse as it likes
      // — which is exactly what the per-arc sagTolerance override is for. At
      // 5 cm this reads as a visible polygon; at the level default it would be
      // 128 segments that nobody can see and the broadphase still has to hold.
      kind: 'decor',
      points: [
        { arcTo: [4.4, 5], bulge: 1.6, sagTolerance: 0.05 },
        { arcTo: [7.6, 5], bulge: 1.6, sagTolerance: 0.05 },
      ],
    },
  ],

  zones: [],
  entities: [],
};
