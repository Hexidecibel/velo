// The end-of-level panel, as elements.
//
// Everything it DECIDES lives in results.ts and is tested in plain node; this
// file only turns a `ResultsModel` into nodes. The split is the same one
// boardui.ts makes and for the same reason — there is no jsdom in this repo.
//
// TWO RULES GOVERN EVERY LINE BELOW.
//
//   1. IT APPEARS ON A FINISH AND NEVER ON A DEATH. Dying is the common case and
//      it already has instant restart; a panel in front of that would ruin the
//      core loop. main.ts owns that call and this file never second-guesses it.
//   2. DISMISSAL IS INSTANT AND NOTHING ANIMATES IN. No fade, no slide, no
//      transition of any kind — a player who wants to hit R the moment they
//      cross the line must never feel this screen was in the way. `hidden` is a
//      class toggle and the panel is built synchronously.
//
// Names come off the network and are typed by other people, so every one of them
// is written with `textContent`. Same absolute rule as boardui.ts.
import type { ActionId, ResultsModel } from './results.ts';
import { fmtTime } from './results.ts';

export interface ResultsUiCallbacks {
  onAction(id: ActionId): void;
  /** Watch one row's run from the start. Human rows only — see ghost.ts. */
  onWatchRow(replayId: string): void;
}

export interface ResultsUi {
  /** Draw a model. Called on the finishing frame and again as the network lands. */
  update(model: ResultsModel): void;
  hide(): void;
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

export function createResultsUi(root: HTMLElement, cb: ResultsUiCallbacks): ResultsUi {
  root.textContent = '';
  root.classList.add('hidden');
  let visible = false;

  const panel = el('div', 'rs-panel');
  root.append(panel);

  // Rebuilt wholesale, like the board panel. It is forty nodes and it changes
  // twice in a run's lifetime — once when the run ends and once when the post
  // resolves — so a rebuild cannot fall out of step with the data.
  function render(m: ResultsModel): void {
    panel.textContent = '';

    panel.append(el('div', 'rs-head', 'FINISHED'));
    panel.append(el('div', 'rs-level', m.levelName));

    // The time, large. It is the thing they came for and it is the only thing on
    // this screen allowed to be big.
    const time = el('div', 'rs-time');
    time.append(el('span', 'rs-time-num', m.time));
    time.append(el('span', 'rs-time-unit', 's'));
    panel.append(time);

    // A new best is marked unmistakably — its own line, its own colour, and the
    // words rather than a symbol.
    if (m.pb.newPb) {
      panel.append(el('div', 'rs-pb new', m.pb.kind === 'first' ? 'FIRST FINISH' : 'NEW PERSONAL BEST'));
    }
    panel.append(el('div', `rs-delta ${m.pb.kind}`, m.pb.text));
    panel.append(el('div', 'rs-apples', `${m.apples} apples`));

    // --- did it count ---
    if (m.submit.text) {
      const sub = el('div', `rs-submit ${m.submit.tone}`);
      sub.append(el('div', 'rs-submit-line', m.submit.text));
      if (m.submit.fix) sub.append(el('div', 'rs-fix', m.submit.fix));
      if (m.submit.detail) sub.append(el('div', 'rs-detail', m.submit.detail));
      panel.append(sub);
    }

    // --- where you stand ---
    if (m.standing) panel.append(el('div', 'rs-standing', m.standing.text));

    // --- the compact board ---
    if (m.rows.length > 0) {
      const list = el('div', 'rs-list');
      for (const r of m.rows) {
        // The break above a detached row: without it "#12" directly under "#5"
        // reads as a board with rows missing rather than as a jump to you.
        if (r.detached) list.append(el('div', 'rs-break', '⋯'));
        const row = el('div', `rs-row${r.you ? ' you' : ''}`);
        row.append(el('span', 'rs-rank', String(r.rank)));
        row.append(el('span', 'rs-name', r.name));
        row.append(el('span', 'rs-rowtime', `${fmtTime(r.timeTicks)}s`));
        const watch = el('button', 'rs-watch', 'watch');
        watch.title = 'play this run from the start';
        watch.addEventListener('click', () => {
          watch.blur();
          cb.onWatchRow(r.replayId);
        });
        row.append(watch);
        list.append(row);
      }
      panel.append(list);
    }

    // The TAS TIME as information. Its LINE is offered only through the action
    // list, and only once this level has been finished — see ghost.ts.
    if (m.tasTime) panel.append(el('div', 'rs-tas', `TAS ${m.tasTime}s — machine run, separate category`));

    // --- the actions, keyboard first ---
    const acts = el('div', 'rs-acts');
    for (const a of m.actions) {
      const b = el('button', `rs-act${a.primary ? ' primary' : ''}`);
      b.append(el('kbd', undefined, a.key));
      b.append(el('span', 'rs-act-label', a.label));
      // BLUR FIRST. A clicked button keeps focus, and the browser then fires
      // its click again on the next Enter — which on this panel is "next level"
      // as well, so one Enter would do two things. Handing focus back to the
      // document keeps the keyboard bindings the only interpretation of a key.
      b.addEventListener('click', () => {
        b.blur();
        cb.onAction(a.id);
      });
      acts.append(b);
    }
    panel.append(acts);
  }

  return {
    get visible() {
      return visible;
    },
    update(model: ResultsModel): void {
      render(model);
      visible = true;
      root.classList.remove('hidden');
    },
    hide(): void {
      // One class toggle, no transition. See the note at the top of the file.
      visible = false;
      root.classList.add('hidden');
    },
  };
}
