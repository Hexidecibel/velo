// The level chooser, as elements — and, since today, the leaderboard browser,
// because they are the same screen.
//
// Everything it DECIDES lives in chooser.ts and browse.ts and is tested in plain
// node; this file only turns groups of `ChooserItem` and a `BrowseModel` into
// nodes and owns the keyboard while it is open. Same split boardui.ts and
// resultsui.ts make, same reason — there is no jsdom in this repo.
//
// WHY THE LEADERBOARD BROWSER IS A VIEW OF THIS SCREEN AND NOT A SCREEN OF ITS
// OWN. The ask was "some leaderboards page? where you can skip through levels,
// see leaderboards without having to load each one". The thing that skips
// through levels already exists and is this: it knows the set, the shipped
// order, the measured difficulty, which ones you have done and what a level
// looks like. A second screen would have had to list all of that again to be
// usable, and then there would be two lists of twenty-four levels, two sorts,
// two definitions of "completed", and a bug fixed in one of them. Two
// near-identical browse screens is a worse outcome than either one of them.
//
// So there is ONE browse surface with two views of the same list:
//
//   levels — the grid. Pictures, difficulty, your best, par. Tap one and you
//            ride it. Unchanged, and deliberately: on a phone this is the only
//            way to change level, and making that two taps to buy a leaderboard
//            would be paying for the new thing with the old one.
//   times  — one level at a time, its whole board, and `‹ prev` / `next ›`. No
//            level is loaded, no sim is touched, and the order it steps in is
//            whatever the sort produced, so "by difficulty" browses the ladder
//            in difficulty order for free.
//
// THREE THINGS GOVERN THE LAYOUT.
//
//   1. THE PICTURE IS THE POINT, in both views. A list of twenty-four names
//      cannot answer "which one was the one with the chimney", and a picture
//      answers it instantly. It is drawn by the real renderer at overview
//      framing (thumbs.ts), so it cannot drift from the level.
//   2. IT MUST NOT SLOW DOWN CHANGING LEVEL. `[` and `]` never open this, and
//      the dropdown in the level bar still works exactly as before. This is for
//      choosing and for browsing, not for stepping.
//   3. SAME CHROME AS EVERYTHING ELSE. The board, the results panel and this
//      are the same drab surface with the same borders, because the readability
//      rule says the highest-contrast things on screen are the bike and the
//      collision edge — including when a menu is over them.
//
// NOTHING FROM THE NETWORK REACHES THE DOM AS MARKUP. Display names are typed
// by other people and the server does not escape them — it strips control
// characters and clips the length, which is hygiene, not sanitisation. Every
// string below goes through `el()`, which sets `textContent`. boardui.ts carries
// the same note and bin/smoke posts a real `<img src=x>` payload through the
// whole stored path and counts the elements it created, in this panel as well
// as in that one.
import type { ChooserGroup, ChooserItem, ChooserSort } from './chooser.ts';
import type { BrowseLine, BrowseModel } from './browse.ts';
import type { BoardEntry, Category } from './api.ts';
import { GHOST_KINDS, GHOST_LABELS } from './ghost.ts';
import type { GhostKind } from './ghost.ts';

/** Which view of the one list is up. */
export type ChooserView = 'levels' | 'times';
export const CHOOSER_VIEWS: readonly ChooserView[] = ['levels', 'times'];

export interface ChooserModel {
  groups: readonly ChooserGroup[];
  summary: string;
  sort: ChooserSort;
  view: ChooserView;
  /** The level the `times` view is about. Null while the grid is up. */
  browse: BrowseModel | null;
  /** Which run rides beside you. A play preference, parked where it is reachable. */
  ghost: GhostKind;
}

