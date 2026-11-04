// THE EDITOR, wired up: one key in, one key out, and the level you are standing
// in is the level you are drawing.
//
// THE LOOP IS THE WHOLE VALUE, and every decision in here is downstream of
// protecting it. Q freezes the sim and hands you the handles; Q again compiles
// the document and rides it. There is no export step, no reload, no second
// application and no dialog in between. Draw a ledge, fail to clear it, drop it
// 20 cm, try again — that is the sentence the design has to be able to say in a
// few seconds, and anything that makes it slower is the wrong answer.
//
// THREE THINGS THAT ARE NOT OBVIOUS AND ARE LOAD-BEARING:
//
// 1. THE EDITOR TAKES THE KEYBOARD IN THE CAPTURE PHASE. `input.ts` binds
//    W/A/S/D, the arrows, Space and Shift to sim bits and returns BEFORE any
//    command dispatch, so those keys are unreachable to anything else — a bug
//    that already cost the montage its keyboard binding once. An editor that
//    could not use A for "apple" or the arrows for "nudge" would be an editor
//    fighting its own game, so while it is open it installs a capture-phase
//    listener on window and swallows what it owns. It is removed on exit, which
//    is the whole of the lifecycle.
//
// 2. THE DOCUMENT SURVIVES A PAGE RELOAD. Saving a level writes into levels/,
//    which the dev server globs, which invalidates the module graph, which
//    reloads the page. Without persistence the reward for saving would be
//    losing your undo history and your place. So the document and the editor's
//    own state go into sessionStorage on every change and come back on boot.
//
// 3. A FORK, ALWAYS. Opening a shipped level gives you a COPY with a new id and
//    `provenance.parent` set to what it came from. The twenty carry the
//    leaderboard and stay pristine; "what if there was a jump here" costs
//    nothing. The authoring endpoint enforces the same rule independently, so
//    this is the courtesy and that is the guarantee.
import type { BikeSpec } from '@/sim/spec.ts';
import type { ReplayFile } from '@/sim/replay.ts';
import {
  addApple, appendDraft, blankDoc, cancelDraft, commitDraft, createHistory, deleteApple,
  deletePolygon, deleteVertex, docFromRaw, docToRaw, forkDoc, insertVertex, moveApple,
  moveFlower, moveStart, moveVertex, setBulge, setDraftKind, setMeta, setPolygonKind, startDraft,
} from './doc.ts';
import type { EditDoc, EditPoint } from './doc.ts';
import type { PolyKind } from '@/sim/level.ts';
import { checkDoc } from './check.ts';
import type { CheckResult, Finding } from './check.ts';
import { bulgeFor, freeSpan, pickEdge, pickHandle, snapPoint } from './geom.ts';
import type { Handle } from './geom.ts';
import { measureRestingBike } from './silhouette.ts';
import type { Silhouette } from './silhouette.ts';
import { drawOverlay, PICK_PX, screenToWorld } from './overlay.ts';
import type { View } from './overlay.ts';
import { createEditorPanel } from './panel.ts';
import type { EditorPanel } from './panel.ts';
import { downloadLevel, fetchAuthoringStatus, OFFLINE, saveToRepo, saveVerdict } from './save.ts';
import type { AuthoringStatus } from './save.ts';
import { POLL_MS, pollSolve, startSolve, stopSolve, summarise } from './solve.ts';
import type { SolveSummary } from './solve.ts';

export interface EditorSource {
  /** The raw JSON of the level currently loaded. */
  raw: unknown;
  id: string;
  name: string;
  simHash: string;
  tier: string | null;
}

export interface EditorOpts {
  canvas: HTMLCanvasElement;
  panelRoot: HTMLElement;
  /**
   * The level the URL asked for, or null when it asked for none.
   *
   * IT DECIDES WHETHER THE EDITOR REOPENS ITSELF. Coming back from the reload a
   * save causes, the URL still names the draft and the session should resume —
   * that is the whole point of persisting it. Following a link to a DIFFERENT
   * level is the opposite intent, and an editor that reopened over it would
   * make a shared level link mean "whatever I was drawing yesterday".
   */
  urlLevel: string | null;
  spec(): BikeSpec;
  /** What is loaded right now. Read at the moment the editor opens. */
  source(): EditorSource;
  /** Where the play camera is, so opening the editor does not jump the view. */
  playView(): View;
  /** Compile and load this document as the level being ridden. */
  onRide(raw: unknown, id: string, name: string): void;
  /** Watch the solver's line. Handed the standard replay envelope. */
  onWatchReplay(file: ReplayFile): void;
  onToast(message: string, label?: string): void;
  /**
   * Entering and leaving edit mode. The game freezes the sim, drops the ghost
   * and the in-canvas HUD, and pins the art's derived look — see main.ts.
   */
  setEditing(editing: boolean): void;
  /**
   * SHOW ME WHAT I AM DRAWING.
   *
   * The editor draws handles; the GAME draws the level, with its real renderer
   * and its real art, and that is the whole premise of editing in place. So
   * every compiling edit is pushed back into the game as the level it is now.
   *
   * Debounced, and deliberately: `bakeLevel` rebuilds a level's panels, hatch
   * and props, and doing that on every pointermove of a drag would spend the
   * frame budget on decoration while the author is looking at a thin line
   * anyway — the overlay already shows the new geometry live, in outline, at no
   * cost. So the outline leads and the filled picture catches up.
   */
  onPreview(raw: unknown): void;
}

