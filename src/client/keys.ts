// EVERY KEY THIS GAME ADVERTISES, AS DATA.
//
// It is one file for one reason, and the reason is a bug that has now happened
// three times: an advertised key that reaches nothing.
//
//   * `A` was bound to the montage and `A` is LEAN LEFT, so `input.ts` returned
//     on the sim binding before command dispatch ever ran. The legend and the
//     results screen both printed it. It was dead from the day it shipped.
//   * The zoom keys were SUSPECTED dead on the same grounds and are not — but
//     nothing proved either way except reading main.ts by hand, twice, because
//     the legend's copy of the truth and the dispatch's copy of the truth were
//     two hand-maintained lists that agreed by luck.
//   * The README is a third copy.
//
// So the legend renders THIS, and `keys.test.ts` asserts that every code in
// here reaches a handler in `input.ts`, `main.ts` or `results.ts`, and that the
// README's own table says the same thing. A key can still be wrong. It can no
// longer be wrong QUIETLY.
//
// Pure data, no DOM, no imports: assertable in plain node, which is the same
// house rule results.ts, montage.ts and touch.ts already keep.

/**
 * Which drawing of the bike teaches this control.
 *
 * The poses are built in `legendart.ts` out of the sim's own numbers — the
 * chassis orientation, `spec.rider.leanL`, the wheel spin scalar — so a legend
 * tile is the game's renderer showing the game's state, not an icon somebody
 * drew of a bike.
 */
export type PoseId = 'still' | 'ride' | 'gas' | 'brake' | 'leanL' | 'leanR';

export interface Control {
  id: string;
  /**
   * The `KeyboardEvent.code`s that do it. Empty is legal — it means "this is a
   * thing you can only do with a thumb" — and the test skips those rather than
   * failing them.
   */
  codes: readonly string[];
  /** What the keycaps PRINT. Not the codes: nobody's keyboard says `ArrowUp`. */
  caps: readonly string[];
  /** The touch pad that does the same thing, as it labels itself. */
  pad?: string;
  /** The name of the action, in the player's words. */
  title: string;
  /** One clause of why, where the name is not enough on its own. */
  note?: string;
  pose?: PoseId;
}

/**
 * THE FIVE BITS THE SIM ACTUALLY TAKES, and nothing else may be in this list.
 *
 * FLIP IS FIRST AND IT IS THE HERO TILE. It is the mechanic the whole
 * double-back level design rests on, it is free and legal in mid-air, and for
 * three milestones it was line four of a text block — which is why players kept
 * riding these levels as though they were one-way. A picture of the bike facing
 * both ways says it in less time than the sentence takes to read.
 */
export const DRIVE: readonly Control[] = [
  {
    id: 'flip',
    codes: ['Space', 'ShiftLeft'],
    caps: ['space'],
    pad: 'flip',
    title: 'flip',
    note: 'free, legal in mid-air, and how you double back',
    pose: 'ride',
  },
  {
    id: 'gas', codes: ['ArrowUp', 'KeyW'], caps: ['↑', 'W'], pad: 'gas',
    title: 'gas', pose: 'gas',
  },
  {
    id: 'brake', codes: ['ArrowDown', 'KeyS'], caps: ['↓', 'S'], pad: 'brake',
    title: 'brake', pose: 'brake',
  },
  {
    id: 'leanL', codes: ['ArrowLeft', 'KeyA'], caps: ['←', 'A'], pad: 'lean ↺',
    title: 'lean left', note: 'rotates the bike — in the air it is your only steering', pose: 'leanL',
  },
  {
    id: 'leanR', codes: ['ArrowRight', 'KeyD'], caps: ['→', 'D'], pad: '↻ lean',
    title: 'lean right', note: 'rotates the bike — in the air it is your only steering', pose: 'leanR',
  },
];

/**
 * Everything else a PLAYER does. The test for this list is "would somebody who
 * has never opened a terminal press it" — restarting, looking at the level,
 * changing level, seeing where they stand, choosing a bike, muting.
 *
 * Every one of these is also reachable by thumb, or is meaningless without a
 * keyboard (there is nothing to pause on a phone that the overview pad does not
 * already freeze).
 */
