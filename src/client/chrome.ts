// Two bits of always-visible chrome that are navigation, not tuning: the level
// picker and the control legend. They live outside the panel on purpose —
// pressing H to hide the sliders should not also hide how you change level or
// what the keys are.
import type { LevelEntry } from './levels.ts';
import { ticksToSeconds } from '@/sim/replay.ts';
import { loadFlag, saveFlag } from './store.ts';

export interface LevelBar {
  /** Re-render: selection, and the best-time annotations. */
  update(currentId: string, bests: Record<string, number>): void;
}

export function createLevelBar(
  root: HTMLElement,
  levels: LevelEntry[],
  onPick: (id: string) => void,
  onBrowse: () => void,
): LevelBar {
  root.textContent = '';
  const label = document.createElement('span');
  label.className = 'lb-label';
  label.textContent = 'level';
  const select = document.createElement('select');
  select.id = 'levelselect';
  root.append(label, select);

  // The way in to the chooser, next to the control it is an alternative to.
  // A key nobody has been told about is not a feature; the button is how C gets
  // discovered, and it prints the key on itself so it teaches rather than
  // replaces.
  const browse = document.createElement('button');
  browse.className = 'lb-browse';
  browse.textContent = 'browse  C';
  browse.title = 'pictures of every level, with difficulty and your best times';
  // BLURRED BEFORE IT DOES ANYTHING, for the same reason the dropdown below is
  // — see that note. A button keeps focus after a click, and a focused button
  // eats Space and Enter, which are FLIP and the results screen's primary
  // action. Every button in this client that opens something does this.
  browse.addEventListener('click', () => {
    browse.blur();
    onBrowse();
  });
  root.append(browse);

  const note = document.createElement('span');
  note.className = 'lb-note';
  root.append(note);

  // THE KEYBOARD GOES BACK TO THE GAME THE INSTANT A LEVEL IS CHOSEN, and this
  // one line is the whole of it.
  //
  // THE BUG IT FIXES, in the user's words: "when i click level selector, then
  // choose level. i have to click back on screen to use hotkeys". A `<select>`
  // keeps focus after a change, and `input.ts` deliberately ignores every
  // command key whose target is an INPUT, a SELECT or a TEXTAREA — so that
  // typing a name into the board's name field does not restart the run. Both
  // halves are right; together they left the whole keyboard dead after the most
  // ordinary action in the game, until a click somewhere else blurred it.
  //
  // It is fixed HERE rather than by loosening that check, because the check is
  // what makes text fields usable and this control has no text in it. A
  // dropdown that has been answered is a dropdown nobody is typing into.
  select.addEventListener('change', () => {
    select.blur();
    onPick(select.value);
  });

  return {
    update(currentId: string, bests: Record<string, number>): void {
      // Rebuilt rather than patched, because the level list can grow under us
      // while somebody is authoring files into levels/ with the dev server up.
      select.textContent = '';
      for (const l of levels) {
        const o = document.createElement('option');
        o.value = l.id;
        // A level that will not load still appears, and says so. A level
        // silently missing from the menu is the most confusing possible
        // feedback for somebody halfway through authoring it.
        if (!l.level) {
          o.textContent = `${l.label}  — BROKEN`;
        } else {
          const best = bests[l.level.simHash];
          o.textContent = best === undefined
            ? l.label
            : `${l.label}  ✓ ${ticksToSeconds(best).toFixed(2)}s`;
        }
        select.append(o);
      }
      select.value = currentId;
      const cur = levels.find((l) => l.id === currentId);
      const done = levels.filter((l) => l.level && bests[l.level.simHash] !== undefined).length;
      note.textContent = cur?.error
        ? `does not load: ${cur.error}`
        : `${done}/${levels.length} completed (local, this browser, rev-scoped)`;
      note.className = cur?.error ? 'lb-note bad' : 'lb-note';
    },
  };
}