export interface ChooserUiCallbacks {
  onPick(id: string): void;
  onSort(sort: ChooserSort): void;
  onClose(): void;
  /** The picture, if it has been drawn. Never triggers a render. */
  thumbUrl(simHash: string): string | null;
  /** Ask for one. Queued, one per frame, abandoned when this closes. */
  wantThumb(simHash: string): void;
  /** Switch view. The list underneath does not change. */
  onView(view: ChooserView): void;
  /** Browse this level's board. NEVER loads the level — that is `onPick`. */
  onBrowse(id: string): void;
  /** `‹ prev` / `next ›`, in the order the current sort produced. */
  onStep(delta: number): void;
  onCategory(c: Category): void;
  onGhost(k: GhostKind): void;
  /** Play one row's run from the start. Only ever offered on a human row. */
  onWatch(entry: BoardEntry): void;
  /** Forget this level's board and fetch it again. */
  onRefresh(): void;
  /**
   * Somebody's bike, small, for one row.
   *
   * Injected rather than imported so this file does not need the level palette
   * or the appearance resolver: an avatar is solved against the level it is
   * drawn on, and the owner of that decision is main.ts, exactly as it is for
   * the board panel.
   */
  avatarFor(entry: BoardEntry): HTMLElement | null;
  /**
   * What to put the keyboard back on when this closes — the button that opened
   * it, in practice, and nothing at all when a pad or a key opened it.
   *
   * Optional, and the fallback is what this panel remembered on the way in.
   * about.ts's note applies word for word: remembering `document.activeElement`
   * alone is not enough, because a click does not necessarily focus the thing
   * it went through, and focusing the body is a no-op.
   */
  returnFocus?(): HTMLElement | null;
}

export interface ChooserUi {
  show(m: ChooserModel): void;
  hide(): void;
  /** A thumbnail landed. Patches the one card rather than rebuilding. */
  setThumb(simHash: string, url: string): void;
  readonly visible: boolean;
  /** Which view is up, for main.ts's key routing and for bin/smoke. */
  readonly view: ChooserView;
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

function button(className: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', () => {
    b.blur();
    onClick();
  });
  return b;
}

