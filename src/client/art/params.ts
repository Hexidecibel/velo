// Art parameters. Same shape as CameraParams and OverviewParams, and for the
// same reason: anything with feel goes on the tuning panel, and "how loud is the
// terrain texture" is feel.
//
// Every field is a number, including the switches. The panel's slider machinery
// is generic over the object it edits but not over the CONTROL, and a 0/1 slider
// is a worse checkbox but a much smaller change than a second control type —
// which matters, because a second control type would want a third the moment
// somebody wants a colour.
export interface ArtParams {
  /**
   * 0 = the old flat renderer, 1 = the art. The A/B switch, also on the V key.
   * It exists because the acceptance criterion for all of this is readability
   * and readability is judged by flipping between two frames.
   */
  enabled: number;

  /** Global multiplier on every texture density. 0 leaves the flat cel look. */
  detail: number;
  /** Diagonal tooth over the terrain. Cheapest thing here to switch off. */
  hatch: number;
  /** Background wall panelling, stains and stencils. */
  wall: number;
  /** Stencil stamps along long top edges. */
  stamps: number;
  /** Striped hazard blocks at drop-offs. */
  chevrons: number;
  /** Under-ledge shadow bands and the bracketed pipework beneath long ceilings. */
  underworks: number;
  /** Drifting dust. Count of motes; 0 is off. */
  motes: number;
  /** The in-canvas game HUD: level card, clock, apple count. 0 hides it. */
  hud: number;

  /**
   * Bloom, as a screen-blend alpha. Done at a quarter resolution — a full-res
   * blur of a 1920x1080 frame is several milliseconds and this is atmosphere.
   */
  bloom: number;
  /** Blur radius of the bloom pass, in quarter-res pixels. */
  bloomRadius: number;

  /** Multiplier on the cel band widths. 0 removes them; the lip and ink stay. */
  bandScale: number;
  /** Ink on the collision edge, in SCREEN pixels. The readability rule itself. */
  inkWidth: number;
  /** Coloured lip just inside the edge, in screen pixels. */
  lipWidth: number;
  /**
   * Zoom at which ink and lip stop shrinking. Below it they scale down, because
   * 5 px of ink on every edge of a 330 m level in the overview is a hairball,
   * and the overview's job is shape.
   */
  inkFullZoom: number;
  /** How thin ink is allowed to get, as a fraction of inkWidth. */
  inkMinScale: number;

  /**
   * Texture fades out below this zoom and is gone by `artOffZoom`. Two reasons,
   * and they agree: at 12 px/m the texture is mud that hides the silhouette, and
   * it is also where a screenful stops being a screenful and starts being a
   * level.
   */
  artFadeZoom: number;
  artOffZoom: number;

  /** Degrees off horizontal at which a face stops being a floor. */
  faceAngle: number;

  // --- Phase 2 ---------------------------------------------------------------

  /**
   * 1 = every level gets its own palette, derived from its simHash; 0 = every
   * level gets the one hand-authored palette, which is exactly Phase 1's look.
   *
   * Kept as a switch for the same reason `enabled` was: "did per-level palettes
   * earn their place" is a comparison, and twenty levels sharing one palette is
   * the thing being compared against. It is also what the third argument to
   * `bakeLevel` is for — that palette is the one used when this is 0.
   */
  derive: number;
  /**
   * How far a level's NON-COLOUR look may stray from the mid parameters: panel
   * pitch, hatch, stain density, light-wedge angle, band contrast. 0 gives every
   * level identical parameters; 1 is the generator's full range. A palette swap
   * alone still reads as the same room repainted, so this is the other half of
   * per-level variety.
   */
  variety: number;

  /** Set dressing: pieces, signage, ladders, lamps, posters, conduit. */
  props: number;
  /** Parallax silhouettes of the level's own geometry, behind the play space. */
  parallax: number;

