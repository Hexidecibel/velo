// The leaderboard panel.
//
// Three jobs, in the order they matter: say where you stand, let you pick which
// ghost to race, and say what the board IS — which rev, which category, and
// that your name is a name rather than a login.
//
// Every string that came off the network is written with `textContent`, never
// `innerHTML`. Display names are typed by other people and the server does not
// escape them; it strips control characters and clips the length, which is
// hygiene, not sanitisation. `textContent` is what makes markup in a name
// harmless, and the rule is easier to keep than to audit, so it is absolute
// here.
import { ticksToSeconds } from '@/sim/replay.ts';
import type { BoardEntry, BoardPayload, Category } from './api.ts';
import type { Appearance } from '@/shared/appearance.ts';
import { GHOST_KINDS, GHOST_LABELS, watchableCategory } from './ghost.ts';
import type { GhostKind } from './ghost.ts';
import { avatarImg } from './avatar.ts';
import { resolveAppearance } from '@/shared/appearance.ts';
import type { Palette } from './art/palette.ts';

export interface BoardUiCallbacks {
  onCategory(c: Category): void;
  onGhost(k: GhostKind): void;
  onName(name: string): void;
  onRefresh(): void;
  /** Watch the selected ghost's run on its own, from the start. */
  onWatch(entry: BoardEntry): void;
  /** Open the customiser. The board is where you see everybody else's bike. */
  onCustomise(): void;
  /** Open the cross-device claim panel: a QR, and a code you can type. */
  onLinkDevice(): void;
}

export interface BoardUiState {
  visible: boolean;
  category: Category;
  ghost: GhostKind;
  playerId: string;
  name: string;
  /** Null while loading or when the server could not be reached. */
  board: BoardPayload | null;
  /** Non-empty when something needs saying: offline, a refusal, a new PB. */
  status: string;
  statusKind: 'ok' | 'warn' | 'bad' | '';
  /** Why the chosen ghost is not on screen, when it is not. */
  ghostNote: string;
  /**
   * The palette of the level on screen. A livery is solved against the level it
   * is ridden on, so a row's avatar is drawn in the room the board is for.
   */
  palette: Palette;
  /** The player's own bike, for the row that offers to change it. */
  appearance: Appearance;
}

export interface BoardUi {
  update(s: BoardUiState): void;
  readonly root: HTMLElement;
}

function fmt(ticks: number): string {
  return `${ticksToSeconds(ticks).toFixed(3)}s`;
}

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

