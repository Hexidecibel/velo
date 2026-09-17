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
 * `restart`, `auto` and `zoom` are COMMANDS, not sim input: they fire on the
 * press and contribute no bit. They are in the same list as the rest because they occupy
 * screen space and the hit test has to know about them — a flip zone that
 * silently extended under the restart button would be a missed input, and this
 * game punishes one of those immediately.
 */
export type ZoneId = 'throttle' | 'brake' | 'leanL' | 'leanR' | 'flip' | 'restart' | 'auto' | 'zoom';

export interface Zone {
  id: ZoneId;
  /** Fractions of the viewport, 0..1, x/y from the top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** What it prints on itself. Words, not icons nobody has learned. */
  label: string;
  /** True for restart and auto: pressed, never held. */
  command: boolean;
}

/**
 * THE LAYOUT. Landscape, a thumb in each bottom corner, the play area above and
 * between them.
 *
 * RIGHT THUMB OWNS THROTTLE, and it gets the biggest, lowest, most comfortable
 * target on the screen — the bottom-right corner, full height of the cluster —
 * because it is held almost constantly and everything else is occasional. Brake
 * sits inboard of it: same row, narrower, because you reach for it in bursts.
 *
 * LEFT THUMB OWNS LEAN, split into two zones that TOUCH ALONG THEIR SHARED
 * EDGE. Sliding from one to the other without lifting has to work — direction
 * changes constantly in mid-air and lifting a thumb to change it would lose
 * runs — so the two are adjacent with no gap and a moving touch re-tests which
 * one it is in on every move.
 *
 * FLIP IS THE AWKWARD ONE and it is given a home rather than a gesture. It is
 * rare and it is critical, and both thumbs are already busy, so it goes up and
 * inboard of the right cluster where the right thumb can reach it by rolling up
 * off the throttle. It is emphatically NOT a double-tap and NOT a swipe: a
 * gesture that fails does so silently, and in a game that punishes a missed
 * input inside a tenth of a second, silence is the worst possible failure mode.
 *
 * THE ZONES TILE. Between the lean pair, and between brake and throttle, there
 * is no dead strip at all — a thumb that drifts a few millimetres during a long
 * hold must land in a zone rather than in nothing.
 */
export function zoomLabel(bias: number): string {
  return `zoom ${(Number.isFinite(bias) ? bias : 1).toFixed(1)}\u00d7`;
}

export function touchZones(autoThrottle: boolean, bias = 1): Zone[] {
  const zones: Zone[] = [
    // Commands first: they are small, they sit on top, and the hit test takes
    // the first match.
    //
    // TOP-LEFT, and that is the one corner that was actually free. Top-centre
    // was the obvious place and it is where the ART RENDERER draws the level
    // name, the clock and the apple count — a screenshot with the pads up put
    // "RESTART" straight through "20 CLOSE QUARTERS" — and top-right is the
    // level picker. Neither of those is in the DOM next to these, so nothing
    // would have caught the collision but a picture.
    { id: 'restart', x: 0.01, y: 0.02, w: 0.09, h: 0.13, label: 'restart', command: true },
    { id: 'auto', x: 0.11, y: 0.02, w: 0.09, h: 0.13, label: autoThrottle ? 'gas: auto' : 'gas: held', command: true },
    // THE ZOOM READOUT, AND THE WAY BACK FROM ONE. Pinch is a gesture and every
    // gesture can go wrong; a zoom that went wrong halfway through a run, with
    // no way back but another gesture, is worse than no pinch at all. So the
    // current multiplier is printed and tapping it returns to 1.0x.
    //
    // It is ALWAYS here rather than appearing when you are zoomed, for two
    // reasons. It is the only thing on the screen that says pinch exists at
    // all. And a pad that comes and goes means rebuilding the overlay mid-run,
    // which drops pointer capture and would release a held throttle — a silent
    // input loss traded for a tidier screen, which is the wrong trade twice.
    //
    // SECOND ROW, not beside the other two: the art renderer draws the level
    // card across the top-centre and this would have reached it on a narrow
    // phone. The row below is empty screen above the lean pads.
    { id: 'zoom', x: 0.01, y: 0.17, w: 0.13, h: 0.11, label: zoomLabel(bias), command: true },

    // Left thumb: lean, two zones sharing an edge.
    { id: 'leanL', x: 0, y: 0.50, w: 0.15, h: 0.50, label: '↺ lean', command: false },
    { id: 'leanR', x: 0.15, y: 0.50, w: 0.15, h: 0.50, label: 'lean ↻', command: false },

    // Right thumb, up and inboard: flip.
    { id: 'flip', x: 0.66, y: 0.26, w: 0.34, h: 0.24, label: 'FLIP', command: false },
  ];

  if (autoThrottle) {
    // AUTO-THROTTLE. The gas is held for you, so the right cluster collapses to
    // one big target and it is the brake — see `zoneMask` for why the brake has
    // to cut the throttle rather than fight it.
    //
    // The plan called this "three targets, right thumb free", and the brake is
    // the honest fourth: dropping it would delete hooking the front tyre, the
    // whole of 20-close-quarters' braking beat, and any level that asks you to
    // stop. The thumb is still free — this is a control you touch in bursts
    // rather than hold, which was the point.
    zones.push({ id: 'brake', x: 0.66, y: 0.50, w: 0.34, h: 0.50, label: 'brake', command: false });
  } else {
    zones.push({ id: 'brake', x: 0.66, y: 0.50, w: 0.13, h: 0.50, label: 'brake', command: false });
    zones.push({ id: 'throttle', x: 0.79, y: 0.50, w: 0.21, h: 0.50, label: 'GAS', command: false });
  }
  return zones;
}

