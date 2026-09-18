// THE FAST FEEDBACK TIER: everything cheap enough to run on every edit, turned
// into one list of findings with a place on the map.
//
// The whole argument is that `bin/level-check` already computes all of this and
// prints it as a report AFTERWARDS. A report afterwards is the wrong shape for
// authoring: you learn that vertex 41 is coarse long after you have forgotten
// why you put it there. So the same functions run on every keystroke and every
// pointer move, and the answer is drawn where the problem is.
//
// It is the SAME loader and the SAME sag metric, not a client-side
// approximation of them. Two implementations would be two sets of thresholds to
// drift apart, and the one that disagreed would be the one the author was
// looking at. `src/shared/sag.ts` was moved out of bin/ for exactly this.
//
// COST. Parsing a level is a few hundred microseconds — tessellation included —
// and the sag pass is linear in the vertex count. On the biggest shipped level
// (about 1,400 compiled vertices) the whole of this is well under a millisecond,
// which is why it can be unconditional rather than debounced. Anything that is
// NOT in that budget belongs in the deliberate tier with the solver, and the
// rule for deciding is simply whether it can run inside a pointermove.
import { parseLevel } from '@/sim/level.ts';
import type { Level } from '@/sim/level.ts';
import { sagFindings } from '@/shared/sag.ts';
import { docToRaw } from './doc.ts';
import type { EditDoc } from './doc.ts';
import { envelopeFindings, headroomFindings } from './geom.ts';

/**
 * Which tool found it, so the panel can group and the overlay can filter.
 *
 *   load      the real loader refused the file. Always an error.
 *   sag       a straight run too coarse to ride smoothly. Always a warning.
 *   envelope  the geometry asks the bike for something near its measured limit.
 *   editor    something about the document rather than the level: a polygon
 *             still being drawn, a name that is not a filename.
 */
export type FindingClass = 'load' | 'sag' | 'envelope' | 'editor';

export interface Finding {
  cls: FindingClass;
  severity: 'error' | 'warn';
  message: string;
  /** Where to point on the canvas. Null when it is about the whole file. */
  at: { x: number; y: number } | null;
}

export interface CheckResult {
  /** The compiled level, or null when the loader refused it. */
  level: Level | null;
  /** The loader's own message, verbatim, or null. */
  loadError: string | null;
  findings: Finding[];
  errors: number;
  warns: number;
  /** Worst sag in metres, for the one-line summary. 0 when clean. */
  worstSag: number;
}

/** Filenames are ids: lower-case, digits and dashes. Enforced, not hoped for. */
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function checkDoc(doc: EditDoc): CheckResult {
  const findings: Finding[] = [];
  let level: Level | null = null;
  let loadError: string | null = null;

  try {
    level = parseLevel(docToRaw(doc));
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
    findings.push({ cls: 'load', severity: 'error', message: loadError, at: locate(doc, loadError) });
  }

  // Document-level things the loader has no opinion about, because they are
  // about the FILE rather than the level.
  if (doc.draft) {
    findings.push({
      cls: 'editor',
      severity: 'warn',
      message: `a ${doc.draft.kind} polygon is still being drawn (${doc.draft.verts.length} ${doc.draft.verts.length === 1 ? 'vertex' : 'vertices'}) — ENTER closes it, ESC discards it`,
      at: doc.draft.verts.length ? { x: doc.draft.verts[doc.draft.verts.length - 1].x, y: doc.draft.verts[doc.draft.verts.length - 1].y } : null,
    });
  }
  if (!ID_RE.test(doc.id)) {
    findings.push({
      cls: 'editor', severity: 'error', at: null,
      message: `"${doc.id}" is not a filename: lower-case letters, digits and dashes, starting with a letter or digit`,
    });
  }
  if (doc.tier === 'core') {
    // Unreachable through the UI — `forkDoc` and `blankDoc` both write "draft"
    // — but the save path refuses a core tier and an author who hand-edited the
    // field deserves to learn that here rather than from a 403.
    findings.push({
      cls: 'editor', severity: 'error', at: null,
      message: 'tier "core" is the shipped set and the editor cannot write it. Save as a draft and promote the file by hand.',
    });
  }

  let worstSag = 0;
  if (level) {
    for (const p of level.polys) {
      for (const f of sagFindings(p, level.sagTolerance)) {
        if (f.sag > worstSag) worstSag = f.sag;
        findings.push({
          cls: 'sag', severity: 'warn', at: { x: f.x, y: f.y },
          message: `turns ${f.turn.toFixed(1)}°, so a ${f.chord.toFixed(2)} m chord across the implied ${f.radius.toFixed(2)} m curve sags ${(f.sag * 1000).toFixed(1)} mm — one arc entry replaces the run`,
        });
      }
    }
    for (const f of [...envelopeFindings(level.polys), ...headroomFindings(level)]) {
      findings.push({ cls: 'envelope', severity: 'warn', at: { x: f.x, y: f.y }, message: f.message });
    }
  }

  return {
    level,
    loadError,
    findings,
    errors: findings.filter((f) => f.severity === 'error').length,
    warns: findings.filter((f) => f.severity === 'warn').length,
    worstSag,
  };
}

/**
 * Turn the loader's message into a place on the map.
 *
 * The loader names the polygon and the vertex — `level.polygons[2].points[5]` —
 * because it was written for somebody reading a file in a text editor. In an
 * editor those are coordinates, and an error you can be shown is worth several
 * you have to go and find.
 *
 * The one case that does not map cleanly is the zero-length-edge check, whose
 * index is into the TESSELLATED ring rather than the entries the author wrote.
 * When the index is out of range for the entries, this falls back to the
 * polygon's first vertex: pointing at the right polygon beats pointing at the
 * wrong vertex, and beats pointing at nothing.
 */
export function locate(doc: EditDoc, message: string): { x: number; y: number } | null {
  const poly = /polygons\[(\d+)\]/.exec(message);
  if (poly) {
    const p = doc.polygons[Number(poly[1])];
    if (!p || p.verts.length === 0) return null;
    const pts = /points\[(\d+)\]/.exec(message);
    const vi = pts ? Number(pts[1]) : -1;
    const v = vi >= 0 && vi < p.verts.length ? p.verts[vi] : p.verts[0];
    return { x: v.x, y: v.y };
  }
  const apple = /apples\[(\d+)\]/.exec(message);
  if (apple) {
    const a = doc.apples[Number(apple[1])];
    return a ? { x: a.x, y: a.y } : null;
  }
  if (message.includes('level.start')) return { x: doc.start.x, y: doc.start.y };
  if (message.includes('level.flower')) return { x: doc.flower.x, y: doc.flower.y };
  return null;
}

/** One line for the HUD: what the fast tier currently thinks of the document. */
export function summarise(c: CheckResult): string {
  if (c.loadError) return 'does not load';
  const bits: string[] = [];
  if (c.errors) bits.push(`${c.errors} error${c.errors === 1 ? '' : 's'}`);
  const sag = c.findings.filter((f) => f.cls === 'sag').length;
  const env = c.findings.filter((f) => f.cls === 'envelope').length;
  if (sag) bits.push(`${sag} coarse (worst ${(c.worstSag * 1000).toFixed(0)} mm)`);
  if (env) bits.push(`${env} envelope`);
  return bits.length ? bits.join(', ') : 'clean';
}
