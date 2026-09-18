// The editor's document: what is being edited, and every operation that may
// change it. Pure — no DOM, no canvas, no fetch — which is what lets the
// interesting half of the editor be tested in plain node like everything else
// in this repo.
//
// THREE DECISIONS SHAPE THIS FILE.
//
// 1. BULGE LIVES ON THE VERTEX IT ARRIVES AT, exactly as the file format has
//    it. `{ "arcTo": [x, y], "bulge": b }` describes the edge from the PREVIOUS
//    entry to this one, so an `EditVertex` is a point plus the bulge of the
//    edge coming into it, and a literal `[x, y]` is that same vertex with bulge
//    0. That makes `toRaw`/`fromRaw` a rename rather than a translation, which
//    is the whole reason the round trip can be exact.
//
// 2. EVERY OPERATION RETURNS A NEW DOCUMENT. Undo is then a stack of whole
//    documents rather than a set of hand-written inverse commands. A level is a
//    few hundred vertices — a snapshot is a few tens of KB and a structural
//    clone is microseconds — so the cheap, obviously-correct mechanism is also
//    the fast one. Hand-written inverses are where undo bugs live, and an undo
//    bug in an authoring tool costs work rather than pixels.
//
// 3. COORDINATES ARE QUANTISED AT THE MOMENT OF THE EDIT, never on save.
//    A slider and a mouse both produce 0.30000000000000004, and a level file
//    full of those is unreadable and un-hand-editable — which the format's
//    whole thesis rests on. Quantising on SAVE instead would mean the file
//    differs from the document that wrote it, and re-opening it would not
//    reproduce what was saved. So `q()` is applied by the operations, and
//    serialisation is a straight copy.
//
// THE DRAFT POLYGON IS PART OF THE DOCUMENT AND NOT PART OF THE LEVEL. A
// polygon being drawn has one or two vertices for most of its life, and
// `parseLevel` rejects that — so if the draft lived in `polygons` the live
// feedback tier would be dark for exactly as long as you were drawing, which is
// when it is most wanted. It sits in its own field, undo covers it like
// everything else, and `toRaw` ignores it.
import type { LevelProvenance, LevelStyle, PolyKind, RawLevel, RawPolygon, RawVertex } from '@/sim/level.ts';

/**
 * 0.1 mm, as the DIVISOR it is applied by. Finer than any level cares about,
 * coarse enough to print cleanly.
 *
 * `Math.round(v * 1e4) / 1e4` and not `Math.round(v / 1e-4) * 1e-4`: the second
 * form multiplies the rounding error back in and gives 0.33330000000000004 for
 * a third, which is exactly the unreadable number this exists to prevent.
 */
export const QUANTUM_PER_M = 1e4;

/**
 * Round to `QUANTUM`. Applied by every operation that takes a coordinate from a
 * pointer or a text field, and by nothing else — a coordinate that came out of
 * a file is left exactly as the file had it, so forking a level and moving one
 * vertex does not silently re-cut the other three hundred.
 */
export function q(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * QUANTUM_PER_M) / QUANTUM_PER_M;
}

export interface EditPoint {
  x: number;
  y: number;
}

export interface EditVertex {
  x: number;
  y: number;
  /**
   * Signed sagitta in metres of the edge ARRIVING at this vertex, off that
   * edge's chord, positive to the left of the direction of travel. 0 is a
   * straight line. See arc.ts — this is the file format's own number, not a
   * re-parameterisation of it.
   */
  bulge: number;
  /** Per-arc sag tolerance override, when the file carried one. */
  sagTolerance?: number;
  /**
   * The source file wrote this vertex as an arc entry even though its bulge is
   * 0 — `{ "arcTo": [x, y], "bulge": 0 }` rather than `[x, y]`.
   *
   * Geometrically the two are identical: a bulge at or under the tolerance IS
   * the one-segment case and tessellates to nothing. Three of the shipped
   * levels contain such entries, though, and rewriting them as bare points
   * would make a fork's diff against its parent show changes that are not
   * changes. So the distinction is remembered, purely so that opening a file
   * and saving it back is a no-op in the diff as well as in the hash.
   */
  explicitArc?: boolean;
}

