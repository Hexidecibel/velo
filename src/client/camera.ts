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
  /** Pixels per metre when standing still. */
  baseZoom: number;
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
   * Push the bike UP the frame by this fraction of the half-viewport. 0 centres
   * it, which is right on a desktop and wrong in a hand.
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
  // Zero on a desktop, where nothing is covering the screen. main.ts raises it
  // when the touch controls come up — see TOUCH_CAMERA there.
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
  /** Manual zoom bias from the +/- keys, as a multiplier on the auto zoom. */
  zoomBias: number;
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
  let fzoom = params.baseZoom;

  const cam: Camera = {
    x: 0,
    y: 0,
    zoom: params.baseZoom,
    params,
    zoomBias: 1,

    snap(t: CameraTarget): void {
      leadX = 0;
      leadY = 0;
      fx = t.x;
      fy = t.y;
      fzoom = clamp(cam.params.baseZoom * cam.zoomBias, cam.params.minZoom, cam.params.maxZoom);
      cam.x = fx;
      cam.y = fy;
      cam.zoom = fzoom;
    },

    update(t: CameraTarget, dtSec: number, cssW: number, cssH: number, ov: OverviewView | null = null): void {
      const p = cam.params;
      // A tab that was backgrounded hands back a huge dt. Clamping it here means
      // the camera eases back in rather than teleporting on the first frame.
      const dt = clamp(dtSec, 0, 0.1);

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
      const want = clamp((p.baseZoom + (p.minZoom - p.baseZoom) * k) * cam.zoomBias, p.minZoom, p.maxZoom);
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
      const bias = clamp(p.screenBiasY, 0, MAX_SCREEN_BIAS - clamp(p.safeBox, 0, MAX_SCREEN_BIAS));
      const shift = bias * halfH;
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
