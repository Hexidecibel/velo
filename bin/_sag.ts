// The sag metric behind bin/level-check's warnings, and behind the assertion in
// src/sim/curvelevel.test.ts that the arc level has no coarse runs left in it.
//
// A wheel rolling a chord of length L across a curve of radius R drops
// L^2 / (8R) below the true surface mid-chord. Measured against the 0.25 m
// wheel that is imperceptible at 0.25 m segments and a real jolt at 1 m
// segments on a tight curve, which is the whole reason arcs exist — and the
// reason a hand-authored polyline is worth measuring the same way.
//
// It lives under bin/ rather than src/sim because it is a TOOL: nothing
// downstream of it is ever simulated, hashed or verified. src/sim stays the set
// of files that must import nothing and call no approximated Math.
import { chordSag } from '../src/sim/arc.ts';
import type { CompiledPolygon } from '../src/sim/level.ts';

export interface Finding {
  x: number;
  y: number;
  radius: number;
  chord: number;
  sag: number;
  /** How far the polyline turns at this vertex, degrees. */
  turn: number;
}

/**
 * cos(45 deg). A turn sharper than this is read as a deliberate CORNER, not as
 * a coarsely sampled curve, and is not reported. That gate matters more than it
 * looks: without it every box in every level is four "infinitely coarse
 * curves", and the warning becomes noise within one run.
 */
const COS_CORNER = 0.7071067811865476;

/**
 * Sag findings for one polygon, worst first.
 *
 * The second gate is that a vertex must sit in a RUN — its turn and at least
 * one neighbour's turn must be gentle AND in the same direction. One isolated
 * gentle kink is still a corner, and geometrically an exact one: there is no
 * "true curve" for it to sag away from. Two or more consecutive turns the same
 * way is what a sampled curve looks like, and that is what this reports.
 */
export function sagFindings(p: CompiledPolygon, tol: number): Finding[] {
  const n = p.vx.length;
  if (n < 3) return [];
  const sin = new Float64Array(n);
  const cos = new Float64Array(n);
  const len = new Float64Array(n); // length of the edge ENTERING vertex i

  for (let i = 0; i < n; i++) {
    const h = i === 0 ? n - 1 : i - 1;
    const j = i + 1 === n ? 0 : i + 1;
    const ax = p.vx[i] - p.vx[h];
    const ay = p.vy[i] - p.vy[h];
    const bx = p.vx[j] - p.vx[i];
    const by = p.vy[j] - p.vy[i];
    const la = Math.sqrt(ax * ax + ay * ay);
    const lb = Math.sqrt(bx * bx + by * by);
    len[i] = la;
    const inv = 1 / (la * lb);
    sin[i] = (ax * by - ay * bx) * inv;
    cos[i] = (ax * bx + ay * by) * inv;
  }

  const gentle = (i: number): boolean => cos[i] > COS_CORNER && Math.abs(sin[i]) > 1e-9;
  const out: Finding[] = [];
  for (let i = 0; i < n; i++) {
    if (!gentle(i)) continue;
    const h = i === 0 ? n - 1 : i - 1;
    const j = i + 1 === n ? 0 : i + 1;
    const run =
      (gentle(h) && sin[h] * sin[i] > 0) || (gentle(j) && sin[j] * sin[i] > 0);
    if (!run) continue;

    // Circumradius of (v[h], v[i], v[j]). By the law of sines that is
    // |v[j] - v[h]| / (2 * sin of the angle opposite it), and the angle opposite
    // is pi minus the turn — whose sine is the turn's. This is the curve the
    // author's three points imply.
    const la = len[i];
    const lb = len[j];
    const cx = p.vx[j] - p.vx[h];
    const cy = p.vy[j] - p.vy[h];
    const lc = Math.sqrt(cx * cx + cy * cy);
    const radius = lc / (2 * Math.abs(sin[i]));
    // The SHORTER of the two chords, deliberately. Both endpoints sit on the
    // circumcircle by construction, so the longer one is not evidence of
    // anything: a long straight run meeting an arc tangentially turns by a
    // fraction of a degree, which implies a huge radius, and measuring the
    // straight 8 m side against it "finds" 25 mm of sag in a line that is
    // exactly straight. The short side is the one that is actually on the
    // implied curve. Under-reporting an uneven run costs nothing, because its
    // neighbouring vertex reports it.
    const chord = la < lb ? la : lb;
    const sag = chordSag(radius, chord);
    // atan2 is fine HERE and nowhere under src/sim: this is a reporting tool,
    // and nothing downstream of a printed number is ever verified.
    const turn = (Math.abs(Math.atan2(sin[i], cos[i])) * 180) / Math.PI;
    if (sag > tol) out.push({ x: p.vx[i], y: p.vy[i], radius, chord, sag, turn });
  }
  out.sort((a, b) => b.sag - a.sag);
  return out;
}