export interface EditPolygon {
  kind: PolyKind;
  verts: EditVertex[];
}

/** A polygon being drawn. Not yet a polygon; see the note at the top. */
export interface DraftPolygon {
  kind: PolyKind;
  verts: EditVertex[];
}

export interface EditDoc {
  /** Filename stem the level saves to: `21-the-jump` -> `levels/21-the-jump.json`. */
  id: string;
  name: string;
  author: string;
  /** Never "core" on anything the editor produces. See `Level.tier`. */
  tier: string;
  /** The level this one was forked from, or null for a level made from nothing. */
  parent: { simHash: string; name: string } | null;
  /** Null means "the loader's default"; the field is then not written at all. */
  sagTolerance: number | null;
  start: EditPoint;
  flower: EditPoint;
  apples: EditPoint[];
  polygons: EditPolygon[];
  draft: DraftPolygon | null;
  style: LevelStyle | null;
  /**
   * Everything else the source file had at the top level — `zones`, `entities`,
   * `rev`, and any key a build newer than this one wrote. Carried verbatim so
   * that forking a level cannot quietly delete the half of it this editor does
   * not understand, which is the same tolerance the loader itself extends.
   */
  extra: Record<string, unknown>;
}

/** Keys `EditDoc` models itself. Everything else goes in `extra`. */
const KNOWN_KEYS = new Set([
  'format', 'name', 'author', 'tier', 'provenance', 'style',
  'start', 'flower', 'apples', 'polygons', 'sagTolerance',
]);

export function clonePoint(p: EditPoint): EditPoint {
  return { x: p.x, y: p.y };
}

export function cloneVertex(v: EditVertex): EditVertex {
  const out: EditVertex = { x: v.x, y: v.y, bulge: v.bulge };
  if (v.sagTolerance !== undefined) out.sagTolerance = v.sagTolerance;
  if (v.explicitArc) out.explicitArc = true;
  return out;
}

export function clonePolygon(p: EditPolygon): EditPolygon {
  return { kind: p.kind, verts: p.verts.map(cloneVertex) };
}

export function cloneDoc(d: EditDoc): EditDoc {
  return {
    id: d.id,
    name: d.name,
    author: d.author,
    tier: d.tier,
    parent: d.parent ? { simHash: d.parent.simHash, name: d.parent.name } : null,
    sagTolerance: d.sagTolerance,
    start: clonePoint(d.start),
    flower: clonePoint(d.flower),
    apples: d.apples.map(clonePoint),
    polygons: d.polygons.map(clonePolygon),
    draft: d.draft ? { kind: d.draft.kind, verts: d.draft.verts.map(cloneVertex) } : null,
    style: d.style === null ? null : (JSON.parse(JSON.stringify(d.style)) as LevelStyle),
    extra: JSON.parse(JSON.stringify(d.extra)) as Record<string, unknown>,
  };
}

// --- reading a file in -------------------------------------------------------

/**
 * Turn a level file into a document.
 *
 * DELIBERATELY NOT `parseLevel`. The loader compiles: it tessellates every arc,
 * normalises winding and throws the authoring form away, and a document built
 * from its output would open a level with three hundred straight segments where
 * the author wrote nine arcs. This reads the AUTHORING form, which is the form
 * the editor edits and writes back, and it is why the round trip is exact.
 *
 * It is also deliberately forgiving, because it runs on files this build did
 * not write. A malformed entry becomes a vertex at the origin rather than an
 * exception — `checkDoc` will then say so through the real loader, with the
 * real message, which is one place for that job instead of two.
 */
