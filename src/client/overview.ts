// Hold-to-overview: the answer to "where am I, and where is the last apple".
//
// The levels grew vertical and large — 10-cathedral is 176x49 m — and the
// camera holds a hard readability floor at 38 px/m so the collision edge stays
// legible while driving. Both of those are right, and together they mean a
// player cannot see the shape of the level they are riding. The fix is not a
// minimap: a minimap costs permanent HUD real estate, shows an ABSTRACTION of
// the level instead of the level, and needs its own visual language maintained
// alongside the real renderer forever. It is worse than zooming out at
// everything except being always-on.
//
// So: hold TAB and the real camera eases out to frame the whole level, with the
// real renderer drawing the real geometry. Release and it eases back.
//
// THE SIM IS FROZEN WHILE THIS IS ON, and that is three decisions at once:
//
//   * The readability floor exists because you are driving. Overview
//     deliberately violates it, which is only acceptable because nobody is.
//   * It cannot corrupt a replay. No sim ticks advance, so `sim.advance` is
//     never called, `recorder.capture` is never called, and `state.tick` — the
//     clock — does not move. A run held in overview for a minute is
//     bit-identical to the same run never held at all. See overview.test.ts,
//     which asserts exactly that rather than trusting this paragraph.
//   * It makes the feature a viewing aid instead of a competitive question.
//
// This module is state and geometry only. It never touches a canvas and never
// reads wall-clock time itself (it is handed `dt`), so all of it is testable in
// plain node — no jsdom, per house rules.
import { approach, clamp } from './camera.ts';

export interface OverviewParams {
  /**
   * Margin around the level, as a fraction of each axis's own span. Framing a
   * level edge-to-edge puts the outer wall exactly on the screen edge, which
   * reads as "the level is cut off" rather than "that is the end".
   */
  padding: number;
  /**
   * HARD FLOOR on the overview zoom, in px/m. Deliberately far below the
   * camera's driving floor — nobody is driving — but not unlimited: past a
   * point the bike is one pixel and the whole thing stops being a view of
   * anything. A level too big to fit above this frames a generous radius around
   * the bike instead, clamped to stay inside the level.
   */
  minZoom: number;
  /** Half-life easing INTO the overview. */
  inHalfLife: number;
  /** Half-life easing back to play framing. Snapping either way is disorienting at this scale. */
  outHalfLife: number;
  /**
   * Seconds the start-of-level overview holds before it eases back in. Route
   * planning IS the game — apples are collectable in any order — so a player
   * who never sees the whole level cannot plan one. Skippable by any input, and
   * 0 disables it, because nobody wants to sit through it on their fortieth
   * retry.
   */
  introHold: number;
  /** How far in from the window edge the off-screen markers sit, in px. */
  markerInset: number;
  /**
   * Marker opacity. Subtlety is the point: they must never compete with the
   * collision edge for attention, which is the standing readability rule.
   */
  markerAlpha: number;
}

export const DEFAULT_OVERVIEW: OverviewParams = {
  padding: 0.06,
  // Chosen against the biggest level rather than in the abstract: 10-cathedral
  // is 176 x 49 m, which with padding wants ~7.3 px/m in a 1440 px window and
  // ~6.1 in a 1200 px one. A floor of 9 framed all but the last 15 m of it,
  // which is the single case this feature exists for. At 6 px/m the 1.7 m bike
  // is ten pixels — findable only because the locator ring over it is drawn in
  // SCREEN pixels and the apples have a pixel floor of their own.
  minZoom: 6,
  inHalfLife: 0.13,
  outHalfLife: 0.1,
  introHold: 1.4,
  markerInset: 30,
  markerAlpha: 0.55,
};

export function cloneOverview(p: OverviewParams): OverviewParams {
  return { ...p };
}

/** The wide framing, in the same units the camera publishes. */
export interface Frame {
  x: number;
  y: number;
  /** Pixels per metre. */
  zoom: number;
}

export interface LevelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Where the wide view sits. Pure: same inputs, same frame, no state.
 *
 * Two cases, and the second is why there is a `minZoom` at all. A level that
 * fits above the floor is framed whole and centred on its own bounds — the bike
 * is somewhere inside it and the locator ring says where. A level too large is
 * framed at the floor and centred on the BIKE, clamped so the view never runs
 * off the padded level box; that is the "generous radius" case, and centring it
 * on the bike rather than the level is what keeps it useful.
 */
