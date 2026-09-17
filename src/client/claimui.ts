// "Be the same player on my phone", as elements.
//
// Everything it DECIDES lives in `src/shared/claim.ts`, `identity.ts` and
// `qr.ts`, all of which are tested in plain node; this file turns those into a
// panel and draws the code onto a canvas. Same split every other panel here
// makes, same reason — there is no jsdom in this repo.
//
// THREE THINGS IT HAS TO SAY, and it says all three rather than implying any of
// them, because every one is a thing somebody would otherwise assume the other
// way round:
//
//   1. IT IS A BEARER CREDENTIAL. Anyone who can see this code can become this
//      player on their own device. At this scale — a device-gated handful of
//      friends — that is a perfectly good trade, and it is also not a new
//      exposure: the id is already on every leaderboard row the API returns, so
//      the code gives away nothing the board does not already publish.
//   2. IT IS NOT A LOGIN. Re-simulation proves a time is real; nothing proves
//      whose it is. That note has been in the README since the board shipped
//      and this extends it rather than softening it.
//   3. THE PHONE MUST ALREADY BE PAST THE DEVICE GATE. cush-auth decides who
//      reaches this app at all, and an un-enrolled phone bounces to
//      auth.cush.rocks before a single byte of the game loads — which looks
//      exactly like a broken QR code unless somebody says so first.
import { CLAIM_PARAM, claimCode, claimUrl, parseClaimCode } from '@/shared/claim.ts';
import { qrEncode, QrError } from './qr.ts';

export interface ClaimUiCallbacks {
  /** Adopt a scanned or typed id. */
  onAdopt(playerId: string): void;
  /** Undo the last claim, or the last rotation. */
  onUndo(): void;
  /** Mint a fresh id and become a new player. */
  onRotate(): void;
  onClose(): void;
}

export interface ClaimUiModel {
  /** 'mine' shows your code; 'adopt' asks whether to become somebody else. */
  mode: 'mine' | 'adopt';
  playerId: string;
  name: string;
  /** In 'adopt' mode: the id the URL is offering. */
  offered: string | null;
  /** In 'adopt' mode: their display name, once the server has answered. */
  offeredName: string | null;
  /** The id this device had before its last claim, when there is one. */
  previous: string | null;
  /** Something to say — a refusal, or what just happened. */
  status: string;
  statusKind: 'ok' | 'warn' | 'bad' | '';
}

export interface ClaimUi {
  show(m: ClaimUiModel): void;
  hide(): void;
  readonly visible: boolean;
}

/**
 * CSS pixels per QR module. Six, sized against the thing that has to read it: a
 * 26-character player id needs a version-4 code, which is 33 modules plus an
 * 8-module quiet zone, so six pixels each is a 246 px square — about the size a
 * phone camera picks up across a desk without being asked twice.
 */
const MODULE_PX = 6;
/** The quiet zone the spec asks for, in modules. Four, and it is not optional. */
const QUIET = 4;

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

/**
 * Draw a QR onto a canvas.
 *
 * BLACK ON WHITE, IGNORING THE GAME'S PALETTE ENTIRELY, and that is deliberate
 * against every other pixel in this project: a phone camera is the reader here,
 * not a person, and readers are calibrated on maximum contrast. A tastefully
 * tinted QR code is a QR code that sometimes does not scan, which is the one
 * thing this panel cannot afford.
 */