export function docFromRaw(raw: unknown, id: string): EditDoc {
  const r = (raw && typeof raw === 'object' ? raw : {}) as RawLevel;
  const fields = r as unknown as Record<string, unknown>;
  const extra: Record<string, unknown> = {};
  for (const k of Object.keys(fields)) {
    if (!KNOWN_KEYS.has(k)) extra[k] = fields[k];
  }
  const prov = (r.provenance ?? null) as LevelProvenance | null;
  const parentRaw = prov?.parent;
  return {
    id,
    name: typeof r.name === 'string' ? r.name : 'untitled',
    author: typeof r.author === 'string' ? r.author : '',
    tier: typeof r.tier === 'string' ? r.tier : 'core',
    parent: parentRaw && typeof parentRaw === 'object'
      ? { simHash: String(parentRaw.simHash ?? ''), name: String(parentRaw.name ?? '') }
      : null,
    sagTolerance: typeof r.sagTolerance === 'number' ? r.sagTolerance : null,
    start: pt(r.start),
    flower: pt(r.flower),
    apples: Array.isArray(r.apples) ? r.apples.map(pt) : [],
    polygons: Array.isArray(r.polygons) ? r.polygons.map(polyFromRaw) : [],
    draft: null,
    style: (r.style ?? null) as LevelStyle | null,
    extra,
  };
}

function pt(v: unknown): EditPoint {
  const o = (v && typeof v === 'object' ? v : {}) as { x?: unknown; y?: unknown };
  return { x: typeof o.x === 'number' ? o.x : 0, y: typeof o.y === 'number' ? o.y : 0 };
}

function polyFromRaw(p: RawPolygon): EditPolygon {
  const kind: PolyKind = p?.kind === 'ground' || p?.kind === 'decor' ? p.kind : 'cave';
  const entries: RawVertex[] = Array.isArray(p?.points) ? p.points : [];
  return { kind, verts: entries.map(vertFromRaw) };
}

function vertFromRaw(e: RawVertex): EditVertex {
  if (Array.isArray(e)) {
    return { x: typeof e[0] === 'number' ? e[0] : 0, y: typeof e[1] === 'number' ? e[1] : 0, bulge: 0 };
  }
  const o = e as { arcTo?: unknown; bulge?: unknown; sagTolerance?: unknown };
  const to = Array.isArray(o?.arcTo) ? (o.arcTo as unknown[]) : [];
  const v: EditVertex = {
    x: typeof to[0] === 'number' ? to[0] : 0,
    y: typeof to[1] === 'number' ? to[1] : 0,
    bulge: typeof o?.bulge === 'number' ? o.bulge : 0,
    explicitArc: true,
  };
  if (typeof o?.sagTolerance === 'number') v.sagTolerance = o.sagTolerance;
  return v;
}

// --- writing a file out ------------------------------------------------------

/**
 * Document to level file.
 *
 * Key ORDER matters here and nowhere else: `contentHash` sorts keys before
 * hashing, so it does not care, but a human reading a diff does, and these
 * files are meant to be read. The order is the one the twenty shipped levels
 * already use, with the two new metadata fields sitting beside `author` where
 * the rest of the metadata is.
 *
 * A vertex with bulge 0 is written as a bare `[x, y]`. Writing every vertex as
 * an arc with `"bulge": 0` would be equivalent to the loader and would double
 * the size of every straight-edged level for nothing.
 */
export function docToRaw(d: EditDoc): RawLevel {
  const out: Record<string, unknown> = { format: 'velo-level' };
  // `rev`, `zones`, `entities` and anything newer, in the position the shipped
  // files have them.
  if (d.extra.rev !== undefined) out.rev = d.extra.rev;
  out.name = d.name;
  if (d.author) out.author = d.author;
  out.tier = d.tier;
  out.provenance = provenanceOf(d);
  if (d.style !== null) out.style = d.style;
  if (d.sagTolerance !== null) out.sagTolerance = d.sagTolerance;
  out.start = { x: d.start.x, y: d.start.y };
  out.flower = { x: d.flower.x, y: d.flower.y };
  out.apples = d.apples.map((a) => ({ x: a.x, y: a.y }));
  out.polygons = d.polygons.map((p): RawPolygon => ({ kind: p.kind, points: p.verts.map(vertToRaw) }));
  for (const k of Object.keys(d.extra)) {
    if (k === 'rev') continue;
    out[k] = d.extra[k];
  }
  return out as unknown as RawLevel;
}