export const PLAY: readonly Control[] = [
  { id: 'restart', codes: ['KeyR'], caps: ['R'], pad: 'restart', title: 'restart' },
  {
    id: 'overview', codes: ['Tab'], caps: ['tab'], pad: 'overview',
    title: 'whole level — hold', note: 'the sim and the clock freeze while it is down',
  },
  { id: 'level', codes: ['BracketLeft', 'BracketRight'], caps: ['[', ']'], title: 'prev / next level' },
  { id: 'chooser', codes: ['KeyC'], caps: ['C'], pad: 'levels', title: 'all levels' },
  {
    id: 'zoom',
    codes: ['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'Digit0', 'Numpad0'],
    caps: ['+', '−', '0'],
    pad: 'zoom',
    title: 'zoom',
    note: 'in, out, back to the default — remembered; a pinch drives the same variable',
  },
  { id: 'board', codes: ['KeyB'], caps: ['B'], title: 'leaderboard' },
  { id: 'look', codes: ['KeyY'], caps: ['Y'], title: 'your bike' },
  { id: 'mute', codes: ['KeyM'], caps: ['M'], title: 'sound' },
  { id: 'pause', codes: ['KeyP'], caps: ['P'], title: 'pause' },
  // IT ADVERTISES ITSELF, and it is the one key that has to. Everything else in
  // this list is discoverable by reading the legend; the legend is not, once it
  // is closed. So the closed state leaves a chip in the corner AND the open
  // state prints the key, and neither of those depends on remembering anything.
  { id: 'help', codes: ['Slash'], caps: ['?'], pad: 'controls', title: 'these controls' },
];

/** The dev toolbar's actions, by id. `main.ts` supplies one function each. */
export type DevActionId =
  | 'panel' | 'readout' | 'collision' | 'art'
  | 'replay' | 'exportReplay' | 'importReplay' | 'montage' | 'editor';

export interface DevTool extends Control {
  id: DevActionId;
}

/**
 * THE DEVELOPER AFFORDANCES, WHICH ARE NOT CONTROLS.
 *
 * This split is the whole point of the rewrite and it came from the user
 * looking at the old legend: a flat list of eighteen keys in which "gas" and
 * "hide the debug readout" sat at the same weight is not a control legend, it
 * is a debug overlay that survived into production. A tuning panel, a collision
 * overlay and a level editor are things you reach for while BUILDING this game.
 * Three of them freeze or repaint the frame, one of them hands you the level's
 * geometry on handles, and none of them is a thing a player wants on the way to
 * a faster time.
 *
 * THE KEYS ALL STILL WORK. Nothing here is removed, revoked or gated — this is
 * about what is ADVERTISED. Somebody who knows that ` hides the readout keeps
 * hitting ` forever, and the toolbar is how anybody else finds out it exists at
 * all, since it is now behind one switch instead of scattered across nine
 * single letters a player can hit by accident.
 */
export const DEV: readonly DevTool[] = [
  { id: 'panel', codes: ['KeyH'], caps: ['H'], title: 'tuning sliders', note: 'a tuned bike cannot post a time' },
  { id: 'readout', codes: ['Backquote'], caps: ['`'], title: 'debug readout', note: 'warnings stay up either way' },
  { id: 'collision', codes: ['KeyG'], caps: ['G'], title: 'collision edge', note: 'normals and live contacts, over everything' },
  { id: 'art', codes: ['KeyV'], caps: ['V'], title: 'art on / off', note: 'the A/B for readability' },
  { id: 'replay', codes: ['KeyT'], caps: ['T'], title: 'replay last run', note: 'and re-check its hash chain' },
  { id: 'exportReplay', codes: ['KeyE'], caps: ['E'], title: 'export replay' },
  { id: 'importReplay', codes: ['KeyL'], caps: ['L'], title: 'load replay', note: 'or drop a file on the window' },
  { id: 'montage', codes: ['KeyF'], caps: ['F'], title: 'every attempt at once' },
  { id: 'editor', codes: ['KeyQ'], caps: ['Q'], title: 'edit this level', note: 'Q again rides what you drew' },
];

/** Every code this build advertises anywhere, deduplicated. */
export function advertisedCodes(): string[] {
  const out = new Set<string>();
  for (const c of [...DRIVE, ...PLAY, ...DEV]) for (const code of c.codes) out.add(code);
  return [...out].sort();
}
