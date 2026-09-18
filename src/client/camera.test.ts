// The camera's two load-bearing claims, which are the ones a person cannot
// check by looking at it: that it is frame-rate independent, and that the
// bike can never leave the frame however hard the smoothing lags.
//
// Everything else about a camera is feel and belongs on the panel. These two
// are correctness, and both are silently broken by the obvious implementation
// (a fixed per-frame lerp with no clamp).
import { describe, it, expect } from 'vitest';
import {
  BIAS_MAX, BIAS_MIN, DEFAULT_CAMERA, MAX_SCREEN_BIAS, baseZoomFor, clampZoomBias, cloneCamera,
  createCamera, screenBiasFor, wideZoomFor,
} from './camera.ts';
import type { CameraParams } from './camera.ts';

const VIEW = { w: 1200, h: 800 };

function run(steps: number, dt: number, target: { x: number; y: number; vx: number; vy: number }) {
  const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
  cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
  for (let i = 0; i < steps; i++) cam.update(target, dt, VIEW.w, VIEW.h);
  return cam;
}

describe('camera', () => {
  it('lands in the same place at 60 Hz and at 144 Hz', () => {
    // A fixed per-frame lerp does NOT: it moves 2.4x faster on the faster
    // display, so the game feels different depending on the monitor. The
    // half-life formulation is the fix and this is what checks it.
    const t = { x: 10, y: 4, vx: 0, vy: 0 };
    const a = run(60, 1 / 60, t);
    const b = run(144, 1 / 144, t);
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.02);
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.02);
    expect(Math.abs(a.zoom - b.zoom)).toBeLessThan(0.5);
  });

  it('never lets the bike outside the safe box, however fast it reverses', () => {
    // The adversarial case: teleport the target every frame, which is worse
    // than anything a bike can do, and check the guarantee holds on every one.
    const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    const box = cam.params.safeBox;
    for (let i = 0; i < 400; i++) {
      const t = { x: Math.sin(i) * 40, y: Math.cos(i * 0.7) * 25, vx: Math.cos(i) * 30, vy: -Math.sin(i) * 20 };
      cam.update(t, 1 / 60, VIEW.w, VIEW.h);
      const halfW = VIEW.w / 2 / cam.zoom;
      const halfH = VIEW.h / 2 / cam.zoom;
      expect(Math.abs(t.x - cam.x)).toBeLessThanOrEqual(halfW * box + 1e-9);
      expect(Math.abs(t.y - cam.y)).toBeLessThanOrEqual(halfH * box + 1e-9);
    }
  });

  it('never zooms out past the readability floor', () => {
    // The rule that outranks framing. At any speed, including absurd ones.
    const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    for (let i = 0; i < 600; i++) {
      cam.update({ x: i, y: 0, vx: 60, vy: 40 }, 1 / 60, VIEW.w, VIEW.h);
      expect(cam.zoom).toBeGreaterThanOrEqual(cam.params.minZoom - 1e-9);
      expect(cam.zoom).toBeLessThanOrEqual(cam.params.maxZoom + 1e-9);
    }
  });

  it('leads in the direction of travel, and eases across a reversal', () => {
    const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    for (let i = 0; i < 120; i++) cam.update({ x: 0, y: 0, vx: 12, vy: 0 }, 1 / 60, VIEW.w, VIEW.h);
    expect(cam.x).toBeGreaterThan(1);

    // Reverse. One frame later the camera must have moved only a little — a
    // lead that reads `facing` instead of velocity jumps the full lead width
    // here, which is exactly what a flip must not do.
    const before = cam.x;
    cam.update({ x: 0, y: 0, vx: -12, vy: 0 }, 1 / 60, VIEW.w, VIEW.h);
    expect(Math.abs(cam.x - before)).toBeLessThan(0.3);

    for (let i = 0; i < 120; i++) cam.update({ x: 0, y: 0, vx: -12, vy: 0 }, 1 / 60, VIEW.w, VIEW.h);
    expect(cam.x).toBeLessThan(-1);
  });

  it('blends to the overview framing, and only the overview may break the zoom floor', () => {
    // The floor is the rule that outranks framing WHILE DRIVING. Overview is
    // the one thing allowed past it, and only because the sim is frozen.
    const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    const t = { x: 0, y: 0, vx: 0, vy: 0 };
    const frame = { x: 88, y: -40, zoom: 9 };

    cam.update(t, 1 / 60, VIEW.w, VIEW.h, { ...frame, blend: 1 });
    expect(cam.x).toBeCloseTo(frame.x, 6);
    expect(cam.y).toBeCloseTo(frame.y, 6);
    expect(cam.zoom).toBeCloseTo(frame.zoom, 6);
    expect(cam.zoom).toBeLessThan(cam.params.minZoom);

    // Half-way is half-way in POSITION and the geometric mean in ZOOM: a
    // linear zoom blend spends most of its travel in the high numbers and then
    // lurches, which is the thing "smooth both ways" is asking to avoid. The
    // play framing to compare against comes from an identically driven camera
    // that was never handed an overview.
    const a = createCamera(cloneCamera(DEFAULT_CAMERA));
    const b = createCamera(cloneCamera(DEFAULT_CAMERA));
    a.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    b.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    for (let i = 0; i < 30; i++) {
      a.update(t, 1 / 60, VIEW.w, VIEW.h, { ...frame, blend: 0.5 });
      b.update(t, 1 / 60, VIEW.w, VIEW.h);
    }
    expect(a.zoom).toBeCloseTo(Math.sqrt(b.zoom * frame.zoom), 6);
    expect(a.x).toBeCloseTo(b.x + (frame.x - b.x) * 0.5, 6);
    expect(a.y).toBeCloseTo(b.y + (frame.y - b.y) * 0.5, 6);
  });

  it('does not let the overview disturb the play framing underneath it', () => {
    // The follow keeps smoothing while the wide view is up, so releasing the
    // key returns to where following had got to — not to a stale position and
    // not with a lurch. Equivalently: a frame spent in overview must leave the
    // published view identical to one that never entered it.
    const held = createCamera(cloneCamera(DEFAULT_CAMERA));
    const plain = createCamera(cloneCamera(DEFAULT_CAMERA));
    held.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    plain.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    const t = { x: 25, y: 9, vx: 4, vy: 1 };
    const frame = { x: -300, y: 400, zoom: 6 };
    for (let i = 0; i < 90; i++) {
      held.update(t, 1 / 60, VIEW.w, VIEW.h, { ...frame, blend: 1 });
      plain.update(t, 1 / 60, VIEW.w, VIEW.h);
    }
    // Now let go: blend 0 on the very next frame.
    held.update(t, 1 / 60, VIEW.w, VIEW.h, { ...frame, blend: 0 });
    plain.update(t, 1 / 60, VIEW.w, VIEW.h);
    expect(held.x).toBeCloseTo(plain.x, 9);
    expect(held.y).toBeCloseTo(plain.y, 9);
    expect(held.zoom).toBeCloseTo(plain.zoom, 9);
  });

  it('snaps without leaving a stale lead behind', () => {
    const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    for (let i = 0; i < 120; i++) cam.update({ x: 0, y: 0, vx: 12, vy: 0 }, 1 / 60, VIEW.w, VIEW.h);
    cam.snap({ x: 99, y: -5, vx: 0, vy: 0 });
    expect(cam.x).toBe(99);
    expect(cam.y).toBe(-5);
    // And the next frame does not lurch back toward the old lead.
    cam.update({ x: 99, y: -5, vx: 0, vy: 0 }, 1 / 60, VIEW.w, VIEW.h);
    expect(Math.abs(cam.x - 99)).toBeLessThan(0.01);
  });
});