function provenanceOf(d: EditDoc): LevelProvenance {
  const p: LevelProvenance = { source: 'authored', generator: 'velo-editor' };
  if (d.parent) p.parent = { simHash: d.parent.simHash, name: d.parent.name };
  return p;
}

function vertToRaw(v: EditVertex): RawVertex {
  if (v.bulge === 0 && !v.explicitArc) return [v.x, v.y];
  const o: { arcTo: [number, number]; bulge: number; sagTolerance?: number } = { arcTo: [v.x, v.y], bulge: v.bulge };
  if (v.sagTolerance !== undefined) o.sagTolerance = v.sagTolerance;
  return o;
}

/** The bytes that land in `levels/<id>.json`. Two-space JSON, like the shipped set. */
export function docToFileText(d: EditDoc): string {
  return JSON.stringify(docToRaw(d), null, 2) + '\n';
}

// --- making one from nothing -------------------------------------------------

/**
 * A new level: a 40 m floor, a start, an apple and a flower, and nothing else.
 *
 * NOT an empty document. An empty one fails to load — no polygons — so the
 * feedback tier would open shouting, the renderer would have nothing to draw,
 * and the first thing the editor ever showed you would be an error you did not
 * cause. A floor is the smallest thing that is a level.
 */
export function blankDoc(id: string, name: string): EditDoc {
  const floor: EditVertex[] = [
    { x: -20, y: 0, bulge: 0 },
    { x: 20, y: 0, bulge: 0 },
    { x: 20, y: 12, bulge: 0 },
    { x: -20, y: 12, bulge: 0 },
  ];
  return {
    id,
    name,
    author: 'velo',
    tier: 'draft',
    parent: null,
    sagTolerance: null,
    start: { x: -16, y: 0.45 },
    flower: { x: 16, y: 0.6 },
    apples: [{ x: 0, y: 0.6 }],
    polygons: [{ kind: 'cave', verts: floor }],
    draft: null,
    style: null,
    extra: { rev: 1 },
  };
}

/**
 * Fork: the same geometry, a new identity, and the edge recorded.
 *
 * THE EDITOR HAS NO OTHER WAY TO OPEN AN EXISTING LEVEL. Opening 03 and adding
 * a jump produces a new file, always, which is what keeps the shipped set and
 * every leaderboard on it pristine while making "what if there was a jump here"
 * a cheap experiment rather than a destructive one. The parent link is written
 * here because it is not recoverable afterwards: nothing else knows it, and no
 * amount of comparing geometry reconstructs the intent.
 *
 * A fork of a fork records ITS immediate parent, not the root. The chain is the
 * tree; flattening it to the original would lose every intermediate step, which
 * is the interesting part of a family tree.
 */
export function forkDoc(d: EditDoc, parentSimHash: string, id: string, name: string): EditDoc {
  const next = cloneDoc(d);
  next.id = id;
  next.name = name;
  next.tier = 'draft';
  next.parent = { simHash: parentSimHash, name: d.name };
  next.draft = null;
  return next;
}

// --- operations --------------------------------------------------------------
//
// Every one of these returns a NEW document and mutates nothing. See the note
// at the top for why undo is a stack of these rather than a set of inverses.

function withPolys(d: EditDoc, polygons: EditPolygon[]): EditDoc {
  const next = cloneDoc(d);
  next.polygons = polygons;
  return next;
}

export function setMeta(d: EditDoc, patch: Partial<Pick<EditDoc, 'id' | 'name' | 'author' | 'tier' | 'sagTolerance'>>): EditDoc {
  const next = cloneDoc(d);
  if (patch.id !== undefined) next.id = patch.id;
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.author !== undefined) next.author = patch.author;
  if (patch.tier !== undefined) next.tier = patch.tier;
  if (patch.sagTolerance !== undefined) next.sagTolerance = patch.sagTolerance;
  return next;
}

