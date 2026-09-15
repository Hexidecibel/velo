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
}

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
  maxZoom: 110,
  zoomFromSpeed: 6,
  zoomToSpeed: 20,
  zoomOutHalfLife: 0.35,
  zoomInHalfLife: 0.9,
  safeBox: 0.42,
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

export interface Camera {
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
  update(t: CameraTarget, dtSec: number, cssW: number, cssH: number): void;
}

/** Frame-rate-independent exponential approach. `hl` is a half-life in seconds. */
function approach(cur: number, target: number, hl: number, dt: number): number {
  if (hl <= 0) return target;
  const k = 1 - Math.pow(0.5, dt / hl);
  return cur + (target - cur) * k;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createCamera(params: CameraParams): Camera {
  let leadX = 0;
  let leadY = 0;

  const cam: Camera = {
    x: 0,
    y: 0,
    zoom: params.baseZoom,
    params,
    zoomBias: 1,

    snap(t: CameraTarget): void {
      leadX = 0;
      leadY = 0;
      cam.x = t.x;
      cam.y = t.y;
      cam.zoom = clamp(cam.params.baseZoom * cam.zoomBias, cam.params.minZoom, cam.params.maxZoom);
    },

    update(t: CameraTarget, dtSec: number, cssW: number, cssH: number): void {
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
      cam.zoom = approach(cam.zoom, want, want < cam.zoom ? p.zoomOutHalfLife : p.zoomInHalfLife, dt);

      // --- follow -------------------------------------------------------
      cam.x = approach(cam.x, t.x + leadX, p.followHalfLife, dt);
      cam.y = approach(cam.y, t.y + leadY, p.followHalfLife, dt);

      // --- the guarantee ------------------------------------------------
      // Applied LAST and unconditionally. Smoothing is a lag and a lag can lose
      // the bike; this is the line that says it cannot. In the common case it
      // does nothing at all — it only bites during a direction change fast
      // enough to outrun the half-life, which is precisely when you would
      // otherwise be looking at empty cave.
      const halfW = (cssW * 0.5) / cam.zoom;
      const halfH = (cssH * 0.5) / cam.zoom;
      const boxX = halfW * p.safeBox;
      const boxY = halfH * p.safeBox;
      cam.x = clamp(cam.x, t.x - boxX, t.x + boxX);
      cam.y = clamp(cam.y, t.y - boxY, t.y + boxY);
    },
  };
  return cam;
}
