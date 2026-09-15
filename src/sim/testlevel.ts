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
  // the bike's resting height over a floor at y=0 is about 0.37. Starting at
  // 0.42 is a 5 cm settle rather than a drop.
  //
  // This is not cosmetic. Drive torque is reacted on the CHASSIS, and while a
  // wheel is unloaded there is nothing for that reaction to push against — so
  // holding the throttle through even a 0.2 m spawn drop builds enough backward
  // rotation to commit to a backflip. That is correct physics and it is the
  // same mechanism that lets you rotate the bike with the throttle in mid-air,
  // which is a real technique. It just should not happen on the start line.
  start: { x: -5, y: 0.42 },
  flower: { x: 64, y: 4.0 },

  // Every one of these is REACHABLE, and that was not true of the first draft:
  // a playtest found apples nobody could get to, on the very first hand-authored
  // level, with a human placing five of them. Reachability is now verified by
  // driving — see bin/level-drive — rather than by looking at coordinates.
  //
  // Pickup tests the head, the chassis origin and both wheels against a 0.4 m
  // radius, so an apple roughly 1 m above a surface is collected by simply
  // riding past it: the head sits at armLength above the chassis, which sits
  // about 0.42 above the ground.
  apples: [
    { x: 9, y: 1.5 }, //      over the roller
    { x: 19.5, y: -0.2 }, //  sitting on the boulder in the pit: the detour
    { x: 29, y: 2.9 }, //     on the shelf, under the low ceiling
    { x: 47, y: 1.6 }, //     over the second bump
    { x: 61, y: 4.0 }, //     on the top shelf, past the climb
  ],

  polygons: [
    {
      // The cave. Playable space is INSIDE the ring; everything outside it is
      // solid. Written floor left-to-right, then ceiling right-to-left. Winding
      // is normalised on load, so this order is a convenience, not a contract.
      //
      // The first 12 m are deliberately flat and the first feature is a gentle
      // roller, because the point of this level is to FEEL the bike. An opening
      // bump steep enough to launch you two metres means a tuning session spent
      // watching the restart screen.
      //
      // EVERY CORNER HERE IS SHARP, ON PURPOSE. test01 is the ugly one and the
      // plain-point-list compatibility fixture, so it uses no arcs — which also
      // makes it the level that demonstrates what a sharp transition costs. A
      // wheel meeting a corner square loses the component of its velocity
      // normal to the new face, and restitution is 0.05, so cos^2(theta) of the
      // kinetic energy is destroyed on contact: 21% at 30 degrees, 41% at 50.
      // That is correct physics and it is why the slopes below are gentle and
      // why test02 fillets its transitions with arcs instead. `bin/slope-sweep`
      // measures it.
      kind: 'cave',
      points: [
        [-8, 0],
        [6, 0],
        [8, 0.45],
        [10, 0.45],
        [12, 0],
        [16, 0],
        // A kicker at the pit lip. Without it the gap is a trap rather than a
        // jump: carry speed and you fly the pit, roll up to it slowly and you
        // drop in for the apple.
        [17.2, 0.55],
        [17.45, 0.45],
        // The pit. It was 4 m deep with a 75-degree exit ramp, which made it a
        // one-way hole: the apple inside it was collectable exactly once per
        // run and cost you the level. Now it is 1.2 m deep and climbs out at
        // 21.8 degrees, so diving in is a DETOUR rather than a death sentence.
        [18, -1.2],
        [21, -1.2],
        [24, 0],
        // Up to the shelf at 33.7 degrees. Steep enough to need some commitment
        // out of the pit, inside what the bike can crawl up from slow.
        [27, 2],
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
        // Four metres of flat to wind up on, and then THE CLIMB: 3.5 m of rise
        // over 5 m, 35 degrees. This is the level's one real hill and it is here
        // so that "can you get up a semi-steep slope" is answerable by hand
        // rather than only in a synthetic rig. Measured on that rig: at 35
        // degrees throttle alone works but pitches the bike to 84-142 degrees
        // on the way — one notch from a loop — while leaning into the face
        // keeps it at 45-51. It is climbable naively and much nicer with
        // technique, which is exactly the shape wanted.
        [53, 0],
        [58, 3.5],
        [66, 3.5],
        [66, 14],
        [36, 14],
        [34, 12],
        // The low ceiling. There is 1.6 m of clearance over the shelf, and an
        // upright rider needs 1.11 of it — so you can ride under this, but you
        // cannot volt under it. Knowing when you cannot afford to volt is the
        // skill a fixed-offset head would have deleted invisibly.
        [32, 3.6],
        [27, 3.6],
        [24, 12],
        [20, 12],
        [18, 10],
        [10, 10],
        [6, 12],
        [-8, 12],
      ],
    },
    {
      // A boulder in the pit. `ground` means solid INSIDE — the opposite
      // interpretation to the cave above, and the reason the format tags kind
      // explicitly instead of leaning on an invisible winding convention.
      //
      // It is also the apple's perch: its apex is at -0.45 and the apple sits a
      // wheel radius above that, so rolling over the boulder collects it.
      kind: 'ground',
      points: [
        [18.5, -1.2],
        [19.5, -0.45],
        [20.5, -1.2],
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
