// The camera.
//
// Renderer code, and therefore exempt from the sim's Math.* ban — nothing
// downstream of it is ever verified. It reads the sim and never writes to it.
//
// The design target is Elma-shaped levels, which double back constantly: right,
// loop up, back left over yourself, drop down. A camera tuned for a
// mostly-horizontal test level fights that, so this one is built around four
// rules, in priority order:
//
//   1. THE COLLISION EDGE MUST STAY READABLE. This outranks framing. A camera
//      that frames the level beautifully and leaves you unable to see exactly
//      where the ground is has failed at the only job that matters. That is why
//      `minZoom` is a hard floor and not a suggestion: below roughly 30 px/m
//      the bike is under 50 px long and you are guessing at clearances.
//   1b. THE UNIT OF FRAMING IS METRES OF WORLD, NOT PIXELS PER METRE. A fixed
//      px/m shows a 3440 px monitor more than twice the level a 844 px phone
//      gets, which is a design decision nobody made — and the phone end of it
//      is the one that hurts, because the level is what you are trying to read.
//      So `baseZoom` is an anchor measured on ONE viewport and every other
//      viewport derives from it — see `baseZoomFor`. The floor above still
//      outranks this: on a narrow screen the floor wins and you see less world.
//   2. NEVER LOSE THE BIKE. Smoothing is a lag, and a lag during a fast
//      direction change can put the bike off-screen. `safeBox` is a hard
//      constraint applied after the smoothing: the bike is never allowed
//      outside the middle of the frame, whatever the smoothing wanted.
//   3. NO SNAPPING, EVER. Every value here is continuous in the sim state.
//      Nothing reads `facing`, which is the one discrete thing a flip changes —
//      lead comes from VELOCITY, so flipping mid-air moves the camera not at
//      all, and reversing direction eases across rather than jumping.
//   4. SMOOTH, NOT FLOATY. Frame-rate-independent exponential smoothing with a
//      half-life, so a 144 Hz display and a 60 Hz display agree about how fast
//      the camera moves. `Math.pow(0.5, dt / halfLife)` is the whole mechanism.
//
// It is deliberately not a cinematic system. Everything is one exponential and
// one clamp, and all of it is on the tuning panel because anything with feel
// belongs on the panel.

