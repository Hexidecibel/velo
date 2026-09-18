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
 * `restart`, `menu`, `overview`, `levels`, `auto`, `zoom` and `full` are
 * COMMANDS, not sim input: they fire on the press and contribute no bit. They
 * are in the same list as the rest because they occupy screen space and the hit
 * test has to know about them — a flip zone that silently extended under the
 * restart button would be a missed input, and this game punishes one of those
 * immediately.
 *
 * `menu` is the drawer, and it is the answer to FIVE PERMANENT PADS FOR FIVE
 * OCCASIONAL ACTIONS. Levels, full screen, gas-mode and zoom-reset are pressed
 * between runs and never during one; paying for them with permanent glass — a
 * row that on a short landscape phone spread across half the width of the band
 * the bike rides through — was a bad trade in every direction. They live behind
 * `menu` now.
 *
 * TWO THINGS DO NOT, and each has to earn it separately.
 *
 * RESTART, because this is a die-and-retry game and there is no R key on a
 * phone: it is the one command with a real claim to being instant.
 *
 * OVERVIEW, because IT IS USED DURING A RUN and everything behind the drawer is
 * not. Seeing the whole level is how you plan a route, route planning is the
 * depth of this game, and it was bound to TAB — a key that does not exist on the
 * device this whole file is about. It is a command rather than a hold pad on
 * purpose: nothing rests on it, it is pressed and pressed again, and classing it
 * with the controls would put it into `thumbInsetPx` and tell the camera a hand
 * lives somewhere no hand lives.
 */
export type ZoneId =
  | 'throttle' | 'brake' | 'leanL' | 'leanR' | 'flip'
  | 'restart' | 'menu' | 'overview' | 'levels' | 'auto' | 'zoom' | 'full' | 'help' | 'look';

/** Every id that is a command. Static: a pad does not change what kind it is. */
export const COMMAND_IDS: readonly ZoneId[] =
  ['restart', 'menu', 'overview', 'levels', 'look', 'full', 'auto', 'zoom', 'help'];

/**
 * Every zone that can ever exist, in the order the elements are created.
 *
 * ONE ELEMENT PER ID, BUILT ONCE AND NEVER REBUILT. Opening the drawer and
 * flipping auto-throttle both change WHICH zones exist, and recreating elements
 * for that would drop the pointer capture on a held pad and weld the throttle on
 * with nothing left to release it. So every element exists from the start and
 * `place` hides the ones this state does not use.
 */
export const ALL_ZONE_IDS: readonly ZoneId[] = [
  'restart', 'menu', 'overview', 'levels', 'look', 'full', 'auto', 'zoom', 'help',
  'flip', 'leanL', 'leanR', 'brake', 'throttle',
];

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
 *   Android           densityDpi / 160 dpr, so 160 CSS px/in    6.30 px/mm
 *   iPhone (@3x)      460 ppi / 3, so 153 CSS px/in             6.04 px/mm
 *   iPhone SE (@2x)   326 ppi / 2, so 163 CSS px/in             6.42 px/mm
 *
 * 6.0 is the middle of the phone range, so a pad specified at 12 mm lands
 * between 11.4 mm (an @3x iPhone) and 12.6 mm (a 6.3 px/mm Android) — inside
 * the comfortable band at both ends, which is the whole requirement.
 *
 * It is a constant and not a media query because the overlay only exists when
 * the primary pointer is coarse — or when `?touch=1` has forced it on in order
 * to PHOTOGRAPH the phone layout, which is exactly the case where the phone's
 * density is the right assumption rather than the monitor's.
 */
export const PX_PER_MM = 6;

/**
 * THE SAME QUESTION FOR A TABLET, AND IT IS A DIFFERENT NUMBER.
 *
 * A tablet is not a dense phone. Every iPad ships a 264 ppi panel at @2x, which
 * is 132 CSS px per inch — 5.20 px/mm — and the big Windows and Android
 * tablets sit in the same place:
 *
 *   iPad Pro 11" / 13" / Air   264 ppi @2x, 132 CSS px/in       5.20 px/mm
 *   Surface Pro                1368 CSS px across 260 mm        5.26 px/mm
 *   10" Android tablet         1280 CSS px across 221 mm        5.79 px/mm
 *
 * (An iPad mini is the outlier at 6.42, and it is the one tablet this number is
 * generous to: its pads come out near 17 mm rather than 21, which is still well
 * inside the comfortable band and errs in the direction of giving the smallest
 * tablet its screen back.)
 *
 * WHY THIS MATTERS AT ALL, given that a pad 15% too big is not a pad you miss:
 * because the moment the layout starts placing things by REACH — how far up the
 * side of the glass a thumb gets from where the hand grips it — every
 * millimetre in the table has to be a real millimetre or the arithmetic is right
 * and the hand is wrong. `MM.gripReach` is the number that made this matter.
 *
 * The previous note here claimed 4.69 px/mm and "about 25% larger, which is the
 * harmless direction". The 4.69 came from dividing 834 px by a 7.0 in device
 * width; the 11" iPad Pro's PANEL is 6.32 in across its short side, not 7.0.
 */
export const TABLET_PX_PER_MM = 5.2;

