// Adaptive detail. Spend the frame budget on the look, and give back only what
// a long frame actually costs.
//
// REPORTED FROM PLAY, on a machine WITH a GPU — this box has none — on
// 20-close-quarters: "feels choppy a lil bit sometimes", and then, asked how
// bad: "its not like SUPER choppy, just a tiny bit here and there". That is
// occasional dropped frames, not a low frame rate, and it matches Phase 1's
// measurement of that level exactly: 89% of the 16.7 ms budget, so most frames
// fit and a few do not.
//
// The counterintuitive part is why 20 is the worst level: it is the SHORTEST
// one, 17 m tall, so its whole height is on screen and solid fills about nine
// tenths of the frame. Cost tracks visible solid AREA, not level size. 19 is
// the same shape.
//
// FOUR RULES, and they come straight from that calibration:
//
// 1. ENGAGE LATE. Nothing is scaled until frames actually run long. A scaler
//    that trades quality across twenty levels to smooth a hitch on one is a
//    regression dressed up as a fix, and the user likes how it looks.
// 2. CHEAPEST REDUCTION FIRST, not proportional scaling. Bloom is the most
//    expensive layer Phase 1 measured (2.0-4.4 ms) and the most forgiving to
//    lose — it is atmosphere, not information. Then blotches and cracks, then
//    hatch, then wall detail. Props go early too: they are the newest thing in
//    the frame and the least load-bearing.
// 3. NEVER THE INK OR THE LIP. They are the one thing the whole look exists to
//    serve and they are nearly free. Degrade decoration, never legibility. Nor
//    the cel bands, the chevrons or the silhouette, for the same reason.
// 4. BACK OFF EARLY. Full detail returns as soon as there is room, and the
//    climb back is smooth — the bike's detail tiers already taught this lesson
//    the hard way: detail that pops in and out while riding is worse than
//    detail that is simply absent.
//
// Pure, so all four are assertable in plain node.

/** Ramp from 0 at `a` to 1 at `b`, clamped. */
function ramp(q: number, a: number, b: number): number {
  if (q <= a) return 0;
  if (q >= b) return 1;
  return (q - a) / (b - a);
}

/**
 * What each scalable layer gets at a given quality.
 *
 * The bands are the degradation ORDER: bloom is gone before the terrain texture
 * is touched at all, and the wall panelling is the last thing to go because it
 * costs the least of the four. Nothing outside this object is ever scaled.
 */
export interface DetailLevels {
  bloom: number;
  /** Blotches and cracks. */
  detail: number;
  /** Hatch opacity; the pitch widens separately as this falls. */
  hatch: number;
  /** Multiplier on the hatch pitch — fewer lines, which is the real saving. */
  hatchPitch: number;
  wall: number;
  motes: number;
  props: number;
}

export function detailAt(q: number): DetailLevels {
  const h = ramp(q, 0.3, 0.58);
  return {
    bloom: ramp(q, 0.72, 1),
    detail: 0.12 + 0.88 * ramp(q, 0.42, 0.8),
    hatch: h,
    hatchPitch: 1 + (1 - h) * 1.6,
    wall: 0.4 + 0.6 * ramp(q, 0.2, 0.45),
    motes: ramp(q, 0.5, 0.85),
    props: ramp(q, 0.3, 0.62),
  };
}

/**
 * Relative cost of the art at a quality, 1 at full detail.
 *
 * The weights are Phase 1's own layer measurements on 20-close-quarters, the
 * worst level: of about 14.8 ms, bloom was 3, blotches and cracks 3.5, hatch 2,
 * wall detail 1.3, and the remaining 5 is the silhouette, the bands, the ink,
 * the lip and the actors — which nothing here scales, and which is therefore
 * the floor this model can never get under.
 */
const W = { fixed: 0.34, bloom: 0.2, detail: 0.24, hatch: 0.135, wall: 0.085 };

export function costAt(q: number): number {
  const d = detailAt(q);
  return W.fixed + W.bloom * d.bloom + W.detail * d.detail
    + W.hatch * (d.hatch / d.hatchPitch) + W.wall * d.wall;
}

