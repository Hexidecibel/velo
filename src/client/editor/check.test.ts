import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseLevel } from '@/sim/level.ts';
import { checkDoc, locate, summarise } from './check.ts';
import { addApple, appendDraft, blankDoc, docFromRaw, forkDoc, moveStart, moveVertex, setMeta, startDraft } from './doc.ts';

const levelsDir = fileURLToPath(new URL('../../../levels/', import.meta.url));
/**
 * How the editor actually opens a shipped level: as a FORK. There is no other
 * route — see `forkDoc` — so every document the checker ever sees is a draft,
 * which is why the core-tier finding below is a guard rather than noise.
 */
const openLevel = (f: string) => {
  const raw: unknown = JSON.parse(readFileSync(levelsDir + f, 'utf8'));
  const id = f.replace('.json', '');
  return forkDoc(docFromRaw(raw, id), parseLevel(raw).simHash, id + '-fork', 'fork');
};

describe('the fast tier', () => {
  it('is quiet on a level that is fine', () => {
    const c = checkDoc(blankDoc('21-new', '21 — New'));
    expect(c.loadError).toBeNull();
    expect(c.errors).toBe(0);
    expect(c.findings.length).toBe(0);
    expect(summarise(c)).toBe('clean');
  });

  it('is quiet on the shipped levels, which is the calibration that matters', () => {
    // If opening a level that ships with the game produced a list of
    // complaints, the list would be noise by the second level. Twelve of the
    // twenty are completely silent; the rest trip only the envelope warnings,
    // never an error and never sag.
    for (const f of ['01-first-light.json', '12-whoops.json', '15-feather.json', '19-low-roof.json']) {
      const c = checkDoc(openLevel(f));
      expect(c.errors).toBe(0);
      expect(c.findings.length).toBe(0);
    }
  });

  it('reports the loader refusing the file, with the loader own message', () => {
    // The SAME loader, not a client-side approximation of it. Two
    // implementations would be two sets of rules to drift apart.
    const doc = moveVertex(blankDoc('t', 't'), 0, 1, { x: -20, y: 0 });
    const c = checkDoc(doc);
    expect(c.level).toBeNull();
    expect(c.loadError).toContain('zero-length edge');
    expect(c.errors).toBe(1);
    expect(summarise(c)).toBe('does not load');
  });

  it('puts the loader message on the map', () => {
    // An error you can be shown is worth several you have to go and find.
    const doc = blankDoc('t', 't');
    const c = checkDoc(moveStart(doc, { x: -100, y: -100 }));
    expect(c.loadError).toContain('inside solid');
    expect(c.findings[0].at).toEqual({ x: -100, y: -100 });
  });

  it('locates a polygon, a vertex, an apple, the start and the flower', () => {
    const doc = addApple(blankDoc('t', 't'), { x: 7, y: 7 });
    expect(locate(doc, 'level.polygons[0].points[2]: nonsense')).toEqual({ x: 20, y: 12 });
    // The zero-length check counts into the TESSELLATED ring, so an index past
    // the entries falls back to the polygon rather than to the wrong vertex.
    expect(locate(doc, 'level.polygons[0].points[900]: nonsense')).toEqual({ x: -20, y: 0 });
    expect(locate(doc, 'level.apples[1]: nonsense')).toEqual({ x: 7, y: 7 });
    expect(locate(doc, 'level.start: nonsense')).toEqual({ x: -16, y: 0.45 });
    expect(locate(doc, 'level.flower: nonsense')).toEqual({ x: 16, y: 0.6 });
    expect(locate(doc, 'level: no collidable polygons')).toBeNull();
  });

  it('surfaces sag as a warning, never an error', () => {
    // A deliberate hard edge is legitimate level design, in exactly the way
    // bin/level-check already says it is.
    const doc = blankDoc('t', 't');
    // Six vertices approximating a gentle curve, coarsely.
    doc.polygons[0].verts = [
      { x: -20, y: 0, bulge: 0 },
      { x: -10, y: -1.2, bulge: 0 },
      { x: 0, y: -1.6, bulge: 0 },
      { x: 10, y: -1.2, bulge: 0 },
      { x: 20, y: 0, bulge: 0 },
      { x: 20, y: 12, bulge: 0 },
      { x: -20, y: 12, bulge: 0 },
    ];
    const c = checkDoc(doc);
    expect(c.errors).toBe(0);
    const sag = c.findings.filter((f) => f.cls === 'sag');
    expect(sag.length).toBeGreaterThan(0);
    expect(sag[0].severity).toBe('warn');
    expect(sag[0].message).toContain('arc entry');
    expect(c.worstSag).toBeGreaterThan(0.002);
    expect(summarise(c)).toContain('coarse');
  });

  it('says a polygon is still being drawn, and does not let it break the level', () => {
    let doc = startDraft(blankDoc('t', 't'), 'ground', { x: 0, y: 3 });
    doc = appendDraft(doc, { x: 2, y: 3 });
    const c = checkDoc(doc);
    expect(c.level).not.toBeNull();
    expect(c.findings.some((f) => f.cls === 'editor' && f.message.includes('still being drawn'))).toBe(true);
    expect(c.errors).toBe(0);
  });

  it('refuses an id that is not a filename, and a core tier', () => {
    expect(checkDoc(setMeta(blankDoc('t', 't'), { id: 'My Level!' })).errors).toBe(1);
    expect(checkDoc(setMeta(blankDoc('t', 't'), { id: '' })).errors).toBe(1);
    expect(checkDoc(setMeta(blankDoc('t', 't'), { id: '21-the-jump' })).errors).toBe(0);
    const core = checkDoc(setMeta(blankDoc('t', 't'), { tier: 'core' }));
    expect(core.errors).toBe(1);
    expect(core.findings[0].message).toContain('cannot write it');
  });

  it('compiles the level it checked, so nothing parses twice', () => {
    const c = checkDoc(openLevel('14-kicker.json'));
    expect(c.level?.simHash).toBe(parseLevel(JSON.parse(readFileSync(levelsDir + '14-kicker.json', 'utf8'))).simHash);
  });
});