/**
 * THE SHORTER SIDE OF THE GLASS, IN CSS PX, ABOVE WHICH THIS IS A TABLET.
 *
 * In CSS pixels and deliberately not in millimetres, because the millimetre
 * scale is the thing this test decides — asking "how many mm across is it"
 * first would be circular. CSS px is the one number the page actually knows.
 *
 * The gap it sits in is enormous, which is why one threshold does the job in
 * both orientations: the widest phone hands the page about 430 px on its short
 * side (an iPhone Pro Max is 430 x 932), and the smallest tablet hands it 744
 * (an iPad mini is 744 x 1133). 700 is in the middle of nothing.
 *
 * It is the SHORT side so that rotating a device never changes what kind of
 * device it is — a layout that reflowed on rotation would be two layouts to
 * learn, which is the same rule that keeps the phone from reflowing.
 */
export const TABLET_MIN_PX = 700;

/**
 * EDGE GRIP: where up the side edge the hand is, as a fraction of the glass.
 *
 * A FRACTION, IN A FILE WHERE EVERYTHING ELSE IS A MILLIMETRE, and the two are
 * different kinds of number rather than an inconsistency. A PAD is a thumb, and
 * a thumb is 15 mm on every device ever made — sizing one as a fraction of a
 * canvas is the bug this file was rewritten to remove. WHERE THE HAND GRIPS is
 * not a thumb, it is a property of the slab: you hold a tablet at the place it
 * balances, and that place is three-fifths of the way down a 160 mm edge and
 * three-fifths of the way down a 197 mm one alike.
 *
 * 0.6 AND NOT 0.5, for two reasons that happen to agree.
 *
 * The hand one: you do not hold a landscape tablet at its exact middle. The
 * fingers hook the back below the centre of mass and the slab leans back into
 * the palms, so the thumb comes over the edge somewhere in the lower half. The
 * same is true in portrait, where holding at the middle is tippy and everyone
 * grips lower.
 *
 * The picture one, and this is the one a screenshot decided: at 0.5 the pads
 * land exactly in the horizontal band the bike is framed in — the camera rests
 * it at 50% of the screen — so the lean pads and the gas sat ON the road the
 * bike was driving down. It is the same sentence the phone layout is built from
 * ("the bottom is for hands and the middle is for the game"), with "the bottom"
 * meaning "below the game" rather than "the last 15 mm of glass".
 */
export const GRIP_Y = 0.6;

/**
 * Which grip this screen is held in — and it is the whole of the tablet pass.
 *
 * A TABLET IS NOT A BIG PHONE, BECAUSE THE GRIP IS DIFFERENT.
 *
 * A phone in landscape is two thumbs on the BOTTOM CORNERS. It is 150 mm across
 * and 60 mm tall; the hand wraps the corner, the whole of the glass is inside
 * the thumb's arc, and the bottom corners are where the thumbs already are with
 * no reach at all. Every placement in the phone layout follows from that.
 *
 * None of it survives the slab. A 13" iPad in landscape is 263 mm across and
 * 197 mm tall, it weighs 680 g, and its bottom corners are a foot apart. You
 * cannot hold it by them — the thing cantilevers out of your hands — and even
 * if you could, this game wants gas, lean and flip held AT THE SAME TIME, so
 * the hands cannot leave. What people actually do with a tablet is grip the two
 * SIDE EDGES at the balance point, fingers behind, thumbs forward onto the
 * glass. The controls have to be where that thumb is, which is up the side and
 * nowhere near the bottom.
 *
 * THE OTHER TABLET GRIP IS NO GRIP AT ALL — the thing flat on a table or a lap,
 * driven with index fingers — and the happy part is that the same answer serves
 * it. Hands come to a flat tablet from its left and right, land near the side
 * edges around the middle of the height, and find bottom-corner pads awkward
 * for exactly the reason a held tablet does. One layout, both grips; the grip
 * that could not be served by the same layout is the phone's, and the phone has
 * its own.
 */
export type Grip = 'corner' | 'edge';

export function gripFor(vp: Viewport): Grip {
  return Math.min(vp.w, vp.h) >= TABLET_MIN_PX ? 'edge' : 'corner';
}