export function startDraft(d: EditDoc, kind: PolyKind, at: EditPoint): EditDoc {
  const next = cloneDoc(d);
  next.draft = { kind, verts: [{ x: q(at.x), y: q(at.y), bulge: 0 }] };
  return next;
}

export function appendDraft(d: EditDoc, at: EditPoint): EditDoc {
  if (!d.draft) return d;
  const next = cloneDoc(d);
  next.draft!.verts.push({ x: q(at.x), y: q(at.y), bulge: 0 });
  return next;
}

export function setDraftKind(d: EditDoc, kind: PolyKind): EditDoc {
  if (!d.draft) return d;
  const next = cloneDoc(d);
  next.draft!.kind = kind;
  return next;
}

export function cancelDraft(d: EditDoc): EditDoc {
  if (!d.draft) return d;
  const next = cloneDoc(d);
  next.draft = null;
  return next;
}

/**
 * Close the draft into a real polygon. Returns the document unchanged when the
 * draft has fewer than three vertices, because two points is not a polygon and
 * committing it would put the loader's rejection in front of every other piece
 * of feedback until it was undone.
 */
export function commitDraft(d: EditDoc): { doc: EditDoc; index: number } {
  if (!d.draft || d.draft.verts.length < 3) return { doc: d, index: -1 };
  const next = cloneDoc(d);
  next.polygons.push({ kind: next.draft!.kind, verts: next.draft!.verts.map(cloneVertex) });
  next.draft = null;
  return { doc: next, index: next.polygons.length - 1 };
}

export function setPolygonKind(d: EditDoc, pi: number, kind: PolyKind): EditDoc {
  if (!d.polygons[pi]) return d;
  const polys = d.polygons.map(clonePolygon);
  polys[pi].kind = kind;
  return withPolys(d, polys);
}

export function deletePolygon(d: EditDoc, pi: number): EditDoc {
  if (!d.polygons[pi]) return d;
  return withPolys(d, d.polygons.filter((_, i) => i !== pi).map(clonePolygon));
}

export function moveVertex(d: EditDoc, pi: number, vi: number, to: EditPoint): EditDoc {
  const p = d.polygons[pi];
  if (!p || !p.verts[vi]) return d;
  const polys = d.polygons.map(clonePolygon);
  polys[pi].verts[vi].x = q(to.x);
  polys[pi].verts[vi].y = q(to.y);
  return withPolys(d, polys);
}

/**
 * Insert a vertex into the edge that ARRIVES at `vi`, i.e. between `vi - 1` and
 * `vi`. The new vertex takes over that edge's bulge and the edge after it is
 * left straight, which is the behaviour that does the least damage: splitting a
 * curve in two and giving both halves the whole sagitta would visibly change
 * the shape, and giving neither half any would flatten it.
 */
export function insertVertex(d: EditDoc, pi: number, vi: number, at: EditPoint): EditDoc {
  const p = d.polygons[pi];
  if (!p || !p.verts[vi]) return d;
  const polys = d.polygons.map(clonePolygon);
  const verts = polys[pi].verts;
  const arriving = verts[vi].bulge;
  verts[vi].bulge = 0;
  verts.splice(vi, 0, { x: q(at.x), y: q(at.y), bulge: arriving });
  return withPolys(d, polys);
}

/**
 * Remove a vertex. A polygon that would drop below three vertices is removed
 * entirely rather than left in a state the loader refuses: "your level no
 * longer loads" is a worse answer to one keypress than "that polygon is gone,
 * press undo".
 */
export function deleteVertex(d: EditDoc, pi: number, vi: number): EditDoc {
  const p = d.polygons[pi];
  if (!p || !p.verts[vi]) return d;
  if (p.verts.length <= 3) return deletePolygon(d, pi);
  const polys = d.polygons.map(clonePolygon);
  polys[pi].verts.splice(vi, 1);
  return withPolys(d, polys);
}