describe('the thumb bias', () => {
  // Landscape on a phone puts hands over the BOTTOM CORNERS, which is exactly
  // where a centred camera puts a grounded bike — so the one thing the
  // readability rule says must always be legible ends up under a thumb.
  //
  // THE FIRST BUG THIS REPLACES: it was a flat 0.17 of the half-frame, chosen
  // against an idealised 844 x 390 viewport. A real Android phone in Chrome is
  // about 915 x 348, and on a frame that short the same fraction was pushing the
  // bike up UNDER the 52 px of in-canvas HUD — the exact thing the offset exists
  // to keep it out from under.
  //
  // THE SECOND: the derivation that replaced it aimed at the MIDDLE of the band
  // nothing was covering, which was right while a row of command buttons owned
  // the top and the pads sat halfway up the glass, and too high once the pads
  // moved to the bottom edge and the clear band became most of the screen. What
  // is below you in this game is mostly floor. The bike rests as low as the safe
  // box allows without ever being under a thumb, and no higher.
  /** The one a person actually played on, and where every number below is measured. */
  const PHONE = { w: 915, h: 348 };
  /** What the real pads measure on a landscape phone: 15 mm of pad plus the 3.5 mm edge. */
  const PADS = 111;
  /**
   * The zoom the phone viewport actually derives, read off a real camera rather
   * than written down — the rail is measured in PIXELS and the bike's size in
   * pixels is the zoom, so a hardcoded 38 here would quietly stop matching the
   * game the day the derivation moves.
   */
  const zoomAt = (w: number, h: number): number => {
    const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    for (let i = 0; i < 120; i++) cam.update({ x: 0, y: 0, vx: 0, vy: 0 }, 1 / 60, w, h);
    return cam.zoom;
  };
  const PHONE_ZOOM = zoomAt(PHONE.w, PHONE.h);
  /** A phone-shaped set of params: a thumb cluster at the bottom, a cap on top. */
  const handsOn = (thumbInsetPx: number, cap = 0.3): CameraParams =>
    ({ ...cloneCamera(DEFAULT_CAMERA), thumbInsetPx, screenBiasY: cap });
  const withBias = (bias: number, w = PHONE.w, h = PHONE.h, inset = PADS) => {
    const cam = createCamera(handsOn(inset, bias));
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    const t = { x: 0, y: 0, vx: 0, vy: 0 };
    for (let i = 0; i < 120; i++) cam.update(t, 1 / 60, w, h);
    return cam;
  };
  /**
   * Where the bike lands on the glass, in CSS px from the top — which is the
   * only unit any of this is actually about. World y is up and the renderer
   * flips, hence the sign.
   */
  const bikeAt = (cam: { y: number; zoom: number }, h: number, bikeY = 0): number =>
    h / 2 - (bikeY - cam.y) * cam.zoom;

  it('is off by default — a desktop has nothing covering the screen', () => {
    expect(DEFAULT_CAMERA.screenBiasY).toBe(0);
    expect(DEFAULT_CAMERA.thumbInsetPx).toBe(0);
    expect(screenBiasFor(DEFAULT_CAMERA, 900, zoomAt(1600, 900))).toBe(0);
    expect(withBias(0, VIEW.w, VIEW.h, 0).y).toBeCloseTo(0, 6);
    // And it stays off even if the cap is raised, because nothing is covering a
    // desktop: the WANT is what is zero, not just the ceiling.
    expect(screenBiasFor({ ...DEFAULT_CAMERA, screenBiasY: 0.3 }, 900, zoomAt(1600, 900))).toBe(0);
    // EVERY desktop window, not just the reference one. This function is the
    // whole of what moved in the last two framing passes, and "the desktop did
    // not move" has to be a property rather than one measurement.
    for (const [w, h] of [[1280, 713], [1600, 900], [2560, 1440], [1366, 640], [3440, 1440]]) {
      expect(screenBiasFor(DEFAULT_CAMERA, h, zoomAt(w, h)), `${w}x${h}`).toBe(0);
    }
  });

  it('puts the bike HIGHER in the frame, which means the camera goes lower', () => {
    // World y is up and the renderer flips, so dropping the camera's centre is
    // what raises the bike on screen. Getting this sign backwards would bury
    // the bike under the thumbs it is supposed to escape, and it would look
    // deliberate.
    // On a 240 px viewport, where the rail still asks for something. The phone
    // the complaint came from is 348 px and now asks for nothing at all, so the
    // SIGN has to be asserted somewhere the bias is not zero — a sign test that
    // passes because both sides are zero is not a sign test.
    const SHORT = { w: 736, h: 240 };
    const cam = withBias(0.3, SHORT.w, SHORT.h);
    expect(cam.y).toBeLessThan(0);
    const halfH = SHORT.h * 0.5 / cam.zoom;
    expect(-cam.y).toBeCloseTo(screenBiasFor(handsOn(PADS), SHORT.h, cam.zoom) * halfH, 6);
  });

  it('RESTS THE BIKE ITSELF CLEAR OF THE PADS, and asks for nothing more', () => {
    // The derivation, stated as the thing it guarantees. The RESTING bike —
    // chassis plus its own reach below it, in pixels at the framing on screen —
    // clears the top of the pads, and that is the whole of the want. The rail
    // used to be measured against the full safe box instead, which insured a
    // transient (a sustained climb) by taxing every frame, and on a 348 px
    // landscape phone the tax was the bike sitting above centre for the whole
    // game.
    const p = handsOn(PADS);
    const bias = screenBiasFor(p, PHONE.h, PHONE_ZOOM);
    const rest = PHONE.h / 2 * (1 - bias);
    const bikeBottom = rest + p.restClearM * PHONE_ZOOM;
    expect(bikeBottom).toBeLessThanOrEqual(PHONE.h - PADS + 1e-9);
  });

  it('CENTRES the bike on the landscape phone the complaint came from', () => {
    // 915 x 348 — a landscape Android in Chrome with the URL bar and the system
    // bars showing — is the viewport a player photographed and said the bike
    // looked cut off on, and "centre it vertically" was their own suggested
    // remedy. On that viewport the pads cannot reach a bike sitting in the
    // middle, so there is nothing to dodge and the answer is dead centre: the
    // framing all twenty levels were authored at.
    expect(screenBiasFor(handsOn(PADS), PHONE.h, PHONE_ZOOM)).toBe(0);
    // And the shorter landscape phone next to it, which was 40% of the way down
    // the glass under the old rail, comes back to within a pixel or two of the
    // middle rather than being left as the one screen that still reads wrong.
    const short = { w: 736, h: 280 };
    const bias = screenBiasFor(handsOn(PADS), short.h, zoomAt(short.w, short.h));
    expect(bias * (short.h / 2)).toBeLessThan(4);
  });

  it('is LOWER than centring the bike in the clear band, which is the change', () => {
    // The old answer, kept here as the thing being moved away from: the middle
    // of the band between the HUD and the pads. It wastes a third of a phone's
    // scarcest dimension on the ground the bike is standing on.
    const p = handsOn(PADS);
    const bias = screenBiasFor(p, PHONE.h, PHONE_ZOOM);
    const rest = PHONE.h / 2 * (1 - bias);
    const clearMid = (p.hudInsetPx + (PHONE.h - PADS)) / 2;
    expect(rest).toBeGreaterThan(clearMid);
    // And it is a real move rather than a rounding: about a twentieth of the
    // glass on the viewport this is all measured at.
    expect(rest - clearMid).toBeGreaterThan(PHONE.h * 0.04);
  });

  it('asks for NOTHING at all on a screen the pads cannot reach across', () => {
    // The whole point of deriving it in pixels. The same hands on a tablet or in
    // portrait are nowhere near the bike wherever the camera puts it, so there is
    // nothing to dodge and the answer is dead centre — the desktop framing.
    expect(screenBiasFor(handsOn(PADS), 820, zoomAt(1180, 820))).toBe(0);
    expect(screenBiasFor(handsOn(101), 800, zoomAt(412, 800))).toBe(0);
    // And it is monotone in the height: the shorter the screen, the more of it
    // the same hands take and the further up the bike has to go. Same zoom for
    // every rung, so what is being compared is the height and nothing else.
    const ladder = [240, 280, 310, 348, 412, 500].map((h) => screenBiasFor(handsOn(PADS), h, PHONE_ZOOM));
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeLessThanOrEqual(ladder[i - 1]);
  });

  it('never rests the bike under a thumb, unless the HUD leaves no room to avoid it', () => {
    for (const h of [240, 280, 300, 310, 348, 390, 412, 640, 820, 900]) {
      const p = handsOn(PADS);
      const bias = screenBiasFor(p, h, PHONE_ZOOM);
      const bikeBottom = h / 2 * (1 - bias) + p.restClearM * PHONE_ZOOM;
      const room = (h / 2 - p.hudInsetPx) / (h / 2) - p.safeBox;
      // Either the resting bike is clear of the pads, or the HUD rail is what
      // bound the bias — which is the documented tie-break and only happens on a
      // viewport with less clear band than the safe box wants.
      const clear = bikeBottom <= h - PADS + 1e-9;
      expect(clear || bias >= room - 1e-9, `viewport ${h} px tall`).toBe(true);
    }
  });

  it('gives up the comfort rather than hiding the bike under the HUD', () => {
    // On a short enough viewport the room runs out before the want is paid, and
    // the room wins. The bound is the one that matters: the safe box already
    // allows the follow `safeBox` of the half-frame above centre, so
    // `safeBox + bias` is the worst case and it has to stay out of the HUD band.
    for (const h of [240, 280, 300, 348, 390, 412, 640, 820, 900]) {
      const p = handsOn(PADS);
      const bias = screenBiasFor(p, h, PHONE_ZOOM);
      const worst = (bias + p.safeBox) * (h / 2);
      expect(h / 2 - worst, `viewport ${h} px tall`).toBeGreaterThanOrEqual(p.hudInsetPx - 1e-9);
    }
    // A viewport with no room at all gets no bias rather than a negative one.
    expect(screenBiasFor(handsOn(PADS), 140, PHONE_ZOOM)).toBe(0);
    expect(screenBiasFor(handsOn(PADS), 0, PHONE_ZOOM)).toBe(0);
  });

  it('bounds what a SUSTAINED CLIMB gives up, which is what the new rail costs', () => {
    // The trade, measured rather than asserted in prose. Protecting the resting
    // bike instead of the worst case means a long climb can now walk the bike
    // into the top of the band the pads occupy — `leadY` goes positive, the
    // camera rides above the bike, and the bike sits low for the whole ascent.
    //
    // What makes that acceptable is WHERE it lands. On the landscape phone the
    // thumb pads are at the left and right edges and the centre column holds the
    // command drawer, which starts ~33 px below the pad row. The bike is drawn
    // near the middle of the frame, so the excursion has to clear the DRAWER,
    // and it is the drawer this pins. If a future layout change moves the drawer
    // up, this fails and says so.
    const DRAWER_TOP = 270;
    const cam = createCamera(handsOn(PADS));
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    let y = 0;
    for (let i = 0; i < 180; i++) {
      y += 6 / 60;
      cam.update({ x: 0, y, vx: 6, vy: 6 }, 1 / 60, PHONE.w, PHONE.h);
    }
    const climbing = bikeAt(cam, PHONE.h, y) + DEFAULT_CAMERA.restClearM * cam.zoom;
    expect(climbing).toBeLessThan(DRAWER_TOP);
    // And it really is the transient it is described as: at rest the same bike
    // on the same viewport is comfortably above the pads.
    const rest = bikeAt(withBias(0.3), PHONE.h) + DEFAULT_CAMERA.restClearM * cam.zoom;
    expect(rest).toBeLessThan(PHONE.h - PADS);
  });

  it('LETS A FALL OPEN THE GROUND UP, which is what pays for resting low', () => {
    // The one case that genuinely needs to see down, and the reason a low
    // resting position costs nothing: falling drives `leadY` toward
    // `-maxLeadY`, the camera drops below the bike, and the bike walks UP the
    // frame. More world below it than at rest, and still clear of the HUD.
    const restCam = withBias(0.3);
    const rest = bikeAt(restCam, PHONE.h);

    const cam = createCamera(handsOn(PADS));
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    // A fall: the bike is moving down hard and the camera has had time to lead.
    let y = 0;
    for (let i = 0; i < 120; i++) {
      y -= 12 / 60;
      cam.update({ x: 0, y, vx: 0, vy: -12 }, 1 / 60, PHONE.w, PHONE.h);
    }
    const falling = bikeAt(cam, PHONE.h, y);
    // 28 px on this viewport, and NOT the 84 that `maxLeadY` alone would buy:
    // in a STEADY fall the follow's own lag sits above the target and cancels
    // most of the lead, so the reveal is the difference between the two. Worth
    // knowing before leaning on the lead to pay for a low resting position — it
    // pays, but it pays less than the parameter reads.
    expect(falling).toBeLessThan(rest - 20);
    expect(falling).toBeGreaterThanOrEqual(DEFAULT_CAMERA.hudInsetPx);
    // And in metres of world below the bike, which is the thing a player reads.
    expect((PHONE.h - falling) / cam.zoom).toBeGreaterThan((PHONE.h - rest) / restCam.zoom + 0.5);
  });

  it('CANNOT push the bike off the edge, however hard it is asked to', () => {
    // The safe box is a guarantee and it outranks the comfort. `safeBox +
    // screenBiasY` is how far off centre the bike can end up, and at 1 it is at
    // the very edge; the clamp leaves the last 15% for the bike's own size and
    // the ground under it.
    const cam = withBias(5, VIEW.w, VIEW.h, VIEW.h);
    const halfH = VIEW.h * 0.5 / cam.zoom;
    const offset = -cam.y / halfH;
    expect(offset).toBeLessThanOrEqual(MAX_SCREEN_BIAS - DEFAULT_CAMERA.safeBox + 1e-9);
    expect(offset + DEFAULT_CAMERA.safeBox).toBeLessThanOrEqual(MAX_SCREEN_BIAS + 1e-9);
  });

  it('fades out under the overview — there is no corner to hide in there', () => {
    // On a viewport SHORT enough to still want a bias, because a fade-out
    // asserted where there is nothing to fade proves nothing. 240 px is the
    // bottom of the phone table and the one rung where the rail still bites.
    const SHORT = { w: 736, h: 240 };
    const p = handsOn(PADS);
    expect(screenBiasFor(p, SHORT.h, zoomAt(SHORT.w, SHORT.h))).toBeGreaterThan(0);
    const cam = createCamera(p);
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    const t = { x: 0, y: 0, vx: 0, vy: 0 };
    for (let i = 0; i < 60; i++) {
      cam.update(t, 1 / 60, SHORT.w, SHORT.h, { x: 0, y: 20, zoom: 10, blend: 1 });
    }
    expect(cam.y).toBeCloseTo(20, 6);
  });
});


