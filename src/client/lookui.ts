// The customiser, as elements — and it is also the profile screen.
//
// SAME CHROME AS EVERYTHING ELSE. The board, the results panel and the level
// chooser are the same drab surface with the same borders, because the
// readability rule says the highest-contrast things on screen are the bike and
// the collision edge — including when a menu is over them. This is one more of
// those, not a new app.
//
// Everything it DECIDES lives in `src/shared/appearance.ts` and
// `art/bikeart.ts`, both of which are tested in plain node; this file only turns
// the catalogue into nodes and owns the keyboard while it is open. Same split
// chooserui.ts and boardui.ts make, same reason — there is no jsdom here.
//
// THE CUSTOMISER IS THE PROFILE SCREEN, AND THAT IS THE WHOLE DESIGN.
//
// The thing this screen replaced was a FORM BEFORE THE FIRST RIDE, and a form
// is the worst thing to put in front of somebody who has just clicked a link.
// It converts to "asdf" typed to make it go away — which is worse than
// anonymous, because it is permanent and it is on a board other people read.
// "Build your rider" is a toy: a bike, paint, a helmet, a jacket, a scarf, a
// decal and an engine. The name is ONE FIELD INSIDE SOMETHING FUN rather than a
// tollbooth in front of it, and nothing on this screen is ever in the way of
// riding: `mode: 'intro'` puts a single `ride` button on it and the ✕ does the
// same thing.
//
// THE INCENTIVE IS "KEEP IT AND BE SEEN IN IT", NEVER "UNLOCK IT". Not one
// cosmetic is gated behind naming yourself, and none ever may be: this would be
// the first thing in this game that withheld something, and it is not needed,
// because the honest version is stronger AND true —
//
//   * Anonymous, a rider lives in ONE browser's localStorage. It dies when site
//     data is cleared and NOBODY ELSE EVER SEES IT. A costume nobody sees.
//   * Named, it follows you to your phone through the claim code, it sits next
//     to your time on the board, and YOUR GHOST WEARS IT ON SOMEBODY ELSE'S
//     SCREEN — appearance already travels with every replay.
//
// So `lk-seen` SHOWS that rather than explaining it: the leaderboard row and the
// ghost the other player would see are drawn right there, from the real board
// row renderer and the real bike renderer. A screen that sells itself needs no
// copy arguing why you should bother, and the two lines of copy it does have say
// what is true rather than what would be persuasive.
//
// NO ACCOUNTS, AND THIS IS A HARD LINE. No email, no password, no reset flow.
// Identity already exists — a `playerId` in localStorage, a claim code, a QR —
// see identity.ts and claimui.ts. This is a DISPLAY NAME plus that existing id
// and nothing more. Collecting an email or a password from a child is what turns
// a play session into a compliance question, and it buys nothing the claim code
// does not already deliver. The genuine weakness — clearing site data loses an
// unclaimed identity — is a NUDGE-TO-CLAIM problem, so the nudge is here, next
// to the name, where somebody has just decided they care about keeping it.
//
// TWO THINGS THE PANEL HAS TO SAY, because both are things a player will
// otherwise assume the other way round:
//
//   1. NONE OF THIS CHANGES HOW THE BIKE RIDES. Six silhouettes, one set of
//      physics, one specHash. A bobber looks heavy and handles exactly like the
//      scrambler, and that is deliberate rather than unfinished.
//   2. NONE OF THIS CAN REFUSE YOUR TIMES. The thing that has confused this user
//      twice is the tuning panel's bike being refused by the leaderboard, and a
//      colour picker that looked like it might do the same would be worse than
//      no colour picker.
//
// THE ENGINE ROW IS THE ONE THING ON THIS PANEL THAT THE PREVIEW CANNOT SHOW,
// which is why picking one revs it (`onPick` in main.ts calls `audio.blip()`).
// A customiser that shows you five things and takes the sixth on trust is a
// customiser people stop trusting about the other five.
//
// The PREVIEW is the real renderer at a small scale on the CURRENT LEVEL'S
// palette, so what it shows is what the bike will look like where it is about
// to be ridden — which matters, because a livery is solved against the level's
// own palette and the same paint is a different set of pixels on a different
// level.
//
// NAMES ARE TEXT AND TEXT IS ALLOWED TO CONTAIN ANGLE BRACKETS. Every string
// that came from a person reaches the document through `textContent` or through
// an input's `value`, never through `innerHTML` — the rule boardui.ts keeps, for
// the reason main.ts's `esc` exists: `cleanName` is hygiene and not
// sanitisation, and a stored XSS through a display name was closed in this
// client today. There is no markup sink in this file and there must never be one.
import { cloneSpec } from '@/sim/spec.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import { APPEARANCE_AXES, appearanceLabel } from '@/shared/appearance.ts';
import type { Appearance, AppearanceKey } from '@/shared/appearance.ts';
import { drawBikePortrait, portraitExtent } from './artrender.ts';
import { makeLook } from './art/bikeart.ts';
import type { Palette } from './art/palette.ts';
import { BOOT_PRESET } from './presets.ts';
import { avatarImg } from './avatar.ts';
import { ticksToSeconds } from '@/sim/replay.ts';