/** CSS px per mm for this screen: what the caller said, or what it looks like. */
export function pxPerMmFor(vp: Viewport): number {
  if (vp.mm && vp.mm > 0) return vp.mm;
  return gripFor(vp) === 'edge' ? TABLET_PX_PER_MM : PX_PER_MM;
}

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
 *   RESTART, OVERVIEW and MENU are the only commands with permanent glass, they
 *   are small, they are dimmer than the controls, and they live in the BOTTOM
 *   GUTTER between the two thumb clusters — see `touchZones`. LEVELS, GAS-MODE,
 *   ZOOM and FULLSCREEN are behind `menu`, because none of them is pressed
 *   during a run and five permanent pads for five occasional actions was the
 *   trade that put a row of buttons across the band the bike rides through.
 *   OVERVIEW is the exception that proves the rule: it IS pressed during a run,
 *   which is exactly the claim the other four cannot make.
 *
 * THE PADS ARE SHORTER THAN THEY WERE, and that is fix 2. 20 mm of pad height
 * was chosen when the pads were the only thing competing for the screen; on a
 * 310 px-tall landscape phone it is 39% of the glass, and the band left over for
 * the level is thinner than the pads are. 15 mm is still inside the generous
 * band for a thumb (9-10 mm is the comfortable minimum), and it hands the level
 * back about 60 px of the one dimension a landscape phone has none of.
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
  gasH: 15,
  brakeW: 13,
  flipH: 11,
  leanW: 15,
  leanH: 15,
  /**
   * 12, NOT 13, AND THE THIRD PERMANENT COMMAND IS WHY.
   *
   * The gutter on the smallest landscape phone in the table — 736 x 280 — is
   * 250 px wide, and three 13 mm pads with their gaps want 252. Two millimetres
   * over, and the fallback is the portrait branch: the whole command block
   * jumps to the top-left, back into the band the bike rides through, which is
   * the layout this rewrite exists to remove. 12 x 9 mm is still a deliberate
   * press by a wide margin (the floor for a command is 8) and it keeps every
   * landscape phone in the gutter, which is worth far more than a millimetre.
   */
  cmdW: 12,
  cmdH: 9,
  /**
   * THE FLOOR A COMMAND PAD MAY SHRINK TO, and the reason there is one at all.
   *
   * The drawer grew a sixth item — `your bike`, which is the only route a phone
   * has to the customiser — and six pads at 12 mm want 477 px of the 460 the
   * smallest landscape phone has above its clusters, and 429 of the 429 the
   * 915 x 348 phone has in its gutter. Seventeen pixels over is enough to break
   * the layout into two rows, and two rows is the stack this whole block exists
   * to prevent: on the narrow phone it climbs into the HUD band, and on the wide
   * one it climbs out of the gutter and into the band the bike rides through.
   *
   * So the DRAWER's row shrinks to fit rather than wrapping, down to here. A
   * command is a deliberate press by a thumb that is not holding anything —
   * which is exactly why it was allowed to be 12 mm when a hold pad is 15 — and
   * 8 mm is the floor below which a deliberate press stops being reliable. In
   * practice the shrink lands at 10.7 mm on the phone that needed it, which is
   * a millimetre and a half, not a different kind of control.
   *
   * THE THREE PERMANENT PADS DO NOT SHRINK. `restart`, `more` and `overview`
   * are pressed DURING a run, one of them one-handed with the other thumb on
   * the gas, and paying for a between-runs menu with the size of those would be
   * the wrong trade in the one direction that matters.
   */
  cmdMin: 8,
  /**
   * EDGE GRIP ONLY: the thumb's working radius from where the hand grips the
   * side of the slab, in mm.
   *
   * It is what stops the tablet layout from simply spreading to fill a screen
   * that has room for anything. A hand gripping the middle of a 197 mm edge can
   * put its thumb on the glass within about 45 mm of the grip; past that is a
   * regrip, and a regrip in this game is a dead run. Every tablet placement
   * below is inside it — flip is one dead strip above the cluster, the cluster
   * hangs off the grip line, and the commands are one clear strip below it —
   * and `touch.test.ts` asserts the whole stack fits in the circle.
   */
  gripReach: 45,
  /**
   * The clear margin the command block keeps from each thumb cluster.
   *
   * Sliding cannot reach a command — `slideZone` refuses to enter one — so this
   * is not about drift. It is about a PRESS: a thumb coming down on the inboard
   * edge of the lean pads must not be able to land on `restart` instead, and
   * this is the distance that makes that a different gesture rather than a
   * near miss. It is also the test for whether the gutter exists at all.
   */
  cmdMargin: 5,
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
  /**
   * Is the command drawer open?
   *
   * Closed — which is every frame of every run — only `restart` and `menu` are
   * on the glass. Open, the other four appear ABOVE them and still inside the
   * bottom gutter wherever there is room for them there, so even the open state
   * mostly stays out of the band the bike is in.
   */
  menu?: boolean;
  /**
   * Is the wide view of the whole level up right now?
   *
   * A TOGGLE, NOT A HOLD, and that is the one place this pad deliberately
   * differs from the TAB it replaces. On a desktop you hold TAB and read the
   * level with both hands free; on a phone a hold would pin a thumb to the
   * bottom of the glass for as long as you are trying to look at what is on it.
   * So it latches, the pad says which state it is in, and everything else on
   * the overlay drops out of it — see `down`.
   */
  overview?: boolean;
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
 * THE BOTTOM IS FOR HANDS AND THE MIDDLE IS FOR THE GAME, and every placement
 * below is that sentence.
 *
 *   The two HOLD clusters are hard against the bottom corners, because that is
 *   where thumbs rest in landscape and the ends of the arc they sweep are the
 *   hardest places to reach, not the easiest.
 *   FLIP is above the right cluster, across a dead strip.
 *   The COMMANDS are in the BOTTOM GUTTER — the strip of glass between the two
 *   clusters, which is the one part of the screen no thumb rests on and no bike
 *   rides through. That is where the previous layout went wrong: it put five
 *   command pads in a block at the top-left, which on a short landscape phone
 *   fell back to ONE ROW spanning half the width, straight across the band the
 *   bike is framed in. One row was worse than two, and two was worse than none.
 *
 * Everything is placed from the mm table above, then ONE SCALE FACTOR is applied
 * if the screen cannot hold it at full size. Scaling rather than reflowing is
 * deliberate: the positions are what a player learns, and a layout that
 * rearranges itself between portrait and landscape is two layouts to learn.
 * Portrait is the hard case — a 360 px-wide phone is 60 mm across and the two
 * clusters plus their gap want 76 — so it shrinks, and `MIN_PAD_MM` is the line
 * below which it is honest to say the screen is too small rather than to keep
 * shrinking.
 *
 * THE GUTTER IS THE ONE THING THAT REFLOWS, and it has to: in portrait the
 * clusters already fill the width and there is no gutter to be in. There the
 * commands fall back to a narrow column at the top-left, which portrait can
 * afford because the scarce dimension there is width and not height.
 */