describe('the framing is metres of world, not pixels per metre', () => {
  // THE BUG THIS REPLACES: a fixed px/m answers "how big is the bike", which is
  // not a question anybody asks while playing. "How much of the level can I
  // see" is, and at 62 px/m the answer depended entirely on the window — 25.8 m
  // on the 1600 px desktop the levels were authored at, 55.5 m on an ultrawide
  // and 13.6 m on a landscape phone. Nobody chose the second two, and the third
  // is the one a player reported as hard to play.
  const P = DEFAULT_CAMERA;
  const metres = (cssW: number) => cssW / baseZoomFor(P, cssW);

  it('is EXACTLY unchanged at the reference viewport', () => {
    // The whole scheme is anchored on one measured, human-approved framing. If
    // this moves, every level was tuned against a camera that no longer exists.
    expect(baseZoomFor(P, P.refWidth)).toBeCloseTo(P.baseZoom, 9);
    expect(metres(1600)).toBeCloseTo(25.806, 3);
  });

  it('shows a phone MORE of the level than it used to, not less', () => {
    // The mistake being undone: the touch camera used to multiply the zoom by
    // 1.25, which took an 844 px phone from 13.6 m to 10.9 m — under half the
    // desktop's 25.8 m. Deriving it gives ~18.7 m instead.
    expect(metres(844)).toBeGreaterThan(17);
    expect(metres(844)).toBeLessThan(21);
    // And the happy consequence nobody asked for: the bike is a LARGER fraction
    // of a small screen than of the desktop, because the phone gave up some
    // world rather than all of it.
    const bikeOnPhone = 1.7 * baseZoomFor(P, 844) / 844;
    const bikeOnDesktop = 1.7 * baseZoomFor(P, 1600) / 1600;
    expect(bikeOnPhone).toBeGreaterThan(bikeOnDesktop);
  });

  it('is monotone: a wider screen always sees more world, and never proportionally more', () => {
    // Between the two extremes and committed to neither. Fixed px/m would make
    // the ratio equal to the width ratio; fixed world width would make it 1.
    let prev = 0;
    for (const w of [390, 780, 844, 1024, 1280, 1600, 1920, 2560, 3440]) {
      const m = metres(w);
      expect(m).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = m;
    }
    expect(metres(3440) / metres(1600)).toBeLessThan(3440 / 1600);
    expect(metres(3440) / metres(1600)).toBeGreaterThan(1);
  });

  it('needs NOTHING doing for a tablet, and this is the measurement that says so', () => {
    // THE ONE THING A TABLET PASS SHOULD NOT TOUCH, written down so the next
    // pass does not touch it either. The worry was the vertical lead: on a
    // 348 px phone `maxLeadY` is 2.2 m against 9.0 m of visible height, which
    // is 24% of the screen and IS the dominant framing term there. A tablet is
    // the opposite problem, and the opposite problem turns out to be no problem:
    //
    //   1600 x 900  desktop      62.0 px/m   25.81 x 14.52 m   lead 15.1% of h
    //   1366 x 1024 iPad 13"     57.3 px/m   23.84 x 17.87 m   lead 12.3%
    //   1194 x 834  iPad 11"     53.6 px/m   22.29 x 15.57 m   lead 14.1%
    //   1024 x 1366 iPad 13" P   49.6 px/m   20.65 x 27.54 m   lead  8.0%
    //    915 x 348  phone        38.6 px/m   23.73 x  9.03 m   lead 24.4%
    //
    // Every tablet is BELOW the reference's own 15%, so the term the phone had
    // to be defended from is quieter on a tablet than on the desktop the levels
    // were authored at. Nothing to fix.
    const frame = (w: number, h: number): [number, number] => {
      const z = baseZoomFor(P, w, h);
      return [w / z, h / z];
    };
    const lead = (w: number, h: number): number => P.maxLeadY / frame(w, h)[1];
    const ref = lead(1600, 900);
    expect(ref).toBeCloseTo(0.1515, 3);
    for (const [w, h] of [[1180, 820], [1194, 834], [834, 1194], [1366, 1024], [1024, 1366]]) {
      expect(lead(w, h), `${w}x${h}`).toBeLessThan(ref);
    }
    expect(lead(915, 348)).toBeGreaterThan(ref);
    // And the horizontal framing a tablet gets is within a couple of metres of
    // the desktop's in landscape, which is the other half of "leave it alone".
    expect(frame(1366, 1024)[0]).toBeCloseTo(23.84, 2);
    expect(frame(1194, 834)[0]).toBeCloseTo(22.29, 2);
    // Portrait is the one that gives up horizontal world, and it gives it up to
    // the SAME rule that makes a landscape phone work: the starved axis sets the
    // zoom, and in portrait that is the width. Zooming out to fill the height
    // would show an 834 px-wide window more world than an 834 px-wide window is
    // owed, which is the rule's whole premise inverted.
    expect(frame(834, 1194)[0]).toBeCloseTo(18.63, 2);
    expect(baseZoomFor(P, 834, 1194)).toBeCloseTo(baseZoomFor(P, 834), 9);
  });

  it('lets the READABILITY FLOOR win on a screen too narrow to satisfy', () => {
    // The floor outranks framing, and this is where that gets paid for: a
    // portrait phone would want 31 px/m and gets 38, so it sees LESS world than
    // the rule asked for rather than a mushier collision edge.
    expect(P.baseZoom * Math.pow(390 / P.refWidth, P.widthExp)).toBeLessThan(P.minZoom);
    expect(baseZoomFor(P, 390)).toBe(P.minZoom);
    for (const w of [200, 390, 844, 1600, 5120, 0, -1]) {
      expect(baseZoomFor(P, w)).toBeGreaterThanOrEqual(P.minZoom);
      expect(baseZoomFor(P, w)).toBeLessThanOrEqual(P.maxZoom);
    }
  });

  it('keeps the speed zoom-out proportional instead of aiming at a fixed number', () => {
    // `minZoom` was both the floor AND what speed zoomed out to, which was one
    // number only because there was one base zoom. Left fixed, an ultrawide
    // would zoom out 2.4x at speed and show 90 m of level.
    expect(wideZoomFor(P, P.refWidth)).toBeCloseTo(P.minZoom, 9);
    const ratio = (w: number) => baseZoomFor(P, w) / wideZoomFor(P, w);
    expect(ratio(3440)).toBeCloseTo(ratio(1600), 6);
    // On a phone the floor takes most of it away, which is the floor doing its
    // job rather than a bug: there is no room below 38 px/m to zoom out into.
    expect(wideZoomFor(P, 844)).toBe(P.minZoom);
    expect(ratio(844)).toBeLessThan(ratio(1600));
  });

  it('DERIVES FROM THE LIMITING DIMENSION, which is the whole of the phone fix', () => {
    // THE BUG: a zoom derived from width alone answers "how much level is
    // ACROSS the screen" and says nothing about how much is up it. A landscape
    // Android phone in Chrome is about 915 x 348 once the URL bar and the system
    // bars have had their quarter — an aspect of 2.63 against the reference's
    // 1.78 — so the width-only formula picked a comfortable 19.5 m across and
    // handed over SEVEN AND A HALF METRES of vertical world. The level came out
    // as a thin band across the top of the canvas.
    //
    // The table, in metres of world, old -> new:
    //
    //   1600 x  900  desktop reference   25.8 x 14.5  ->  25.8 x 14.5   unchanged
    //   1920 x 1080  same aspect         28.3 x 15.9  ->  28.3 x 15.9   unchanged
    //   3440 x 1440  ultrawide           37.8 x 15.8  ->  43.9 x 18.4
    //   1180 x  820  tablet landscape    22.2 x 15.4  ->  22.2 x 15.4   unchanged
    //    844 x  390  iPhone landscape    18.7 x  8.7  ->  20.7 x  9.6
    //    915 x  348  Android + chrome    19.5 x  7.4  ->  23.7 x  9.0
    //    915 x  412  the same, installed 19.5 x  8.8  ->  21.8 x  9.8
    //    412 x  800  portrait            10.8 x 21.1  ->  10.8 x 21.1   at the floor
    const P = DEFAULT_CAMERA;
    const widthOnly = (w: number) => clampish(P.baseZoom * Math.pow(w / P.refWidth, P.widthExp));
    const clampish = (z: number) => Math.min(P.maxZoom, Math.max(P.minZoom, z));
    for (const [w, h] of [[915, 348], [892, 340], [844, 390], [3440, 1440]]) {
      expect(baseZoomFor(P, w, h), `${w}x${h}`).toBeLessThan(widthOnly(w));
      // More world on BOTH axes than the width-only answer gave. That is the
      // statement the rule makes, and it is the only one it makes.
      expect(h / baseZoomFor(P, w, h)).toBeGreaterThan(h / widthOnly(w));
      expect(w / baseZoomFor(P, w, h)).toBeGreaterThan(w / widthOnly(w));
    }
    expect(348 / baseZoomFor(P, 915, 348)).toBeGreaterThan(8.9);
    expect(915 / baseZoomFor(P, 915, 348)).toBeGreaterThan(23);
  });

  it('does not move a single viewport that has the reference ASPECT', () => {
    // Which is the safety argument for the whole change: every level was tuned
    // against 1600 x 900, and a 16:9 window of any size still frames exactly
    // what it framed before.
    const P = DEFAULT_CAMERA;
    for (const w of [1024, 1280, 1600, 1920, 2560]) {
      const h = (w * P.refHeight) / P.refWidth;
      expect(baseZoomFor(P, w, h), `${w}x${h}`).toBeCloseTo(baseZoomFor(P, w), 9);
    }
    expect(baseZoomFor(P, P.refWidth, P.refHeight)).toBeCloseTo(P.baseZoom, 9);
  });

  it('SAYS SO when a viewport cannot honour the readability floor', () => {
    // The floor outranks framing and this is where it gets paid for. A portrait
    // phone wants 31 px/m by width and gets 38; a 280 px-tall landscape one
    // wants 34.6 by height and gets 38. Both see LESS world than the derivation
    // asked for, rather than a mushier collision edge — and the only honest
    // thing to do about it is to report it, not to lower the floor.
    const P = DEFAULT_CAMERA;
    const atFloor = (w: number, h: number) => baseZoomFor(P, w, h) === P.minZoom;
    expect(atFloor(412, 800)).toBe(true);
    expect(atFloor(360, 640)).toBe(true);
    expect(atFloor(736, 280)).toBe(true);
    // And the one the user is on is barely above it: 348 px of height at 38.55
    // px/m is 9.0 m, and there is 1.4% of headroom left over the floor. That is
    // the real answer to "why is there not more level on screen" on that phone
    // — there is nothing left to give without the edge going soft.
    expect(baseZoomFor(P, 915, 348)).toBeGreaterThan(P.minZoom);
    expect(baseZoomFor(P, 915, 348) / P.minZoom).toBeLessThan(1.05);
    // Reclaiming the browser chrome is what actually buys more, and it is worth
    // eight tenths of a metre of vertical world — which is why the manifest and the
    // fullscreen pad are part of this fix rather than a nicety.
    expect(412 / baseZoomFor(P, 915, 412)).toBeGreaterThan(348 / baseZoomFor(P, 915, 348) + 0.7);
    for (const [w, h] of [[200, 100], [915, 348], [412, 800], [5120, 2160], [0, 0], [-1, -1]]) {
      expect(baseZoomFor(P, w, h)).toBeGreaterThanOrEqual(P.minZoom);
      expect(baseZoomFor(P, w, h)).toBeLessThanOrEqual(P.maxZoom);
    }
  });

  it('follows a resize and a rotation without being told', () => {
    // The common case on a phone, and it arrives through `update` like
    // everything else: the viewport is an input to the zoom on every frame, so
    // a rotation EASES rather than jumping, and nothing has to listen.
    const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
    cam.setViewport(844, 390);
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    expect(cam.zoom).toBeCloseTo(baseZoomFor(DEFAULT_CAMERA, 844, 390), 6);
    const t = { x: 0, y: 0, vx: 0, vy: 0 };
    // Rotated to portrait.
    cam.update(t, 1 / 60, 390, 844);
    expect(cam.zoom).toBeGreaterThan(baseZoomFor(DEFAULT_CAMERA, 390, 844));
    // Ten seconds of frames each way, because easing is the point: a rotation
    // that snapped the zoom would be the one discontinuity in a camera whose
    // whole design rule is that there are none.
    for (let i = 0; i < 600; i++) cam.update(t, 1 / 60, 390, 844);
    expect(cam.zoom).toBeCloseTo(baseZoomFor(DEFAULT_CAMERA, 390, 844), 2);
    for (let i = 0; i < 600; i++) cam.update(t, 1 / 60, 844, 390);
    expect(cam.zoom).toBeCloseTo(baseZoomFor(DEFAULT_CAMERA, 844, 390), 2);
    // BOTH DIMENSIONS, and a rotation is the cleanest demonstration of why: the
    // same phone, the same pixels, and the limiting axis has swapped ends.
    expect(baseZoomFor(DEFAULT_CAMERA, 844, 390)).toBeLessThan(baseZoomFor(DEFAULT_CAMERA, 844));
  });

  it('snaps to the viewport it was told about, not to the reference', () => {
    // A restart on a phone must not flash the desktop's framing for a few
    // frames. There is no resize event on a restart, so `snap` has to already
    // know.
    const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
    cam.setViewport(844);
    cam.snap({ x: 1, y: 2, vx: 0, vy: 0 });
    expect(cam.zoom).toBeLessThan(DEFAULT_CAMERA.baseZoom);
    expect(cam.zoom).toBeCloseTo(844 / 18.7, 0);
  });
});