export interface CameraParams {
  /** Seconds for the camera to close half the distance to where it wants to be. */
  followHalfLife: number;
  /** Seconds of velocity used as look-ahead. 0 disables leading. */
  leadTime: number;
  maxLeadX: number;
  /** Smaller than X: vertical reversals are faster and more surprising. */
  maxLeadY: number;
  /** Half-life of the lead vector itself. This is what stops a reversal lurching. */
  leadHalfLife: number;
  /**
   * Pixels per metre when standing still ON A `refWidth`-WIDE VIEWPORT. It is
   * an anchor, not the zoom: `baseZoomFor` derives the actual base zoom for
   * whatever viewport is in front of the player.
   */
  baseZoom: number;
  /** The viewport width, in CSS pixels, `baseZoom` was measured on. */
  refWidth: number;
  /**
   * The viewport HEIGHT, in CSS pixels, `baseZoom` was measured on — and the
   * whole of the second half of the derivation.
   *
   * A zoom derived from width alone answers "how much level is across the
   * screen" and says nothing about how much is UP it, which is fine while every
   * screen is roughly 16:9 and catastrophic the moment one is not. A landscape
   * phone with Chrome's toolbar and the system bars on it is 915x348 — an
   * aspect of 2.63 against the reference's 1.78 — and the width-only formula
   * gave it 47 px/m, which is 19.5 m across and SEVEN AND A HALF METRES UP. The
   * level came out as a thin band across the top of the canvas with the bottom
   * two thirds empty, which is exactly what the player photographed.
   *
   * So the height is derived the same way the width is, from the same measured
   * anchor and with the same exponent, and the LIMITING one wins. See
   * `baseZoomFor`.
   */
  refHeight: number;
  /**
   * How much a wider viewport is spent on MORE WORLD rather than on a bigger
   * picture. `zoom = baseZoom * (cssW / refWidth) ** widthExp`, so:
   *
   *   0  — fixed px/m. Every screen draws the bike the same size and a phone
   *        sees half the level a desktop does. This is what was here before.
   *   1  — fixed world width. Every screen sees exactly `refWidth / baseZoom`
   *        metres across, and the bike shrinks to nothing on a small screen.
   *
   * Neither extreme is right and the answer is not taste: 0 is what a phone
   * player complained about, and 1 asks a 844 px screen for 33 px/m, which is
   * below the readability floor — the floor would simply overrule it. 0.5 is
   * the geometric mean of the two defensible targets (same LEVEL visible as the
   * desktop reference, and same APPARENT scale as it — a phone subtends about
   * 55% of the visual angle a monitor does), and it lands within 2% of that
   * compromise across the range of screens anybody plays this on.
   */
  widthExp: number;
  /** HARD floor. Below this the collision edge stops being readable. */
  minZoom: number;
  maxZoom: number;
  /** Speed (m/s) at which zoom-out starts, and the speed it is complete by. */
  zoomFromSpeed: number;
  zoomToSpeed: number;
  /** Zooming OUT is urgent (something is about to arrive); zooming in is not. */
  zoomOutHalfLife: number;
  zoomInHalfLife: number;
  /**
   * Fraction of the half-viewport the bike may never leave. 0.4 keeps it inside
   * the middle 80% of the frame; 1.0 disables the guarantee.
   */
  safeBox: number;
  /**
   * How much of the TOP of the viewport the in-canvas HUD covers, in CSS px.
   *
   * The level card, the clock and the apple counter are drawn at a fixed pixel
   * size by artrender.ts — 12 px down, 34 px tall, plus the hard drop shadow —
   * so this is a constant rather than a fraction. It is here because it is half
   * of the sum that decides `screenBiasY`: the bike wants to sit in the middle
   * of the band that nothing is covering, and the HUD is the top edge of it.
   */
  hudInsetPx: number;
  /**
   * How much of the BOTTOM of the viewport the thumb pads cover, in CSS px. 0
   * on a desktop; `main.ts` sets it from the touch overlay's own measured
   * layout, which sizes itself in millimetres and therefore knows a number the
   * camera cannot derive.
   */
  thumbInsetPx: number;
  /**
   * The MOST the bike may be pushed up the frame, as a fraction of the
   * half-viewport. 0 centres it, which is right on a desktop and wrong in a
   * hand.
   *
   * A CAP AND NOT THE VALUE, since the short-viewport bug. The value is derived
   * per frame by `screenBiasFor` from the two insets above and from how much
   * room is actually left — 0.17 was picked on an idealised phone and, on a 348
   * px-tall one, was pushing the bike up UNDER THE HUD CARDS it was supposed to
   * be keeping clear of. A constant fraction cannot be right on two viewports
   * that differ by a factor of three in height.
   *
   * IT EXISTS FOR THUMBS. In landscape on a phone, hands cover the bottom
   * corners of the screen — which is exactly where a grounded bike sits when
   * the camera centres it, so the one thing the readability rule says must
   * always be legible is under a thumb. Biasing the view down moves the bike up
   * into the clear part of the frame, and the ground it is about to hit comes
   * with it.
   *
   * It is a PRESENTATION offset and nothing else: it moves the published view,
   * never the follow, so the safe-box guarantee below still holds against the
   * play framing and the sim never learns it happened. The effective bound on
   * the bike's screen position becomes `safeBox + screenBiasY`, which is why
   * this is clamped so the two together can never put it off the edge.
   */
  screenBiasY: number;
}

/**
 * The most the bike may be pushed off centre, as a fraction of the half-frame.
 *
 * `safeBox + screenBiasY` is how far from the middle the bike can end up, and
 * at 1 it is at the very edge of the frame. 0.85 leaves the last 15% for the
 * bike's own size plus the ground under it.
 */