export function createBoardUi(root: HTMLElement, cb: BoardUiCallbacks): BoardUi {
  root.textContent = '';

  const panel = el('div', 'bd-panel');
  root.append(panel);

  // Rebuilt wholesale on every update rather than patched. The panel is a few
  // dozen nodes, it changes only when a run ends or a fetch lands, and a
  // rebuild cannot get out of step with the data the way a patch can.
  function render(s: BoardUiState): void {
    panel.textContent = '';
    root.classList.toggle('hidden', !s.visible);
    if (!s.visible) return;

    // --- header: category, refresh ---
    const head = el('div', 'bd-head');
    head.append(el('span', 'bd-title', 'leaderboard'));
    const cats = el('span', 'bd-cats');
    for (const c of ['human', 'tas'] as Category[]) {
      const b = el('button', `bd-cat${s.category === c ? ' on' : ''}`, c === 'human' ? 'human' : 'TAS');
      b.addEventListener('click', () => cb.onCategory(c));
      cats.append(b);
    }
    head.append(cats);
    const refresh = el('button', 'bd-refresh', '↻');
    refresh.title = 'refresh';
    refresh.addEventListener('click', () => cb.onRefresh());
    head.append(refresh);
    panel.append(head);

    // --- the name, when there is not one yet ---
    //
    // Deliberately in the way until it is answered: nothing is submitted without
    // a name, so a player with no name is a player whose times are being banked
    // and not posted, and they should know that at the moment it starts.
    if (!s.name) {
      const form = el('div', 'bd-name');
      form.append(el('div', 'bd-hint', 'pick a name to post times. it is a label, not a login.'));
      const input = el('input');
      input.type = 'text';
      input.maxLength = 24;
      input.placeholder = 'your name';
      const save = el('button', '', 'save');
      const commit = (): void => {
        if (input.value.trim()) cb.onName(input.value);
      };
      save.addEventListener('click', commit);
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
      });
      // Keydown on the canvas is the game's input. Without this, typing a name
      // containing "r" restarts the run underneath you.
      input.addEventListener('keyup', (e) => e.stopPropagation());
      form.append(input, save);
      panel.append(form);
    }

    // YOUR OWN BIKE, next to where everybody else's is shown. It is the one
    // place the customiser is discoverable without reading the legend, and it
    // prints its key on itself so it teaches rather than replaces.
    const mine = el('div', 'bd-mine');
    mine.append(avatarImg(s.appearance, s.palette, s.playerId));
    const edit = el('button', 'bd-edit', 'your bike  Y');
    edit.title = 'pick a bike, a livery and what the rider is wearing';
    edit.addEventListener('click', () => {
      edit.blur();
      cb.onCustomise();
    });
    mine.append(edit);
    // "Be this player on my phone too". It lives HERE because this is where
    // identity already is — the name form is three lines up — and because the
    // moment somebody cares about a name and a bike is the moment they care
    // about having them on the device they actually play on.
    const link = el('button', 'bd-edit', 'link a device');
    link.title = 'scan a code on your phone and it becomes the same player';
    link.addEventListener('click', () => {
      link.blur();
      cb.onLinkDevice();
    });
    mine.append(link);
    panel.append(mine);

    if (!s.board) {
      panel.append(el('div', 'bd-note', s.status || 'loading…'));
      appendFooter(s);
      return;
    }

    const b = s.board;

    // --- the table ---
    const list = el('div', 'bd-list');
    if (b.top.length === 0) {
      list.append(el('div', 'bd-empty', 'no times on this board yet — be first'));
    }
    // Times always, on both boards. LINES only on the human board, and on no
    // condition at all on the TAS one — route choice is this game's depth and a
    // searched optimal line deletes the puzzle permanently. A time is
    // information; a line is a solution.
    const lines = watchableCategory(b.category);
    for (let i = 0; i < b.top.length; i++) {
      const e = b.top[i];
      const row = el('div', `bd-row${e.playerId === s.playerId ? ' you' : ''}`);
      row.append(el('span', 'bd-rank', String(i + 1)));
      // THE ROW SHOWS A PERSON. An appearance that never travelled — every row
      // written before customisation existed — resolves to a stable derivation
      // from the playerId rather than to one shared default, so an old board is
      // still a board of different people.
      row.append(avatarImg(resolveAppearance(e.appearance, e.playerId), s.palette, e.playerId));
      row.append(el('span', 'bd-name-cell', e.name));
      row.append(el('span', 'bd-time', fmt(e.timeTicks)));
      if (lines) {
        const watch = el('button', 'bd-watch', 'watch');
        watch.title = 'play this run from the start';
        watch.addEventListener('click', () => cb.onWatch(e));
        row.append(watch);
      }
      list.append(row);
    }
    panel.append(list);
    if (!lines && b.top.length > 0) {
      // Said plainly HERE, where somebody has deliberately opened the TAS
      // category and already knows machine runs exist, rather than anywhere in
      // ordinary play. The ghost selector never mentions it at all: a note
      // explaining what is being withheld is itself the hint. This one is not
      // that — it says the times are the whole of what this board is, which is
      // now simply true.
      panel.append(
        el(
          'div',
          'bd-note',
          'these are machine runs \u2014 proof the level goes, and a number to chase. Only the times: a ' +
            'solver picks the apple order by searching it, and that order is the level rather than a race.',
        ),
      );
    }

    // --- where you stand ---
    const you = el('div', 'bd-you');
    if (b.you && b.rank !== null) {
      const gap = b.above ? b.you.timeTicks - b.above.timeTicks : 0;
      you.append(
        el('span', '', `you: #${b.rank} of ${b.total} — ${fmt(b.you.timeTicks)}`),
      );
      if (b.above) {
        you.append(el('span', 'bd-gap', `  ${fmt(gap)} behind ${b.above.name}`));
      } else {
        you.append(el('span', 'bd-gap ok', '  nobody ahead of you'));
      }
    } else {
      you.append(el('span', 'bd-gap', `no time here yet${b.total ? ` — ${b.total} others do` : ''}`));
    }
    panel.append(you);

    // --- the ghost picker ---
    const ghost = el('div', 'bd-ghost');
    // Human runs only, always. The TAS category is a board, never a ghost.
    ghost.append(el('label', 'bd-hint', 'ghost (human runs)'));
    const sel = el('select');
    for (const k of GHOST_KINDS) {
      const o = el('option', undefined, GHOST_LABELS[k]);
      o.value = k;
      sel.append(o);
    }
    sel.value = s.ghost;
    sel.addEventListener('change', () => cb.onGhost(sel.value as GhostKind));
    ghost.append(sel);
    panel.append(ghost);
    if (s.ghostNote) panel.append(el('div', 'bd-note warn', s.ghostNote));

    // --- other revs, so nobody thinks their times were deleted ---
    if (b.otherRevs.length > 0) {
      const revs = b.otherRevs.map((r) => `rev ${r.rev}: ${r.entries}`).join(', ');
      panel.append(
        el(
          'div',
          'bd-note',
          `older physics revs hold times on this level (${revs}). They are kept and labelled, never deleted — ` +
            'and they cannot be compared with this board or shown as ghosts.',
        ),
      );
    }

    appendFooter(s);
  }

  function appendFooter(s: BoardUiState): void {
    if (s.status) panel.append(el('div', `bd-note ${s.statusKind}`, s.status));
    panel.append(
      el(
        'div',
        'bd-foot',
        `rev-scoped board — through milestone 1 the sim rev bumps freely and the live board resets. ` +
          'Times are verified by re-simulation on the server; names are not authenticated.',
      ),
    );
  }

  return {
    root,
    update(s: BoardUiState): void {
      render(s);
    },
  };
}