// --- the control legend ------------------------------------------------------
//
// WHAT WAS WRONG WITH IT, in the user's words: "player controls and developer
// affordances currently sit in one list at equal weight". Eighteen lines of
// `<b>KEY</b> description<br>` in which "gas" and "hide the debug readout" had
// the same typography, the same indent and the same claim on your attention. It
// did not read as part of a game. It read as a debug overlay that survived into
// production, because that is exactly what it was.
//
// So it is two things now, and they are different KINDS of thing:
//
//   THE LEGEND is the five bits the sim takes plus the things a player does
//   between runs, and it SHOWS them: each drive control is the real bike, drawn
//   by the real renderer, in the pose that control puts it in (legendart.ts).
//   Flip is the hero and gets a tile of its own, with the same bike facing both
//   ways — it is the mechanic the whole double-back level design rests on and it
//   spent three milestones as line four of a text block.
//
//   THE DEV TOOLBAR is the tuning panel, the debug readout, the collision
//   overlay, the replay tools, the montage and the editor. Off by default,
//   remembered, and reachable through ONE switch instead of nine single letters
//   a player can hit by accident. Every key still works; this is about what is
//   advertised.
//
// PERSISTENT, NOT DISMISS-FOR-GOOD. The alternative — a first-run card that
// never comes back unless summoned — is cleaner and was rejected: the key that
// summons it would have to be advertised somewhere, and the only place to
// advertise it is the thing that just disappeared. Collapsed, the legend leaves
// a `controls ?` chip in the corner; that chip IS the way back, it is always on
// screen, and it costs one line of glass. A kid who closes it can see how to
// open it without being told and without remembering anything.
//
// AND IT GETS OUT OF THE WAY WHILE YOU RIDE. `body.riding` fades the whole
// block to a quarter, because the art direction's one rule is that the player
// and the collision edge are the highest-contrast things on screen and a panel
// full of little bikes in the corner is the most obvious possible way to break
// it. It comes back the moment the bike stops, or on hover, or on focus.
import { DEV, DRIVE, PLAY } from './keys.ts';
import type { Control, DevActionId } from './keys.ts';
import { poseImg } from './legendart.ts';
import { createAbout } from './about.ts';
import type { About } from './about.ts';
import type { Palette } from './art/palette.ts';
import type { BikeLook } from './art/bikeart.ts';

/** CSS px. The drive tiles, and the two halves of the flip tile. */
const TILE_W = 74;
const TILE_H = 44;
const HERO_W = 68;
const HERO_H = 46;

export interface LegendOpts {
  /** No keyboard: the tiles print the PAD each control is on, not a keycap. */
  touch: boolean;
  /** Fetched lazily, because the palette and the livery both move under it. */
  palette(): Palette;
  look(): BikeLook;
  /** One function per dev tool. The toolbar presses them; the keys still work. */
  dev: Record<DevActionId, () => void>;
  /**
   * The card opened or closed, WHOEVER did it.
   *
   * It exists because the first phone screenshot of this legend came back with
   * no thumb pads on it at all: main.ts hides the pads while the card is up —
   * they sit exactly where its close button is — and it did that in its own
   * wrapper, which the card's own `×` button went straight past. A panel with
   * two ways to open it and one of them wired to the side effect is a bug
   * waiting for whichever way somebody uses.
   */
  onOpen?(open: boolean): void;
}

export interface Legend {
  readonly open: boolean;
  toggle(): void;
  setOpen(on: boolean): void;
  /** The livery or the level palette moved; redraw every picture. */
  refresh(): void;
  /**
   * The about page, which hangs off this card's `about` button.
   *
   * Exposed rather than hidden because the legend is the only thing that knows
   * it exists, and `bin/shots` has to be able to open it — through the same
   * button a thumb goes through, which is the shots file's own rule.
   */
  readonly about: About;
}

function cap(text: string): HTMLElement {
  const b = document.createElement('kbd');
  b.className = 'lg-cap';
  b.textContent = text;
  return b;
}

/** The keycaps for one control, or the name of the pad when there is no key. */
function capsFor(c: Control, touch: boolean): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'lg-caps';
  if (touch) {
    // A DEVICE WITH NO KEYBOARD MUST NOT BE TOLD TO PRESS A KEY. Same rule the
    // art renderer already keeps for the death banner ("TAP RESTART" rather
    // than "R TO RESTART"), and the same rule that hides the desktop level bar.
    const pad = document.createElement('span');
    pad.className = 'lg-pad';
    pad.textContent = c.pad ?? '—';
    wrap.append(pad);
    return wrap;
  }
  c.caps.forEach((k, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'lg-sep';
      sep.textContent = '/';
      wrap.append(sep);
    }
    wrap.append(cap(k));
  });
  return wrap;
}

