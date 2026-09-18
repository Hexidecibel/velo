// Touch controls, for playing this on a phone.
//
// LARGE ZONES, NOT JOYSTICKS, and that is the one decision everything else here
// follows from.
//
// A virtual stick is the obvious thing to reach for and it would be wrong,
// because THE SIM TAKES A BITMASK. Throttle is on or off; lean is on or off;
// there is no analog value anywhere in the physics and there never has been. A
// stick over a bitmask is a four-way pad wearing a costume, and a worse one
// than a pad: it adds a dead zone, it makes the thumb travel to reach an input
// that is binary at the other end, and — the part that actually hurts — it is a
// FALSE AFFORDANCE. Everybody who has held a stick expects it to mean partial
// throttle and a lean proportional to the tilt, and it cannot mean either. A
// control that promises a thing the game does not have is worse than a blunt
// one that promises exactly what it does.
//
// So: big rectangles, in the places thumbs already are.
//
// NO DOM IN THE DECISIONS. Where the zones are, which one a touch is in and
// what bitmask a set of held zones produces is arithmetic over plain objects,
// tested in plain node — same house rule as results.ts and montage.ts. The
// bottom half of this file turns that into elements and pointer handlers.
//
// THE COMPATIBILITY CLAIM, AND IT IS NOT A HOPE: a touch-played run records the
// SAME INPUT STREAM as a keyboard one. `zoneMask` returns nothing but the sim's
// own `IN_*` bits, the result is OR-ed into the same `input.mask()` the fixed
// step loop samples at 128 Hz, and the recorder never learns where a bit came
// from. So a phone run verifies on the server exactly as a desktop run does,
// and `touch.test.ts` asserts it by running a touch-derived stream through
// `verifyReplay`.
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '@/sim/consts.ts';

/**
 * `restart`, `levels`, `auto`, `zoom` and `full` are COMMANDS, not sim input:
 * they fire on the press and contribute no bit. They are in the same list as the
 * rest because they occupy screen space and the hit test has to know about them
 * — a flip zone that silently extended under the restart button would be a
 * missed input, and this game punishes one of those immediately.
 */
export type ZoneId =
  | 'throttle' | 'brake' | 'leanL' | 'leanR' | 'flip'
  | 'restart' | 'levels' | 'auto' | 'zoom' | 'full';

export interface Zone {
  id: ZoneId;
  /** CSS PIXELS from the top-left of the viewport. Not fractions — see `MM`. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** What it prints on itself. Words, not icons nobody has learned. */
  label: string;
  /** True for the commands: pressed, never held. */
  command: boolean;
}

/**
 * CSS PIXELS PER MILLIMETRE, and the reason every number below is in mm.
 *
 * A THUMB IS THE SAME SIZE ON EVERY PHONE. A fraction of the canvas is not, and
 * sizing pads as fractions is what produced the screenshot this rewrite comes
 * from: `GAS`, `BRAKE` and two `LEAN` pads at 50% of the height each, covering
 * the entire lower half of a large phone with empty background while the whole
 * level was in a band across the top. The same fractions on a small phone would
 * have been too small. Neither is a size anybody chose.
 *
 * CSS's own `mm` unit cannot be used for this: absolute CSS units are anchored
 * to the CSS pixel at exactly 96 per inch, which is a fiction on a phone. The
 * real number is set by the device-pixel-ratio the platform picks, and it is
 * knowable only statistically:
 *
 *   Android           densityDpi / 160 dpr, so ~160 CSS px/in   6.30 px/mm
 *   iPhone 15 Pro     393 px across 2.78 in                     5.56 px/mm
 *   iPhone SE         375 px across 2.31 in                     6.38 px/mm
 *   iPad Pro 11"      834 px across 7.0 in                      4.69 px/mm
 *
 * 6.0 is the middle of the phone range, so a pad specified at 12 mm lands
 * between 10.9 mm (a 5.56 px/mm iPhone) and 12.6 mm (a 6.3 px/mm Android) —
 * inside the comfortable band at both ends, which is the whole requirement. A
 * tablet gets pads about 25% larger than nominal, which is the harmless
 * direction and is also roughly right for a hand holding a heavier device.
 *
 * It is one constant and not a media query because the overlay only exists when
 * the primary pointer is coarse — or when `?touch=1` has forced it on in order
 * to PHOTOGRAPH the phone layout, which is exactly the case where the phone's
 * density is the right assumption rather than the monitor's.
 */
export const PX_PER_MM = 6;

/**
 * THE LAYOUT, in millimetres, and what each control is paying for.
 *
 * The sizing rule is a physical one: ABOUT 9-10 MM IS THE MINIMUM COMFORTABLE
 * TOUCH TARGET AND 12-15 MM IS GENEROUS. Past that a pad is not easier to hit,
 * it is just taking screen away from the level — which is what the previous
 * layout did, at roughly 40% of the glass.
 *
 * THUMBS PIVOT FROM WHERE THE HAND GRIPS and sweep an arc, which on a large
 * phone makes the far corners harder to reach than the near ones, not easier.
 * So everything a thumb touches while driving hugs the bottom corner it is
 * already near, and nothing that matters is out at the far end of the arc.
 *
 * What each control is owed:
 *
 *   GAS is held almost constantly, so it gets the best position on the screen —
 *   the bottom-right corner, where the thumb rests with no reach at all — and
 *   the largest area.
 *   LEAN is used constantly and switches direction mid-air, so the pair is under
 *   the left thumb, generous, and TILED ALONG THEIR SHARED EDGE: sliding from
 *   one to the other without lifting has to work.
 *   BRAKE is used in bursts, inboard of the gas, narrower because you reach for
 *   it rather than live on it.
 *   FLIP is rare and critical. It sits directly above the right cluster, where
 *   the right thumb reaches it by rolling up off the throttle, and it is a PLACE
 *   rather than a gesture — a gesture that fails does so silently.
 *   RESTART, LEVELS, GAS-MODE, ZOOM and FULLSCREEN are occasional. They are
 *   small, they are in a block at the top-left out of both thumbs' way, and they
 *   are dimmer than the controls, because in the last layout they were as
 *   prominent as them.
 */