/**
 * WHAT THIS SCREEN IS BEING ASKED TO BE, which is three things and not three
 * screens.
 *
 *   `plain`  — you opened it. Y, the board's button, or the `your bike` pad.
 *   `intro`  — the first load, before anybody has ridden anything. Offered, and
 *              one tap gets out of it.
 *   `finish` — the first finish by somebody who skipped the intro. There is now
 *              a TIME to attach a name to, which is where the motivation
 *              actually is, and the row it would sit on is on screen.
 *
 * One panel rather than three, because the thing being offered is identical in
 * all three and a separate "sign up" screen is exactly the tollbooth this
 * design exists to avoid. The mode changes the title, the copy and which button
 * is the primary one. It never changes what you can do.
 */
export type LookMode = 'plain' | 'intro' | 'finish';

export interface LookUiCallbacks {
  onPick(key: AppearanceKey, id: string): void;
  onRandom(): void;
  onReset(): void;
  onClose(): void;
  /**
   * A display name was committed. The caller cleans and stores it — `cleanName`
   * lives in identity.ts beside the id, because the two are stored together and
   * one copy of the rules is how the client and the server stay in step.
   */
  onName(name: string): void;
  /**
   * "just ride", "not now", and the ✕ in every mode. NOBODY IS EVER BLOCKED
   * FROM RIDING, so this is one tap and it asks nothing.
   */
  onSkip(): void;
  /** The QR that makes another device the same player. The nudge-to-claim. */
  onLinkDevice(): void;
  /**
   * Sound on or off. The SAME function `M` calls, so there is one mute.
   *
   * IT IS HERE BECAUSE A PHONE HAD NO MUTE AT ALL. `setMuted` had exactly two
   * callers and both were the keyboard, which meant the game shipped four
   * engine notes as a customisation axis and gave the device most likely to be
   * used in a room with other people in it no way to turn any of them off. (A
   * phone has hardware volume keys; iOS Safari's ringer switch does not mute
   * WebAudio, so "flick the switch" is not reliably an answer either.)
   *
   * AND IT IS ON THIS PANEL RATHER THAN ON A PAD, which is the part worth
   * arguing. The drawer has room for exactly one more thing and this is not
   * what it should be spent on: this screen already owns `engine`, so it is
   * where somebody who cares about the noise already is, and a row here costs
   * no glass at all — permanent or otherwise.
   */
  onMute(muted: boolean): void;
}

export interface LookUiModel {
  appearance: Appearance;
  /** The palette of the level being played, so the preview is honest. */
  palette: Palette;
  playerId: string;
  levelName: string;
  mode: LookMode;
  /** The stored display name. Empty means anonymous, which is a legal state. */
  name: string;
  /**
   * Where this player stands, for the row in `lk-seen`.
   *
   * REAL NUMBERS OR NONE. `timeTicks` is the run that just finished in `finish`
   * mode and this browser's local best otherwise; `rank` comes off the human
   * board when there is one. A mocked-up rank and an invented time would make
   * the one part of this screen that is a PROMISE into a lie, so both are
   * nullable and the row prints a placeholder instead.
   */
  standing: { rank: number | null; total: number; timeTicks: number | null };
  /** True on a phone or tablet: no keyboard hints, and the buttons are thumbed. */
  touch: boolean;
  /**
   * Is the sound off? A DEVICE SETTING, not an appearance — see the row it
   * draws, which says so, and `onMute`, which says why it is on this panel.
   */
  muted: boolean;
}

