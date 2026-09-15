// The one ugly hand-written test level for milestone 1.
//
// It is plain data in exactly the shape a `.json` file has — `parseLevel` takes
// `unknown` and does not care where the object came from — so this doubles as
// the worked example of the format. `bin/level-export` writes it out as JSON.
//
// It deliberately exercises every feature the sim has: a rolling floor, a
// launch bump, a pit with a `ground` boulder in it, a raised shelf under a LOW
// CEILING that kills you if you volt under it, a steep climb, and a flower at
// the far end. Ugly on purpose — art is milestone 9, and a pretty level here
// would only make it harder to see what the collision is doing.
import type { RawLevel } from './level.ts';

export const TEST_LEVEL: RawLevel = {
  format: 'velo-level',
  rev: 1,
  name: 'test01 — the ugly one',
  author: 'm1',

  // Chassis origin. The wheels hang 0.15 below it and have a 0.25 radius, so
  // 0.6 above a floor at y=0 drops the bike 0.2 m onto its suspension.
  start: { x: -3, y: 0.6 },
  flower: { x: 59, y: 4.6 },

  apples: [
    { x: 9, y: 2.2 },
    { x: 20.5, y: -0.8 },
    { x: 29, y: 2.9 },
    { x: 47, y: 1.6 },
    { x: 57, y: 5.0 },
  ],

  polygons: [
    {
      // The cave. Playable space is INSIDE the ring; everything outside it is
      // solid. Written floor left-to-right, then ceiling right-to-left. Winding
      // is normalised on load, so this order is a convenience, not a contract.
      kind: 'cave',
      points: [
        [-6, 0],
        [4, 0],
        [6, 0.2],
        [8, 1.2],
        [10, 1.2],
        [12, 0],
        [16, 0],
        [17, -0.2],
        [18, -4],
        [22, -4],
        [23, -0.5],
        [24, 0],
        [26, 2],
        [32, 2],
        [33, 1.6],
        [35, 0],
        [38, 0],
        [39, 0.6],
        [41, 0.6],
        [42, 0],
        [45, 0],
        [46, 0.8],
        [48, 0.8],
        [49, 0],
        [52, 0],
        [54, 1.5],
        [56, 4],
        [60, 4],
        [60, 14],
        [36, 14],
        [34, 12],
        [32, 3.6],
        [26, 3.6],
        [24, 12],
        [20, 12],
        [18, 10],
        [10, 10],
        [6, 12],
        [-6, 12],
      ],
    },
    {
      // A boulder in the pit. `ground` means solid INSIDE — the opposite
      // interpretation to the cave above, and the reason the format tags kind
      // explicitly instead of leaning on an invisible winding convention.
      kind: 'ground',
      points: [
        [19, -4],
        [20.5, -1.5],
        [22, -4],
      ],
    },
    {
      // Never collides. Here only so that the decor path is exercised by every
      // run rather than by nothing.
      kind: 'decor',
      points: [
        [1, 6],
        [3, 8],
        [5, 6],
      ],
    },
  ],

  // Reserved for the later boost pads, gravity zones, ice and teleporters. Rev
  // 1 ignores both arrays, and the loader tolerates unknown entries rather than
  // rejecting them — that is what keeps a level authored in 2027 loadable by a
  // 2026 client.
  zones: [],
  entities: [],
};