export const MM = {
  /** Margin from the screen edge (on top of any safe-area inset). */
  edge: 3.5,
  /** Between tiles of one cluster that are NOT meant to be slid between. */
  gap: 1.5,
  /**
   * Between the right cluster and FLIP above it, and it is a DEAD STRIP ON
   * PURPOSE — the one place in this layout that has one.
   *
   * Everywhere else a gap would eat an input. Here it prevents one: a thumb
   * drifting up off a held throttle must not arrive in FLIP, because that fires
   * a direction change in mid-air and loses the run. `slideZone` latches a touch
   * that slides into nothing, so the strip catches the drift and the throttle
   * stays held. Reaching flip deliberately means crossing 3 mm of nothing, which
   * a deliberate press does and a drift does not.
   */
  flipGap: 3,
  /** The least that may ever separate the two thumb clusters. */
  clusterGap: 5,
  gasW: 21,
  gasH: 20,
  brakeW: 13,
  flipH: 13,
  leanW: 15,
  leanH: 20,
  cmdW: 13,
  cmdH: 9,
  /**
   * The widest the command block is allowed to be before it wraps to a second
   * row. Three across, which ends about a third of the way over a landscape
   * phone — clear of the level card the art renderer centres at the top.
   */
  cmdBlockW: 45,
};

/** The smallest a hold pad's short side is allowed to get, in mm. */
export const MIN_PAD_MM = 9;

/**
 * How much of the top of the canvas the in-canvas art HUD owns, in CSS px.
 *
 * `drawHud` puts its panels at y=12, 34 px tall, with a 4 px ink shadow: a fixed
 * pixel size, so this is a fixed pixel number and not a fraction. Nothing in
 * this overlay is allowed above it, which is the DOM half of the same rule that
 * hides the desktop level bar on touch — two HUDs drawn on top of each other is
 * what the player photographed.
 */
export const HUD_BAND_PX = 52;