export function createChooserUi(root: HTMLElement, cb: ChooserUiCallbacks): ChooserUi {
  root.textContent = '';
  root.classList.add('hidden');
  root.tabIndex = -1;
  let visible = false;
  let view: ChooserView = 'levels';
  /** Flat, in display order. What the arrow keys walk in the grid. */
  let order: ChooserItem[] = [];
  let at = 0;
  /** simHash -> the element holding that level's picture, in whichever view. */
  const cards = new Map<string, HTMLElement>();

  const panel = el('div', 'ch-panel');
  root.append(panel);

  /** What had the keyboard before this opened. See `returnFocus`. */
  let returnTo: HTMLElement | null = null;

  /**
   * MAY THIS ELEMENT BE HANDED THE KEYBOARD?
   *
   * Never a form control, and that is not a style rule. `input.ts` deliberately
   * ignores every command key whose target is an INPUT, a SELECT or a TEXTAREA,
   * so that typing a name into the board's name field cannot restart the run —
   * which means handing focus back to one of those is handing back a keyboard
   * that does nothing. That is exactly the bug the level bar's dropdown had:
   * "i have to click back on screen to use hotkeys". A panel that closes must
   * not be able to recreate it.
   */
  function canTakeFocus(e: Element | null): e is HTMLElement {
    return (
      e instanceof HTMLElement
      && e.isConnected
      && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName)
    );
  }

  /** The picture, or the level's number while it is still being drawn. */
  function shotFor(item: ChooserItem, big: boolean): HTMLElement {
    const shot = el('div', `ch-shot${big ? ' big' : ''}`);
    if (!item.simHash) {
      shot.append(el('span', 'ch-shot-wait bad', '!'));
      return shot;
    }
    const url = cb.thumbUrl(item.simHash);
    if (url) {
      const img = el('img');
      img.src = url;
      img.alt = '';
      shot.append(img);
    } else {
      // A number, not a spinner. The card is complete and readable the instant
      // it appears; the picture arrives into a space it already has, so nothing
      // reflows under the pointer.
      shot.append(el('span', 'ch-shot-wait', item.number === null ? '—' : String(item.number).padStart(2, '0')));
      cb.wantThumb(item.simHash);
    }
    cards.set(item.simHash, shot);
    return shot;
  }

  /** The difficulty bar and its word, or the reason there is no rating. */
  function diffInto(host: HTMLElement, item: ChooserItem): void {
    const diff = el('div', 'ch-diff');
    if (item.rating) {
      const bar = el('span', 'ch-bar');
      const fill = el('i', `ch-fill ${item.rating.band}`);
      fill.style.width = `${Math.max(2, Math.min(100, item.rating.score))}%`;
      bar.append(fill);
      diff.append(bar);
      diff.append(el('span', `ch-band ${item.rating.band}`, `${item.rating.band} ${item.rating.score}`));
    } else {
      // A level with no rating SAYS WHY. It is never shown as easy and an
      // unsolved one is never shown as hard — the solver failing to find a route
      // is an honest "could not", and it has been wrong in that direction twice.
      diff.append(el('span', 'ch-band none', item.unratedNote));
    }
    host.append(diff);
  }

  // --- the grid ---------------------------------------------------------------

  function card(item: ChooserItem, index: number): HTMLElement {
    const b = el('button', 'ch-card');
    b.type = 'button';
    if (item.current) b.classList.add('on');
    if (item.completed) b.classList.add('done');
    if (item.broken) b.classList.add('broken');
    b.dataset.index = String(index);

    b.append(shotFor(item, false));

    const meta = el('div', 'ch-meta');
    const name = el('div', 'ch-name');
    name.append(document.createTextNode(item.label));
    // Only the non-core ones. Absent tier is core and that is the overwhelming
    // majority, so badging it would be twenty identical labels.
    if (item.tier && item.tier !== 'core') name.append(el('span', 'ch-tier', item.tier));
    meta.append(name);

    if (item.broken) {
      meta.append(el('div', 'ch-err', `does not load: ${item.error ?? '?'}`));
    } else {
      // Facts off the level itself. There is no description here because the
      // level format has no description field, and twenty invented sentences
      // would be filler that nobody maintains.
      meta.append(el('div', 'ch-facts', `${item.apples} apples · ${item.spanX} × ${item.spanY} m`));
      diffInto(meta, item);
      if (item.rating) {
        const clear = item.rating.minHeadClearance;
        b.title = `solver difficulty ${item.rating.score}/100 (${item.rating.band})`
          + (clear === null ? '' : ` — ${(clear * 100).toFixed(1)} cm of head clearance at the worst point`)
          + (item.rating.solveSeconds === null ? '' : `, solved in ${item.rating.solveSeconds.toFixed(1)} s`);
      }

      // YOUR BEST AND PAR, ON ONE LINE. Par is the only number on this card that
      // is a property of the LEVEL rather than of somebody's run, so it belongs
      // next to the one number that is yours: together they say "how far off the
      // best line anybody has found am I", which neither says on its own.
      const times = el('div', 'ch-cardtimes');
      times.append(
        item.completed
          ? el('span', 'ch-best done', `best ${item.bestText}s`)
          : el('span', 'ch-best', 'not completed'),
      );
      if (item.parSeconds !== null) {
        times.append(el('span', 'ch-par', `par ${item.parSeconds.toFixed(2)}s`));
      }
      meta.append(times);
    }
    b.append(meta);

    b.addEventListener('click', () => {
      at = index;
      cb.onPick(item.id);
    });
    return b;
  }

  function renderGrid(m: ChooserModel): void {
    panel.append(el('div', 'ch-sub', m.summary));
    for (const g of m.groups) {
      const h = el('div', 'ch-group');
      h.append(el('span', 'ch-group-label', g.label));
      h.append(el('span', 'ch-group-note', g.note));
      panel.append(h);
      const grid = el('div', 'ch-grid');
      for (const item of g.items) {
        const index = order.length;
        order.push(item);
        grid.append(card(item, index));
      }
      panel.append(grid);
    }
    panel.append(
      el(
        'div',
        'ch-foot',
        'Difficulty is measured by the solver — how tight the winning line is, how much head clearance it '
          + 'leaves, and how hard it was to find — not by apple count or level size. Par is the fastest line '
          + 'anything has found. Best times are local to this browser and to this sim rev; everybody else’s '
          + 'are under times.',
      ),
    );
  }

  // --- the board browser ------------------------------------------------------

  function rowFor(line: BrowseLine): HTMLElement {
    if (line.kind === 'par') {
      // PAR IS A ROW, at the rank its time earns. It never offers a `watch`:
      // the time is information and the line is the solution to the puzzle, and
      // being able to watch a programmatically defined best path is the one
      // thing this game deliberately does not have.
      const row = el('div', 'ch-bdrow par');
      row.append(el('span', 'ch-bdrank', '—'));
      // An empty avatar-sized box rather than no box: par has no rider and the
      // rows either side do, and a ladder whose names do not line up reads as a
      // rendering fault rather than as a different kind of row.
      row.append(el('span', 'ch-bdav'));
      row.append(el('span', 'ch-bdname', 'par'));
      row.append(el('span', 'ch-bdtime', line.timeText));
      row.append(el('span', 'ch-bdgap', ''));
      // And a box where the `watch` button would be. Par never offers one —
      // see above — but a column that vanishes on one row slides that row's
      // time out from under the times above it, which reads as a mistake.
      row.append(el('span', 'ch-bdwatchpad'));
      row.title = line.note;
      return row;
    }
    const row = el('div', `ch-bdrow${line.you ? ' you' : ''}`);
    row.append(el('span', 'ch-bdrank', String(line.rank)));
    const av = cb.avatarFor(line.entry);
    if (av) row.append(av);
    row.append(el('span', 'ch-bdname', line.name));
    row.append(el('span', 'ch-bdtime', line.timeText));
    // THE GAP TO THE ROW ABOVE, which is the number a per-level popup never
    // showed. An absolute time says nothing you can act on; "0.412s behind"
    // says whether the next place is one clean corner away.
    row.append(el('span', 'ch-bdgap', line.behindText ? `+${line.behindText}` : 'leader'));
    if (line.watchable) {
      row.append(button('ch-bdwatch', 'watch', 'play this run from the start', () => cb.onWatch(line.entry)));
    }
    return row;
  }

  function renderBrowse(m: ChooserModel): void {
    const b = m.browse;
    if (!b) {
      panel.append(el('div', 'ch-bdnote', 'no levels to browse'));
      return;
    }

    // --- the stepper. This is the "skip through levels" half, and it is the
    // first thing on the screen because it is the verb the ask was written in.
    // What Enter rides, and what the grid would have selected: the level being
    // browsed. One index for both views means Enter never loads a level other
    // than the one whose board is on screen.
    at = Math.max(0, Math.min(order.length - 1, b.at - 1));

    // --- the level itself, as a header rather than as a card.
    //
    // The NAME is not repeated here: it is in the sticky head, beside the
    // stepper that changes it, which is both where it is most useful and the
    // only place it stays on screen once the ladder is scrolled. A 736 x 280
    // phone has 280 px in total and the first draft spent 215 of them on this
    // block, which left a leaderboard one and a half rows tall.
    const lv = el('div', 'ch-lv');
    lv.append(shotFor(b.item, true));
    const meta = el('div', 'ch-lvmeta');
    if (b.item.tier && b.item.tier !== 'core') meta.append(el('span', 'ch-tier', b.item.tier));
    if (b.facts) meta.append(el('div', 'ch-facts', b.facts));
    diffInto(meta, b.item);

    const nums = el('div', 'ch-nums');
    if (b.parText) nums.append(el('span', 'ch-par', b.parText));
    nums.append(el('span', `ch-best${b.bestText ? ' done' : ''}`, b.bestText || 'not completed'));
    if (b.parGapText) nums.append(el('span', 'ch-pargap', b.parGapText));
    meta.append(nums);
    lv.append(meta);

    // RIDE IT. The one control on this screen that loads a level, said in as
    // many words, because everything else here deliberately does not.
    const go = el('div', 'ch-lvgo');
    if (!b.item.broken) {
      go.append(button('ch-ride', 'ride this level', 'load it and play (Enter)', () => cb.onPick(b.item.id)));
    }
    lv.append(go);
    panel.append(lv);

    // --- the board's own head: which category, how many, and a refresh.
    const head = el('div', 'ch-bdhead');
    const cats = el('span', 'ch-cats');
    for (const c of ['human', 'tas'] as Category[]) {
      const btn = button(
        `ch-cat${b.category === c ? ' on' : ''}`,
        c === 'human' ? 'human' : 'TAS',
        c === 'human' ? 'times set by people' : 'times set by the solver — the numbers only, never the lines',
        () => cb.onCategory(c),
      );
      cats.append(btn);
    }
    head.append(cats);
    head.append(el('span', 'ch-entries', b.entriesText));
    head.append(button('ch-refresh', '↻', 'fetch this board again', () => cb.onRefresh()));
    panel.append(head);

    const list = el('div', 'ch-bdlist');
    for (const line of b.lines) list.append(rowFor(line));
    if (b.lines.length === 0) list.append(el('div', 'ch-bdnote', b.note || 'nothing here'));
    panel.append(list);

    if (b.note && b.lines.length > 0) panel.append(el('div', 'ch-bdnote', b.note));
    if (b.standing) panel.append(el('div', 'ch-stand', b.standing));

    if (b.category === 'tas' && b.lines.length > 0) {
      // Said plainly HERE, where somebody has deliberately opened the TAS
      // category and already knows machine runs exist, rather than anywhere in
      // ordinary play. It says the times are the whole of what this board is,
      // which is simply true: there is no `watch` on any row of it.
      panel.append(
        el(
          'div',
          'ch-bdnote',
          'these are machine runs — proof the level goes, and a number to chase. Only the times: a solver '
            + 'picks the apple order by searching it, and that order is the level rather than a race.',
        ),
      );
    }
    if (b.revNote) panel.append(el('div', 'ch-bdnote', b.revNote));

    // THE GHOST PICKER, which had no touch path at all while it lived only on
    // the desktop board panel. It is a preference about play rather than about
    // this level, so it sits in the footer and says so — but it is HERE because
    // this is the screen a phone can reach, and "turn the ghost off while I
    // learn this level" is the one choice somebody learning actually wants.
    const ghost = el('div', 'ch-ghost');
    const label = el('label', 'ch-ghostlabel', 'ghost you race (human runs)');
    const sel = el('select');
    sel.id = 'ch-ghost-select';
    label.htmlFor = sel.id;
    for (const k of GHOST_KINDS) {
      const o = el('option', undefined, GHOST_LABELS[k]);
      o.value = k;
      sel.append(o);
    }
    sel.value = m.ghost;
    sel.addEventListener('change', () => cb.onGhost(sel.value as GhostKind));
    // The arrows open and walk a native select. Without this they would also
    // be walking the level stepper underneath it.
    sel.addEventListener('keydown', (e) => e.stopPropagation());
    sel.addEventListener('keyup', (e) => e.stopPropagation());
    ghost.append(label, sel);
    panel.append(ghost);

    panel.append(
      el(
        'div',
        'ch-foot',
        'Times are verified by re-simulation on the server; names are not authenticated. The board is scoped '
          + 'to this sim rev — through milestone 1 the rev bumps freely and the live board resets, and old '
          + 'times are kept and labelled rather than deleted. Par comes from the solver and is a property of '
          + 'the level, not of anybody’s run.',
      ),
    );
  }

  // --- the frame around both ---------------------------------------------------

  function render(m: ChooserModel): void {
    panel.textContent = '';
    cards.clear();
    order = [];
    view = m.view;
    root.classList.toggle('ch-times', view === 'times');

    // STICKY, so the way out is on screen after twenty-four cards or fifty
    // rows. Every panel on this project has shipped at least one state where
    // the close button was below the fold on a 280 px phone.
    const head = el('div', 'ch-head');
    if (view === 'times' && m.browse) {
      // THE STEPPER LIVES IN THE STICKY HEAD, which is the one part of this
      // screen that is always on glass. "Skip through levels" is the verb the
      // whole feature was asked for, so it may not be a thing you have to
      // scroll back up to reach — and putting the level's NAME between the two
      // arrows makes the head say what you are looking at as well as how to
      // leave it.
      head.append(button('ch-stepbtn', '‹', 'previous level (←)', () => cb.onStep(-1)));
      const title = el('span', 'ch-title');
      title.append(document.createTextNode(m.browse.item.label));
      if (m.browse.item.current) title.append(el('span', 'ch-here', 'on screen'));
      head.append(title);
      head.append(el('span', 'ch-at', `${m.browse.at} / ${m.browse.of}`));
      head.append(button('ch-stepbtn', '›', 'next level (→)', () => cb.onStep(1)));
    } else {
      head.append(el('span', 'ch-title', 'levels'));
    }
    const views = el('span', 'ch-views');
    for (const v of CHOOSER_VIEWS) {
      views.append(
        button(
          `ch-view${m.view === v ? ' on' : ''}`,
          v === 'levels' ? 'levels' : 'times',
          v === 'levels' ? 'pictures, difficulty and your best' : 'every level’s leaderboard, without loading it',
          () => cb.onView(v),
        ),
      );
    }
    head.append(views);
    if (view === 'levels') {
      const sorts = el('span', 'ch-sorts');
      for (const s of ['number', 'difficulty'] as ChooserSort[]) {
        sorts.append(
          button(
            `ch-sort${m.sort === s ? ' on' : ''}`,
            s === 'number' ? 'in order' : 'by difficulty',
            '',
            () => cb.onSort(s),
          ),
        );
      }
      head.append(sorts);
    }
    head.append(button('ch-close', '✕', 'close (Esc)', () => cb.onClose()));
    panel.append(head);

    if (view === 'times') {
      // The order the stepper walks is the order the grid shows, so a sort
      // chosen over there is a browse order over here for free.
      for (const g of m.groups) for (const i of g.items) order.push(i);
      renderBrowse(m);
      return;
    }
    renderGrid(m);
    at = Math.max(0, order.findIndex((i) => i.current));
    focusCard();
  }

  function focusCard(): void {
    const btns = panel.querySelectorAll<HTMLElement>('.ch-card');
    for (let i = 0; i < btns.length; i++) btns[i].classList.toggle('sel', i === at);
    const cur = btns[at];
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  function move(delta: number): void {
    if (order.length === 0) return;
    at = (at + delta + order.length) % order.length;
    focusCard();
  }

  // THE CHOOSER OWNS THESE KEYS WHILE IT IS OPEN, and takes them off the game
  // with `stopPropagation` rather than by adding a mode flag to input.ts. The
  // arrows and Space are SIM INPUT — lean and flip — so without this, walking
  // the grid would also be leaning the bike underneath, and the flip bit would
  // still be held when the menu closed.
  //
  // `[` and `]` are swallowed IN THE TIMES VIEW ONLY, and that is the one
  // difference between the two. In the grid they are still let through and
  // still step the loaded level instantly, which rule 2 at the top of this file
  // exists to protect. In the times view they mean the same thing the arrows
  // do — step which board you are looking at — because stepping the level you
  // are RIDING underneath a leaderboard of a different level is a state nobody
  // asked for and the screen cannot show.
  root.addEventListener('keydown', (e) => {
    const times = view === 'times';
    switch (e.code) {
      case 'ArrowRight':
      case 'BracketRight':
        if (times) cb.onStep(1);
        else if (e.code === 'ArrowRight') move(1);
        else return;
        break;
      case 'ArrowLeft':
      case 'BracketLeft':
        if (times) cb.onStep(-1);
        else if (e.code === 'ArrowLeft') move(-1);
        else return;
        break;
      case 'ArrowDown':
        if (times) root.scrollBy({ top: 64 });
        else move(1);
        break;
      case 'ArrowUp':
        if (times) root.scrollBy({ top: -64 });
        else move(-1);
        break;
      case 'PageDown':
      case 'PageUp':
        if (!times) return;
        root.scrollBy({ top: (e.code === 'PageDown' ? 0.85 : -0.85) * root.clientHeight });
        break;
      case 'Home':
        if (times) root.scrollTop = 0;
        else {
          at = 0;
          focusCard();
        }
        break;
      case 'End':
        if (times) root.scrollTop = root.scrollHeight;
        else {
          at = Math.max(0, order.length - 1);
          focusCard();
        }
        break;
      case 'Space':
        // SCROLLS the board rather than riding it. Space is `flip` in play and
        // "page down" in every document a person has ever read; making it load
        // a level from a screen you are reading would be the one keystroke on
        // this panel that costs a run to undo.
        if (times) root.scrollBy({ top: 0.85 * root.clientHeight });
        else if (order[at]) cb.onPick(order[at].id);
        break;
      case 'Enter':
      case 'NumpadEnter':
        if (order[at]) cb.onPick(order[at].id);
        break;
      case 'Escape':
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
  const RELEASES = [
    'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Space', 'Enter', 'NumpadEnter',
    'BracketLeft', 'BracketRight', 'PageUp', 'PageDown',
  ];
  root.addEventListener('keyup', (e) => {
    if (!RELEASES.includes(e.code)) return;
    // `[` and `]` are only ours in the times view; releasing them for a press
    // the game never saw is exactly the stuck-bit hazard above, in reverse.
    if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && view !== 'times') return;
    e.preventDefault();
    e.stopPropagation();
  });

  return {
    show(m: ChooserModel): void {
      const wasOpen = visible;
      render(m);
      root.classList.remove('hidden');
      visible = true;
      // Only on the way IN. A re-render while it is open — a board landing, a
      // step, a category switch — must not yank the keyboard off whatever the
      // player is using, and it must not scroll them back to the top.
      if (!wasOpen) {
        returnTo = canTakeFocus(document.activeElement) ? document.activeElement : null;
        root.scrollTop = 0;
        root.focus();
      }
    },
    hide(): void {
      // THE KEYBOARD GOES SOMEWHERE THE GAME CAN HEAR IT, and it is let go of
      // BEFORE the panel is hidden rather than after.
      //
      // `#chooser.hidden` is `display: none`, and a browser moves focus off a
      // hidden element on its own — so in Chrome this mostly worked by
      // accident. It is an accident this panel is not entitled to: the rule is
      // about `display`, a panel hidden any other way (visibility, a transform
      // off-screen, a future animation) keeps the keyboard inside a thing
      // nobody can see, and every key then goes to an element the game is not
      // listening on. Letting go explicitly makes it true by construction.
      if (root.contains(document.activeElement) && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      root.classList.add('hidden');
      visible = false;
      // The button that opened it first, then whatever had the keyboard before
      // it opened — and NEITHER if it is a form control. With nothing to give
      // it back to the keyboard lands on the body, which is where `input.ts`
      // hears it: the listeners are on `window`, so an unfocused page is a
      // playable one.
      const back = cb.returnFocus?.() ?? returnTo;
      if (canTakeFocus(back)) back.focus({ preventScroll: true });
      returnTo = null;
    },
    setThumb(simHash: string, url: string): void {
      const shot = cards.get(simHash);
      if (!shot) return;
      shot.textContent = '';
      const img = el('img');
      img.src = url;
      img.alt = '';
      shot.append(img);
    },
    get visible(): boolean {
      return visible;
    },
    get view(): ChooserView {
      return view;
    },
  };
}
