// The editor's panel. DOM only — every decision it displays was made somewhere
// testable, which is why this file has no logic in it worth testing and no test
// beside it. It renders a model and reports clicks.
//
// It sits where the tuning panel sits and looks like it, because it is the same
// kind of thing: an instrument beside the game rather than a screen in front of
// it. The canvas keeps the whole of the rest of the window, which is the point
// — you are editing the level you are looking at.
//
// EVERY KEY THE EDITOR OWNS IS PRINTED ON IT. That is the house rule for a mode
// that rebinds keys (the results screen does the same), and here it matters
// more than usual: the editor takes over A, S, D and W, which are the driving
// keys everywhere else in the game.
import type { EditDoc } from './doc.ts';
import type { CheckResult, Finding } from './check.ts';
import type { SaveVerdict } from './save.ts';
import type { SolveSummary } from './solve.ts';
import type { Handle } from './geom.ts';

export interface PanelModel {
  doc: EditDoc;
  check: CheckResult;
  verdict: SaveVerdict;
  selection: Handle | null;
  grid: number;
  gridOn: boolean;
  showWarnings: boolean;
  bikeOn: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Null when no solve has been asked for in this session. */
  solve: SolveSummary | null;
  solveRunning: boolean;
  solveSeconds: number;
  /** Set when the endpoint is absent, so the panel can say what saving means. */
  endpointNote: string;
  message: string;
  messageBad: boolean;
}

export interface PanelHooks {
  onMeta(patch: { id?: string; name?: string; author?: string }): void;
  onSelectionNumber(field: 'x' | 'y' | 'bulge', value: number): void;
  onSave(): void;
  onNew(): void;
  onRide(): void;
  onSolve(): void;
  onStopSolve(): void;
  onWatch(): void;
  onUndo(): void;
  onRedo(): void;
  onGrid(size: number, on: boolean): void;
  onToggleWarnings(on: boolean): void;
  onToggleBike(on: boolean): void;
  onSolveSeconds(v: number): void;
  onFocusFinding(f: Finding): void;
}

export interface EditorPanel {
  el: HTMLElement;
  sync(m: PanelModel): void;
  /** Put the caret in the X field, for the "type an exact number" key. */
  focusNumber(): void;
}

