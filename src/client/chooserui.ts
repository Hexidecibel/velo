// The level chooser, as elements.
//
// Everything it DECIDES lives in chooser.ts and is tested in plain node; this
// file only turns groups of `ChooserItem` into nodes and owns the keyboard
// while it is open. Same split boardui.ts and resultsui.ts make, same reason —
// there is no jsdom in this repo.
//
// THREE THINGS GOVERN THE LAYOUT.
//
//   1. THE PICTURE IS THE POINT. A list of twenty names cannot answer "which
//      one was the one with the chimney", and a picture answers it instantly.
//      It is drawn by the real renderer at overview framing (thumbs.ts), so it
//      cannot drift from the level.
//   2. IT MUST NOT SLOW DOWN CHANGING LEVEL. `[` and `]` never open this, and
//      the dropdown in the level bar still works exactly as before. This is for
//      choosing, not for stepping.
//   3. SAME CHROME AS EVERYTHING ELSE. The board, the results panel and this
//      are the same drab surface with the same borders, because the readability
//      rule says the highest-contrast things on screen are the bike and the
//      collision edge — including when a menu is over them.
import type { ChooserGroup, ChooserItem, ChooserSort } from './chooser.ts';

export interface ChooserModel {
  groups: readonly ChooserGroup[];
  summary: string;
  sort: ChooserSort;
}

export interface ChooserUiCallbacks {
  onPick(id: string): void;
  onSort(sort: ChooserSort): void;
  onClose(): void;
  /** The picture, if it has been drawn. Never triggers a render. */
  thumbUrl(simHash: string): string | null;
  /** Ask for one. Queued, one per frame, abandoned when this closes. */
  wantThumb(simHash: string): void;
}

export interface ChooserUi {
  show(m: ChooserModel): void;
  hide(): void;
  /** A thumbnail landed. Patches the one card rather than rebuilding. */
  setThumb(simHash: string, url: string): void;
  readonly visible: boolean;
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

export function createChooserUi(root: HTMLElement, cb: ChooserUiCallbacks): ChooserUi {
  root.textContent = '';
  root.classList.add('hidden');
  root.tabIndex = -1;
  let visible = false;
  /** Flat, in display order. What the arrow keys walk. */
  let order: ChooserItem[] = [];
  let at = 0;
  const cards = new Map<string, HTMLElement>();

  const panel = el('div', 'ch-panel');
  root.append(panel);

  function card(item: ChooserItem, index: number): HTMLElement {
    const b = el('button', 'ch-card');
    if (item.current) b.classList.add('on');
    if (item.completed) b.classList.add('done');
    if (item.broken) b.classList.add('broken');
    b.dataset.index = String(index);

    const shot = el('div', 'ch-shot');
    if (item.simHash) {
      const url = cb.thumbUrl(item.simHash);
      if (url) {
        const img = el('img');
        img.src = url;
        img.alt = '';
        shot.append(img);
      } else {
        // A number, not a spinner. The card is complete and readable the
        // instant it appears; the picture arrives into a space it already has,
        // so nothing reflows under the pointer.
        shot.append(el('span', 'ch-shot-wait', item.number === null ? '—' : String(item.number).padStart(2, '0')));
        cb.wantThumb(item.simHash);
      }
      cards.set(item.simHash, shot);
    } else {
      shot.append(el('span', 'ch-shot-wait bad', '!'));
    }
    b.append(shot);

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

      const diff = el('div', 'ch-diff');
      if (item.rating) {
        const bar = el('span', 'ch-bar');
        const fill = el('i', `ch-fill ${item.rating.band}`);
        fill.style.width = `${Math.max(2, Math.min(100, item.rating.score))}%`;
        bar.append(fill);
        diff.append(bar);
        diff.append(el('span', `ch-band ${item.rating.band}`, `${item.rating.band} ${item.rating.score}`));
        const clear = item.rating.minHeadClearance;
        b.title = `solver difficulty ${item.rating.score}/100 (${item.rating.band})`
          + (clear === null ? '' : ` — ${(clear * 100).toFixed(1)} cm of head clearance at the worst point`)
          + (item.rating.solveSeconds === null ? '' : `, solved in ${item.rating.solveSeconds.toFixed(1)} s`);
      } else {
        diff.append(el('span', 'ch-band none', item.unratedNote));
      }
      meta.append(diff);

      meta.append(
        item.completed
          ? el('div', 'ch-best done', `best ${item.bestText}s`)
          : el('div', 'ch-best', 'not completed'),
      );
    }
    b.append(meta);

    b.addEventListener('click', () => {
      at = index;
      cb.onPick(item.id);
    });
    return b;
  }

  function render(m: ChooserModel): void {
    panel.textContent = '';
    cards.clear();
    order = [];

    const head = el('div', 'ch-head');
    head.append(el('span', 'ch-title', 'levels'));
    const sorts = el('span', 'ch-sorts');
    for (const s of ['number', 'difficulty'] as ChooserSort[]) {
      const btn = el('button', `ch-sort${m.sort === s ? ' on' : ''}`, s === 'number' ? 'in order' : 'by difficulty');
      btn.addEventListener('click', () => cb.onSort(s));
      sorts.append(btn);
    }
    head.append(sorts);
    const close = el('button', 'ch-close', '✕');
    close.title = 'close (Esc)';
    close.addEventListener('click', () => cb.onClose());
    head.append(close);
    panel.append(head);
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
          + 'leaves, and how hard it was to find — not by apple count or level size. Best times are local to '
          + 'this browser and to this sim rev; the leaderboard is B.',
      ),
    );

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
  // still be held when the menu closed. Everything else is deliberately let
  // through, so `[`, `]`, H and C behave exactly as they do in play.
  root.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'ArrowRight':
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        move(-1);
        break;
      case 'Home':
        at = 0;
        focusCard();
        break;
      case 'End':
        at = Math.max(0, order.length - 1);
        focusCard();
        break;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
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
  root.addEventListener('keyup', (e) => {
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Space', 'Enter', 'NumpadEnter'].includes(e.code)) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  return {
    show(m: ChooserModel): void {
      render(m);
      root.classList.remove('hidden');
      visible = true;
      root.focus();
    },
    hide(): void {
      root.classList.add('hidden');
      visible = false;
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
  };
}