export interface LookUi {
  show(m: LookUiModel): void;
  hide(): void;
  readonly visible: boolean;
}

/** The preview is drawn on the SHIPPED bike, like every other portrait in the game. */
const SPEC: BikeSpec = cloneSpec(BOOT_PRESET.spec);

const PREVIEW_W = 300;
const PREVIEW_H = 150;

/**
 * The preview, at a size this screen actually has.
 *
 * A landscape phone is 348 CSS px tall and the panel has to hold a bike, a
 * name, a leaderboard row and seven rows of chips in it. 150 px of preview is
 * nearly half the glass, and what gets pushed off the bottom is the board row —
 * which is the one thing on this screen that is an argument rather than a
 * control. So the picture gives up the height it does not need.
 *
 * In JS rather than in CSS because a canvas carries an INLINE width and height
 * (its backing store is pixels, so it has to), and an inline style beats a
 * stylesheet rule — a media query here would be a rule that silently never
 * applied, which is the class of bug this project has now shipped twice by
 * trusting arithmetic over a screenshot.
 */
function previewSize(): { w: number; h: number } {
  const h = typeof window === 'undefined' ? 0 : window.innerHeight;
  if (h > 0 && h < 460) return { w: 216, h: 108 };
  return { w: PREVIEW_W, h: PREVIEW_H };
}

/**
 * The ghost card's canvas, in CSS px.
 *
 * Small on purpose: it is a picture of what somebody ELSE sees out of the
 * corner of their eye while they are racing, and blown up to the size of the
 * preview it would read as a second customiser rather than as the point.
 */
const GHOST_W = 132;
const GHOST_H = 72;

/**
 * The ghost card, at a size this screen has.
 *
 * Same argument as `previewSize` and the same screenshot: at 348 px tall every
 * pixel above the option chips is a pixel the toy does not get, and this is a
 * picture of what somebody else sees out of the corner of their eye — it makes
 * its point at 56 px as well as at 72.
 */
function ghostSize(): { w: number; h: number } {
  const h = typeof window === 'undefined' ? 0 : window.innerHeight;
  if (h > 0 && h < 460) return { w: 104, h: 56 };
  return { w: GHOST_W, h: GHOST_H };
}

/**
 * What a ghost is drawn at, and it is `artrender.ts`'s number rather than a
 * tasteful one picked here — `renderArt` draws the leaderboard ghost at 0.3, so
 * a preview at any other alpha would be a picture of a ghost this game does not
 * have.
 */
const GHOST_ALPHA = 0.3;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmtTime(ticks: number): string {
  return `${ticksToSeconds(ticks).toFixed(3)}s`;
}