export const MAX_SCREEN_BIAS = 0.85;

export const DEFAULT_CAMERA: CameraParams = {
  followHalfLife: 0.09,
  leadTime: 0.32,
  maxLeadX: 3.6,
  maxLeadY: 2.2,
  leadHalfLife: 0.22,
  baseZoom: 62,
  // MEASURED, NOT CHOSEN. 62 px/m on a 1600 px window is the framing all twenty
  // levels were authored and played at, and it is the one framing a human has
  // called good — 25.8 m of world across the screen. Everything else in the
  // game now derives from that pair, so a phone and an ultrawide are asking the
  // same question ("how much level is that?") rather than two different ones.
  refWidth: 1600,
  // The other half of the same measured pair. 1600x900 is the window, so 900 is
  // the height, and 900 / 62 = 14.5 m of world up the screen — which is the
  // number the twenty levels' vertical beats (the chimney, the cathedral, the
  // low roof) were all authored against.
  refHeight: 900,
  widthExp: 0.5,
  // 38 px/m puts the 1.7 m bike at ~65 px and the 0.25 m wheel at ~10 px, which
  // is the point where a wheel-sized gap in the floor is still unmistakable.
  minZoom: 38,
  // Raised from 110 on request — the user wants room to get close, and manual
  // zoom with +/- is a feature rather than a debug affordance.
  //
  // Cheap in both directions. Higher zoom means LESS world on screen, so fewer
  // edges and fewer art chunks to draw: the Phase 1 bench measured the art at
  // 110 px/m costing less than at 62, not more. And the bike's detail tiers have
  // headroom — at 150 px/m a wheel is 37.5 px against a fine-detail threshold of
  // about 12, so nothing changes tier.
  //
  // `minZoom` is the one that must not move: it is the readability floor that
  // keeps the collision edge legible while driving, and the bike's LOD dead
  // bands are derived from it.
  maxZoom: 150,
  zoomFromSpeed: 6,
  zoomToSpeed: 20,
  zoomOutHalfLife: 0.35,
  zoomInHalfLife: 0.9,
  safeBox: 0.42,
  // The art HUD band: `drawHud` puts its panels at y=12, 34 px tall, with a 4 px
  // ink shadow under them. 52 is the first row of pixels the game is allowed to
  // put the bike in.
  hudInsetPx: 52,
  // Raised by main.ts from the touch overlay's own layout when there are pads on
  // the glass, and left at zero otherwise.
  thumbInsetPx: 0,
  // Zero on a desktop, where nothing is covering the screen. main.ts raises the
  // CAP when the touch controls come up — see TOUCH_CAMERA there — and
  // `screenBiasFor` derives the value under it.
  screenBiasY: 0,
};

export function cloneCamera(p: CameraParams): CameraParams {
  return { ...p };
}