export interface Editor {
  readonly active: boolean;
  /** The camera to draw with while editing. Undefined when not editing. */
  readonly view: View | null;
  toggle(): void;
  open(): void;
  close(): void;
  /** Called after the game has drawn the level. */
  draw(ctx: CanvasRenderingContext2D, cssW: number, cssH: number): void;
  /** One line for the HUD. Empty when not editing. */
  hud(): string;
  /**
   * A flat summary, for the headless smoke check and for devtools. Not
   * load-bearing — the same rule `window.velo` follows.
   */
  state(): {
    active: boolean;
    id: string;
    name: string;
    tier: string;
    parent: string | null;
    polygons: number;
    vertices: number;
    arcs: number;
    apples: number;
    errors: number;
    warns: number;
    loadError: string | null;
    dirty: boolean;
    simHash: string;
    endpoint: boolean;
    solving: boolean;
    solveHeadline: string;
  };
  detach(): void;
}

const STORE_KEY = 'velo.editor.doc';
const STORE_OPEN = 'velo.editor.open';
/**
 * The last thing the editor said, carried across a reload.
 *
 * SAVING RELOADS THE PAGE. `levels/` is a build-time glob, writing a file into
 * it invalidates the module graph, and Vite reloads — which destroyed the
 * "wrote levels/21-rollers.json" confirmation about 80 ms after it appeared,
 * the first time this editor was used in anger. A save that says nothing is a
 * save you do twice.
 */
const STORE_NOTE = 'velo.editor.note';
/** Keys the editor swallows in the capture phase. See note 1 at the top. */
const OWNED = new Set([
  'KeyQ', 'KeyZ', 'KeyN', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyE', 'KeyB', 'KeyG', 'KeyT',
  'Digit1', 'Digit2', 'Digit3', 'Enter', 'Escape', 'Delete', 'Backspace',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'BracketLeft', 'BracketRight', 'Tab',
]);