describe('the manual zoom bias', () => {
  // Driven by the +/- keys and by the pinch, which are the same variable on
  // purpose: a second concept for "the player asked for a different zoom" is
  // two things to keep in step for no gain.
  const P = DEFAULT_CAMERA;

  it('clamps against the ZOOM RANGE, not against a fixed pair of numbers', () => {
    // The old keys clamped the bias to 0.35..3 and let the camera clamp the
    // zoom afterwards, so the bias could wind up to 3 while the zoom sat pinned
    // at maxZoom — and then several presses of `-` did nothing at all. A pinch
    // makes that much worse: the gesture banks travel it has to give back.
    const hi = clampZoomBias(P, 1600, 900, 99);
    expect(P.baseZoom * hi).toBeCloseTo(P.maxZoom, 6);
    const lo = clampZoomBias(P, 1600, 900, 0.01);
    expect(P.baseZoom * lo).toBeCloseTo(P.minZoom, 6);
  });

  it('is tighter on a phone, because there is less room under it', () => {
    // 844 px derives ~45 px/m against a 38 px/m floor, so zooming out has 16%
    // to give and no more. Saying so is the point: the floor is not quietly
    // lowered to make a gesture feel better.
    const lo = clampZoomBias(P, 844, undefined, 0.1);
    expect(baseZoomFor(P, 844) * lo).toBeCloseTo(P.minZoom, 6);
    expect(lo).toBeGreaterThan(0.8);
    expect(lo).toBeLessThan(1);
  });

  it('never leaves the sanity rails', () => {
    for (const w of [390, 844, 1600, 3440]) {
      for (const v of [-5, 0, 0.001, 1, 7, 1e9, NaN, Infinity]) {
        const b = clampZoomBias(P, w, undefined, v);
        expect(Number.isFinite(b)).toBe(true);
        expect(b).toBeGreaterThanOrEqual(BIAS_MIN);
        expect(b).toBeLessThanOrEqual(BIAS_MAX);
      }
    }
  });

  it('is applied through the camera, and reports what it actually did', () => {
    const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
    cam.setViewport(844);
    expect(cam.setZoomBias(1.2)).toBeCloseTo(1.2, 9);
    expect(cam.zoomBias).toBeCloseTo(1.2, 9);
    // On a phone it is the sanity rail that bites first — a derived 45 px/m
    // times 3 is still short of the 150 px/m ceiling — and either way the
    // request is cut down to something the camera can actually show.
    const asked = cam.setZoomBias(50);
    expect(asked).toBe(BIAS_MAX);
    expect(baseZoomFor(DEFAULT_CAMERA, 844) * asked).toBeLessThanOrEqual(DEFAULT_CAMERA.maxZoom);
    // And it still cannot break the floor, at any speed.
    cam.setZoomBias(0.01);
    cam.snap({ x: 0, y: 0, vx: 0, vy: 0 });
    for (let i = 0; i < 200; i++) cam.update({ x: 0, y: 0, vx: 60, vy: 0 }, 1 / 60, 844, 390);
    expect(cam.zoom).toBeGreaterThanOrEqual(DEFAULT_CAMERA.minZoom - 1e-9);
  });
});