export const GRID_SIZES = [0.05, 0.1, 0.25, 0.5, 1, 2, 5];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export function createEditorPanel(root: HTMLElement, hooks: PanelHooks): EditorPanel {
  root.textContent = '';
  root.classList.add('edpanel');

  const h1 = el('h1', '', 'level editor');
  const sub = el('div', 'sub');
  root.append(h1, sub);

  // --- identity -------------------------------------------------------------
  const idIn = el('input');
  idIn.type = 'text';
  idIn.spellcheck = false;
  const nameIn = el('input');
  nameIn.type = 'text';
  const authorIn = el('input');
  authorIn.type = 'text';
  root.append(field('file', idIn, 'levels/<this>.json'), field('name', nameIn), field('author', authorIn));
  idIn.addEventListener('input', () => hooks.onMeta({ id: idIn.value.trim() }));
  nameIn.addEventListener('input', () => hooks.onMeta({ name: nameIn.value }));
  authorIn.addEventListener('input', () => hooks.onMeta({ author: authorIn.value }));

  // --- the loop -------------------------------------------------------------
  const rideBtn = el('button', 'primary', 'ride  Q');
  const saveBtn = el('button', '', 'save');
  const newBtn = el('button', '', 'new level');
  const undoBtn = el('button', '', 'undo  Z');
  const redoBtn = el('button', '', 'redo  ⇧Z');
  const btns = el('div', 'btns');
  btns.append(rideBtn, saveBtn, newBtn, undoBtn, redoBtn);
  root.append(btns);
  rideBtn.addEventListener('click', () => hooks.onRide());
  saveBtn.addEventListener('click', () => hooks.onSave());
  // FROM NOTHING, not only from a fork. The editor's first user went looking
  // for this within a minute: forking is the right default when you are
  // standing in a level, and it is the wrong and only option when the level you
  // want has nothing to do with the one you happen to be on.
  newBtn.addEventListener('click', () => hooks.onNew());
  undoBtn.addEventListener('click', () => hooks.onUndo());
  redoBtn.addEventListener('click', () => hooks.onRedo());

  const saveNote = el('div', 'note');
  const msg = el('div', 'note');
  root.append(saveNote, msg);

  // --- selection ------------------------------------------------------------
  root.append(h2('selection', 'drag a handle, or type the number'));
  const selWhat = el('div', 'note');
  const xIn = numberInput();
  const yIn = numberInput();
  const bIn = numberInput();
  const grid3 = el('div', 'ed-nums');
  grid3.append(label('x'), xIn, label('y'), yIn, label('bulge'), bIn);
  root.append(selWhat, grid3);
  xIn.addEventListener('change', () => hooks.onSelectionNumber('x', Number(xIn.value)));
  yIn.addEventListener('change', () => hooks.onSelectionNumber('y', Number(yIn.value)));
  bIn.addEventListener('change', () => hooks.onSelectionNumber('bulge', Number(bIn.value)));

  // --- drawing aids ---------------------------------------------------------
  root.append(h2('aids', 'the bike is 1.7 m long; 1.20 m of gap is clean, 1.10 m kills'));
  const gridChk = checkbox('snap to grid  G');
  const gridSel = el('select');
  for (const g of GRID_SIZES) {
    const o = el('option');
    o.value = String(g);
    o.textContent = `${g} m`;
    gridSel.append(o);
  }
  const warnChk = checkbox('show warnings');
  const bikeChk = checkbox('bike at the pointer  B');
  const aids = el('div', 'ed-aids');
  aids.append(gridChk.wrap, gridSel, warnChk.wrap, bikeChk.wrap);
  root.append(aids);
  gridChk.input.addEventListener('change', () => hooks.onGrid(Number(gridSel.value), gridChk.input.checked));
  gridSel.addEventListener('change', () => hooks.onGrid(Number(gridSel.value), gridChk.input.checked));
  warnChk.input.addEventListener('change', () => hooks.onToggleWarnings(warnChk.input.checked));
  bikeChk.input.addEventListener('change', () => hooks.onToggleBike(bikeChk.input.checked));

  // --- the fast tier --------------------------------------------------------
  root.append(h2('checks', 'the loader and the sag metric, live'));
  const checkLine = el('div', 'note');
  const findingList = el('div', 'ed-findings');
  root.append(checkLine, findingList);

  // --- the deliberate tier --------------------------------------------------
  root.append(h2('solve', 'bin/solve — minutes, not milliseconds'));
  const solveBtns = el('div', 'btns');
  const solveBtn = el('button', '', 'solve  ^ENTER');
  const stopBtn = el('button', '', 'stop');
  const watchBtn = el('button', '', 'watch it');
  const secsSel = el('select');
  for (const s of [60, 120, 300, 600, 900]) {
    const o = el('option');
    o.value = String(s);
    o.textContent = `${s >= 60 ? s / 60 + ' min' : s + ' s'} budget`;
    secsSel.append(o);
  }
  solveBtns.append(solveBtn, stopBtn, watchBtn);
  root.append(solveBtns, secsSel);
  solveBtn.addEventListener('click', () => hooks.onSolve());
  stopBtn.addEventListener('click', () => hooks.onStopSolve());
  watchBtn.addEventListener('click', () => hooks.onWatch());
  secsSel.addEventListener('change', () => hooks.onSolveSeconds(Number(secsSel.value)));
  const solveHead = el('div', 'note');
  const solveRows = el('div', 'ed-rows');
  root.append(solveHead, solveRows);

  // --- keys -----------------------------------------------------------------
  root.append(h2('keys', 'the editor owns these while it is open'));
  const keys = el('div', 'keys');
  keys.innerHTML =
    '<b>Q</b> back to riding &nbsp; <b>Z</b> / <b>&#8679;Z</b> undo, redo<br>' +
    '<b>N</b> new polygon at the pointer &#8212; <b>1</b> cave <b>2</b> ground <b>3</b> decor<br>' +
    '<b>ENTER</b> close it &nbsp; <b>ESC</b> discard it / deselect<br>' +
    '<b>drag a vertex</b> to move it &nbsp; <b>drag a diamond</b> to bend the edge<br>' +
    '<b>E</b> insert a vertex in the nearest edge &nbsp; <b>DEL</b> delete<br>' +
    '<b>A</b> apple here &nbsp; <b>S</b> start here &nbsp; <b>F</b> flower here<br>' +
    '<b>arrows</b> nudge by the grid (&#8679; ten, ALT a centimetre)<br>' +
    '<b>T</b> type an exact number &nbsp; <b>G</b> grid &nbsp; <b>[ ]</b> grid size<br>' +
    '<b>right-drag</b> pan &nbsp; <b>wheel</b> zoom &nbsp; <b>TAB</b> frame the level<br>' +
    '<b>^S</b> save &nbsp; <b>^ENTER</b> solve';
  root.append(keys);

  function field(name: string, input: HTMLElement, hint = ''): HTMLElement {
    const row = el('div', 'row');
    row.append(label(name), input);
    if (hint) row.append(el('div', 'hint', hint));
    return row;
  }
  function label(t: string): HTMLElement {
    return el('label', '', t);
  }
  function h2(t: string, why: string): HTMLElement {
    const e = el('h2', '', t);
    const w = el('span', 'why', why);
    e.append(w);
    return e;
  }
  function numberInput(): HTMLInputElement {
    const i = el('input');
    i.type = 'number';
    i.step = '0.01';
    return i;
  }
  function checkbox(text: string): { wrap: HTMLElement; input: HTMLInputElement } {
    const w = el('label', 'ed-chk');
    const i = el('input');
    i.type = 'checkbox';
    w.append(i, document.createTextNode(' ' + text));
    return { wrap: w, input: i };
  }

  let lastFindings = '';

  return {
    el: root,
    focusNumber(): void {
      xIn.focus();
      xIn.select();
    },
    sync(m: PanelModel): void {
      const parent = m.doc.parent ? ` ← forked from ${m.doc.parent.name}` : '';
      sub.textContent = `${m.doc.tier}${parent}${m.dirty ? '  • unsaved' : ''}`;
      if (document.activeElement !== idIn) idIn.value = m.doc.id;
      if (document.activeElement !== nameIn) nameIn.value = m.doc.name;
      if (document.activeElement !== authorIn) authorIn.value = m.doc.author;

      saveBtn.textContent = m.verdict.label;
      saveBtn.disabled = !m.verdict.can;
      saveBtn.className = m.verdict.can && m.verdict.route === 'repo' ? 'primary' : '';
      saveNote.textContent = m.verdict.note || m.endpointNote;
      undoBtn.disabled = !m.canUndo;
      redoBtn.disabled = !m.canRedo;
      msg.textContent = m.message;
      msg.className = m.messageBad ? 'note bad' : 'note';

      // selection
      const s = m.selection;
      const v = s && s.kind === 'vertex' ? m.doc.polygons[s.pi]?.verts[s.vi] : null;
      const arc = s && s.kind === 'arc' ? m.doc.polygons[s.pi]?.verts[s.vi] : null;
      const obj = s && (s.kind === 'start' || s.kind === 'flower' || s.kind === 'apple')
        ? (s.kind === 'apple' ? m.doc.apples[s.pi] : s.kind === 'start' ? m.doc.start : m.doc.flower)
        : null;
      selWhat.textContent = !s
        ? 'nothing selected'
        : s.kind === 'vertex'
          ? `${m.doc.polygons[s.pi]?.kind} polygon ${s.pi}, vertex ${s.vi} of ${m.doc.polygons[s.pi]?.verts.length}`
          : s.kind === 'arc'
            ? `the edge arriving at polygon ${s.pi} vertex ${s.vi} — bulge is the sagitta in metres, + humps left`
            : s.kind === 'apple' ? `apple ${s.pi}` : s.kind;
      const px = v ? v.x : arc ? null : obj ? obj.x : null;
      const py = v ? v.y : arc ? null : obj ? obj.y : null;
      setNum(xIn, px);
      setNum(yIn, py);
      setNum(bIn, arc ? arc.bulge : v ? v.bulge : null);

      gridChk.input.checked = m.gridOn;
      gridSel.value = String(m.grid);
      warnChk.input.checked = m.showWarnings;
      bikeChk.input.checked = m.bikeOn;

      // the fast tier
      checkLine.textContent = m.check.loadError
        ? 'DOES NOT LOAD'
        : `${m.check.errors} error${m.check.errors === 1 ? '' : 's'}, ${m.check.warns} warning${m.check.warns === 1 ? '' : 's'}`;
      checkLine.className = m.check.errors ? 'note bad' : m.check.warns ? 'note warn' : 'note ok';
      // Rebuilt only when it changed: this runs on every pointermove and
      // rebuilding forty rows forty times a second is how an editor gets a
      // reputation for being sluggish while doing nothing.
      const key = m.check.findings.map((f) => f.cls + f.message).join('|');
      if (key !== lastFindings) {
        lastFindings = key;
        findingList.textContent = '';
        for (const f of m.check.findings.slice(0, 40)) {
          const row = el('div', `ed-finding ${f.severity}`);
          row.append(el('span', 'ed-tag', f.cls), document.createTextNode(' ' + f.message));
          if (f.at) row.addEventListener('click', () => hooks.onFocusFinding(f));
          findingList.append(row);
        }
        if (m.check.findings.length > 40) {
          findingList.append(el('div', 'note', `and ${m.check.findings.length - 40} more`));
        }
      }

      // the deliberate tier
      solveBtn.disabled = m.solveRunning;
      stopBtn.disabled = !m.solveRunning;
      watchBtn.disabled = !(m.solve?.watchable ?? false);
      secsSel.value = String(m.solveSeconds);
      solveHead.textContent = m.solve?.headline ?? '';
      solveHead.className = m.solve?.verdict === 'solved'
        ? 'note ok'
        : m.solve?.verdict === 'unsolved' || m.solve?.verdict === 'failed' ? 'note warn' : 'note';
      solveRows.textContent = '';
      for (const r of m.solve?.rows ?? []) {
        const row = el('div', 'ed-row');
        row.append(el('span', 'ed-k', r.label), el('span', 'ed-v', r.value));
        solveRows.append(row);
      }
    },
  };
}

function setNum(input: HTMLInputElement, v: number | null): void {
  input.disabled = v === null;
  if (document.activeElement === input) return;
  input.value = v === null ? '' : String(v);
}