function drawQr(canvas: HTMLCanvasElement, text: string): string {
  let code;
  try {
    code = qrEncode(text);
  } catch (e) {
    return e instanceof QrError ? e.message : String(e);
  }
  const span = code.size + QUIET * 2;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(span * MODULE_PX * dpr);
  canvas.height = canvas.width;
  canvas.style.width = `${span * MODULE_PX}px`;
  canvas.style.height = `${span * MODULE_PX}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'this browser would not give us a canvas to draw the code on';
  const s = MODULE_PX * dpr;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (code.get(x, y)) ctx.fillRect((x + QUIET) * s, (y + QUIET) * s, s, s);
    }
  }
  return '';
}

export function createClaimUi(root: HTMLElement, cb: ClaimUiCallbacks): ClaimUi {
  root.textContent = '';
  root.classList.add('hidden');
  root.tabIndex = -1;
  let visible = false;

  const panel = el('div', 'cl-panel');
  root.append(panel);

  function renderMine(m: ClaimUiModel): void {
    panel.append(
      el('div', 'cl-lead', 'Scan this on your phone and it becomes the same player — same board rows, same bike, same name.'),
    );

    const shot = el('div', 'cl-shot');
    const canvas = el('canvas');
    shot.append(canvas);
    panel.append(shot);
    const url = claimUrl(location.origin, m.playerId);
    const err = drawQr(canvas, url);
    if (err) {
      shot.textContent = '';
      shot.append(el('div', 'cl-note bad', `could not draw the code: ${err}`));
    }

    // THE FALLBACK THAT ALWAYS WORKS. Cameras fail, readers vary, the phone is
    // across the room. A code somebody can read out and type is what still gets
    // them there, so it is not hidden behind a "having trouble?" link.
    panel.append(el('div', 'cl-hint', 'or type this in on the other device, under “have a code?”'));
    const code = el('div', 'cl-code', claimCode(m.playerId));
    // Selectable, and selected on click: this is a string somebody is about to
    // copy, and making them drag across it is a small rudeness that adds up.
    code.addEventListener('click', () => {
      const r = document.createRange();
      r.selectNodeContents(code);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    });
    panel.append(code);
    panel.append(el('div', 'cl-hint', url));

    panel.append(
      el(
        'div',
        'cl-note warn',
        'Anyone who can see this code can become you on their own device. That is what makes it work, and '
          + 'it is not a new exposure — your id is already on every leaderboard row the server hands out — '
          + 'but do not put it on a stream you have not thought about. If you do, “start over” below gives '
          + 'you a fresh one.',
      ),
    );
    panel.append(
      el(
        'div',
        'cl-note',
        'The other device has to be enrolled with the door first. An un-enrolled phone bounces to the sign-in '
          + 'page before the game loads at all, which looks exactly like a broken code and is not one.',
      ),
    );

    // Typing one IN, on this device.
    const form = el('div', 'cl-form');
    form.append(el('div', 'cl-hint', 'have a code? paste the code or the whole link'));
    const input = el('input');
    input.type = 'text';
    input.placeholder = 'code or link';
    input.autocomplete = 'off';
    const go = el('button', '', 'become that player');
    const commit = (): void => {
      const id = parseClaimCode(input.value);
      if (id) cb.onAdopt(id);
    };
    go.addEventListener('click', commit);
    // Keydown on the canvas is the game's input. Without this, typing a code
    // containing "r" restarts the run underneath you — the same hazard the name
    // form in boardui.ts already guards against.
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit();
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    form.append(input, go);
    panel.append(form);

    const acts = el('div', 'cl-acts');
    if (m.previous) {
      const undo = el('button', '', 'go back to the previous id');
      undo.title = `this device was ${m.previous} before`;
      undo.addEventListener('click', () => {
        undo.blur();
        cb.onUndo();
      });
      acts.append(undo);
    }
    const rot = el('button', '', 'start over as a new player');
    rot.title = 'mint a fresh id on this device';
    rot.addEventListener('click', () => {
      rot.blur();
      cb.onRotate();
    });
    acts.append(rot);
    panel.append(acts);
    panel.append(
      el(
        'div',
        'cl-foot',
        'Starting over gives this device a brand new id. Times you have already posted STAY on the board under '
          + 'the old one — they are not deleted and they are not moved, they just stop being yours — and the old '
          + 'id is kept, so this is reversible. Your local best times belong to this browser rather than to a '
          + 'player, so none of this touches them.',
      ),
    );
  }

  function renderAdopt(m: ClaimUiModel): void {
    const who = m.offeredName ? `“${m.offeredName}”` : 'that player';
    panel.append(el('div', 'cl-lead', `This link makes this device ${who}.`));
    panel.append(el('div', 'cl-code', claimCode(m.offered ?? '')));
    panel.append(
      el(
        'div',
        'cl-note warn',
        `This device is currently ${m.name ? `“${m.name}”` : 'a player with no name'} (${claimCode(m.playerId)}). `
          + 'Claiming replaces that: new runs post as them, and their name and bike come with it. Your best '
          + 'times on this browser are kept — they belong to the browser, not to a player — and the id you '
          + 'have now is remembered, so this is reversible.',
      ),
    );
    const acts = el('div', 'cl-acts');
    const yes = el('button', 'primary', 'yes, become them');
    yes.addEventListener('click', () => {
      yes.blur();
      if (m.offered) cb.onAdopt(m.offered);
    });
    const no = el('button', '', 'no, stay as I am');
    no.addEventListener('click', () => {
      no.blur();
      cb.onClose();
    });
    acts.append(yes, no);
    panel.append(acts);
    panel.append(
      el(
        'div',
        'cl-foot',
        'This is not a login and there is nothing to sign in to. The server proves a TIME is real by '
          + 're-running it; it has never had any way to prove whose it is, and this does not change that.',
      ),
    );
  }

  function render(m: ClaimUiModel): void {
    panel.textContent = '';
    const head = el('div', 'cl-head');
    head.append(el('span', 'cl-title', m.mode === 'mine' ? 'this device' : 'claim this player'));
    const close = el('button', 'cl-close', '✕');
    close.title = 'close (Esc)';
    close.addEventListener('click', () => cb.onClose());
    head.append(close);
    panel.append(head);
    if (m.status) panel.append(el('div', `cl-note ${m.statusKind}`, m.status));
    if (m.mode === 'mine') renderMine(m);
    else renderAdopt(m);
  }

  root.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    cb.onClose();
    e.preventDefault();
    e.stopPropagation();
  });

  return {
    show(m: ClaimUiModel): void {
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

/** Re-exported so main.ts has one import for the whole feature. */
export { CLAIM_PARAM };
