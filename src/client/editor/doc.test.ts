import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLevel } from '@/sim/level.ts';
import {
  addApple, appendDraft, blankDoc, cancelDraft, cloneDoc, commitDraft, createHistory,
  deleteApple, deletePolygon, deleteVertex, docFromRaw, docToFileText, docToRaw, forkDoc,
  insertVertex, moveApple, moveFlower, moveStart, moveVertex, q, setBulge, setPolygonKind, startDraft,
} from './doc.ts';

const LEVELS = fileURLToPath(new URL('../../../levels/', import.meta.url));
const levelFiles = readdirSync(LEVELS).filter((f) => f.endsWith('.json')).sort();
const readLevel = (f: string): unknown => JSON.parse(readFileSync(join(LEVELS, f), 'utf8'));

describe('the authoring form survives a round trip', () => {
  it('has levels to test against', () => {
    expect(levelFiles.length).toBeGreaterThan(15);
  });

  it.each(levelFiles)('%s: reading and rewriting preserves the geometry exactly', (file) => {
    // THE CLAIM THE WHOLE EDITOR RESTS ON. A level opened and saved with nothing
    // touched must be the same level — same simHash, same leaderboard — or the
    // editor is silently re-cutting geometry every time it writes a file. The
    // interesting half is that this reads the AUTHORING form: if `docFromRaw`
    // went through `parseLevel` it would open nine arcs as three hundred
    // straight segments and this would still pass, which is why the assertion
    // below is about the arc COUNT as well as the hash.
    const raw = readLevel(file);
    const original = parseLevel(raw);
    const doc = docFromRaw(raw, file.replace('.json', ''));
    const again = parseLevel(docToRaw(doc));
    expect(again.simHash).toBe(original.simHash);
    expect(again.arcCount).toBe(original.arcCount);
    expect(again.arcSegments).toBe(original.arcSegments);
    expect(again.decor.length).toBe(original.decor.length);
    expect(again.apples).toEqual(original.apples);
  });

  it('a file the editor wrote re-opens byte-identically', () => {
    // Re-opening must reproduce EXACTLY what was saved, which is stronger than
    // reproducing the same level: it is what makes "edit, save, come back
    // tomorrow" not a lossy operation on the arcs and the metadata.
    let doc = blankDoc('21-round-trip', '21 — Round Trip');
    doc = setBulge(doc, 0, 1, -1.25);
    doc = addApple(doc, { x: 3, y: 1 });
    const text = docToFileText(doc);
    const reopened = docFromRaw(JSON.parse(text), '21-round-trip');
    expect(docToFileText(reopened)).toBe(text);
    // And re-opening is a fixpoint, which is the property that actually
    // matters: every subsequent open/save cycle is a no-op on the bytes.
    expect(docFromRaw(JSON.parse(docToFileText(reopened)), '21-round-trip')).toEqual(reopened);
    expect(reopened.polygons).toEqual(doc.polygons.map((p) => ({
      ...p,
      verts: p.verts.map((v) => (v.bulge === 0 ? v : { ...v, explicitArc: true })),
    })));
    expect(reopened.apples).toEqual(doc.apples);
    expect(reopened.start).toEqual(doc.start);
  });

  it('carries top-level keys it does not model', () => {
    // zones, entities and anything a newer build wrote. Forking a level must
    // not quietly delete the half of it this editor does not understand.
    const raw = {
      ...(readLevel(levelFiles[0]) as Record<string, unknown>),
      zones: [{ type: 'gravity-well-2027', strength: 3 }],
      entities: [{ type: 'teleporter', to: 9 }],
    };
    const out = docToRaw(docFromRaw(raw, 'x')) as unknown as Record<string, unknown>;
    expect(out.zones).toEqual([{ type: 'gravity-well-2027', strength: 3 }]);
    expect(out.entities).toEqual([{ type: 'teleporter', to: 9 }]);
    expect(out.rev).toBe(1);
  });

  it('writes a straight vertex as [x, y] and a curved one as an arc', () => {
    let doc = blankDoc('t', 't');
    doc = setBulge(doc, 0, 2, 0.5);
    const points = (docToRaw(doc).polygons[0].points);
    expect(points[1]).toEqual([20, 0]);
    expect(points[2]).toEqual({ arcTo: [20, 12], bulge: 0.5 });
  });
});

