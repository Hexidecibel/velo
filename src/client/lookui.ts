// The customiser, as elements.
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
// The PREVIEW is the real renderer at a small scale on the CURRENT LEVEL'S
// palette, so what it shows is what the bike will look like where it is about
// to be ridden — which matters, because a livery is solved against the level's
// own palette and the same paint is a different set of pixels on a different
// level.
import { cloneSpec } from '@/sim/spec.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import { APPEARANCE_AXES, appearanceLabel } from '@/shared/appearance.ts';
import type { Appearance, AppearanceKey } from '@/shared/appearance.ts';
import { drawBikePortrait, portraitExtent } from './artrender.ts';
import { makeLook } from './art/bikeart.ts';
import type { Palette } from './art/palette.ts';
import { BOOT_PRESET } from './presets.ts';

export interface LookUiCallbacks {
  onPick(key: AppearanceKey, id: string): void;
  onRandom(): void;
  onReset(): void;
  onClose(): void;
}

export interface LookUiModel {
  appearance: Appearance;
  /** The palette of the level being played, so the preview is honest. */
  palette: Palette;
  playerId: string;
  levelName: string;
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

  function drawPreview(canvas: HTMLCanvasElement, m: LookUiModel): void {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(PREVIEW_W * dpr);
    canvas.height = Math.round(PREVIEW_H * dpr);
    canvas.style.width = `${PREVIEW_W}px`;
    canvas.style.height = `${PREVIEW_H}px`;
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
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(zoom, -zoom);
    ctx.translate(0, -ext.cy);
    drawBikePortrait(ctx, SPEC, P, makeLook(m.appearance, P, m.playerId), zoom);
    ctx.restore();
  }

  // Rebuilt wholesale on every change rather than patched, like every other
  // panel here: it is a hundred nodes, it changes when somebody clicks, and a
  // rebuild cannot fall out of step with the model the way a patch can.
  function render(m: LookUiModel): void {
    model = m;
    panel.textContent = '';

    const head = el('div', 'lk-head');
    head.append(el('span', 'lk-title', 'your bike'));
    const acts = el('span', 'lk-acts');
    const rnd = el('button', 'lk-act', 'surprise me');
    rnd.addEventListener('click', () => cb.onRandom());
    const rst = el('button', 'lk-act', 'shipped bike');
    rst.title = 'back to the bike the game ships with';
    rst.addEventListener('click', () => cb.onReset());
    acts.append(rnd, rst);
    head.append(acts);
    const close = el('button', 'lk-close', '✕');
    close.title = 'close (Esc)';
    close.addEventListener('click', () => cb.onClose());
    head.append(close);
    panel.append(head);

    const shot = el('div', 'lk-shot');
    const canvas = el('canvas');
    shot.append(canvas);
    panel.append(shot);
    drawPreview(canvas, m);

    panel.append(
      el('div', 'lk-sub', `${appearanceLabel(m.appearance)} — previewed on ${m.levelName}'s palette`),
    );

    APPEARANCE_AXES.forEach((ax, i) => {
      const row = el('div', `lk-row${i === axis ? ' sel' : ''}`);
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
    });

    panel.append(
      el(
        'div',
        'lk-foot',
        'Every bike here rides EXACTLY the same — same wheels, same weight, same head, one spec hash — so '
          + 'nothing on this screen can change a time or stop one counting. Paint is lifted until it clears '
          + "the level's own terrain, which is why the same livery looks a little different from level to "
          + 'level: the bike is kept the most legible thing on screen by arithmetic, not by taste. Your '
          + 'colours travel with every run you post, so your ghost is you.',
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
  root.addEventListener('keydown', (e) => {
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
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Space', 'Enter', 'NumpadEnter'].includes(e.code)) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  return {
    show(m: LookUiModel): void {
      render(m);
      root.classList.remove('hidden');
      visible = true;
      root.focus();
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