export interface CameraTarget {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * A wide framing to blend toward, plus how far to blend. Supplied by
 * overview.ts, which owns the state machine and the easing; the camera's only
 * job is to publish a view that is `blend` of the way there.
 *
 * This is the one thing that may take the camera below `minZoom`, and it is
 * allowed to because the sim is frozen whenever `blend` is being driven toward
 * 1 — the readability floor exists for somebody who is driving.
 */
export interface OverviewView {
  x: number;
  y: number;
  /** Pixels per metre. */
  zoom: number;
  /** 0 = play framing, 1 = fully the wide view. */
  blend: number;
}

export interface Camera {
  /**
   * The PUBLISHED view — what the renderer reads. Equal to the play framing
   * whenever no overview is blended in, which is the overwhelmingly common
   * case; the play framing itself is kept separately and keeps smoothing
   * underneath, so releasing the overview returns to where following had got
   * to rather than to a stale position.
   */
  x: number;
  y: number;
  /** Pixels per metre. */
  zoom: number;
  params: CameraParams;
  /** Manual zoom bias from the +/- keys and the pinch, as a multiplier. */
  zoomBias: number;
  /**
   * Set the manual bias, clamped against the zoom range on the CURRENT
   * viewport. Returns what was actually applied, which is what the caller
   * should persist and print — the request and the result differ at the ends.
   */
  setZoomBias(v: number): number;
  /**
   * Tell the camera how big the viewport is without driving a frame.
   *
   * `update` does this every frame, so this exists for the one case that is not
   * a frame: `snap` at boot, before anything has been drawn. Without it the
   * first frame on a phone would start at the desktop's zoom and visibly ease
   * out, which looks like a bug on the one screen the derivation exists for.
   */
  setViewport(cssW: number, cssH?: number): void;
  /** Place the camera on the target immediately. Restart, level change, load. */
  snap(t: CameraTarget): void;
  /** One rendered frame. `dt` in seconds; never the sim's dt. */
  update(t: CameraTarget, dtSec: number, cssW: number, cssH: number, ov?: OverviewView | null): void;
}

/**
 * Frame-rate-independent exponential approach. `hl` is a half-life in seconds.
 * Exported because overview.ts eases its blend with exactly this curve, and two
 * different easings in one camera is how a system starts feeling inconsistent.
 */
export function approach(cur: number, target: number, hl: number, dt: number): number {
  if (hl <= 0) return target;
  const k = 1 - Math.pow(0.5, dt / hl);
  return cur + (target - cur) * k;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The most and least the manual zoom may be asked for, before the readability
 * floor and the ceiling get their say. They are a sanity rail on the gesture
 * and the keys, not the real limit — `clampZoomBias` is.
 */
export const BIAS_MIN = 0.35;
export const BIAS_MAX = 3;

/**
 * THE BASE ZOOM FOR A PARTICULAR SCREEN, and the whole of fix 1.
 *
 * A camera parameterised in pixels-per-metre answers "how big is the bike",
 * which is not the question anybody asks while playing. The question is "how
 * much of the level can I see", and the answer used to depend entirely on how
 * wide the window happened to be: at a fixed 62 px/m a 1600 px desktop saw
 * 25.8 m, a 3440 px ultrawide saw 55.5 m and a landscape phone saw 13.6 m of
 * the same level. Two of those three nobody chose.
 *
 * So the anchor is a MEASURED pair — `baseZoom` px/m on a `refWidth` x
 * `refHeight` window — and every other viewport is derived from it by
 * `widthExp`. Clamped to the same floor and ceiling as everything else, because
 * the floor outranks framing: on a viewport too small to demand `minZoom`, the
 * floor wins and the player sees less world rather than a mushier edge.
 *
 * BOTH DIMENSIONS, AND THE LIMITING ONE WINS — which is fix 1b, and the bug
 * that shipped without it.
 *
 * Deriving from width alone is only correct while every screen has the
 * reference's aspect. A landscape phone with Chrome's URL bar and the Android
 * navigation bar on it does not: 915 x 348 is an aspect of 2.63 against 1.78,
 * and the width-only formula answered 47 px/m — a comfortable 19.5 m across and
 * 7.4 m up, which is four bike-lengths of vertical world and put the whole level
 * in a band across the top of the canvas.
 *
 * So each axis derives its own zoom from its own reference extent with the same
 * exponent, and the answer is the SMALLER of the two. That is not an average and
 * not a compromise: it is the statement that NEITHER AXIS EVER SHOWS LESS WORLD
 * THAN ITS OWN DERIVATION ASKED FOR. On the reference window the two agree
 * exactly, so the desktop framing every level was authored at does not move, and
 * neither does any window that is a reference-aspect resize of it. On a shape
 * the reference never anticipated, the axis that is starved is the one that sets
 * the zoom.
 *
 *   915 x 348 landscape phone   47.0 -> 38.6 px/m   19.5 x 7.4 m -> 23.7 x 9.0 m
 *   3440 x 1440 ultrawide       90.9 -> 78.4 px/m   37.8 x 15.8 m -> 43.9 x 18.4 m
 *
 * The ultrawide moving is the same rule doing the same job in the other
 * direction, and in the direction of more world, which is the one that cannot
 * hurt.
 */
export function baseZoomFor(p: CameraParams, cssW: number, cssH?: number): number {
  const refW = p.refWidth > 0 ? p.refWidth : 1600;
  const refH = p.refHeight > 0 ? p.refHeight : 900;
  const w = cssW > 0 ? cssW : refW;
  // A height that was not supplied is assumed to be the REFERENCE ASPECT, which
  // makes `baseZoomFor(p, w)` mean exactly what it meant before this fix: the
  // width-only answer. Every caller that has a height passes it.
  const h = cssH !== undefined && cssH > 0 ? cssH : (w * refH) / refW;
  const e = clamp(p.widthExp, 0, 1);
  const byW = p.baseZoom * Math.pow(w / refW, e);
  const byH = p.baseZoom * Math.pow(h / refH, e);
  return clamp(Math.min(byW, byH), p.minZoom, p.maxZoom);
}

/**
 * Where the speed-driven zoom-out is heading on this screen.
 *
 * `minZoom` used to be both the readability floor AND the thing speed zoomed
 * out to, which was the same number only because there was one base zoom. Once
 * the base is derived, a fixed target is wrong in both directions: an ultrawide
 * would zoom out 2.4x at speed (90 px/m down to 38, showing 90 m of level) and
 * a phone would have almost nothing left to give. So the zoom-out is a RATIO —
 * the one the reference framing already implies, `minZoom / baseZoom` — and the
 * floor is applied afterwards, as a floor.
 *
 * At the reference viewport this is exactly `minZoom`, so nothing about the
 * desktop feel moves.
 */
export function wideZoomFor(p: CameraParams, cssW: number, cssH?: number): number {
  const ratio = p.baseZoom > 0 ? p.minZoom / p.baseZoom : 1;
  return clamp(baseZoomFor(p, cssW, cssH) * ratio, p.minZoom, p.maxZoom);
}

/**
 * The manual zoom bias, clamped so it cannot ask for a zoom that does not
 * exist.
 *
 * The keys used to clamp the BIAS to 0.35..3 and let the camera clamp the zoom
 * afterwards, which meant the bias could wind up to 3 while the zoom sat pinned
 * at `maxZoom` — and then several presses of `-` did nothing at all before the
 * picture moved. A pinch makes that far worse, because a gesture that keeps
 * spreading would bank travel it then has to give back before anything happens.
 * Clamping against the actual zoom range is what makes the gesture feel
 * attached to the screen.
 */
export function clampZoomBias(p: CameraParams, cssW: number, cssH: number | undefined, bias: number): number {
  const base = baseZoomFor(p, cssW, cssH);
  if (!(base > 0) || !Number.isFinite(bias)) return 1;
  const lo = Math.max(BIAS_MIN, p.minZoom / base);
  const hi = Math.min(BIAS_MAX, p.maxZoom / base);
  return clamp(bias, Math.min(lo, hi), hi);
}

/**
 * HOW FAR UP THE FRAME THE BIKE SITS, on this particular viewport.
 *
 * `screenBiasY` used to BE this number: a constant 0.17 of the half-frame,
 * chosen on a phone that was assumed to be 844 x 390. On the 348 px-tall
 * viewport a real Android phone actually hands you — Chrome's toolbar and the
 * system bars take about a quarter of the screen — the same fraction is a
 * smaller distance in pixels but a much larger one relative to the 52 px of HUD
 * at the top, and it was pushing a grounded bike up UNDER the level card. A
 * comfort offset that hides the bike behind the HUD has inverted its own
 * purpose.
 *
 * So it is derived, from the two things that are actually covering the screen:
 *
 *   THE WANT. The clear band runs from the bottom of the HUD to the top of the
 *   thumb pads, and the bike wants to be in the middle of THAT rather than in
 *   the middle of the glass. That is a shift of half the difference between the
 *   two insets — and it is a number of PIXELS, which is why it comes out small
 *   on a tall screen and large on a short one without anybody choosing either.
 *
 *   THE ROOM. `safeBox` already allows the follow to put the bike that fraction
 *   of the half-frame away from centre, so the worst case is `safeBox + bias`
 *   and it must still land below the HUD. On a short viewport that is the
 *   binding constraint and the want does not get paid in full — which is the
 *   whole of fix 3, stated as arithmetic instead of as a constant.
 *
 *   THE CAP. `screenBiasY` survives as the most this is ever allowed to ask
 *   for, which is what keeps the desktop at exactly zero (nothing is covering a
 *   desktop, so `thumbInsetPx` is 0 and the want is negative anyway) and what
 *   leaves a slider on the tuning panel that means something.
 */
export function screenBiasFor(p: CameraParams, cssH: number): number {
  const half = cssH * 0.5;
  if (!(half > 0)) return 0;
  const box = clamp(p.safeBox, 0, MAX_SCREEN_BIAS);
  const hud = Math.max(p.hudInsetPx, 0);
  const want = (Math.max(p.thumbInsetPx, 0) - hud) * 0.5 / half;
  // The bike's worst case is (box + bias) of the half-frame above centre. Keep
  // that out of the HUD band; on a viewport with no room at all this goes
  // negative and the clamp below returns 0, which is the honest answer.
  const room = (half - hud) / half - box;
  return clamp(Math.min(want, p.screenBiasY, room), 0, MAX_SCREEN_BIAS - box);
}

export function createCamera(params: CameraParams): Camera {
  let leadX = 0;
  let leadY = 0;
  // The PLAY framing, kept apart from the published view. Everything below
  // smooths these; `cam.x/y/zoom` are then these blended toward the overview.
  // Keeping them separate is what lets the overview be a pure view effect: the
  // follow never learns that it happened, so releasing TAB does not have to
  // recover from anything.
  let fx = 0;
  let fy = 0;
  // The viewport the zoom is derived against. Defaults to the reference width,
  // so a camera that is snapped before it has ever been drawn is framed exactly
  // as the reference desktop until the first frame says otherwise.
  let viewW = params.refWidth;
  let viewH = params.refHeight;
  let fzoom = baseZoomFor(params, viewW, viewH);

  const cam: Camera = {
    x: 0,
    y: 0,
    zoom: fzoom,
    params,
    zoomBias: 1,

    setZoomBias(v: number): number {
      cam.zoomBias = clampZoomBias(cam.params, viewW, viewH, v);
      return cam.zoomBias;
    },

    setViewport(cssW: number, cssH?: number): void {
      if (cssW > 0) viewW = cssW;
      if (cssH !== undefined && cssH > 0) viewH = cssH;
    },

    snap(t: CameraTarget): void {
      leadX = 0;
      leadY = 0;
      fx = t.x;
      fy = t.y;
      fzoom = clamp(baseZoomFor(cam.params, viewW, viewH) * cam.zoomBias, cam.params.minZoom, cam.params.maxZoom);
      cam.x = fx;
      cam.y = fy;
      cam.zoom = fzoom;
    },

    update(t: CameraTarget, dtSec: number, cssW: number, cssH: number, ov: OverviewView | null = null): void {
      const p = cam.params;
      // A tab that was backgrounded hands back a huge dt. Clamping it here means
      // the camera eases back in rather than teleporting on the first frame.
      const dt = clamp(dtSec, 0, 0.1);
      // RESIZE AND ROTATION ARE HANDLED BY BEING READ, not by a listener. The
      // viewport is an input to the zoom on every single frame, so a window
      // drag, a rotated phone, a keyboard sliding up and an address bar
      // collapsing all arrive the same way and all ease rather than jump —
      // `approach` below is already the right behaviour for a framing that
      // changed underneath the player.
      if (cssW > 0) viewW = cssW;
      if (cssH > 0) viewH = cssH;

      // --- lead ---------------------------------------------------------
      // From velocity, never from `facing`: facing is the one discrete thing a
      // flip changes, and a camera that reads it jumps a full lead-width the
      // instant you press space in mid-air.
      const wantX = clamp(t.vx * p.leadTime, -p.maxLeadX, p.maxLeadX);
      const wantY = clamp(t.vy * p.leadTime, -p.maxLeadY, p.maxLeadY);
      leadX = approach(leadX, wantX, p.leadHalfLife, dt);
      leadY = approach(leadY, wantY, p.leadHalfLife, dt);

      // --- zoom ---------------------------------------------------------
      // Speed is the only input. Zooming out on the vertical extent of the
      // level, which is the obvious alternative, is exactly the thing that
      // breaks rule 1 in a tall cave.
      const speed = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
      const span = Math.max(p.zoomToSpeed - p.zoomFromSpeed, 1e-6);
      const k = clamp((speed - p.zoomFromSpeed) / span, 0, 1);
      // Both ends of the speed ramp are derived from the viewport, so the
      // amount of LEVEL the zoom-out buys is the same everywhere rather than
      // depending on the width of somebody's monitor.
      const base = baseZoomFor(p, viewW, viewH);
      const wide = wideZoomFor(p, viewW, viewH);
      const want = clamp((base + (wide - base) * k) * cam.zoomBias, p.minZoom, p.maxZoom);
      fzoom = approach(fzoom, want, want < fzoom ? p.zoomOutHalfLife : p.zoomInHalfLife, dt);

      // --- follow -------------------------------------------------------
      fx = approach(fx, t.x + leadX, p.followHalfLife, dt);
      fy = approach(fy, t.y + leadY, p.followHalfLife, dt);

      // --- the guarantee ------------------------------------------------
      // Applied LAST and unconditionally. Smoothing is a lag and a lag can lose
      // the bike; this is the line that says it cannot. In the common case it
      // does nothing at all — it only bites during a direction change fast
      // enough to outrun the half-life, which is precisely when you would
      // otherwise be looking at empty cave.
      //
      // It clamps the PLAY framing, which is the framing it is a guarantee
      // about. The overview blend below may legitimately put the bike anywhere
      // in the frame, including a corner of a 176 m level — that is the whole
      // point of it, and the sim is frozen while it is happening.
      const halfW = (cssW * 0.5) / fzoom;
      const halfH = (cssH * 0.5) / fzoom;
      const boxX = halfW * p.safeBox;
      const boxY = halfH * p.safeBox;
      fx = clamp(fx, t.x - boxX, t.x + boxX);
      fy = clamp(fy, t.y - boxY, t.y + boxY);

      // --- publish ------------------------------------------------------
      // The thumb bias, applied to the PUBLISHED view only. World y is up and
      // the renderer flips, so dropping the camera's centre raises the bike on
      // screen. Clamped against the safe box so the two together can never put
      // the bike off the edge — the guarantee above outranks the comfort.
      const shift = screenBiasFor(p, cssH) * halfH;
      const b = ov ? clamp(ov.blend, 0, 1) : 0;
      if (b <= 0) {
        cam.x = fx;
        cam.y = fy - shift;
        cam.zoom = fzoom;
        return;
      }
      const o = ov as OverviewView;
      cam.x = fx + (o.x - fx) * b;
      // The bias fades out with the overview: the whole level on screen has no
      // bottom corner the bike is hiding in, and an off-centre framing there is
      // just a crooked picture.
      cam.y = (fy - shift * (1 - b)) + (o.y - (fy - shift * (1 - b))) * b;
      // GEOMETRIC, not linear. Zoom is a scale factor, and a linear blend from
      // 62 px/m to 6 px/m spends most of its travel in the high numbers and
      // then plummets — it reads as a lurch at the far end. Blending the
      // logarithm makes the apparent rate of zoom constant, which is what
      // "smooth" means for a scale.
      cam.zoom = fzoom * Math.pow(Math.max(o.zoom, 1e-3) / fzoom, b);
    },
  };
  return cam;
}