/**
 * Which zone a point is in, or null for the play area.
 *
 * FIRST MATCH WINS and the order is the order in `touchZones`, which puts the
 * commands first. Nothing else overlaps, and that is deliberate: overlapping
 * hold zones would make "which input did I just give" depend on list order,
 * which is not something a player can see.
 */
export function hitZone(zones: readonly Zone[], px: number, py: number, w: number, h: number): ZoneId | null {
  if (w <= 0 || h <= 0) return null;
  const fx = px / w;
  const fy = py / h;
  for (const z of zones) {
    if (fx >= z.x && fx < z.x + z.w && fy >= z.y && fy < z.y + z.h) return z.id;
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
  w: number,
  h: number,
): ZoneId | null {
  const hit = hitZone(zones, px, py, w, h);
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
export function playAreaPointers(
  zones: readonly Zone[],
  pts: readonly Pointer[],
  w: number,
  h: number,
): Pointer[] {
  return pts.filter((p) => hitZone(zones, p.x, p.y, w, h) === null);
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
  detach(): void;
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
  let zones = touchZones(autoThrottle, zoomBias);
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

  function build(): void {
    root.textContent = '';
    els.clear();
    for (const z of zones) {
      const el = document.createElement('div');
      el.className = `tc-zone tc-${z.id}${z.command ? ' tc-cmd' : ''}`;
      el.style.left = `${z.x * 100}%`;
      el.style.top = `${z.y * 100}%`;
      el.style.width = `${z.w * 100}%`;
      el.style.height = `${z.h * 100}%`;
      const label = document.createElement('span');
      label.textContent = z.label;
      el.append(label);
      root.append(el);
      els.set(z.id, el);
    }
    paint();
  }

  /** Light the zones that are down. The only feedback a finger gets. */
  function paint(): void {
    const on = new Set(held.values());
    for (const [id, el] of els) el.classList.toggle('on', on.has(id));
  }

  const down = (e: PointerEvent): void => {
    if (!enabled) return;
    const r = root.getBoundingClientRect();
    const id = hitZone(zones, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    if (id === null) return;
    const z = zones.find((x) => x.id === id);
    if (!z) return;
    // The browser's own gestures are the enemy here: a two-finger hold is a
    // pinch-zoom and a drag is a scroll, and either one would eat inputs. The
    // CSS says `touch-action: none`, and this is the belt to that's braces.
    e.preventDefault();
    if (z.command) {
      if (id === 'restart') cb.onRestart();
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
    const next = slideZone(zones, cur, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
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
  const point = (e: PointerEvent): { p: Pointer; w: number; h: number } => {
    const r = root.getBoundingClientRect();
    return { p: { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top }, w: r.width, h: r.height };
  };

  const startPinch = (w: number, h: number): void => {
    if (pinch) return;
    const pair = pinchPair(playAreaPointers(zones, [...free.values()], w, h));
    if (!pair) return;
    pinch = { a: pair[0].id, b: pair[1].id, spread: spread(pair[0], pair[1]), bias: zoomBias };
  };

  const freeDown = (e: PointerEvent): void => {
    if (!enabled || hidden) return;
    if (opts.surface && e.target !== opts.surface) return;
    const { p, w, h } = point(e);
    if (hitZone(zones, p.x, p.y, w, h) !== null) return;
    free.set(p.id, p);
    startPinch(w, h);
  };

  const freeMove = (e: PointerEvent): void => {
    const cur = free.get(e.pointerId);
    if (!cur) return;
    const { p, w, h } = point(e);
    cur.x = p.x;
    cur.y = p.y;
    if (!pinch) {
      // Two fingers that landed too close together can still become a pinch by
      // being moved apart, which is what somebody who started the gesture badly
      // does next.
      startPinch(w, h);
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

  function apply(): void {
    root.classList.toggle('hidden', !enabled);
    document.body.classList.toggle('touch', enabled);
    if (!enabled) clearAll();
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
      zones = touchZones(autoThrottle, zoomBias);
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
    },
  };
}