export function createLegend(root: HTMLElement, opts: LegendOpts): Legend {
  // Fixed for the life of the page, exactly like `createTouch`'s own `enabled`:
  // both come from one `wantsTouch` call at boot, and a device does not grow a
  // keyboard mid-session. Read through a local so the two can never disagree
  // about which of them is the source of truth.
  const touch = opts.touch;
  let open = loadFlag('legend', true);
  let dev = loadFlag('devbar', false);

  root.textContent = '';
  root.className = '';

  // --- the dev toolbar, above the card and outside it -----------------------
  //
  // A separate block on purpose. Folding it into the legend as a final section
  // would put it back at the same weight as `gas`, which is the whole thing
  // this change exists to undo.
  const devbar = document.createElement('div');
  devbar.className = 'lg-dev';
  const devTitle = document.createElement('span');
  devTitle.className = 'lg-devtitle';
  devTitle.textContent = 'dev';
  devbar.append(devTitle);
  for (const t of DEV) {
    const b = document.createElement('button');
    b.className = 'lg-tool';
    b.type = 'button';
    // The button DOES the thing and also prints the key that does it, which is
    // how the key gets discovered rather than replaced — the same argument the
    // `browse C` button in the level bar makes.
    b.append(cap(t.caps[0]));
    const label = document.createElement('span');
    label.textContent = t.title;
    b.append(label);
    b.title = t.note ? `${t.title} — ${t.note}` : t.title;
    b.addEventListener('click', () => opts.dev[t.id]());
    devbar.append(b);
  }

  // --- collapsed: one chip, which is the way back ---------------------------
  const chip = document.createElement('button');
  chip.className = 'lg-chip';
  chip.type = 'button';
  chip.innerHTML = '<span>controls</span>';
  chip.append(cap('?'));
  chip.title = 'how to ride';
  chip.addEventListener('click', () => setOpen(true, true));

  // --- open: the card -------------------------------------------------------
  const card = document.createElement('section');
  card.className = 'lg-card';
  card.setAttribute('aria-label', 'controls');

  const head = document.createElement('header');
  head.className = 'lg-head';
  const title = document.createElement('span');
  title.className = 'lg-title';
  title.textContent = 'controls';
  const devBtn = document.createElement('button');
  devBtn.className = 'lg-devtoggle';
  devBtn.type = 'button';
  devBtn.textContent = 'dev';
  devBtn.title = 'the tuning panel, the collision overlay, replays, the editor';
  devBtn.addEventListener('click', () => setDev(!dev));
  // THE WAY IN TO THE ABOUT PAGE, and it is in the header for the same reason
  // `browse  C` is in the level bar: the only place a player is already looking
  // for "what is this". It is not behind the dev switch and it is not hidden on
  // a phone — it is the one thing in this header that is for the player rather
  // than for whoever is building the game.
  //
  // The page itself is built here and now rather than on first click. It costs
  // one hidden element and its stylesheet, and building it lazily would mean
  // this button spending the first frame after a click unstyled — the styles
  // for the button live with the page, in about.ts, so that a rename in
  // style.css can never quietly make this invisible.
  const about = createAbout({
    touch,
    palette: opts.palette,
    look: opts.look,
    // Closing it puts the keyboard back on the button that opened it, which is
    // the only element on the page that is guaranteed to still be there and to
    // still make sense — the legend can have been collapsed underneath it in
    // the meantime, but the card is rebuilt, not replaced, so this node is.
    returnFocus: () => (aboutBtn.isConnected ? aboutBtn : null),
  });
  const aboutBtn = document.createElement('button');
  aboutBtn.className = 'lg-about';
  aboutBtn.type = 'button';
  aboutBtn.textContent = 'about';
  aboutBtn.title = 'where this came from, and what is ours';
  aboutBtn.addEventListener('click', () => about.setOpen(true));
  const close = document.createElement('button');
  close.className = 'lg-close';
  close.type = 'button';
  close.textContent = '×';
  close.title = 'close (? reopens)';
  close.setAttribute('aria-label', 'close the controls');
  close.addEventListener('click', () => setOpen(false, true));
  head.append(title, aboutBtn, devBtn, close);

  // THE HERO. Two bikes, the same bike, facing opposite ways.
  const hero = document.createElement('div');
  hero.className = 'lg-hero';
  const heroArt = document.createElement('div');
  heroArt.className = 'lg-heroart';
  const heroText = document.createElement('div');
  heroText.className = 'lg-herotext';
  hero.append(heroArt, heroText);

  const grid = document.createElement('div');
  grid.className = 'lg-grid';

  const keys = document.createElement('div');
  keys.className = 'lg-keys';

  card.append(head, hero, grid, keys);
  root.append(devbar, chip, card);

  const flip = DRIVE[0];

  function paint(): void {
    const P = opts.palette();
    const look = opts.look();

    heroArt.textContent = '';
    heroArt.append(poseImg('ride', P, look, HERO_W, HERO_H, 1));
    const arrow = document.createElement('span');
    arrow.className = 'lg-arrow';
    arrow.textContent = '⇄';
    heroArt.append(arrow, poseImg('ride', P, look, HERO_W, HERO_H, -1));

    heroText.textContent = '';
    heroText.append(capsFor(flip, touch));
    const ht = document.createElement('span');
    ht.className = 'lg-heronote';
    ht.textContent = flip.note ?? '';
    const hn = document.createElement('b');
    hn.textContent = flip.title;
    heroText.append(hn, ht);

    grid.textContent = '';
    for (const c of DRIVE.slice(1)) {
      const tile = document.createElement('div');
      tile.className = 'lg-tile';
      tile.title = c.note ?? c.title;
      if (c.pose) tile.append(poseImg(c.pose, P, look, TILE_W, TILE_H));
      const name = document.createElement('span');
      name.className = 'lg-name';
      name.textContent = c.title;
      tile.append(name, capsFor(c, touch));
      grid.append(tile);
    }

    keys.textContent = '';
    for (const c of PLAY) {
      // On a phone, a row for a thing with no pad would be a row about a key
      // that does not exist on the device holding it.
      if (touch && !c.pad) continue;
      const row = document.createElement('span');
      row.className = 'lg-key';
      row.append(capsFor(c, touch));
      const label = document.createElement('span');
      label.className = 'lg-label';
      // THE NAME ONLY. The notes are real and they are long — "in, out, back to
      // the default, remembered, and a pinch drives the same variable" is a
      // paragraph — and putting them here turned a four-line strip into
      // fourteen, which made the legend the tallest thing on the screen. They
      // live on the tooltip, where somebody who wants them can find them.
      label.textContent = c.title;
      row.title = c.note ? `${c.title} — ${c.note}` : c.title;
      row.append(label);
      keys.append(row);
    }
  }

  function sync(): void {
    root.classList.toggle('lg-open', open);
    root.classList.toggle('lg-touch', touch);
    card.hidden = !open;
    chip.hidden = open;
    devbar.hidden = !dev;
    devBtn.setAttribute('aria-pressed', dev ? 'true' : 'false');
    devBtn.classList.toggle('on', dev);
    if (open) paint();
  }

  /**
   * `moveFocus` is true only when a BUTTON did it, and that is deliberate.
   *
   * Clicking the chip hides the chip, so focus would land on nothing and a
   * keyboard player would be stranded mid-page — hence the hand-off. But the
   * `?` key must NOT take focus: a focused button eats Enter, and putting the
   * keyboard inside a panel because somebody glanced at the controls is how you
   * get a flip that closes the legend instead of turning the bike around.
   */
  function setOpen(on: boolean, moveFocus = false): void {
    if (open === on) return;
    open = on;
    saveFlag('legend', on);
    sync();
    opts.onOpen?.(on);
    if (moveFocus) (on ? close : chip).focus({ preventScroll: true });
  }

  function setDev(on: boolean): void {
    dev = on;
    saveFlag('devbar', on);
    sync();
  }

  sync();

  return {
    get open(): boolean {
      return open;
    },
    toggle: () => setOpen(!open),
    setOpen: (on: boolean) => setOpen(on),
    refresh: () => {
      if (open) paint();
      // Unconditionally, unlike the card: the about page is its own overlay and
      // can be up with the legend collapsed underneath it. It no-ops when shut.
      about.refresh();
    },
    about,
  };
}