export function overviewFrame(
  level: LevelBounds,
  bike: { x: number; y: number },
  cssW: number,
  cssH: number,
  p: OverviewParams,
): Frame {
  const w = Math.max(level.maxX - level.minX, 1e-3);
  const h = Math.max(level.maxY - level.minY, 1e-3);
  // Padded PER AXIS, by that axis's own span. The tempting alternative — one
  // margin in metres off the longest span — gives 10-cathedral (176 x 49 m) a
  // 10 m margin above and below a 49 m level, and it does real damage in the
  // second branch below, where the padded box is also the box the view is
  // allowed to pan within: a 4000 m level would be free to scroll 240 m past
  // its own ceiling into empty space.
  const k = Math.max(p.padding, 0);
  const padX = w * k;
  const padY = h * k;
  const lo = { x: level.minX - padX, y: level.minY - padY };
  const hi = { x: level.maxX + padX, y: level.maxY + padY };

  const viewW = Math.max(cssW, 1);
  const viewH = Math.max(cssH, 1);
  const fit = Math.min(viewW / (hi.x - lo.x), viewH / (hi.y - lo.y));
  const floor = Math.max(p.minZoom, 1e-3);
  if (fit >= floor) {
    return { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, zoom: fit };
  }
  const zoom = floor;
  return {
    x: centreWithin(bike.x, lo.x, hi.x, viewW / 2 / zoom),
    y: centreWithin(bike.y, lo.y, hi.y, viewH / 2 / zoom),
    zoom,
  };
}

/**
 * Keep a view of half-width `half` centred near `want` without letting it show
 * anything outside [lo, hi] — unless it is wider than that span, in which case
 * the only sensible answer is to centre the span.
 */
function centreWithin(want: number, lo: number, hi: number, half: number): number {
  if (hi - lo <= half * 2) return (lo + hi) / 2;
  return clamp(want, lo + half, hi - half);
}

export type OverviewMode = 'off' | 'intro' | 'held';

export interface Overview {
  /** Live, mutated in place by the tuning panel. */
  params: OverviewParams;
  readonly mode: OverviewMode;
  /**
   * True exactly while the sim must not advance. Note this is NOT `blend > 0`:
   * the ease-out runs with the sim already live, which is what makes releasing
   * TAB feel immediate rather than like a half-second of stuck controls.
   */
  readonly frozen: boolean;
  /** 0..1, eased. What the camera blends by. */
  readonly blend: number;
  /** The TAB key, down and up. */
  hold(on: boolean): void;
  /** A level was loaded: peek at the whole thing before settling to play zoom. */
  startIntro(): void;
  /** Any input at all cancels an intro. It never cancels a deliberate hold. */
  skipIntro(): void;
  /** One rendered frame. `dt` in seconds; never the sim's dt. */
  tick(dtSec: number): void;
}

export function createOverview(params: OverviewParams): Overview {
  let held = false;
  let introLeft = 0;
  let blend = 0;

  const self: Overview = {
    params,
    get mode(): OverviewMode {
      // A deliberate hold outranks an intro that is still running, so releasing
      // TAB during the opening peek drops you straight into play rather than
      // back into the remainder of the intro.
      return held ? 'held' : introLeft > 0 ? 'intro' : 'off';
    },
    get frozen(): boolean {
      return self.mode !== 'off';
    },
    get blend(): number {
      return blend;
    },
    hold(on: boolean): void {
      if (on && !held) introLeft = 0;
      held = on;
    },
    startIntro(): void {
      introLeft = Math.max(params.introHold, 0);
    },
    skipIntro(): void {
      introLeft = 0;
    },
    tick(dtSec: number): void {
      // A backgrounded tab hands back a huge dt; clamping it means the intro
      // does not silently expire while the window was hidden and the camera
      // does not teleport on the first frame back.
      const dt = clamp(dtSec, 0, 0.1);
      if (!held && introLeft > 0) introLeft = Math.max(introLeft - dt, 0);
      const want = self.mode === 'off' ? 0 : 1;
      blend = approach(blend, want, want > blend ? params.inHalfLife : params.outHalfLife, dt);
      // Land exactly on the rails. An exponential never arrives, and a blend
      // that sits at 0.003 forever keeps the renderer drawing a locator ring
      // over a bike nobody is looking for.
      if (blend < 1e-3) blend = 0;
      else if (blend > 1 - 1e-3) blend = 1;
    },
  };
  return self;
}