export function touchZones(vp: Viewport, o: LayoutOpts): Zone[] {
  const mm = pxPerMmFor(vp);
  const grip = gripFor(vp);
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
  const leanW = px(MM.leanW * s);
  const leanH = px(MM.leanH * s);

  const zones: Zone[] = [];

  // --- where the hands are, which is the only thing that differs -----------
  //
  // CORNER GRIP (a phone): the clusters are hard against the bottom corners,
  // because that is where the thumbs already are and the ends of the arc they
  // sweep are the hardest places to reach, not the easiest.
  //
  // EDGE GRIP (a tablet): the hands are on the two SIDE edges, and the thumbs
  // come forward onto the glass from there. They are still hard against the
  // left and right edges — that has not changed and must not, it is the one
  // thing both grips agree on — but they are LIFTED OFF THE BOTTOM to the grip
  // line, because the bottom corners of a 13" iPad are 263 mm apart and no
  // hand that is holding the thing is anywhere near them.
  //
  // THE GRIP LINE IS `GRIP_Y` OF THE WAY DOWN THE EDGE — see the constant for
  // why that is a fraction in a file of millimetres, and why it is 0.6.
  //
  // The cluster HANGS BELOW the line rather than straddling it: reaching onto
  // the glass, the thumb tip lands below the web of the hand, and it sweeps
  // down and inboard far more comfortably than up. It also keeps the pads out
  // of the horizontal band the bike is framed in, which is dead centre.
  const rightW = gasW + brakeW;
  const rightX = right0 - rightW;
  const gripY = grip === 'edge' ? top0 + (bottom0 - top0) * GRIP_Y : bottom0 - Math.max(leanH, gasH);
  const leanTop = grip === 'edge' ? gripY : bottom0 - leanH;
  const rowY = grip === 'edge' ? gripY : bottom0 - gasH;

  // --- flip, above the right cluster, across a dead strip ------------------
  //
  // The dead strip is `MM.flipGap` of nothing: a thumb drifting up off a held
  // throttle must not arrive in flip, because that fires a direction change in
  // mid-air and loses the run.
  let flipH = px(MM.flipH * s);
  // AND IT NEVER SCALES BELOW A THUMB. `s` is usually decided by the WIDTH — a
  // portrait phone cannot hold both clusters side by side — and shrinking the
  // one rare, critical control below the comfortable minimum to solve a width
  // problem is paying in the wrong currency. It grows back to `MIN_PAD_MM` only
  // as far as the room between the HUD band and the dead strip allows.
  const flipRoom = rowY - px(MM.flipGap * s) - top0;
  if (flipH < px(MIN_PAD_MM) && flipRoom > flipH) flipH = Math.min(px(MIN_PAD_MM), flipRoom);

  // --- the commands ---------------------------------------------------------
  //
  // RESTART AND OVERVIEW ARE ALWAYS THERE AND THE OTHER FOUR ARE BEHIND `MENU`.
  // The test for permanent glass is "is it pressed DURING a run": restart is
  // (die-and-retry, no R key), overview is (route planning is the game, and
  // there is no TAB key), and levels, full screen, gas-mode and zoom-reset are
  // not. `overview` is at the far end rather than beside `restart` so that the
  // one pad you reach for mid-run is not tiled against the one that ends the
  // run — `more` is the harmless thing to mis-press between them.
  const cmdRow: Array<[ZoneId, string]> = [
    ['restart', 'restart'],
    ['menu', o.menu ? 'close' : 'more'],
    ['overview', o.overview ? 'ride' : 'overview'],
  ];
  const drawer: Array<[ZoneId, string]> = [];
  if (o.menu) {
    drawer.push(['levels', 'levels']);
    // THE CUSTOMISER, WHICH HAD NO TOUCH PATH AT ALL UNTIL THIS PAD.
    //
    // It was bound to `Y` and to a button on the leaderboard panel, and
    // `body.touch #board { display: none }` hides that panel — so on the one
    // device a kid actually opens the link on there was NO WAY to change your
    // paint, your helmet or the engine. Not a hard way: none. A game that ships
    // four exhaust notes and cannot be reached by a thumb has shipped nothing,
    // and since the name lives on that same screen there was no way to stop
    // being anonymous either once the board went.
    //
    // In the drawer and not on permanent glass, by the same test as everything
    // else here: nobody presses `your bike` during a run. It sits beside
    // `levels` because the two are the same kind of question — what am I
    // riding, and what am I riding it as.
    drawer.push(['look', 'your bike']);
    if (o.fullscreen === 'off') drawer.push(['full', 'full screen']);
    else if (o.fullscreen === 'on') drawer.push(['full', 'exit full']);
    drawer.push(['auto', o.autoThrottle ? 'gas: auto' : 'gas: held']);
    drawer.push(['zoom', zoomLabel(o.bias ?? 1)]);
    // THE CONTROL LEGEND, WHICH A PHONE NEEDS MORE THAN A DESKTOP DOES. There
    // is no keyboard to fumble into the flip with here, and flip is the whole
    // double-back design — so the one screen that teaches it has to be
    // reachable. It is in the drawer rather than on permanent glass because it
    // fails the only test that earns permanent glass: nobody presses it during
    // a run.
    drawer.push(['help', 'controls']);
  }

  const cmdW = px(MM.cmdW * s);
  const cmdH = px(MM.cmdH * s);
  const cmdGap = px(MM.gap * s);
  const rowW = (n: number): number => n * cmdW + (n - 1) * cmdGap;
  const fits = (room: number): number => Math.floor((room + cmdGap) / (cmdW + cmdGap));

  // THE GUTTER: what is left of the bottom edge once both clusters have taken
  // their corners, less a clear margin from each so that a press on the inboard
  // edge of a lean pad cannot land on `restart` instead.
  const gutL = left0 + 2 * leanW + px(MM.cmdMargin * s);
  const gutR = rightX - px(MM.cmdMargin * s);
  const gutW = gutR - gutL;

  /**
   * Lay a list of rows out as a block, top row first, ending at `endY`.
   *
   * `mid` centres each row on it; `x0Fixed` overrides that and starts every row
   * at the same x. THE EDGE GRIP WANTS THE SECOND ONE: its block hangs off the
   * left edge because that is where the hand is, so the edge is the datum and a
   * short last row centred under a full one reads as a mistake rather than as a
   * block. Centring is right in a gutter, where the gutter is the datum.
   */
  const block = (
    rows: Array<Array<[ZoneId, string]>>, endY: number, mid: number, x0Fixed?: number, w = cmdW,
  ): void => {
    const n = rows.length;
    const rw = (k: number): number => k * w + (k - 1) * cmdGap;
    for (let r = 0; r < n; r++) {
      const row = rows[r];
      const y = endY - (n - r) * cmdH - (n - 1 - r) * cmdGap;
      const x0 = x0Fixed ?? mid - rw(row.length) / 2;
      for (let i = 0; i < row.length; i++) {
        zones.push({
          id: row[i][0],
          x: x0 + i * (w + cmdGap),
          y,
          w,
          h: cmdH,
          label: row[i][1],
          command: true,
        });
      }
    }
  };

  /**
   * How wide the drawer's pads have to be to make it ONE ROW in `room` px, or 0
   * when that would take them below the floor.
   *
   * ONE ROW IS THE WHOLE POINT. A second row of commands is not a slightly
   * taller menu, it is a menu that has left the cheap glass it was placed in —
   * the gutter on a wide phone, the strip above the clusters on a narrow one —
   * and climbed into either the HUD band or the band the bike rides through.
   * Shrinking a between-runs pad by a millimetre and a half is a far smaller
   * price than that, and `MM.cmdMin` is where shrinking stops being a price
   * worth paying at all.
   */
  const oneRowW = (n: number, room: number): number => {
    if (n <= 0) return cmdW;
    const w = Math.min(cmdW, (room - (n - 1) * cmdGap) / n);
    return w >= px(MM.cmdMin * s) ? w : 0;
  };

  const chunk = (list: Array<[ZoneId, string]>, cols: number): Array<Array<[ZoneId, string]>> => {
    const out: Array<Array<[ZoneId, string]>> = [];
    for (let i = 0; i < list.length; i += cols) out.push(list.slice(i, i + cols));
    return out;
  };

  if (grip === 'edge') {
    // UNDER THE LEFT HAND, AND THAT IS THE WHOLE TABLET COMMAND DECISION.
    //
    // The gutter answer does not survive the slab. On a 13" iPad the strip
    // between the two clusters is 900 px wide and its centre — where the phone
    // puts `restart / more / overview` — is 130 mm from either hand: not a
    // reach, a regrip. It is also the horizontal centre of the screen, which is
    // exactly where the bike is framed and where the level's floor runs, and
    // the before-shot of the chimney has the command row sitting on that floor
    // beside an apple. Cheap glass on a phone is the most expensive glass on a
    // tablet, because the same strip is now the middle of the picture.
    //
    // So they hang off the LEFT cluster, against the edge the left hand is
    // already holding, one `cmdMargin` below it. The left thumb drops onto them
    // without letting go of anything and — the part that matters during a run —
    // THE RIGHT THUMB NEVER LEAVES THE GAS to press `overview`.
    //
    // Left-aligned rather than centred under the cluster: the hand is at the
    // edge, so the edge is the datum.
    const cmdTop = leanTop + leanH + px(MM.cmdMargin * s);
    block([cmdRow], cmdTop + cmdH, 0, left0);
    if (drawer.length) {
      // THE DRAWER OPENS DOWNWARD, into the band of clear glass the lifted
      // clusters left behind. Upward is the lean pads and there is nothing to
      // be gained by fighting them for the room; downward is empty, out of the
      // play band, and a state that the next touch anywhere shuts.
      //
      // Three columns so it is a block under the hand rather than a row running
      // out across the screen towards the other one.
      const cols = clamp(fits(rightX - px(MM.cmdMargin * s) - left0), 1, Math.min(3, drawer.length));
      const rows = chunk(drawer, cols);
      const end = cmdTop + cmdH + cmdGap + rows.length * cmdH + (rows.length - 1) * cmdGap;
      block(rows, end, 0, left0);
    }
  } else if (gutW >= rowW(cmdRow.length)) {
    const gutterW = oneRowW(drawer.length, gutW);
    if (!drawer.length || gutterW > 0) {
      // IN THE GUTTER, AT THE VERY BOTTOM, and the drawer opens into it too.
      // On a landscape phone the gutter is 70-odd millimetres of glass that no
      // thumb rests on and the bike is never framed in, which makes it the
      // cheapest screen in the game — so even the open state costs nothing.
      //
      // ONE ROW, NARROWER IF IT HAS TO BE. Six pads at full width want four
      // more pixels than the 915 x 348 phone's gutter has; wrapping them to a
      // second row would climb straight out of the gutter and into the band
      // the bike is framed in, to save a millimetre and a half on a pad nobody
      // presses during a run. See `oneRowW`.
      block([cmdRow], bottom0, (gutL + gutR) / 2);
      if (drawer.length) {
        block([drawer], bottom0 - cmdH - cmdGap, (gutL + gutR) / 2, undefined, gutterW);
      }
    } else {
      // A NARROW GUTTER STACKS, AND A STACK IS THE THING THIS REWRITE IS
      // REMOVING. Rather than pile three rows up through the play band, the
      // drawer opens as one wide row ABOVE both clusters, where the only thing
      // it has to stay clear of is flip's column. It is a transient state — the
      // next touch anywhere shuts it — so a wide row there costs one press of
      // the level and a stack would cost the whole open state.
      block([cmdRow], bottom0, (gutL + gutR) / 2);
      const wideR = rightX - px(MM.cmdMargin * s);
      const wideRoom = wideR - left0;
      // ONE ROW IF IT CAN BE HAD AT ALL, for the reason on `oneRowW` and for a
      // second one specific to this branch: this row hangs off the BOTTOM of
      // the strip above the clusters, so every extra row grows UPWARDS into the
      // in-canvas HUD — and "nothing is ever above the HUD band" is a rule this
      // file keeps exactly rather than nearly. Six pads at full width on a
      // 736 x 280 phone put the top row at y = 43 against a band that ends at
      // 52, which is a picture of two HUDs on top of each other.
      const wideW = oneRowW(drawer.length, wideRoom);
      if (wideW > 0) {
        block([drawer], leanTop - px(MM.gap * s), (left0 + wideR) / 2, undefined, wideW);
      } else {
        const wideCols = clamp(fits(wideRoom), 1, drawer.length);
        block(chunk(drawer, wideCols), leanTop - px(MM.gap * s), (left0 + wideR) / 2);
      }
    }
  } else {
    // NO GUTTER — portrait, where the clusters already fill the width. Top-left,
    // below the HUD band, as narrow a grid as the height allows: in portrait the
    // scarce dimension is width and there is plenty of room above the pads.
    const all = [...cmdRow, ...drawer];
    const maxRows = Math.max(1, fits(leanTop - px(MM.gap * s) - top0));
    const maxCols = Math.max(1, fits(right0 - left0));
    // THREE DEEP AT MOST, so an open drawer is a block rather than a ladder down
    // the side of the screen. Row-major from the top-left either way, which
    // leaves `restart` in the corner it was in while the drawer was shut.
    const cols = clamp(
      Math.max(Math.ceil(all.length / maxRows), Math.ceil(all.length / 3)),
      1,
      maxCols,
    );
    const rows = chunk(all, cols);
    block(rows, top0 + rows.length * cmdH + (rows.length - 1) * cmdGap, left0 + rowW(cols) / 2);
  }

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
 *
 * AND A PAD THAT IS NOT AGAINST THE BOTTOM MAKES NO BOTTOM BAND. This is the
 * tablet case and it is the reason the test below exists rather than the bare
 * minimum. Under the edge grip the clusters are lifted to the middle of the
 * side edges, so the bottom of a tablet's glass is CLEAR — the hands are two
 * strips at the far left and right of a screen whose middle the bike is framed
 * in, and they cannot reach it. `vpH - min(z.y)` would have answered 450 px on
 * a 13" iPad, which the camera would have read as "the bottom half of the
 * screen is under a hand" and used to shove the bike up under the HUD to dodge
 * a hand that is not there. Nothing is measured off the pads that the pads do
 * not actually claim.
 *
 * The test is scale-free rather than a tolerance: a pad is against the bottom
 * if the glass left below it is less than the pad's own height. On a phone
 * that gap is the 3.5 mm edge margin plus at most a home indicator, against a
 * 15 mm pad; on a tablet it is 40 mm against the same 15.
 */
export function thumbInsetPx(zones: readonly Zone[], vpH: number): number {
  let top = vpH;
  for (const z of zones) {
    if (z.id === 'flip' || z.command) continue;
    if (vpH - (z.y + z.h) > z.h) continue;
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
  /**
   * The wide view of the whole level went on, or came off.
   *
   * THE PAD DOES NOT OWN THE STATE. main.ts does — the same `overview.hold()`
   * TAB drives, so there is exactly one freeze and one state machine rather
   * than a second one that has to be kept in step with it. This says which way
   * the press went and `setOverview` says what happened, which is the same
   * shape as the zoom: the gesture asks and the owner decides.
   */
  onOverview(on: boolean): void;
  /**
   * The control legend. `main.ts` owns it — the same panel the `?` key opens on
   * a desktop — because there must be exactly one of it and one place that
   * decides whether the pads are hidden underneath it.
   */
  onHelp(): void;
  /**
   * The customiser, which is also the profile screen — the same panel `Y` opens
   * on a desktop, and the ONLY way to it on a phone.
   *
   * `main.ts` owns it for the same reason it owns the legend: there must be
   * exactly one of it, one place that decides whether the pads are hidden under
   * it, and one sim hold.
   */
  onLook(): void;
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
   * Whether the whole-level view is up, as main.ts sees it. The pad prints it,
   * and every other pad on the glass drops out of it.
   *
   * It is pushed in rather than latched here because TAB, the opening peek and
   * a level change can all move it without a finger being involved, and a pad
   * that disagreed with the frozen sim would be the worst kind of wrong.
   */
  setOverview(on: boolean): void;
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
  /**
   * Is the command drawer open? CLOSED IS THE ONLY STATE A RUN IS EVER IN — it
   * closes on the first hold pad pressed, on restart, on any item in it, and on
   * the overlay going away — so the four occasional commands cost nothing but
   * the `more` pad for all the time anybody is actually riding.
   */
  let menuOpen = false;
  /**
   * Is the whole-level view up? MIRRORED FROM main.ts, never owned here — see
   * `setOverview`. It is in this file only so that the pad can print which way
   * it goes and so that `down` knows a press on anything else has to cancel it.
   */
  let overviewOn = false;
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

  /**
   * THE SCREEN, AND THE PART OF IT THAT IS ACTUALLY VISIBLE.
   *
   * `#touch` is `position: fixed; inset: 0`, so its rect is the LAYOUT viewport
   * — and on a phone that is not always the glass you can see. Browser chrome
   * appearing, a software keyboard and the page being pinch-zoomed all move the
   * VISUAL viewport inside the layout one, and a pad placed against the layout
   * viewport then sits somewhere the hand is not: either below the fold or, if
   * the layout box is the short one, with a band of unreachable screen under it.
   * "The pads are not at the bottom and there is an empty band below them" is
   * exactly what that looks like from a hand.
   *
   * `visualViewport` is the browser's own answer and it folds into the existing
   * safe-area insets without the layout having to learn a second concept: the
   * part of the fixed overlay outside the visible rect is, for every purpose
   * this file has, an inset. Zero on a desktop, zero in the shot harness, and
   * `place` is already bound to `visualViewport.resize`.
   */
  function viewport(): Viewport {
    const r = root.getBoundingClientRect();
    const safe = insets();
    const vv = window.visualViewport;
    if (!vv || !(r.width > 0) || !(r.height > 0)) return { w: r.width, h: r.height, ...safe };
    const top = clamp(vv.offsetTop, 0, r.height);
    const left = clamp(vv.offsetLeft, 0, r.width);
    return {
      w: r.width,
      h: r.height,
      top: Math.max(safe.top, top),
      left: Math.max(safe.left, left),
      right: Math.max(safe.right, clamp(r.width - (left + vv.width), 0, r.width)),
      bottom: Math.max(safe.bottom, clamp(r.height - (top + vv.height), 0, r.height)),
    };
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
    zones = touchZones(vp, {
      autoThrottle, bias: zoomBias, fullscreen: fullState(), menu: menuOpen, overview: overviewOn,
    });
    // WHICH ZONES EXIST IS STATE, AND IT IS EXPRESSED BY HIDING RATHER THAN BY
    // BUILDING. Opening the drawer and flipping auto-throttle both change the
    // set; recreating elements for either would drop the pointer capture on a
    // held pad and leave the throttle welded on with nothing to release it.
    const live = new Set(zones.map((z) => z.id));
    for (const [id, el] of els) if (!live.has(id)) el.style.display = 'none';
    els.get('menu')?.classList.toggle('open', menuOpen);
    els.get('overview')?.classList.toggle('open', overviewOn);
    for (const z of zones) {
      const el = els.get(z.id);
      if (!el) continue;
      el.style.display = '';
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

  /**
   * Create the elements. ONCE, for every zone that could ever exist.
   *
   * It used to build only the zones the current state has and rebuild when that
   * changed, which is the shape of the worst bug a touch control can have: a
   * rebuild with a thumb down on the gas drops the pointer capture, the release
   * arrives at an element that is no longer in the document, and the throttle is
   * held forever. Now the set is fixed, `place` hides what this state does not
   * use, and nothing in a relayout or a mode switch touches the DOM's identity.
   */
  function build(): void {
    root.textContent = '';
    els.clear();
    const cmd = new Set(COMMAND_IDS);
    for (const id of ALL_ZONE_IDS) {
      const el = document.createElement('div');
      el.className = `tc-zone tc-${id}${cmd.has(id) ? ' tc-cmd' : ''}`;
      el.style.display = 'none';
      el.append(document.createElement('span'));
      root.append(el);
      els.set(id, el);
    }
    place();
    paint();
  }

  /** Shut the drawer, if it is open. Returns whether anything moved. */
  function closeMenu(): boolean {
    if (!menuOpen) return false;
    menuOpen = false;
    place();
    return true;
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

  /**
   * Did the press that just happened land on a pad? Read by `touchStart`, which
   * runs immediately after `down` for the same finger and needs an answer that
   * is only true at that moment.
   */
  let padTouch = false;

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
    // And the touchstart that is about to follow this pointerdown gets
    // cancelled too — see `touchStart` for the level it picked by itself.
    padTouch = true;
    // EVERY OTHER PAD ON THE GLASS DROPS OUT OF THE OVERVIEW, and that is what
    // makes the way back unambiguous. The pad itself says `ride`; so does a
    // thumb on the gas, on lean, on flip, on restart, on the drawer — because
    // every one of those is somebody who has finished looking. Above the
    // command branch so it covers the hold pads too, and skipped for `overview`
    // itself, which toggles.
    if (overviewOn && id !== 'overview') cb.onOverview(false);
    if (z.command) {
      // THE DRAWER IS A TOGGLE AND EVERYTHING ELSE SHUTS IT. A command you have
      // just given is a command you are finished with, and leaving four extra
      // pads on the glass afterwards would be the layout this rewrite removes.
      if (id === 'menu') {
        menuOpen = !menuOpen;
        place();
        return;
      }
      // THE WHOLE LEVEL, AND IT IS A TOGGLE. TAB is a hold on a desktop because
      // both hands are free there; a hold here would pin a thumb to the bottom
      // of the glass for exactly as long as you were trying to read what is on
      // it. main.ts owns the state and the freeze — this only asks.
      if (id === 'overview') {
        closeMenu();
        cb.onOverview(!overviewOn);
        return;
      }
      closeMenu();
      if (id === 'restart') cb.onRestart();
      else if (id === 'levels') cb.onBrowse();
      else if (id === 'look') cb.onLook();
      else if (id === 'help') cb.onHelp();
      else if (id === 'full') toggleFullscreen();
      else if (id === 'auto') cb.onAutoThrottle(!autoThrottle);
      else if (id === 'zoom') {
        cb.onZoom(1);
        cb.onZoomEnd?.();
      }
      return;
    }
    // A HOLD PAD IS THE START OF A RUN, so the drawer goes. It is shut before
    // the capture below rather than after: `place` moves elements, and the one
    // this press landed on must already be where it is going to stay.
    closeMenu();
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
    // A TAP ON THE LEVEL MEANS RIDE. The other half of the rule in `down`: with
    // the pads covered there, this covers everywhere else, so "touch anything at
    // all" is the way out of the wide view and there is no gesture to learn.
    if (overviewOn) cb.onOverview(false);
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
  /**
   * THE GHOST CLICK, and it is not hypothetical — it picked a level.
   *
   * A touch that ends generates a synthesised `click` at the point the finger
   * lifted, aimed at whatever is under that point AT THAT MOMENT. `levels`
   * opens the chooser on the press, so by the time the finger comes up there is
   * a grid of level cards under it — and the phantom click lands on one and
   * rides it. Pressing "levels" and being dropped into a level you did not
   * choose is exactly the kind of silent wrong input this whole file is built
   * to avoid, and moving the commands to the bottom gutter is what put the pad
   * over the cards rather than over the chooser's title bar.
   *
   * `preventDefault` on POINTERDOWN does not stop it: per spec that suppresses
   * the compatibility MOUSE events, and the click synthesised from a touch
   * sequence is suppressed by cancelling the TOUCHSTART. So this listener
   * exists for one line, and it is deliberately narrow — only a touch that
   * landed on a pad is cancelled, because a touch in the play area is half of a
   * pinch and none of our business.
   *
   * IT ASKS `down` RATHER THAN RE-TESTING THE COORDINATES, and that is not
   * tidiness. Chrome fires `pointerdown` and then `touchstart` for the same
   * finger, so by the time this runs the press has already been acted on — and
   * `levels` has already hidden the overlay. Re-testing here would either miss
   * the case that matters or, worse, cancel a tap meant for the results screen
   * underneath the inert pads. `down` knows the answer at the only moment it is
   * true, so it leaves it here.
   */
  const touchStart = (e: TouchEvent): void => {
    if (!padTouch) return;
    padTouch = false;
    e.preventDefault();
  };
  root.addEventListener('touchstart', touchStart, { passive: false });
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
      // RE-PLACED, NOT REBUILT — the gas pad is hidden rather than deleted, so
      // switching modes with a finger down cannot strand a pointer capture on an
      // element that has left the document.
      menuOpen = false;
      place();
      paint();
    },
    setHidden(on: boolean): void {
      hidden = on;
      root.classList.toggle('tc-away', on);
      if (on) {
        clearAll();
        // The results screen and the chooser are underneath these. A drawer
        // left open would come back on top of whatever the player did next.
        closeMenu();
      }
    },
    thumbInset: () => (enabled ? thumbInsetPx(zones, root.getBoundingClientRect().height) : 0),
    layout: place,
    setOverview(on: boolean): void {
      if (overviewOn === on) return;
      overviewOn = on;
      // RE-PLACED, NOT REBUILT, like every other state change here: the label
      // flips between `overview` and `ride`, and an element that was recreated
      // under a held thumb would strand its pointer capture.
      place();
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
      root.removeEventListener('touchstart', touchStart);
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