export function createEditor(o: EditorOpts): Editor {
  let active = false;
  let history = createHistory(blankDoc('draft', 'draft'));
  let hasDoc = false;
  let view: View = { x: 0, y: 0, zoom: 60 };
  let selection: Handle | null = null;
  let hover: Handle | null = null;
  let cursor: EditPoint | null = null;
  let drag: { handle: Handle; stroke: string } | null = null;
  let pan: { sx: number; sy: number; vx: number; vy: number } | null = null;
  let grid = 0.25;
  let gridOn = true;
  let showWarnings = true;
  let bikeOn = true;
  let message = '';
  let messageBad = false;
  let status: AuthoringStatus = OFFLINE;
  let check: CheckResult = checkDoc(history.doc);
  let bike: Silhouette | null = null;
  let solveJob: number | null = null;
  let solveTimer = 0;
  let solveSummary: SolveSummary | null = null;
  let solveReplay: ReplayFile | null = null;
  let solveSeconds = 300;

  const panel: EditorPanel = createEditorPanel(o.panelRoot, {
    onMeta: (patch) => edit('meta', setMeta(history.doc, patch)),
    onSelectionNumber: (field, value) => typeNumber(field, value),
    onSave: () => void save(),
    onNew: () => newLevel(),
    onRide: () => close(),
    onSolve: () => void solve(),
    onStopSolve: () => void cancelSolve(),
    onWatch: () => {
      if (solveReplay) o.onWatchReplay(solveReplay);
    },
    onUndo: () => step(history.undo()),
    onRedo: () => step(history.redo()),
    onGrid: (size, on) => {
      grid = size;
      gridOn = on;
      sync();
    },
    onToggleWarnings: (on) => {
      showWarnings = on;
      sync();
    },
    onToggleBike: (on) => {
      bikeOn = on;
      sync();
    },
    onSolveSeconds: (v) => {
      solveSeconds = v;
      sync();
    },
    onFocusFinding: (f) => focusOn(f),
  });
  o.panelRoot.classList.add('hidden');

  // ASKED ONLY WHERE THE ANSWER CAN BE YES. The authoring endpoint is a
  // dev-server middleware and exists nowhere else (vite.config.ts), so in a
  // published build this probe was a guaranteed 404 on every page load — which
  // the browser prints in the console as a failed request, in red, to anybody
  // who opens devtools on the live game. `status` already starts as OFFLINE,
  // which is the truth about a build, so there is nothing to ask. (MODE rather
  // than DEV: DEV follows NODE_ENV, which this box sets to production in every
  // shell, and bin/edit must keep its save path regardless.)
  if (import.meta.env.MODE !== 'production') {
    void fetchAuthoringStatus().then((s) => {
      status = s;
      if (active) sync();
    });
  }

  // --- state ----------------------------------------------------------------

  function edit(label: string, next: EditDoc): void {
    history.push(label, next);
    recheck();
  }

  function step(moved: boolean): void {
    if (!moved) return;
    selection = null;
    recheck();
  }

  /** See `onPreview`. Long enough to cover a drag, short enough to feel live. */
  const PREVIEW_MS = 150;
  let previewTimer = 0;

  function recheck(): void {
    check = checkDoc(history.doc);
    persist();
    sync();
    if (!active || !check.level) return;
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      if (active && check.level) o.onPreview(docToRaw(history.doc));
    }, PREVIEW_MS);
  }

  function sync(): void {
    if (!active) return;
    panel.sync({
      doc: history.doc,
      check,
      verdict: saveVerdict(status, history.doc),
      selection,
      grid,
      gridOn,
      showWarnings,
      bikeOn,
      dirty: history.dirty(),
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
      solve: solveSummary,
      solveRunning: solveJob !== null,
      solveSeconds,
      endpointNote: status.enabled ? '' : status.note,
      message,
      messageBad,
    });
  }

  function say(text: string, bad = false, keepAcrossReload = false): void {
    message = text;
    messageBad = bad;
    try {
      if (keepAcrossReload) sessionStorage.setItem(STORE_NOTE, text);
    } catch { /* ignore */ }
    sync();
  }

  function persist(): void {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(history.doc));
    } catch { /* a private window, a full quota — not worth a message */ }
  }

  function restore(): EditDoc | null {
    try {
      const s = sessionStorage.getItem(STORE_KEY);
      if (!s) return null;
      const d = JSON.parse(s) as EditDoc;
      // Shape check only; `checkDoc` has the real opinion.
      return d && Array.isArray(d.polygons) && d.start ? d : null;
    } catch {
      return null;
    }
  }

  // --- opening and closing --------------------------------------------------

  /**
   * Is the level currently loaded the document we already have open?
   *
   * `-unsaved` is in here because `upsertLevel` renames a draft whose id
   * collides with a real file in levels/, and a rename must not make the editor
   * think it is looking at a different level and fork its own draft.
   */
  function isOurs(id: string): boolean {
    return hasDoc && (history.doc.id === id || `${history.doc.id}-unsaved` === id);
  }

  function open(): void {
    if (active) return;
    const src = o.source();
    if (!isOurs(src.id)) {
      const stored = restore();
      if (stored && (stored.id === src.id || `${stored.id}-unsaved` === src.id)) {
        history = createHistory(stored);
      } else {
        // THE FORK. A level that is not already one of the editor's own drafts
        // becomes a copy with a new id and its parent recorded.
        const base = docFromRaw(src.raw, src.id);
        history = createHistory(
          src.tier && src.tier !== 'core'
            ? base
            : forkDoc(base, src.simHash, `${src.id}-fork`, `${src.name} (fork)`),
        );
      }
      hasDoc = true;
    }
    active = true;
    o.setEditing(true);
    o.panelRoot.classList.remove('hidden');
    document.body.classList.add('editing');
    view = { ...o.playView() };
    if (!bike) bike = measureRestingBike(o.spec());
    selection = null;
    message = history.doc.parent
      ? `forked from ${history.doc.parent.name} — the original is untouched`
      : '';
    messageBad = false;
    attach();
    recheck();
    if (check.level) o.onPreview(docToRaw(history.doc));
    try {
      sessionStorage.setItem(STORE_OPEN, '1');
    } catch { /* ignore */ }
  }

  function close(): void {
    if (!active) return;
    // RIDE WHAT IS ON SCREEN. A document that does not compile cannot be
    // ridden, and saying so is better than loading the last good version and
    // letting somebody test a level they are not looking at.
    if (!check.level) {
      say(check.loadError ?? 'the level does not load', true);
      return;
    }
    active = false;
    detachKeys();
    o.panelRoot.classList.add('hidden');
    document.body.classList.remove('editing');
    o.setEditing(false);
    try {
      sessionStorage.setItem(STORE_OPEN, '0');
    } catch { /* ignore */ }
    o.onRide(docToRaw(history.doc), history.doc.id, history.doc.name);
  }

  /**
   * A level from nothing: a 40 m room with a floor, a start, an apple and a
   * flower. See `blankDoc` for why it is not empty.
   *
   * It replaces the open document, so it asks first when there is unsaved work.
   * `confirm` rather than a bespoke dialog: this is the one destructive button
   * in the editor and the browser's own is the one nobody mistakes for part of
   * the level.
   */
  function newLevel(): void {
    if (history.dirty() && !window.confirm(`Discard the unsaved changes to ${history.doc.id}?`)) return;
    const n = nextDraftId();
    history = createHistory(blankDoc(n, n));
    hasDoc = true;
    selection = null;
    say(`new level — name it, draw it, press Q to ride it`);
    recheck();
    fit();
  }

  /** `21-draft`, `22-draft`, ... — after the highest number already in levels/. */
  function nextDraftId(): string {
    let top = 0;
    for (const l of status.levels) {
      const m = /^(\d+)/.exec(l.id);
      if (m) top = Math.max(top, Number(m[1]));
    }
    return `${String(top + 1).padStart(2, '0')}-draft`;
  }

  function toggle(): void {
    if (active) close();
    else open();
  }

  // --- the view -------------------------------------------------------------

  function size(): { cssW: number; cssH: number } {
    return { cssW: o.canvas.clientWidth, cssH: o.canvas.clientHeight };
  }

  function toWorld(ev: { clientX: number; clientY: number }): EditPoint {
    const r = o.canvas.getBoundingClientRect();
    const { cssW, cssH } = size();
    return screenToWorld(view, cssW, cssH, ev.clientX - r.left, ev.clientY - r.top);
  }

  function place(p: EditPoint): EditPoint {
    return gridOn ? snapPoint(p, grid) : p;
  }

  function pickRadius(): number {
    return PICK_PX / view.zoom;
  }

  function fit(): void {
    const lv = check.level;
    if (!lv) return;
    const { cssW, cssH } = size();
    const w = Math.max(lv.maxX - lv.minX, 1) * 1.1;
    const h = Math.max(lv.maxY - lv.minY, 1) * 1.1;
    view = {
      x: (lv.minX + lv.maxX) / 2,
      y: (lv.minY + lv.maxY) / 2,
      zoom: Math.max(2, Math.min(cssW / w, cssH / h)),
    };
  }

  function focusOn(f: Finding): void {
    if (!f.at) return;
    view = { ...view, x: f.at.x, y: f.at.y };
  }

  // --- pointer --------------------------------------------------------------

  function onPointerDown(ev: PointerEvent): void {
    if (!active) return;
    o.canvas.setPointerCapture(ev.pointerId);
    const w = toWorld(ev);
    if (ev.button === 1 || ev.button === 2) {
      pan = { sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y };
      ev.preventDefault();
      return;
    }
    if (ev.button !== 0) return;
    ev.preventDefault();

    const doc = history.doc;
    if (doc.draft) {
      // Clicking the first vertex closes the ring — the universal gesture, and
      // it means ENTER is a shortcut rather than the only way.
      const first = doc.draft.verts[0];
      if (doc.draft.verts.length >= 3 && Math.hypot(w.x - first.x, w.y - first.y) < pickRadius()) {
        commit();
        return;
      }
      edit(history.beginStroke('draw'), appendDraft(doc, place(w)));
      return;
    }

    const hit = pickHandle(doc, w, pickRadius());
    if (hit) {
      selection = hit;
      drag = { handle: hit, stroke: history.beginStroke('drag') };
      sync();
      return;
    }
    // ALT-click on an edge inserts a vertex and starts dragging it, which is the
    // one gesture that turns a straight run into a shape without a mode.
    if (ev.altKey) {
      const e = pickEdge(doc, w, pickRadius() * 1.5);
      if (e) {
        const next = insertVertex(doc, e.pi, e.vi, place(w));
        edit('insert', next);
        selection = { kind: 'vertex', pi: e.pi, vi: e.vi, x: w.x, y: w.y };
        drag = { handle: selection, stroke: history.beginStroke('drag') };
        return;
      }
    }
    selection = null;
    sync();
  }

  function onPointerMove(ev: PointerEvent): void {
    if (!active) return;
    const w = toWorld(ev);
    cursor = place(w);
    if (pan) {
      view = { ...view, x: pan.vx - (ev.clientX - pan.sx) / view.zoom, y: pan.vy + (ev.clientY - pan.sy) / view.zoom };
      return;
    }
    if (drag) {
      applyDrag(drag.handle, w, drag.stroke);
      return;
    }
    hover = pickHandle(history.doc, w, pickRadius());
  }

  function onPointerUp(ev: PointerEvent): void {
    if (o.canvas.hasPointerCapture(ev.pointerId)) o.canvas.releasePointerCapture(ev.pointerId);
    pan = null;
    drag = null;
  }

  function applyDrag(h: Handle, w: EditPoint, stroke: string): void {
    const doc = history.doc;
    const p = place(w);
    switch (h.kind) {
      case 'vertex':
        edit(stroke, moveVertex(doc, h.pi, h.vi, p));
        break;
      case 'draft': {
        // Dragging a draft vertex is rare but the alternative is that a
        // mis-clicked point can only be undone, which in a five-point shape is
        // four points of work.
        const next = { ...doc, draft: doc.draft ? { ...doc.draft, verts: doc.draft.verts.map((v, i) => (i === h.vi ? { ...v, x: p.x, y: p.y } : v)) } : null };
        edit(stroke, next);
        break;
      }
      case 'arc': {
        const poly = doc.polygons[h.pi];
        if (!poly) break;
        const n = poly.verts.length;
        const a = poly.verts[h.vi === 0 ? n - 1 : h.vi - 1];
        const b = poly.verts[h.vi];
        // NOT snapped to the grid. The sagitta is a derived quantity and
        // snapping it would quantise the curve rather than the handle, which is
        // the wrong thing to make tidy.
        edit(stroke, setBulge(doc, h.pi, h.vi, bulgeFor(a, b, w)));
        break;
      }
      case 'start':
        edit(stroke, moveStart(doc, p));
        break;
      case 'flower':
        edit(stroke, moveFlower(doc, p));
        break;
      case 'apple':
        edit(stroke, moveApple(doc, h.pi, p));
        break;
    }
  }

  function onWheel(ev: WheelEvent): void {
    if (!active) return;
    ev.preventDefault();
    const before = toWorld(ev);
    const k = Math.pow(1.0015, -ev.deltaY);
    view = { ...view, zoom: Math.max(2, Math.min(400, view.zoom * k)) };
    const after = toWorld(ev);
    // Keep the world point under the pointer under the pointer. Zoom that
    // drifts is zoom you have to correct, every time.
    view = { ...view, x: view.x + (before.x - after.x), y: view.y + (before.y - after.y) };
  }

  function onContextMenu(ev: Event): void {
    if (active) ev.preventDefault();
  }

  function onDoubleClick(ev: MouseEvent): void {
    if (!active) return;
    const hit = pickHandle(history.doc, toWorld(ev), pickRadius());
    if (hit?.kind === 'arc') edit('flatten', setBulge(history.doc, hit.pi, hit.vi, 0));
  }

  // --- keys -----------------------------------------------------------------

  function onKeyDown(ev: KeyboardEvent): void {
    if (!active) return;
    const t = ev.target as HTMLElement | null;
    // A text field in the panel gets the keyboard. Without this, typing a level
    // name would place apples.
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
      if (ev.code === 'Escape') (t as HTMLInputElement).blur();
      return;
    }
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.code === 'KeyS') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      void save();
      return;
    }
    if (mod && ev.code === 'Enter') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      void solve();
      return;
    }
    if (mod && ev.code === 'KeyZ') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      step(ev.shiftKey ? history.redo() : history.undo());
      return;
    }
    if (mod) return;
    if (!OWNED.has(ev.code)) return;
    ev.preventDefault();
    // The sim's own keys are bound in `input.ts` on a bubble-phase listener, so
    // stopping propagation here is what makes A mean "apple" rather than "lean
    // left" for as long as the editor is open.
    ev.stopImmediatePropagation();
    handleKey(ev);
  }

  function handleKey(ev: KeyboardEvent): void {
    const doc = history.doc;
    const at = cursor ?? { x: view.x, y: view.y };
    switch (ev.code) {
      case 'KeyQ':
        close();
        break;
      case 'KeyZ':
        step(ev.shiftKey ? history.redo() : history.undo());
        break;
      case 'KeyN':
        edit('draw', startDraft(doc.draft ? cancelDraft(doc) : doc, 'cave', at));
        break;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3': {
        const kind: PolyKind = ev.code === 'Digit1' ? 'cave' : ev.code === 'Digit2' ? 'ground' : 'decor';
        if (doc.draft) edit('kind', setDraftKind(doc, kind));
        else if (selection && (selection.kind === 'vertex' || selection.kind === 'arc')) edit('kind', setPolygonKind(doc, selection.pi, kind));
        break;
      }
      case 'Enter':
        commit();
        break;
      case 'Escape':
        if (doc.draft) edit('draw', cancelDraft(doc));
        else {
          selection = null;
          sync();
        }
        break;
      case 'Delete':
      case 'Backspace':
        remove(ev.shiftKey);
        break;
      case 'KeyA':
        edit('apple', addApple(doc, at));
        break;
      case 'KeyS':
        edit('start', moveStart(doc, at));
        break;
      case 'KeyF':
        edit('flower', moveFlower(doc, at));
        break;
      case 'KeyE': {
        const e = pickEdge(doc, at, pickRadius() * 2);
        if (e) {
          edit('insert', insertVertex(doc, e.pi, e.vi, place({ x: e.x, y: e.y })));
          selection = { kind: 'vertex', pi: e.pi, vi: e.vi, x: e.x, y: e.y };
          sync();
        } else say('no edge near the pointer', true);
        break;
      }
      case 'KeyB':
        bikeOn = !bikeOn;
        sync();
        break;
      case 'KeyG':
        gridOn = !gridOn;
        sync();
        break;
      case 'KeyT':
        panel.focusNumber();
        break;
      case 'BracketLeft':
      case 'BracketRight': {
        const sizes = [0.05, 0.1, 0.25, 0.5, 1, 2, 5];
        const i = sizes.indexOf(grid);
        grid = sizes[Math.max(0, Math.min(sizes.length - 1, (i < 0 ? 2 : i) + (ev.code === 'BracketRight' ? 1 : -1)))];
        sync();
        break;
      }
      case 'Tab':
        fit();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        nudge(ev);
        break;
    }
  }

  function commit(): void {
    const { doc, index } = commitDraft(history.doc);
    if (index < 0) {
      say('a polygon needs three vertices', true);
      return;
    }
    edit('commit', doc);
    selection = { kind: 'vertex', pi: index, vi: 0, x: doc.polygons[index].verts[0].x, y: doc.polygons[index].verts[0].y };
    say('');
  }

  function remove(whole: boolean): void {
    const s = selection;
    const doc = history.doc;
    if (!s) return;
    if (s.kind === 'apple') edit('delete', deleteApple(doc, s.pi));
    else if (s.kind === 'vertex') edit('delete', whole ? deletePolygon(doc, s.pi) : deleteVertex(doc, s.pi, s.vi));
    else if (s.kind === 'arc') edit('flatten', setBulge(doc, s.pi, s.vi, 0));
    else return; // the start and the flower are not optional, so they are not deletable
    selection = null;
    sync();
  }

  function nudge(ev: KeyboardEvent): void {
    const s = selection;
    if (!s) return;
    // ALT is a centimetre, SHIFT is ten grid steps, otherwise one. The
    // centimetre is the one that matters: it is the unit the 1.20/1.10 gap
    // difference lives in.
    const stepSize = ev.altKey ? 0.01 : (gridOn ? grid : 0.1) * (ev.shiftKey ? 10 : 1);
    const dx = ev.code === 'ArrowLeft' ? -stepSize : ev.code === 'ArrowRight' ? stepSize : 0;
    const dy = ev.code === 'ArrowDown' ? -stepSize : ev.code === 'ArrowUp' ? stepSize : 0;
    const doc = history.doc;
    const stroke = 'nudge';
    if (s.kind === 'vertex') {
      const v = doc.polygons[s.pi]?.verts[s.vi];
      if (v) edit(stroke, moveVertex(doc, s.pi, s.vi, { x: v.x + dx, y: v.y + dy }));
    } else if (s.kind === 'apple') {
      const a = doc.apples[s.pi];
      if (a) edit(stroke, moveApple(doc, s.pi, { x: a.x + dx, y: a.y + dy }));
    } else if (s.kind === 'start') {
      edit(stroke, moveStart(doc, { x: doc.start.x + dx, y: doc.start.y + dy }));
    } else if (s.kind === 'flower') {
      edit(stroke, moveFlower(doc, { x: doc.flower.x + dx, y: doc.flower.y + dy }));
    } else if (s.kind === 'arc') {
      const poly = doc.polygons[s.pi];
      const v = poly?.verts[s.vi];
      if (v) edit(stroke, setBulge(doc, s.pi, s.vi, v.bulge + (dy !== 0 ? dy : dx)));
    }
  }

  function typeNumber(field: 'x' | 'y' | 'bulge', value: number): void {
    const s = selection;
    if (!s || !Number.isFinite(value)) return;
    const doc = history.doc;
    if (s.kind === 'arc') {
      if (field === 'bulge') edit('type', setBulge(doc, s.pi, s.vi, value));
      return;
    }
    if (s.kind === 'vertex') {
      const v = doc.polygons[s.pi]?.verts[s.vi];
      if (!v) return;
      if (field === 'bulge') edit('type', setBulge(doc, s.pi, s.vi, value));
      else edit('type', moveVertex(doc, s.pi, s.vi, { x: field === 'x' ? value : v.x, y: field === 'y' ? value : v.y }));
      return;
    }
    if (field === 'bulge') return;
    const cur = s.kind === 'apple' ? doc.apples[s.pi] : s.kind === 'start' ? doc.start : doc.flower;
    if (!cur) return;
    const to = { x: field === 'x' ? value : cur.x, y: field === 'y' ? value : cur.y };
    edit('type', s.kind === 'apple' ? moveApple(doc, s.pi, to) : s.kind === 'start' ? moveStart(doc, to) : moveFlower(doc, to));
  }

  // --- saving ---------------------------------------------------------------

  async function save(): Promise<void> {
    const v = saveVerdict(status, history.doc);
    if (!v.can) {
      say(v.note, true);
      return;
    }
    if (!check.level) {
      say(`will not save a level that does not load: ${check.loadError}`, true);
      return;
    }
    if (v.route === 'download') {
      downloadLevel(history.doc);
      history.markSaved();
      say(`downloaded ${history.doc.id}.json — and copied to the clipboard. Move it into levels/ yourself.`);
      return;
    }
    say('saving…');
    const r = await saveToRepo(history.doc);
    if (!r.ok) {
      say(r.error ?? 'save failed', true);
      return;
    }
    history.markSaved();
    status = await fetchAuthoringStatus();
    say(`${r.created ? 'wrote' : 'overwrote'} ${r.path}`, false, true);
    o.onToast(`${r.created ? 'wrote' : 'overwrote'} ${r.path}`, 'editor');
  }

  // --- the deliberate tier --------------------------------------------------

  async function solve(): Promise<void> {
    if (solveJob !== null) return;
    if (!check.level) {
      say('the level does not load, so there is nothing to solve', true);
      return;
    }
    if (!status.enabled) {
      say('bin/solve needs the authoring endpoint — run bin/dev to use it', true);
      return;
    }
    const { job, error } = await startSolve(history.doc, solveSeconds, 1);
    if (job === null) {
      say(error ?? 'could not start the solver', true);
      return;
    }
    solveJob = job;
    solveReplay = null;
    solveSummary = summarise({ id: job, state: 'running', lines: [], report: null, replay: null, error: null, elapsedMs: 0 });
    say('');
    solveTimer = window.setInterval(() => void poll(), POLL_MS);
  }

  async function poll(): Promise<void> {
    if (solveJob === null) return;
    const s = await pollSolve(solveJob);
    if (!s) return;
    solveSummary = summarise(s);
    if (s.state !== 'running') {
      window.clearInterval(solveTimer);
      solveJob = null;
      solveReplay = (s.replay as ReplayFile | null) ?? null;
      o.onToast(solveSummary.headline, 'solver');
    }
    sync();
  }

  async function cancelSolve(): Promise<void> {
    if (solveJob === null) return;
    const job = solveJob;
    window.clearInterval(solveTimer);
    solveJob = null;
    solveSummary = null;
    sync();
    await stopSolve(job);
  }

  // --- listeners ------------------------------------------------------------

  function attach(): void {
    window.addEventListener('keydown', onKeyDown, true);
  }
  function detachKeys(): void {
    window.removeEventListener('keydown', onKeyDown, true);
  }

  o.canvas.addEventListener('pointerdown', onPointerDown);
  o.canvas.addEventListener('pointermove', onPointerMove);
  o.canvas.addEventListener('pointerup', onPointerUp);
  o.canvas.addEventListener('pointercancel', onPointerUp);
  o.canvas.addEventListener('wheel', onWheel, { passive: false });
  o.canvas.addEventListener('contextmenu', onContextMenu);
  o.canvas.addEventListener('dblclick', onDoubleClick);

  // --- drawing --------------------------------------------------------------

  function draw(ctx: CanvasRenderingContext2D, cssW: number, cssH: number): void {
    if (!active) return;
    const gap = cursor && check.level ? freeSpan(check.level.polys, cursor.x, cursor.y) : null;
    drawOverlay(ctx, cssW, cssH, view, {
      doc: history.doc,
      findings: check.findings,
      showWarnings,
      selection,
      hover,
      cursor,
      grid,
      gridOn,
      bike: bikeOn ? bike : null,
      gap,
      spec: o.spec(),
    });
  }

  function hud(): string {
    if (!active) return '';
    const d = history.doc;
    const c = check;
    const bits = [
      `EDIT ${d.id}`,
      `${d.polygons.length} polys`,
      `${d.apples.length} apples`,
      gridOn ? `grid ${grid} m` : 'no grid',
    ];
    if (c.loadError) bits.push('DOES NOT LOAD');
    else if (c.warns) bits.push(`${c.warns} warn`);
    if (history.dirty()) bits.push('unsaved');
    return bits.join('  ·  ');
  }

  /**
   * Come back to the draft after a reload.
   *
   * Saving a level writes into levels/, the dev server globs that directory,
   * and the module graph invalidation reloads the page. If the reward for
   * saving were losing your undo history and your place, saving would become
   * something you put off — so the document comes back, the LEVEL it describes
   * is loaded, and the editor reopens on it.
   *
   * The level has to be loaded first: the game boots on whatever
   * `resolveLevel` picked, which after a reload is not the draft, and opening
   * the editor over somebody else's geometry would be worse than not
   * reopening at all.
   */
  function bootRestore(): void {
    let stored: EditDoc | null = null;
    try {
      if (sessionStorage.getItem(STORE_OPEN) !== '1') return;
      stored = restore();
    } catch {
      return;
    }
    if (!stored) return;
    // An explicit ?level= for something else outranks the session. See `urlLevel`.
    if (o.urlLevel && o.urlLevel !== stored.id && o.urlLevel !== `${stored.id}-unsaved`) return;
    history = createHistory(stored);
    hasDoc = true;
    check = checkDoc(history.doc);
    if (!check.level) return;
    o.onRide(docToRaw(history.doc), history.doc.id, history.doc.name);
    open();
    try {
      const note = sessionStorage.getItem(STORE_NOTE);
      if (note) {
        sessionStorage.removeItem(STORE_NOTE);
        say(note + '  (the dev server reloaded the page; your draft came back)');
      }
    } catch { /* ignore */ }
  }

  // Deferred, because `open()` reads the play camera and the caller has not
  // finished building the game when this module is constructed.
  setTimeout(bootRestore, 0);

  return {
    get active() {
      return active;
    },
    get view() {
      return active ? view : null;
    },
    toggle,
    open,
    close,
    draw,
    hud,
    state: () => ({
      active,
      id: history.doc.id,
      name: history.doc.name,
      tier: history.doc.tier,
      parent: history.doc.parent?.name ?? null,
      polygons: history.doc.polygons.length,
      vertices: history.doc.polygons.reduce((n, p) => n + p.verts.length, 0),
      arcs: history.doc.polygons.reduce((n, p) => n + p.verts.filter((v) => v.bulge !== 0).length, 0),
      apples: history.doc.apples.length,
      errors: check.errors,
      warns: check.warns,
      loadError: check.loadError,
      dirty: history.dirty(),
      simHash: check.level?.simHash ?? '',
      endpoint: status.enabled,
      solving: solveJob !== null,
      solveHeadline: solveSummary?.headline ?? '',
    }),
    detach(): void {
      detachKeys();
      o.canvas.removeEventListener('pointerdown', onPointerDown);
      o.canvas.removeEventListener('pointermove', onPointerMove);
      o.canvas.removeEventListener('pointerup', onPointerUp);
      o.canvas.removeEventListener('pointercancel', onPointerUp);
      o.canvas.removeEventListener('wheel', onWheel);
      o.canvas.removeEventListener('contextmenu', onContextMenu);
      o.canvas.removeEventListener('dblclick', onDoubleClick);
    },
  };
}