describe('forking', () => {
  it('records the parent simHash and drops to a draft tier', () => {
    const raw = readLevel('01-first-light.json');
    const parent = parseLevel(raw);
    const doc = forkDoc(docFromRaw(raw, '01-first-light'), parent.simHash, '21-with-a-jump', '21 — With A Jump');
    expect(doc.tier).toBe('draft');
    expect(doc.parent).toEqual({ simHash: parent.simHash, name: parent.name });

    const forked = parseLevel(docToRaw(doc));
    // Identity is geometry: an untouched fork IS the same level until you move
    // something, and the leaderboard is right to think so.
    expect(forked.simHash).toBe(parent.simHash);
    expect(forked.tier).toBe('draft');
    expect(forked.provenance?.parent).toEqual({ simHash: parent.simHash, name: parent.name });
  });

  it('a fork of a fork points at its immediate parent, not the root', () => {
    const raw = readLevel('01-first-light.json');
    const root = parseLevel(raw);
    const first = forkDoc(docFromRaw(raw, 'a'), root.simHash, 'b', 'B');
    const moved = moveVertex(first, 0, 0, { x: -46.5, y: -0.25 });
    const firstHash = parseLevel(docToRaw(moved)).simHash;
    const second = forkDoc(moved, firstHash, 'c', 'C');
    expect(second.parent?.simHash).toBe(firstHash);
    expect(second.parent?.simHash).not.toBe(root.simHash);
  });
});

describe('operations', () => {
  it('quantises to a tenth of a millimetre, at the edit and not at the save', () => {
    // A pointer produces 0.30000000000000004 and a level file full of those is
    // not hand-editable, which the format's whole thesis depends on.
    expect(q(0.1 + 0.2)).toBe(0.3);
    const doc = moveVertex(blankDoc('t', 't'), 0, 0, { x: 0.1 + 0.2, y: 1 / 3 });
    expect(doc.polygons[0].verts[0]).toEqual({ x: 0.3, y: 0.3333, bulge: 0 });
    expect(docToFileText(doc)).toContain('0.3333');
  });

  it('never mutates the document it was given', () => {
    const a = blankDoc('t', 't');
    const before = docToFileText(a);
    moveVertex(a, 0, 0, { x: 9, y: 9 });
    addApple(a, { x: 1, y: 1 });
    deletePolygon(a, 0);
    setBulge(a, 0, 1, 3);
    expect(docToFileText(a)).toBe(before);
  });

  it('insert takes over the arriving bulge and leaves the new edge straight', () => {
    // Splitting a curve and giving both halves the whole sagitta would visibly
    // change the shape; giving neither any would flatten it.
    let doc = blankDoc('t', 't');
    doc = setBulge(doc, 0, 1, 2);
    doc = insertVertex(doc, 0, 1, { x: 0, y: 1 });
    expect(doc.polygons[0].verts[1]).toEqual({ x: 0, y: 1, bulge: 2 });
    expect(doc.polygons[0].verts[2].bulge).toBe(0);
  });

  it('deleting the third-from-last vertex removes the polygon rather than breaking the level', () => {
    let doc = blankDoc('t', 't');
    doc = deleteVertex(doc, 0, 0);
    expect(doc.polygons[0].verts.length).toBe(3);
    doc = deleteVertex(doc, 0, 0);
    expect(doc.polygons.length).toBe(0);
  });

  it('places and moves the objects', () => {
    let doc = blankDoc('t', 't');
    doc = moveStart(doc, { x: -1, y: 2 });
    doc = moveFlower(doc, { x: 5, y: 6 });
    doc = addApple(doc, { x: 1, y: 1 });
    doc = moveApple(doc, 0, { x: 2, y: 2 });
    expect(doc.start).toEqual({ x: -1, y: 2 });
    expect(doc.flower).toEqual({ x: 5, y: 6 });
    expect(doc.apples[0]).toEqual({ x: 2, y: 2 });
    doc = deleteApple(doc, 0);
    expect(doc.apples.length).toBe(1);
  });

  it('changes a polygon kind without touching its points', () => {
    const doc = setPolygonKind(blankDoc('t', 't'), 0, 'ground');
    expect(doc.polygons[0].kind).toBe('ground');
    expect(doc.polygons[0].verts.length).toBe(4);
  });
});