export function createLookUi(root: HTMLElement, cb: LookUiCallbacks): LookUi {
  root.textContent = '';
  root.classList.add('hidden');
  root.tabIndex = -1;
  let visible = false;
  let model: LookUiModel | null = null;
  /** Which axis the arrow keys are on. */
  let axis = 0;

  const panel = el('div', 'lk-panel');
  root.append(panel);

  /** The bike, standing still, on the room it is about to be ridden in. */
  function paintBike(
    canvas: HTMLCanvasElement, m: LookUiModel, w: number, h: number, alpha: number,
  ): void {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const P = m.palette;
    // The room the bike will be ridden in, so the contrast the floors are
    // solved against is the contrast you are looking at. A preview on a neutral
    // grey would be a preview of a level that does not exist.
    ctx.fillStyle = P.wall[Math.min(2, P.wall.length - 1)];
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const ext = portraitExtent(SPEC);
    const zoom = Math.min(canvas.width / (ext.w * 1.25), canvas.height / (ext.h * 1.25));
    const draw = (target: CanvasRenderingContext2D, ox: number, oy: number): void => {
      target.save();
      target.translate(ox, oy);
      target.scale(zoom, -zoom);
      target.translate(0, -ext.cy);
      drawBikePortrait(target, SPEC, P, makeLook(m.appearance, P, m.playerId), zoom);
      target.restore();
    };
    if (alpha >= 1) {
      draw(ctx, canvas.width / 2, canvas.height / 2);
      return;
    }
    // A GHOST IS A COMPOSITE AND NOT A FAINT DRAWING. `drawBikePortrait` sets
    // its own `globalAlpha` per stroke, so fading it by setting one beforehand
    // does nothing at all; the renderer's own ghost path passes an alpha all the
    // way down. Rather than grow a parameter through three call sites for a
    // picture, the bike is drawn opaque on its own surface and blitted once —
    // which is also what makes it look like the game's ghost instead of a
    // stack of individually translucent parts overlapping each other.
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const octx = off.getContext('2d');
    if (!octx) return;
    draw(octx, off.width / 2, off.height / 2);
    ctx.globalAlpha = alpha;
    ctx.drawImage(off, 0, 0);
    ctx.globalAlpha = 1;
  }

  /**
   * THE PAYOFF, SHOWN RATHER THAN ARGUED.
   *
   * A leaderboard row drawn by the same code the leaderboard draws, and the
   * ghost at the alpha the game actually draws ghosts at. The claim this screen
   * makes is "other people see this", so the honest way to make it is to put
   * the two places they see it on the screen.
   *
   * Anonymous, the same two pictures say the opposite thing — the row has no
   * name on it and the note says plainly that nobody ever sees any of this.
   * That is not a threat and it is not a paywall; it is the difference between
   * the two states, which is the only argument for naming yourself that is both
   * true and worth making.
   */
  function seenBlock(m: LookUiModel): HTMLElement {
    const named = m.name.length > 0;
    const box = el('div', `lk-seen${named ? '' : ' anon'}`);
    box.append(el('div', 'lk-seen-title', 'this is what other people see'));

    const cols = el('div', 'lk-seen-cols');

    const row = el('div', 'lk-seen-row');
    row.append(el('span', 'lk-seen-rank', m.standing.rank !== null ? `#${m.standing.rank}` : '#—'));
    // THE SAME `<img>` THE BOARD PUTS ON A ROW, from the same cache — not a
    // second drawing of the same bike that could drift from it. If the avatar
    // here and the avatar on the leaderboard could ever differ, this block
    // would be a mock-up of the board rather than a picture of it, and the one
    // claim it makes is that it is not.
    row.append(avatarImg(m.appearance, m.palette, m.playerId));
    row.append(
      named
        ? el('span', 'lk-seen-name', m.name)
        : el('span', 'lk-seen-name none', 'no name yet'),
    );
    row.append(
      el('span', 'lk-seen-time', m.standing.timeTicks !== null ? fmtTime(m.standing.timeTicks) : '—'),
    );
    const rowWrap = el('div', 'lk-seen-card');
    rowWrap.append(el('div', 'lk-seen-cap', 'on the leaderboard'));
    rowWrap.append(row);
    cols.append(rowWrap);

    const ghostWrap = el('div', 'lk-seen-card');
    ghostWrap.append(el('div', 'lk-seen-cap', "as a ghost, on their screen"));
    const ghost = el('canvas', 'lk-seen-ghost');
    ghostWrap.append(ghost);
    const gs = ghostSize();
    paintBike(ghost, m, gs.w, gs.h, GHOST_ALPHA);
    cols.append(ghostWrap);
    box.append(cols);

    box.append(
      el(
        'div',
        'lk-seen-note',
        named
          ? 'Your colours travel with every run you post, so that is the ghost racing beside somebody else.'
          : m.touch
            ? 'Unnamed, none of this leaves this browser — and site data gets cleared.'
            : 'Unnamed, none of this leaves this browser — no board row, no ghost on anybody else’s screen, '
              + 'and clearing site data takes the bike with it.',
      ),
    );
    return box;
  }

  /**
   * The name, as one field.
   *
   * IT COMMITS ON ENTER AND ON THE BUTTON and never on every keystroke: a
   * half-typed name reaching the board is how somebody ends up permanently
   * called "hex". Empty is a legal value that means "still anonymous", so the
   * button is not disabled and the field is not required — the only thing that
   * is refused is committing whitespace, which would clear a name somebody has.
   */
  function nameBlock(m: LookUiModel): HTMLElement {
    const form = el('div', 'lk-name');
    form.append(el('label', 'lk-name-label', m.name ? 'your name' : 'pick a name'));
    const input = el('input', 'lk-name-input');
    input.type = 'text';
    input.maxLength = 24;
    input.placeholder = 'your name';
    input.value = m.name;
    // A NAME IS NOT A LOGIN and the browser must not treat it as one: an
    // autofilled email address in a game played by a child is exactly the data
    // this design refuses to hold.
    input.autocomplete = 'off';
    input.spellcheck = false;
    const save = el('button', 'lk-name-save', m.name ? 'rename' : 'save');
    const commit = (): void => {
      if (input.value.trim()) cb.onName(input.value);
    };
    save.addEventListener('click', () => {
      save.blur();
      commit();
    });
    form.append(input, save);
    form.append(
      el(
        'div',
        'lk-name-hint',
        // SHORTER ON A PHONE, AND THE SHORT VERSION KEEPS THE PART THAT MATTERS.
        // The reassurance is "not a login"; the rest is detail that costs two
        // lines, and on a 348 px-tall screen two lines of small grey text is a
        // row of chips that nobody can see. The long version stays where there
        // is room for it.
        m.touch
          ? 'A label, not a login. Rename yourself any time.'
          : 'A label, not a login — no email, no password, nothing to sign in to. Rename yourself whenever '
            + 'you like: your times are keyed to this device, never to the name.',
      ),
    );
    if (m.name) {
      // THE NUDGE, AND IT IS HERE BECAUSE THIS IS WHERE SOMEBODY HAS JUST
      // DECIDED THEY CARE. The one real weakness of an id in localStorage is
      // that clearing site data loses it; the fix that exists is the claim code,
      // not an account, and the moment to offer it is the moment a rider stops
      // being disposable.
      const link = el('button', 'lk-link', 'play as you on your phone too');
      link.title = 'a QR code: scan it and that device becomes this player';
      link.addEventListener('click', () => {
        link.blur();
        cb.onLinkDevice();
      });
      form.append(link);
    }
    return form;
  }

  /**
   * The way out, which every mode has and which is never more than one tap.
   *
   * The PRIMARY action is "go and ride" in all three modes, because it is the
   * right answer in all three: nothing is blocked, nothing is pending, and
   * anything not chosen here can be chosen later from the same screen.
   */
  function actionRow(m: LookUiModel): HTMLElement {
    const acts = el('div', 'lk-go');
    const label = m.mode === 'intro'
      ? 'ride →'
      : m.mode === 'finish'
        ? (m.name ? 'back to the results →' : 'not now, just ride →')
        : 'done →';
    const go = el('button', 'lk-go-btn', label);
    go.addEventListener('click', () => {
      go.blur();
      cb.onSkip();
    });
    acts.append(go);
    return acts;
  }

  /**
   * Sound on / off — the same `setMuted` the `M` key calls, through the caller.
   *
   * See `onMute` for why a device setting is on the customiser at all. The
   * short version: a phone had no mute, the drawer has one slot left and this
   * is not what it is for, and the panel that owns the engine axis is where
   * somebody who cares about the noise already is.
   */
  function soundRow(m: LookUiModel): HTMLElement {
    const row = el('div', 'lk-row lk-row-set');
    const label = el('div', 'lk-label');
    label.append(el('span', 'lk-axis', 'sound'));
    label.append(
      el('span', 'lk-axis-note', m.touch
        ? 'your speakers, not your bike — it does not travel with a run'
        : 'your speakers, not your bike — M does this too'),
    );
    row.append(label);
    const opts = el('div', 'lk-opts');
    for (const [on, text, note] of [
      [true, 'on', 'engine, tyres, impacts — all synthesised, none of it sampled'],
      [false, 'off', 'silent. Nothing else about the game changes.'],
    ] as const) {
      const b = el('button', `lk-set${m.muted !== on ? ' on' : ''}`, text);
      b.title = note;
      b.addEventListener('click', () => {
        b.blur();
        cb.onMute(!on);
      });
      opts.append(b);
    }
    row.append(opts);
    return row;
  }

  function headTitle(m: LookUiModel): string {
    switch (m.mode) {
      case 'intro':
        return 'build your rider';
      case 'finish':
        return m.name ? 'your rider' : 'put a name on that time';
      default:
        return 'your bike';
    }
  }

  /** One line under the title saying why this screen is up, when it opened itself. */
  function headLead(m: LookUiModel): string {
    if (m.mode === 'intro') {
      // ONE LINE ON A LANDSCAPE PHONE. Every line of copy up here is a row of
      // chips pushed below the fold, and the screen has to LOOK like a toy
      // within the first screenful or it reads as the form it is not.
      return 'Pick a bike, paint it, name yourself — or skip the lot and ride. Nothing here is locked.';
    }
    if (m.mode === 'finish' && !m.name) {
      const t = m.standing.timeTicks !== null ? fmtTime(m.standing.timeTicks) : 'that run';
      return `You finished ${m.levelName} in ${t}. It is banked on this device — a name is what puts it `
        + 'on the board, in these colours.';
    }
    return '';
  }

  // Rebuilt wholesale on every change rather than patched, like every other
  // panel here: it is a hundred nodes, it changes when somebody clicks, and a
  // rebuild cannot fall out of step with the model the way a patch can.
  function render(m: LookUiModel): void {
    model = m;
    panel.textContent = '';
    root.classList.toggle('lk-mode-intro', m.mode === 'intro');
    root.classList.toggle('lk-mode-finish', m.mode === 'finish');

    const head = el('div', 'lk-head');
    head.append(el('span', 'lk-title', headTitle(m)));
    const acts = el('span', 'lk-acts');
    const rnd = el('button', 'lk-act', 'surprise me');
    rnd.addEventListener('click', () => cb.onRandom());
    const rst = el('button', 'lk-act', 'shipped bike');
    rst.title = 'back to the bike the game ships with';
    rst.addEventListener('click', () => cb.onReset());
    acts.append(rnd, rst);
    head.append(acts);
    const close = el('button', 'lk-close', '✕');
    close.title = m.touch ? 'close' : 'close (Esc)';
    close.addEventListener('click', () => cb.onClose());
    head.append(close);
    panel.append(head);

    const lead = headLead(m);
    if (lead) panel.append(el('div', 'lk-lead', lead));

    // THE TOP HALF IS TWO COLUMNS ON A SHORT SCREEN. A landscape phone is 348
    // px tall and a stack of preview, name, board row and seven axis rows is a
    // scroll before anything has been read; side by side, the preview and the
    // thing it is an argument for are on screen together, which is the one
    // pairing this whole design rests on. CSS decides, off the viewport.
    const top = el('div', 'lk-top');

    const shot = el('div', 'lk-shot');
    const canvas = el('canvas');
    shot.append(canvas);
    top.append(shot);
    const pv = previewSize();
    paintBike(canvas, m, pv.w, pv.h, 1);

    const side = el('div', 'lk-side');
    side.append(nameBlock(m));
    side.append(seenBlock(m));
    top.append(side);
    panel.append(top);

    panel.append(
      el('div', 'lk-sub', `${appearanceLabel(m.appearance)} — previewed on ${m.levelName}'s palette`),
    );

    APPEARANCE_AXES.forEach((ax, i) => {
      const row = el('div', `lk-row${i === axis && !m.touch ? ' sel' : ''}`);
      const label = el('div', 'lk-label');
      label.append(el('span', 'lk-axis', ax.label));
      if (ax.note) label.append(el('span', 'lk-axis-note', ax.note));
      row.append(label);
      const opts = el('div', 'lk-opts');
      for (const o of ax.options) {
        const on = m.appearance[ax.key] === o.id;
        const b = el('button', `lk-opt${on ? ' on' : ''}`, o.label);
        b.title = o.note;
        b.addEventListener('click', () => {
          axis = i;
          b.blur();
          cb.onPick(ax.key, o.id);
        });
        opts.append(b);
      }
      row.append(opts);
      panel.append(row);
      // THE VOLUME, DIRECTLY UNDER THE ENGINE, and directly under it on purpose:
      // the row above says what your bike sounds like and this one says whether
      // you hear it, which is the one question somebody reading that row is
      // most likely to have next.
      //
      // IT IS NOT AN APPEARANCE AXIS AND IT MUST NOT LOOK LIKE ONE. An engine
      // is a property of your bike — it persists, it travels with a run, it is
      // claimed with your id — and mute is a property of your speakers: it is
      // stored as a flag, it is not submitted, and nobody else is affected by
      // it. So it is drawn in the same shape (a labelled row of chips, because
      // learning a second shape for one setting is worse) with its own class
      // and its own note saying which kind of thing it is. `.lk-set` rather
      // than `.lk-opt` also keeps "how many cosmetics does this game offer" an
      // honest count for the harnesses that ask.
      if (ax.key === 'engine') panel.append(soundRow(m));
    });

    panel.append(actionRow(m));

    panel.append(
      el(
        'div',
        'lk-foot',
        'Every bike here rides EXACTLY the same — same wheels, same weight, same head, one spec hash — so '
          + 'nothing on this screen can change a time or stop one counting, the engine included. Paint is '
          + "lifted until it clears the level's own terrain, which is why the same livery looks a little "
          + 'different from level to level: the bike is kept the most legible thing on screen by '
          + 'arithmetic, not by taste. Your colours travel with every run you post, so your ghost is you. '
          + 'Your engine travels too and nobody ever hears it — only your own bike makes a noise, because '
          + 'two dozen of them at once on the end-of-level montage would be unlistenable.',
      ),
    );
  }

  function move(dAxis: number, dOpt: number): void {
    if (!model) return;
    if (dAxis !== 0) {
      axis = (axis + dAxis + APPEARANCE_AXES.length) % APPEARANCE_AXES.length;
      render(model);
      return;
    }
    const ax = APPEARANCE_AXES[axis];
    const at = ax.options.findIndex((o) => o.id === model!.appearance[ax.key]);
    const next = ax.options[((at < 0 ? 0 : at) + dOpt + ax.options.length) % ax.options.length];
    cb.onPick(ax.key, next.id);
  }

  // THE PANEL OWNS THESE KEYS WHILE IT IS OPEN, and takes them off the game with
  // `stopPropagation` rather than by adding a mode flag to input.ts — the same
  // call the chooser makes, and for the same reason: the arrows and Space are
  // SIM INPUT, so walking this grid would otherwise lean the bike underneath and
  // leave the flip bit held when the menu closed.
  //
  // THE NAME FIELD IS THE EXCEPTION AND IT IS THE FIRST BRANCH. A text input in
  // a panel that eats Space is a text input you cannot type a space into, and
  // one that eats the arrows is one you cannot move the caret in — so while the
  // focus is in it, this handler does exactly two things: commit on Enter, and
  // keep every other key away from the game underneath. (The game is held while
  // this is up, but a keydown still reaches `input.ts` and a mask left set when
  // the panel closed is a welded throttle.)
  root.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) {
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (e.target.value.trim()) cb.onName(e.target.value);
        e.preventDefault();
      } else if (e.code === 'Escape') {
        e.target.blur();
        e.preventDefault();
      }
      return;
    }
    switch (e.code) {
      case 'ArrowDown':
        move(1, 0);
        break;
      case 'ArrowUp':
        move(-1, 0);
        break;
      case 'ArrowRight':
      case 'Space':
        move(0, 1);
        break;
      case 'ArrowLeft':
        move(0, -1);
        break;
      case 'Escape':
      case 'Enter':
      case 'NumpadEnter':
        cb.onClose();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  });
  // The matching releases, for exactly the keys swallowed above: a keyup that
  // reaches the game for a keydown that did not is how an input bit gets stuck
  // on. See input.ts's own note about the same hazard with Tab.
  root.addEventListener('keyup', (e) => {
    if (e.target instanceof HTMLInputElement) {
      e.stopPropagation();
      return;
    }
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Space', 'Enter', 'NumpadEnter'].includes(e.code)) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  return {
    show(m: LookUiModel): void {
      const first = !visible;
      render(m);
      root.classList.remove('hidden');
      visible = true;
      // THE PANEL TAKES THE KEYBOARD, NOT THE NAME FIELD. Focusing the input
      // would put a cursor in a box in front of a child who came to ride a
      // bike, and on a phone it would raise the software keyboard over the
      // whole screen — which is the tollbooth this design is against, built out
      // of a focus call instead of a form. It is one tap away for anybody who
      // wants it. Only on the way in: re-focusing on every re-render would
      // steal the caret back from somebody halfway through typing their name.
      if (first) root.focus();
    },
    hide(): void {
      root.classList.add('hidden');
      visible = false;
    },
    get visible(): boolean {
      return visible;
    },
  };
}