  // --- adaptive detail -------------------------------------------------------
  //
  // REPORTED FROM PLAY, on a machine WITH a GPU: "feels choppy a lil bit
  // sometimes", on 20-close-quarters. That level measured at 89% of the frame
  // budget in Phase 1, and the reason is counterintuitive — 20 is the SHORTEST
  // level in the set, so its whole height is on screen and the solid fills about
  // nine tenths of the frame. Cost tracks visible solid area, not level size.
  //
  // So the margin is not something to spend on decoration; it is something to
  // defend. The four layers Phase 1 measured as expensive (bloom, blotches and
  // cracks, hatch, wall detail) are scaled down when frames run long, and the
  // ink and the lip are never touched — they are the one thing the whole look
  // exists to serve and they are nearly free.

  /** 1 = scale the expensive layers to fit the budget. 0 = always full detail. */
  adaptive: number;
  /** Milliseconds the art render call is allowed to take. */
  adaptTarget: number;
  /** How far detail may be scaled back. 1 is no scaling; the floor keeps a look. */
  adaptFloor: number;

  // --- outputs ---------------------------------------------------------------
  //
  // Written by the renderer, not by the panel. They live here because this
  // object is the art's public surface — `window.velo.art` — and a diagnostic
  // that cannot be read from outside the page is not a diagnostic. Nothing
  // reads them back as input.

  /** Current detail multiplier, 0..1. 1 means nothing has been scaled back. */
  quality: number;
  /** Fraction of the last frame that was solid. The feed-forward cost predictor. */
  solidFrac: number;
  /** Milliseconds the last art render call took, smoothed. */
  artMs: number;
}

export const DEFAULT_ART: ArtParams = {
  enabled: 1,
  detail: 1,
  hatch: 1,
  wall: 1,
  stamps: 1,
  chevrons: 1,
  underworks: 1,
  motes: 70,
  hud: 1,
  bloom: 0.17,
  bloomRadius: 5,
  bandScale: 1,
  inkWidth: 5,
  // 4, not the mockup's 2.5. The ink is stroked CENTRED on the boundary and
  // eats half of itself out of the lip, and its antialiased inner edge eats
  // most of what is left — measured off a screenshot, a 2.5 px lip came out as
  // one blended pixel. The lip is half the readability rule; it has to survive
  // the other half.
  lipWidth: 4,
  inkFullZoom: 40,
  inkMinScale: 0.4,
  // The play camera lives between 38 and 110 px/m and the overview goes down to
  // about 3. Fading the texture out across 26..38 therefore means: full detail
  // at every zoom anybody is DRIVING at, and none of it in the overview — where
  // it is both sub-pixel mud that hides the silhouette and, because a screenful
  // is then a whole level, by far the most expensive thing on screen.
  artFadeZoom: 38,
  artOffZoom: 26,
  faceAngle: 53,
  derive: 1,
  variety: 1,
  props: 1,
  parallax: 1,
  adaptive: 1,
  // 11 ms, not 16.7. The art render call is not the whole frame — the sim step,
  // the HUD and the browser's own compositing come out of the same 16.7 — so
  // aiming the art at the whole budget is how you ship something that drops
  // frames while every measurement says it fits.
  adaptTarget: 11,
  // 0.2 still leaves the cel bands, the ink, the lip, the silhouette and a
  // trace of texture. Below that the look stops being the look.
  adaptFloor: 0.2,
  quality: 1,
  solidFrac: 0,
  artMs: 0,
};

export function cloneArt(p: ArtParams): ArtParams {
  return { ...p };
}

/** cos(90 - faceAngle): the |ny| above which a face counts as floor or ceiling. */
export function faceThreshold(p: ArtParams): number {
  return Math.sin((p.faceAngle * Math.PI) / 180);
}

/** 0..1 — how much of the texture treatment this zoom gets. */
export function artStrength(p: ArtParams, zoom: number): number {
  if (zoom >= p.artFadeZoom) return 1;
  if (zoom <= p.artOffZoom) return 0;
  return (zoom - p.artOffZoom) / Math.max(p.artFadeZoom - p.artOffZoom, 1e-6);
}