describe('the draft polygon', () => {
  it('is not part of the level until it is closed', () => {
    // Two points is not a polygon, and if the draft lived in `polygons` the
    // loader would refuse the whole file for as long as you were drawing —
    // which is exactly when the live feedback is most wanted.
    let doc = startDraft(blankDoc('t', 't'), 'ground', { x: 0, y: 0 });
    doc = appendDraft(doc, { x: 1, y: 0 });
    expect(docToRaw(doc).polygons.length).toBe(1);
    expect(() => parseLevel(docToRaw(doc))).not.toThrow();

    doc = appendDraft(doc, { x: 1, y: 1 });
    const { doc: closed, index } = commitDraft(doc);
    expect(index).toBe(1);
    expect(closed.draft).toBeNull();
    expect(docToRaw(closed).polygons.length).toBe(2);
  });

  it('refuses to close under three vertices, and discards on cancel', () => {
    let doc = startDraft(blankDoc('t', 't'), 'ground', { x: 0, y: 0 });
    doc = appendDraft(doc, { x: 1, y: 0 });
    expect(commitDraft(doc).index).toBe(-1);
    expect(commitDraft(doc).doc).toBe(doc);
    expect(cancelDraft(doc).draft).toBeNull();
  });
});

describe('undo', () => {
  it('steps back and forward through whole documents', () => {
    const h = createHistory(blankDoc('t', 't'));
    expect(h.canUndo()).toBe(false);
    h.push('move', moveVertex(h.doc, 0, 0, { x: 5, y: 5 }));
    h.push('apple', addApple(h.doc, { x: 1, y: 1 }));
    expect(h.doc.apples.length).toBe(2);
    expect(h.undo()).toBe(true);
    expect(h.doc.apples.length).toBe(1);
    expect(h.doc.polygons[0].verts[0].x).toBe(5);
    expect(h.undo()).toBe(true);
    expect(h.doc.polygons[0].verts[0].x).toBe(-20);
    expect(h.undo()).toBe(false);
    expect(h.redo()).toBe(true);
    expect(h.doc.polygons[0].verts[0].x).toBe(5);
  });

  it('coalesces a drag into one step', () => {
    // Forty pointermoves is one gesture, and undo has to agree or it is useless.
    const h = createHistory(blankDoc('t', 't'));
    const stroke = h.beginStroke('drag');
    for (let i = 1; i <= 40; i++) h.push(stroke, moveVertex(h.doc, 0, 0, { x: i, y: 0 }));
    expect(h.depth()).toBe(1);
    h.undo();
    expect(h.doc.polygons[0].verts[0].x).toBe(-20);
  });

  it('a second drag does not merge into the first', () => {
    const h = createHistory(blankDoc('t', 't'));
    const a = h.beginStroke('drag');
    h.push(a, moveVertex(h.doc, 0, 0, { x: 1, y: 0 }));
    const b = h.beginStroke('drag');
    h.push(b, moveVertex(h.doc, 0, 0, { x: 2, y: 0 }));
    expect(h.depth()).toBe(2);
    h.undo();
    expect(h.doc.polygons[0].verts[0].x).toBe(1);
  });

  it('a new edit after an undo drops the redo branch', () => {
    const h = createHistory(blankDoc('t', 't'));
    h.push('a', addApple(h.doc, { x: 1, y: 1 }));
    h.undo();
    expect(h.canRedo()).toBe(true);
    h.push('b', addApple(h.doc, { x: 2, y: 2 }));
    expect(h.canRedo()).toBe(false);
  });

  it('is bounded, and drops the oldest', () => {
    const h = createHistory(blankDoc('t', 't'), 5);
    for (let i = 0; i < 20; i++) h.push('e' + i, addApple(h.doc, { x: i, y: 0 }));
    expect(h.depth()).toBe(5);
  });

  it('knows whether the document differs from what was saved', () => {
    const h = createHistory(blankDoc('t', 't'));
    expect(h.dirty()).toBe(false);
    h.push('a', addApple(h.doc, { x: 1, y: 1 }));
    expect(h.dirty()).toBe(true);
    h.markSaved();
    expect(h.dirty()).toBe(false);
    h.undo();
    expect(h.dirty()).toBe(true);
  });
});

describe('cloneDoc', () => {
  it('is deep', () => {
    const a = blankDoc('t', 't');
    const b = cloneDoc(a);
    b.polygons[0].verts[0].x = 999;
    b.apples[0].x = 999;
    expect(a.polygons[0].verts[0].x).toBe(-20);
    expect(a.apples[0].x).toBe(0);
  });
});