/** Set the bulge of the edge arriving at `vi`. This is the arc primitive's one knob. */
export function setBulge(d: EditDoc, pi: number, vi: number, bulge: number): EditDoc {
  const p = d.polygons[pi];
  if (!p || !p.verts[vi]) return d;
  const polys = d.polygons.map(clonePolygon);
  const v = polys[pi].verts[vi];
  v.bulge = Number.isFinite(bulge) ? q(bulge) : 0;
  // Flattening an arc by hand writes a bare point, not `"bulge": 0`. The flag
  // exists to keep an UNTOUCHED file byte-stable, not to preserve noise the
  // author has just asked to be rid of.
  delete v.explicitArc;
  return withPolys(d, polys);
}

export function moveStart(d: EditDoc, to: EditPoint): EditDoc {
  const next = cloneDoc(d);
  next.start = { x: q(to.x), y: q(to.y) };
  return next;
}

export function moveFlower(d: EditDoc, to: EditPoint): EditDoc {
  const next = cloneDoc(d);
  next.flower = { x: q(to.x), y: q(to.y) };
  return next;
}

export function addApple(d: EditDoc, at: EditPoint): EditDoc {
  const next = cloneDoc(d);
  next.apples.push({ x: q(at.x), y: q(at.y) });
  return next;
}

export function moveApple(d: EditDoc, i: number, to: EditPoint): EditDoc {
  if (!d.apples[i]) return d;
  const next = cloneDoc(d);
  next.apples[i] = { x: q(to.x), y: q(to.y) };
  return next;
}

export function deleteApple(d: EditDoc, i: number): EditDoc {
  if (!d.apples[i]) return d;
  const next = cloneDoc(d);
  next.apples.splice(i, 1);
  return next;
}

// --- undo --------------------------------------------------------------------

/**
 * Undo, as a bounded stack of whole documents.
 *
 * `push` COALESCES on the label: a drag calls it once per pointermove and all
 * of them collapse into one entry, so undoing a drag undoes the drag rather
 * than one pixel of it. That is the only thing the label is for, and it is why
 * a drag must use a label that nothing else uses while it is in progress —
 * `beginStroke` hands one out.
 */
export interface History {
  doc: EditDoc;
  push(label: string, next: EditDoc): void;
  /** A fresh coalescing label, so the next drag cannot merge into the last one. */
  beginStroke(kind: string): string;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Entries on the undo stack. For the panel, and for the tests. */
  depth(): number;
  /** Marks the current document as saved, so `dirty()` can answer honestly. */
  markSaved(): void;
  dirty(): boolean;
}

export const HISTORY_LIMIT = 200;

export function createHistory(initial: EditDoc, limit = HISTORY_LIMIT): History {
  let doc = cloneDoc(initial);
  const past: { label: string; doc: EditDoc }[] = [];
  const future: EditDoc[] = [];
  let lastLabel = '';
  let strokeSeq = 0;
  let savedDoc = docToFileText(doc);

  const self: History = {
    get doc() {
      return doc;
    },
    set doc(v: EditDoc) {
      doc = v;
    },
    push(label, next): void {
      if (next === doc) return;
      // Coalesce: a repeated label replaces the previous entry's RESULT rather
      // than stacking a new one, so the undo step is the whole gesture.
      if (label !== lastLabel || past.length === 0) {
        past.push({ label, doc });
        if (past.length > limit) past.shift();
        lastLabel = label;
      }
      doc = next;
      future.length = 0;
    },
    beginStroke(kind): string {
      strokeSeq++;
      return `${kind}#${strokeSeq}`;
    },
    undo(): boolean {
      const prev = past.pop();
      if (!prev) return false;
      future.push(doc);
      doc = prev.doc;
      lastLabel = '';
      return true;
    },
    redo(): boolean {
      const next = future.pop();
      if (next === undefined) return false;
      past.push({ label: 'redo', doc });
      doc = next;
      lastLabel = '';
      return true;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    depth: () => past.length,
    markSaved(): void {
      savedDoc = docToFileText(doc);
    },
    dirty: () => docToFileText(doc) !== savedDoc,
  };
  return self;
}