/** The screen the pads are being laid out on. */
export interface Viewport {
  /** CSS px. */
  w: number;
  h: number;
  /** CSS px per mm. Defaults to `PX_PER_MM`. */
  mm?: number;
  /** Safe-area insets in CSS px — the notch, the home indicator, the cutout. */
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface LayoutOpts {
  autoThrottle: boolean;
  /** The manual zoom multiplier, for the zoom pad to print. */
  bias?: number;
  /**
   * Whether a fullscreen pad is offered at all, and what it would do.
   *
   * 'none' means the browser has no Fullscreen API worth offering — iOS Safari
   * on an iPhone, most obviously — and the pad is simply not built. A control
   * that does nothing is worse than no control.
   */
  fullscreen?: 'none' | 'off' | 'on';
}

export function zoomLabel(bias: number): string {
  return `zoom ${(Number.isFinite(bias) ? bias : 1).toFixed(1)}×`;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * THE LAYOUT, as rectangles in CSS pixels on a particular screen.
 *
 * Everything is placed from the mm table above, then ONE SCALE FACTOR is applied
 * to the thumb clusters if the screen cannot hold them at full size. Scaling
 * rather than reflowing is deliberate: the positions are what a player learns,
 * and a layout that rearranges itself between portrait and landscape is two
 * layouts to learn. Portrait is the hard case — a 360 px-wide phone is 60 mm
 * across and the two clusters plus their gap want 76 — so it shrinks, and
 * `MIN_PAD_MM` is the line below which it is honest to say the screen is too
 * small rather than to keep shrinking.
 */
export function touchZones(vp: Viewport, o: LayoutOpts): Zone[] {
  const mm = vp.mm && vp.mm > 0 ? vp.mm : PX_PER_MM;
  const px = (v: number): number => v * mm;
  const left0 = Math.max(vp.left ?? 0, 0) + px(MM.edge);
  const right0 = vp.w - Math.max(vp.right ?? 0, 0) - px(MM.edge);
  const bottom0 = vp.h - Math.max(vp.bottom ?? 0, 0) - px(MM.edge);
  // Nothing goes above the art HUD, safe-area inset or no safe-area inset.
  const top0 = Math.max(Math.max(vp.top ?? 0, 0) + px(MM.edge), HUD_BAND_PX);

  // --- how much of the mm table this screen can actually afford -------------
  const wantW = 2 * MM.leanW + MM.gasW + MM.brakeW;
  const availW = (right0 - left0) / mm - MM.clusterGap;
  const wantH = MM.gasH + MM.flipGap + MM.flipH;
  const availH = (bottom0 - top0) / mm;
  const s = clamp(Math.min(availW / wantW, availH / wantH), 0.2, 1);

  const gasW = px(MM.gasW * s);
  const gasH = px(MM.gasH * s);
  const brakeW = px(MM.brakeW * s);
  const flipH = px(MM.flipH * s);
  const leanW = px(MM.leanW * s);
  const leanH = px(MM.leanH * s);

  const zones: Zone[] = [];

  // --- the commands, top-left, small and dim -------------------------------
  //
  // TOP-LEFT IS THE ONE CORNER THAT IS FREE. Top-centre is the art renderer's
  // level card and clock, and top-right was the desktop level picker — which no
  // longer exists on touch, because it was being drawn straight through the
  // art HUD. `levels` below is what replaces it.
  //
  // BELOW THE HUD BAND rather than beside it: on a narrow phone the level card
  // is most of the width, so "beside" is not a place that exists.
  const cmds: Array<[ZoneId, string]> = [
    ['restart', 'restart'],
    ['levels', 'levels'],
  ];
  if (o.fullscreen === 'off') cmds.push(['full', 'full screen']);
  else if (o.fullscreen === 'on') cmds.push(['full', 'exit full']);
  cmds.push(['auto', o.autoThrottle ? 'gas: auto' : 'gas: held']);
  cmds.push(['zoom', zoomLabel(o.bias ?? 1)]);

  // AS NARROW AS THE ROOM ALLOWS, AND NO NARROWER. A block three wide and two
  // deep is the shape that stays out of the way: it ends about a third of the
  // way across, clear of the level card the art renderer draws at the top
  // centre, and clear of the lean pads below. `MM.cmdBlockW` is that cap — a row
  // of five spans nearly half a landscape phone and crowds the HUD, which is a
  // thing a screenshot showed and a fraction could not.
  //
  // It widens only when the screen is too SHORT for two rows. A 280 px-tall
  // landscape viewport has about 13 mm between the HUD band and the lean pads,
  // which is one row and not two — so the block goes wide and flat rather than
  // shrinking the buttons to 6 mm, because a control too small to hit is worse
  // than one in a slightly worse place.
  const leanTop = bottom0 - leanH;
  const cmdRoom = (leanTop - px(MM.gap) - top0) / mm;
  const fits = (n: number): number => Math.floor((n + MM.gap) / (MM.cmdW + MM.gap));
  const maxCols = Math.max(1, Math.min(cmds.length, fits((right0 - left0) / mm)));
  let cols = Math.max(1, Math.min(maxCols, fits(MM.cmdBlockW)));
  const deep = (n: number): number => {
    const r = Math.ceil(cmds.length / n);
    return r * MM.cmdH + (r - 1) * MM.gap;
  };
  while (cols < maxCols && deep(cols) > cmdRoom) cols++;
  // And if even the widest arrangement does not fit, the commands give way
  // rather than collide: a lean pad that a command has eaten a corner of is a
  // lost run, and a cramped `zoom` readout is not.
  const cs = clamp(Math.min(s, cmdRoom / deep(cols)), 0.2, 1);
  const cmdW = px(MM.cmdW * cs);
  const cmdH = px(MM.cmdH * cs);
  const cmdGap = px(MM.gap * cs);
  for (let i = 0; i < cmds.length; i++) {
    const [id, label] = cmds[i];
    zones.push({
      id,
      x: left0 + (i % cols) * (cmdW + cmdGap),
      y: top0 + Math.floor(i / cols) * (cmdH + cmdGap),
      w: cmdW,
      h: cmdH,
      label,
      command: true,
    });
  }

  // --- flip, above the right cluster, across a dead strip ------------------
  const rightW = gasW + brakeW;
  const rightX = right0 - rightW;
  const rowY = bottom0 - gasH;
  zones.push({
    id: 'flip',
    x: rightX,
    // `top0` rather than the arithmetic alone: on a viewport short enough that
    // the cluster exactly fills the space, floating point can put this a
    // hundredth of a pixel inside the HUD band, and "nothing is ever above the
    // HUD" is a rule worth keeping true rather than nearly true.
    y: Math.max(top0, rowY - px(MM.flipGap * s) - flipH),
    w: rightW,
    h: flipH,
    label: 'flip',
    command: false,
  });

  // --- lean, bottom-left, two zones sharing an edge ------------------------
  //
  // TILED WITH NO DEAD STRIP: direction changes constantly in mid-air and
  // lifting a thumb to do it would cost runs, so a moving touch re-tests which
  // one it is in on every move and a gap here would swallow exactly that.
  zones.push({ id: 'leanL', x: left0, y: leanTop, w: leanW, h: leanH, label: 'lean ↺', command: false });
  zones.push({ id: 'leanR', x: left0 + leanW, y: leanTop, w: leanW, h: leanH, label: '↻ lean', command: false });

  // --- the right cluster ---------------------------------------------------
  if (o.autoThrottle) {
    // AUTO-THROTTLE. The gas is held for you, so the right cluster collapses to
    // one target and it is the brake — see `zoneMask` for why the brake has to
    // cut the throttle rather than fight it.
    //
    // It takes the WHOLE cluster rather than staying its own narrow self,
    // because the thumb that was resting on the gas now has nothing under it,
    // and a corner of dead glass where a control used to be is a control you
    // press and miss.
    zones.push({ id: 'brake', x: rightX, y: rowY, w: rightW, h: gasH, label: 'brake', command: false });
  } else {
    zones.push({ id: 'brake', x: rightX, y: rowY, w: brakeW, h: gasH, label: 'brake', command: false });
    // `rightX + brakeW` and not `right0 - gasW`: the two are the same number in
    // algebra and not always in floating point, and the one property that has to
    // hold exactly is that these two TILE — there is no dead strip between the
    // brake and the gas for a thumb to drift into.
    zones.push({ id: 'throttle', x: rightX + brakeW, y: rowY, w: gasW, h: gasH, label: 'gas', command: false });
  }
  return zones;
}

/**
 * How much of the BOTTOM of the screen a resting pair of thumbs covers, in CSS
 * px. The camera's `screenBiasY` is derived from it — see `screenBiasFor`.
 *
 * FLIP IS NOT IN IT, deliberately. The inset means "where the hands live", and
 * a hand does not live on flip: it is touched for a tenth of a second and the
 * play area behind it is legible for the rest of the run. Counting it would
 * push the bike a centimetre up the screen to dodge a pad nobody is touching.
 */
export function thumbInsetPx(zones: readonly Zone[], vpH: number): number {
  let top = vpH;
  for (const z of zones) {
    if (z.id === 'flip' || z.command) continue;
    top = Math.min(top, z.y);
  }
  return Math.max(vpH - top, 0);
}

/** The smallest side of the smallest HOLD pad, in mm. The comfort check. */
export function smallestPadMm(zones: readonly Zone[], mm = PX_PER_MM): number {
  let out = Infinity;
  for (const z of zones) {
    if (z.command) continue;
    out = Math.min(out, z.w / mm, z.h / mm);
  }
  return Number.isFinite(out) ? out : 0;
}

/**
 * Which zone a point is in, or null for the play area. CSS pixels, from the
 * top-left of the overlay — which is the viewport, since `#touch` is
 * `position: fixed; inset: 0`.
 *
 * FIRST MATCH WINS and the order is the order in `touchZones`, which puts the
 * commands first. Nothing overlaps anything — `touch.test.ts` asserts that
 * across every viewport in the table — so the order is a tie-break that never
 * has to be taken, which is the point: "which input did I just give" must not
 * depend on list order, because a player cannot see list order.
 */
export function hitZone(zones: readonly Zone[], px: number, py: number): ZoneId | null {
  for (const z of zones) {
    if (px >= z.x && px < z.x + z.w && py >= z.y && py < z.y + z.h) return z.id;
  }
  return null;
}

/**
 * The sim bitmask for a set of held zones.
 *
 * MULTI-TOUCH IS THE NORMAL CASE, not an edge case, which is why this takes a
 * SET rather than one zone: throttle plus lean is most of the game, and
 * throttle plus lean plus flip — three fingers at once — is how you save a
 * landing. Nothing here is exclusive and nothing cancels anything else.
 *
 * The one exception, and it is auto-throttle's: THE BRAKE CUTS THE AUTO GAS.
 * In the sim, throttle and brake are additive torques on the wheel, so holding
 * both makes the bike fight itself — the brake caps the spin at zero and the
 * drive immediately re-spins it. Under auto-throttle a player pressing brake
 * means "stop", so the throttle bit comes off. A player holding both DELIBERATELY
 * on the keyboard still gets exactly what they asked for; this only governs the
 * bit this file adds on the player's behalf.
 */
export function zoneMask(held: Iterable<ZoneId>, autoThrottle: boolean): number {
  let mask = 0;
  let brake = false;
  for (const id of held) {
    switch (id) {
      case 'throttle': mask |= IN_THROTTLE; break;
      case 'brake': mask |= IN_BRAKE; brake = true; break;
      case 'leanL': mask |= IN_LEAN_L; break;
      case 'leanR': mask |= IN_LEAN_R; break;
      case 'flip': mask |= IN_FLIP; break;
      default: break;
    }
  }
  if (autoThrottle && !brake) mask |= IN_THROTTLE;
  return mask;
}

/**
 * Where a touch that has moved now counts as being.
 *
 * SLIDING BETWEEN THE LEAN ZONES MUST WORK — you change direction mid-air
 * constantly and lifting a thumb to do it would cost runs — so a moving touch
 * re-tests and takes the new zone.
 *
 * BUT A TOUCH THAT SLIDES INTO NOTHING KEEPS WHAT IT HAD. The throttle is held
 * for most of a run and a thumb drifts while it is held; a drift of four
 * millimetres past the top edge of the gas zone must not cut the engine
 * silently. So leaving a zone for the play area LATCHES, and only lifting the
 * finger releases.
 *
 * A COMMAND ZONE IS NEVER SLID INTO. Restart under a sliding thumb would end
 * runs by accident, so commands fire on the press and a move that crosses one
 * keeps the zone it had.
 */
export function slideZone(
  zones: readonly Zone[],
  current: ZoneId | null,
  px: number,
  py: number,
): ZoneId | null {
  const hit = hitZone(zones, px, py);
  if (hit === null) return current;
  const z = zones.find((x) => x.id === hit);
  if (!z || z.command) return current;
  return hit;
}

// --- the pinch ---------------------------------------------------------------
//
// SCREENS DIFFER AND SO DO PEOPLE, so the derived base zoom is a good default
// rather than an answer, and pinch is how you say otherwise. It drives
// `zoomBias` — the same variable the +/- keys already drive — because a second
// concept for "the player asked for a different zoom" is two things to keep in
// step for no gain.
//
// THE HARD PART IS NOT THE ARITHMETIC. It is that TWO FINGERS ON THE GLASS IS
// THE NORMAL CASE HERE: gas and lean is most of the game, and gas, lean and
// flip is three. A pinch recogniser that watched raw touch points would fire
// during ordinary play, and — far worse — would have to decide what to do with
// the pads while it did. So the rule is structural rather than heuristic:
//
//   A POINTER THAT LANDED ON A PAD IS A CONTROL FOR AS LONG AS IT IS DOWN.
//
// It can never become half of a gesture, including after it slides off the pad
// into the play area, which is exactly the latch that keeps a drifting thumb on
// the throttle. Pinch fingers and control fingers are therefore disjoint sets
// by construction, and no gesture can take an input away. Two thumbs on pads is
// zero pinch candidates; a thumb on the gas and a stray touch in the play area
// is one. It takes TWO FINGERS THAT BOTH STARTED IN THE PLAY AREA, which is not
// a thing that happens while driving.

/** A pointer in the play area, in CSS pixels relative to the overlay. */
export interface Pointer {
  id: number;
  x: number;
  y: number;
}

/**
 * How far apart two fingers must START for it to be a pinch at all.
 *
 * A pinch is a deliberate two-handed (or thumb-and-finger) spread; 56 px is
 * about a centimetre and a half on a phone. Below it, the pair is far likelier
 * to be one hand resting, a palm edge, or the two-finger tap somebody uses to
 * skip the opening peek — and dividing by a tiny starting spread is also what
 * makes a jittery gesture multiply the zoom by ten.
 */
export const PINCH_MIN_SPREAD = 56;

/**
 * The dead band, as a fraction of the starting spread, before the zoom moves at
 * all — and it is applied as a RUBBER BAND rather than a threshold that arms:
 * the scale is continuous through it, so the picture never jumps the moment the
 * gesture is recognised.
 */
export const PINCH_DEAD = 0.1;

export function spread(a: Pointer, b: Pointer): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Which pointers are eligible to be pinch fingers: the ones in the play area.
 * `hitZone` is the whole test, which is why the pads never had to know about
 * any of this.
 */
export function playAreaPointers(zones: readonly Zone[], pts: readonly Pointer[]): Pointer[] {
  return pts.filter((p) => hitZone(zones, p.x, p.y) === null);
}

/**
 * The two fingers a gesture is made of, or null.
 *
 * EXACTLY TWO, and only at the moment a gesture starts. A third free finger
 * arriving later does not cancel the one in progress — a gesture that dies
 * because of a knuckle is the same silent failure the pads were designed to
 * avoid — it is simply not part of it.
 */
export function pinchPair(free: readonly Pointer[]): [Pointer, Pointer] | null {
  if (free.length !== 2) return null;
  return spread(free[0], free[1]) >= PINCH_MIN_SPREAD ? [free[0], free[1]] : null;
}

/**
 * What the fingers are asking the zoom to be multiplied by, relative to where
 * the gesture began. 1 inside the dead band, and continuous across its edges.
 */
export function pinchScale(spread0: number, now: number, dead = PINCH_DEAD): number {
  if (!(spread0 > 0) || !(now > 0)) return 1;
  const r = now / spread0;
  if (r > 1 + dead) return r / (1 + dead);
  if (r < 1 - dead) return r / (1 - dead);
  return 1;
}

// --- the elements ------------------------------------------------------------

export interface TouchCallbacks {
  onRestart(): void;
  /** The auto-throttle toggle was pressed. The caller persists it and calls back. */
  onAutoThrottle(on: boolean): void;
  /**
   * A pinch, or a tap on the zoom pad (which asks for exactly 1).
   *
   * The number is a REQUEST. What is legal depends on the viewport and on the
   * readability floor, both of which belong to the camera, so the caller clamps
   * it and calls `setZoom` back with what it actually did — that is what the
   * pad prints, and what the next gesture is baselined on.
   */
  onZoom(bias: number): void;
  /** The fingers came off. A good moment to persist, and the only one. */
  onZoomEnd?(): void;
  /**
   * The level chooser. It exists here because the desktop level bar is HIDDEN
   * on touch — it was being drawn straight through the in-canvas level card and
   * clock, two HUDs on top of each other — and hiding the only way to change
   * level without replacing it would be a worse bug than the one it fixes.
   */
  onBrowse(): void;
  /** Something the player should be told, in one sentence. */
  onNote?(msg: string): void;
}

export interface TouchControls {
  /** The sim bits currently held. OR-ed into the keyboard's by main.ts. */
  mask(): number;
  /**
   * TAP TO START, and it exists because auto-throttle would otherwise drive off
   * the line before the player had looked at the level.
   *
   * With the gas held for you the mask is never zero, so the opening peek —
   * which ends on "any input at all" — would end on the frame the level loaded,
   * and the bike would be moving before a thumb was anywhere near the screen.
   * So the auto bit is withheld until the first touch since the last restart.
   * `main.ts` arms it from the same global pointerdown that skips the peek, so
   * the gesture that says "I am ready" is the one that already meant that.
   *
   * It does nothing when auto-throttle is off: a held zone is its own arming.
   */
  arm(): void;
  disarm(): void;
  readonly enabled: boolean;
  readonly autoThrottle: boolean;
  setEnabled(on: boolean): void;
  setAutoThrottle(on: boolean): void;
  /**
   * Hide the pads without turning the controls off — for the results screen,
   * whose own buttons are underneath them and must be tappable.
   */
  setHidden(hidden: boolean): void;
  /** What the camera actually settled on. Prints it, and baselines the gesture. */
  setZoom(bias: number): void;
  /**
   * How much of the bottom of the screen the resting thumbs cover, in CSS px.
   * The camera derives `screenBiasY` from it — a number of pixels, because a
   * thumb is a number of millimetres and never a fraction of a canvas.
   */
  thumbInset(): number;
  /** Re-place the pads for the viewport as it is now. Rotation, URL bar, resize. */
  layout(): void;
  detach(): void;
}

/**
 * Is there a Fullscreen API worth offering?
 *
 * BROWSER CHROME IS EATING A QUARTER OF THE SCREEN on an Android phone in
 * landscape and that is reclaimable, but not by taking it: a game that grabs the
 * screen on load is hostile, and the API throws outside a user gesture anyway.
 * So it is OFFERED, on a pad, and the layout has to be right without it.
 *
 * On an iPhone there is no element fullscreen at all, so the pad is not built
 * rather than built and dead — `display: standalone` in the web manifest is the
 * route to a URL-bar-free game there, and it is the better route everywhere.
 */
export function canFullscreen(doc: Document = document): boolean {
  return doc.fullscreenEnabled === true && typeof doc.documentElement.requestFullscreen === 'function';
}

/**
 * Should the touch controls come up on their own?
 *
 * `pointer: coarse` is the honest question — "is the primary pointer a finger"
 * — where `maxTouchPoints` says only that the hardware COULD be touched, which
 * is true of every laptop with a touchscreen and of this machine's dev box. A
 * desktop that sprouted pads because a monitor happens to be a touchscreen
 * would be a worse first impression than a phone with no pads, so the coarse
 * test is the one that decides, and `?touch=1` is the override for testing it
 * from a desktop.
 */
export function wantsTouch(search: string, mm: (q: string) => boolean): boolean {
  const forced = new URLSearchParams(search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return mm('(pointer: coarse)');
}

export function createTouch(
  root: HTMLElement,
  cb: TouchCallbacks,
  opts: {
    enabled: boolean;
    autoThrottle: boolean;
    /** The starting zoom multiplier, as remembered from last time. */
    zoom?: number;
    /**
     * The element the play area actually is — the canvas. A pinch finger has to
     * have landed on it: the pads are above it and take their own pointers, and
     * everything else on the glass (the level bar, the results screen, the level
     * chooser) is a panel whose own gestures are not ours to steal.
     */
    surface?: HTMLElement;
  },
): TouchControls {
  let enabled = opts.enabled;
  let autoThrottle = opts.autoThrottle;
  let armed = false;
  let hidden = false;
  let zoomBias = opts.zoom ?? 1;
  const full = canFullscreen();
  let zones: Zone[] = [];
  /**
   * Pointer id -> the zone it is holding. A MAP AND NOT A SET OF ZONES, because
   * multi-touch is the normal case and two fingers can be in the same zone: a
   * set of zones would release the throttle when either of them lifted.
   */
  const held = new Map<number, ZoneId>();
  const els = new Map<ZoneId, HTMLElement>();
  /**
   * Pointers that landed in the PLAY AREA, in the order they arrived. Disjoint
   * from `held` by construction — see the pinch section above — which is what
   * makes it impossible for a gesture and a control to fight over a finger.
   */
  const free = new Map<number, Pointer>();
  let pinch: { a: number; b: number; spread: number; bias: number } | null = null;

  /**
   * The SAFE AREA, measured rather than assumed.
   *
   * `viewport-fit=cover` is what lets the game paint under a notch and a home
   * indicator, and the price of it is that the corners of the glass are not all
   * usable. `env(safe-area-inset-*)` is the browser's own answer and there is no
   * JS API for it, so it is read off a probe element. Zero everywhere it does
   * not apply, which is every Android phone and every desktop.
   */
  function insets(): { top: number; right: number; bottom: number; left: number } {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;'
      + 'padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);'
      + 'padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);';
    root.append(probe);
    const cs = getComputedStyle(probe);
    const n = (v: string): number => {
      const x = parseFloat(v);
      return Number.isFinite(x) ? x : 0;
    };
    const out = { top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) };
    probe.remove();
    return out;
  }

  function viewport(): Viewport {
    const r = root.getBoundingClientRect();
    return { w: r.width, h: r.height, ...insets() };
  }

  function fullState(): 'none' | 'off' | 'on' {
    return full ? (document.fullscreenElement ? 'on' : 'off') : 'none';
  }

  /**
   * RE-PLACE, NEVER REBUILD. Rotating the phone, the URL bar collapsing and a
   * keyboard sliding up all land here, and all three can happen with a thumb
   * down on the gas. Recreating the elements would drop the pointer capture on a
   * held pad and weld the throttle on with nothing to release it, so this moves
   * the elements that already exist and leaves their captures alone.
   */
  function place(): void {
    const vp = viewport();
    // A HIDDEN OVERLAY HAS NO SIZE, and this is the bug that shipped the first
    // time: `#touch` starts with `display: none`, so the very first layout ran
    // against a 0 x 0 rect, every pad collapsed to the minimum scale and the
    // thumb clusters were placed off the left of the screen. Nothing in a unit
    // test could see it — the geometry was right for the viewport it was given —
    // and the screenshot showed it immediately. So a measurement of nothing is
    // discarded rather than laid out against, and `apply` re-places the moment
    // the overlay is shown.
    if (!(vp.w > 0) || !(vp.h > 0)) return;
    zones = touchZones(vp, { autoThrottle, bias: zoomBias, fullscreen: fullState() });
    for (const z of zones) {
      const el = els.get(z.id);
      if (!el) continue;
      el.style.left = `${z.x}px`;
      el.style.top = `${z.y}px`;
      el.style.width = `${z.w}px`;
      el.style.height = `${z.h}px`;
      // The label is sized off the PAD rather than off the screen, because the
      // pad is the thing that has a size in millimetres.
      const cap = z.command ? 10 : 15;
      el.style.fontSize = `${Math.round(Math.max(7, Math.min(cap, z.w * 0.2, z.h * 0.24)))}px`;
      const span = el.firstElementChild;
      if (span && span.textContent !== z.label) span.textContent = z.label;
    }
  }

  /** Create the elements. Only when the SET of zones changes — see `place`. */
  function build(): void {
    root.textContent = '';
    els.clear();
    zones = touchZones({ w: window.innerWidth, h: window.innerHeight }, { autoThrottle, bias: zoomBias, fullscreen: fullState() });
    for (const z of zones) {
      const el = document.createElement('div');
      el.className = `tc-zone tc-${z.id}${z.command ? ' tc-cmd' : ''}`;
      const label = document.createElement('span');
      label.textContent = z.label;
      el.append(label);
      root.append(el);
      els.set(z.id, el);
    }
    place();
    paint();
  }

  /**
   * FULLSCREEN IS OFFERED AND NEVER TAKEN. It is requested only from this
   * press, which is the user gesture the API requires anyway, and every way it
   * can fail — a browser that refuses, a permissions policy, an iPad — lands in
   * the catch and says so rather than leaving a pad that did nothing.
   */
  function toggleFullscreen(): void {
    const done = (): void => place();
    try {
      const p = document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      void Promise.resolve(p).then(done, () => {
        cb.onNote?.('this browser would not go full screen — add the game to your home screen instead');
      });
    } catch {
      cb.onNote?.('this browser would not go full screen — add the game to your home screen instead');
    }
  }

  /** Light the zones that are down. The only feedback a finger gets. */
  function paint(): void {
    const on = new Set(held.values());
    for (const [id, el] of els) el.classList.toggle('on', on.has(id));
  }

  const down = (e: PointerEvent): void => {
    if (!enabled) return;
    const r = root.getBoundingClientRect();
    const id = hitZone(zones, e.clientX - r.left, e.clientY - r.top);
    if (id === null) return;
    const z = zones.find((x) => x.id === id);
    if (!z) return;
    // The browser's own gestures are the enemy here: a two-finger hold is a
    // pinch-zoom and a drag is a scroll, and either one would eat inputs. The
    // CSS says `touch-action: none`, and this is the belt to that's braces.
    e.preventDefault();
    if (z.command) {
      if (id === 'restart') cb.onRestart();
      else if (id === 'levels') cb.onBrowse();
      else if (id === 'full') toggleFullscreen();
      else if (id === 'auto') cb.onAutoThrottle(!autoThrottle);
      else if (id === 'zoom') {
        cb.onZoom(1);
        cb.onZoomEnd?.();
      }
      return;
    }
    // CAPTURE THE POINTER. Without it a finger that slides off the element it
    // started on stops sending moves to that element, and the zone latches on
    // forever with nothing to release it — which is the single worst bug a
    // touch control can have in a game that kills you for holding the gas.
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // Safari throws on a pointer that is already gone. Not fatal: the
      // pointerup/cancel handlers below clear the entry either way.
    }
    held.set(e.pointerId, id);
    armed = true;
    paint();
  };

  const move = (e: PointerEvent): void => {
    if (!enabled) return;
    const cur = held.get(e.pointerId);
    if (cur === undefined) return;
    const r = root.getBoundingClientRect();
    const next = slideZone(zones, cur, e.clientX - r.left, e.clientY - r.top);
    if (next !== cur) {
      if (next === null) held.delete(e.pointerId);
      else held.set(e.pointerId, next);
      paint();
    }
    e.preventDefault();
  };

  const up = (e: PointerEvent): void => {
    if (!held.delete(e.pointerId)) return;
    paint();
  };

  // THE PINCH, and it listens on the WINDOW rather than on `root`.
  //
  // It has to: `#touch` is `pointer-events: none` and only the pads themselves
  // take input, which is what lets a tap in the play area reach the canvas at
  // all. So a play-area pointer never reaches the overlay's own handlers, and
  // the gesture is recognised where every pointer does arrive.
  //
  // Both filters below matter. `surface` keeps a gesture off every panel on the
  // glass, and the `hitZone` test keeps it off the pads even in the one state
  // where they are inert (`tc-away`, while the results screen is up) and their
  // pointers would otherwise fall through to the canvas.
  const point = (e: PointerEvent): Pointer => {
    const r = root.getBoundingClientRect();
    return { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const startPinch = (): void => {
    if (pinch) return;
    const pair = pinchPair(playAreaPointers(zones, [...free.values()]));
    if (!pair) return;
    pinch = { a: pair[0].id, b: pair[1].id, spread: spread(pair[0], pair[1]), bias: zoomBias };
  };

  const freeDown = (e: PointerEvent): void => {
    if (!enabled || hidden) return;
    if (opts.surface && e.target !== opts.surface) return;
    const p = point(e);
    if (hitZone(zones, p.x, p.y) !== null) return;
    free.set(p.id, p);
    startPinch();
  };

  const freeMove = (e: PointerEvent): void => {
    const cur = free.get(e.pointerId);
    if (!cur) return;
    const p = point(e);
    cur.x = p.x;
    cur.y = p.y;
    if (!pinch) {
      // Two fingers that landed too close together can still become a pinch by
      // being moved apart, which is what somebody who started the gesture badly
      // does next.
      startPinch();
      return;
    }
    const a = free.get(pinch.a);
    const b = free.get(pinch.b);
    if (!a || !b) return;
    e.preventDefault();
    cb.onZoom(pinch.bias * pinchScale(pinch.spread, spread(a, b)));
  };

  const freeUp = (e: PointerEvent): void => {
    if (!free.delete(e.pointerId)) return;
    if (pinch && (e.pointerId === pinch.a || e.pointerId === pinch.b)) {
      pinch = null;
      cb.onZoomEnd?.();
    }
  };

  window.addEventListener('pointerdown', freeDown);
  window.addEventListener('pointermove', freeMove);
  window.addEventListener('pointerup', freeUp);
  window.addEventListener('pointercancel', freeUp);

  // EVERY WAY A TOUCH CAN END, and they are not interchangeable: `pointerup` is
  // a lift, `pointercancel` is the OS taking the gesture away (a notification
  // shade, a phone call, the browser deciding it was a scroll after all), and
  // `blur` is the tab going away with fingers still down. A control that only
  // listened for the first of those leaves the throttle welded on.
  root.addEventListener('pointerdown', down);
  root.addEventListener('pointermove', move);
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('lostpointercapture', up);
  const clearAll = (): void => {
    // The gesture goes with the fingers. A tab that came back with `pinch` still
    // set would take its next move as a continuation of a gesture whose other
    // finger is long gone.
    if (pinch) {
      pinch = null;
      cb.onZoomEnd?.();
    }
    free.clear();
    if (held.size === 0) return;
    held.clear();
    paint();
  };
  window.addEventListener('blur', clearAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearAll();
  });

  // THE VIEWPORT IS NOT A CONSTANT ON A PHONE. Rotation, the URL bar collapsing
  // as you scroll into the game, a software keyboard, and entering or leaving
  // fullscreen all change it, and pads sized in millimetres have to be re-placed
  // when it does. `visualViewport` is the one that fires for the URL bar; the
  // other two are for browsers that do not have it.
  const relayout = (): void => place();
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', relayout);
  window.visualViewport?.addEventListener('resize', relayout);
  document.addEventListener('fullscreenchange', relayout);

  function apply(): void {
    root.classList.toggle('hidden', !enabled);
    document.body.classList.toggle('touch', enabled);
    if (!enabled) clearAll();
    // AFTER the class, never before: the overlay has no size while it is
    // `display: none`, so this is the first moment there is a viewport to lay
    // out against.
    if (enabled) place();
  }

  build();
  apply();

  return {
    mask: () => (enabled ? zoneMask(held.values(), autoThrottle && armed) : 0),
    arm(): void {
      armed = true;
    },
    disarm(): void {
      armed = false;
    },
    get enabled() {
      return enabled;
    },
    get autoThrottle() {
      return autoThrottle;
    },
    setEnabled(on: boolean): void {
      enabled = on;
      apply();
    },
    setAutoThrottle(on: boolean): void {
      autoThrottle = on;
      // Turning it ON mid-session must not launch the bike from wherever it is
      // standing. The next touch arms it, exactly as a restart would.
      armed = false;
      // The right cluster changes shape, so anything held in it is now holding
      // a zone that no longer exists. Dropped rather than remapped: a throttle
      // that survived into auto mode as a phantom hold would be unreleasable.
      held.clear();
      build();
    },
    setHidden(on: boolean): void {
      hidden = on;
      root.classList.toggle('tc-away', on);
      if (on) clearAll();
    },
    thumbInset: () => (enabled ? thumbInsetPx(zones, root.getBoundingClientRect().height) : 0),
    layout: place,
    setZoom(bias: number): void {
      zoomBias = Number.isFinite(bias) ? bias : 1;
      // The LABEL only, not a rebuild. Rebuilding the overlay would drop the
      // pointer capture on a held pad and release the throttle, and this is
      // called on every frame of a gesture.
      const z = zones.find((x) => x.id === 'zoom');
      if (z) z.label = zoomLabel(zoomBias);
      const el = els.get('zoom');
      const span = el?.firstElementChild;
      if (span) span.textContent = zoomLabel(zoomBias);
    },
    detach(): void {
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', up);
      root.removeEventListener('lostpointercapture', up);
      window.removeEventListener('blur', clearAll);
      window.removeEventListener('pointerdown', freeDown);
      window.removeEventListener('pointermove', freeMove);
      window.removeEventListener('pointerup', freeUp);
      window.removeEventListener('pointercancel', freeUp);
      window.removeEventListener('resize', relayout);
      window.removeEventListener('orientationchange', relayout);
      window.visualViewport?.removeEventListener('resize', relayout);
      document.removeEventListener('fullscreenchange', relayout);
    },
  };
}
