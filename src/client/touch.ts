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
 * `restart` and `auto` are COMMANDS, not sim input: they fire on the press and
 * contribute no bit. They are in the same list as the rest because they occupy
 * screen space and the hit test has to know about them — a flip zone that
 * silently extended under the restart button would be a missed input, and this
 * game punishes one of those immediately.
 */
export type ZoneId = 'throttle' | 'brake' | 'leanL' | 'leanR' | 'flip' | 'restart' | 'auto';

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
export function touchZones(autoThrottle: boolean): Zone[] {
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

// --- the elements ------------------------------------------------------------

export interface TouchCallbacks {
  onRestart(): void;
  /** The auto-throttle toggle was pressed. The caller persists it and calls back. */
  onAutoThrottle(on: boolean): void;
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
  opts: { enabled: boolean; autoThrottle: boolean },
): TouchControls {
  let enabled = opts.enabled;
  let autoThrottle = opts.autoThrottle;
  let armed = false;
  let zones = touchZones(autoThrottle);
  /**
   * Pointer id -> the zone it is holding. A MAP AND NOT A SET OF ZONES, because
   * multi-touch is the normal case and two fingers can be in the same zone: a
   * set of zones would release the throttle when either of them lifted.
   */
  const held = new Map<number, ZoneId>();
  const els = new Map<ZoneId, HTMLElement>();

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
      zones = touchZones(autoThrottle);
      // The right cluster changes shape, so anything held in it is now holding
      // a zone that no longer exists. Dropped rather than remapped: a throttle
      // that survived into auto mode as a phantom hold would be unreleasable.
      held.clear();
      build();
    },
    setHidden(hidden: boolean): void {
      root.classList.toggle('tc-away', hidden);
      if (hidden) clearAll();
    },
    detach(): void {
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', up);
      root.removeEventListener('lostpointercapture', up);
      window.removeEventListener('blur', clearAll);
    },
  };
}