export interface AdaptState {
  /** Current quality, 0..1. */
  q: number;
  /** Smoothed cost of the art at full quality, per unit of load. */
  unit: number;
  /** Frames seen. The first few are a cold bake and are not evidence. */
  frames: number;
  /** Consecutive frames with room to spare. */
  easy: number;
  /** Worst art frame in the recent window, ms. */
  worst: number;
  ring: Float32Array;
  at: number;
}

export function newAdapt(): AdaptState {
  return { q: 1, unit: 0, frames: 0, easy: 0, worst: 0, ring: new Float32Array(40), at: 0 };
}

/**
 * How much work this frame is, before drawing it.
 *
 * Solid area is the predictor, and it is knowable in advance — which is the
 * whole reason it is used. Reacting only to measured time means quality is
 * always one frame behind, and one frame behind is exactly the frame that
 * drops. 0.25 is the part of the cost that is there even with no solid on
 * screen: the background, the wall, the bloom.
 */
export function loadOf(solidFrac: number): number {
  return 0.25 + solidFrac;
}

export interface AdaptOpts {
  /** Milliseconds the art render call may take. */
  target: number;
  /** Lowest quality allowed. */
  floor: number;
}

/**
 * Fold in the frame that was just drawn.
 *
 * `ms` is what the art render call actually took, `load` and `q` are what it was
 * drawn at. Cost is modelled as `unit * load * costAt(q)`, and `unit` is the
 * one thing measured — which makes the model self-calibrating across machines,
 * which is the point: this has to be right on hardware neither of us has.
 */
export function observe(s: AdaptState, ms: number, load: number, q: number): void {
  s.frames++;
  s.ring[s.at] = ms;
  s.at = (s.at + 1) % s.ring.length;
  let worst = 0;
  for (let i = 0; i < s.ring.length; i++) if (s.ring[i] > worst) worst = s.ring[i];
  s.worst = worst;
  // The first frames after a level load include the cold bake and a cold
  // rasteriser. Treating them as evidence would drop the quality of every
  // level for its first half second.
  if (s.frames < 12) return;
  const denom = Math.max(1e-6, load * costAt(q));
  const sample = ms / denom;
  s.unit = s.unit === 0 ? sample : s.unit + (sample - s.unit) * 0.12;
}

/**
 * The quality to draw the NEXT frame at.
 *
 * Engages late: while the worst recent frame fits, `want` is 1 and nothing
 * moves. Drops in bounded steps when it does not fit, so a single spike costs a
 * little quality rather than all of it. Recovers only after a sustained stretch
 * with room to spare, and then climbs smoothly — a hard jump back would be
 * exactly the strobing the bike's detail tiers had to be fixed for.
 */
export function chooseQuality(s: AdaptState, load: number, o: AdaptOpts): number {
  if (s.frames < 12 || s.unit === 0) return s.q;

  // What full detail would cost this frame, given what the last ones cost.
  const full = s.unit * load;
  let want = 1;
  if (full * costAt(1) > o.target) {
    // Walk down to the highest quality that fits, rather than scaling
    // proportionally: the ladder in detailAt gives up the cheapest thing first.
    want = o.floor;
    for (let qq = 1; qq >= o.floor; qq -= 0.02) {
      if (full * costAt(qq) <= o.target) { want = qq; break; }
    }
  }

  // A recent spike counts even if this frame's prediction is comfortable: the
  // complaint is about occasional long frames, and a controller that only looks
  // at the average never sees one.
  if (s.worst > o.target * 1.25) want = Math.min(want, s.q - 0.06);

  const room = s.worst < o.target * 0.8;
  s.easy = room ? s.easy + 1 : 0;

  if (want < s.q - 0.02) {
    // Down: promptly, but bounded, so one bad frame is not a cliff.
    s.q = Math.max(o.floor, Math.max(want, s.q - 0.05));
  } else if (want > s.q && s.easy > 20) {
    // Up: only once the budget has plainly had room for a third of a second.
    //
    // NO DEAD BAND ON THE WAY UP, deliberately, and the asymmetry is the whole
    // "back off early" rule. A symmetric band leaves the controller stranded a
    // couple of per cent below full detail forever after one spike, which is a
    // permanent quality reduction bought by a single frame.
    s.q = Math.min(1, Math.min(want, s.q + 0.03));
  }
  return s.q;
}
