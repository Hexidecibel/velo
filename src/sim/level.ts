// The level format, and the loader that refuses to hand the sim a level that
// would produce a NaN.
//
// JSON, hand-writable in a text editor, y-UP (gravity is -y; the renderer
// flips). The builder is deferred; the FORMAT is not, because it and the replay
// format are the two things that get expensive to change once a level library
// and a leaderboard exist.
//
// Polygons carry an explicit `kind` instead of relying on winding. Winding is
// an INVISIBLE failure mode for a hand-author: get the vertex order backwards
// and the level loads fine with inside-out collision. `kind` is
// self-documenting and the loader normalises winding on load, so getting it
// wrong becomes impossible.
//
//   cave   playable space is INSIDE the ring; solid is outside. Elma's caves.
//   ground solid is INSIDE; a platform, a boulder, a pillar.
//   decor  never collides. Drawn only.
//
// `zones` and `entities` exist from day one for the later boost pads, gravity
// zones, ice and teleporters. Rev 1 IGNORES them, and the loader TOLERATES
// unknown types rather than rejecting — that is what keeps a level authored in
// 2027 loadable by a 2026 client.
//
// GEOMETRY DOES NOT GET THAT TOLERANCE. An unrecognised entry in a `points`
// list is rejected, not skipped, because every other array here is content the
// sim may ignore while `points` is the collision surface itself — quietly
// dropping a vertex you did not understand is how a level loads with a hole in
// the floor.
//
// CURVES LIVE IN THE AUTHORING FORMAT AND NOWHERE ELSE. A `points` entry may be
// an arc to the next point (see arc.ts for the shape and the reasoning behind
// it); the loader tessellates it here, deterministically, at compile time. Past
// this file there are only straight segments: `collide.ts` has exactly one
// primitive and never learns what an arc is. That is the trade the whole
// feature is built on — level files stay short and hand-editable, and the
// physics stays as simple and as tested as it already is.
import { Hasher } from './hash.ts';
import { DEFAULT_SAG_TOLERANCE, EPS, MAX_ARC_SEGMENTS, MIN_EDGE_LEN2 } from './consts.ts';
import { tessellateArc } from './arc.ts';
import type { ArcStatus } from './arc.ts';
import type { Vec2 } from './spec.ts';

export type PolyKind = 'cave' | 'ground' | 'decor';

/** A literal vertex. */
export type RawPoint = [number, number];

/**
 * An arc from the PREVIOUS entry in the points list to `arcTo`.
 *
 *     { "arcTo": [12, 0], "bulge": -2.5 }
 *
 * `bulge` is the signed height in METRES of the middle of the arc off the
 * middle of its chord, positive to the LEFT of the direction of travel. Write a
 * floor left-to-right — which is what everyone does in a y-up side-scroller —
 * and the rule is simply "positive humps up, negative dishes down". Zero is a
 * straight line. There is no impossible value and no flag to get backwards;
 * arc.ts records why that was chosen over a radius plus large-arc/sweep.
 *
 * An arc as the FIRST entry curves the closing edge, because the entry before
 * entry 0 is the last one. Nothing special is needed to say that — the list is
 * a ring.
 */
export interface RawArc {
  arcTo: RawPoint;
  bulge: number;
  /** Per-arc override of the level's sag tolerance, metres. */
  sagTolerance?: number;
}

export type RawVertex = RawPoint | RawArc;

export interface RawPolygon {
  kind: PolyKind;
  /**
   * Vertices in ring order — an [x, y] pair, or an arc to the next point.
   * Closing vertex implied; do not repeat the first point.
   */
  points: RawVertex[];
}

/** Decor after tessellation: literal points, because nothing re-reads the arcs. */
export interface DecorPolygon {
  kind: 'decor';
  points: RawPoint[];
}

export interface RawLevel {
  format?: string;
  rev?: number;
  name?: string;
  author?: string;
  start: Vec2;
  flower: Vec2;
  apples?: Vec2[];
  polygons: RawPolygon[];
  /**
   * Metres of sag any tessellated chord may have against the true arc.
   * Defaults to DEFAULT_SAG_TOLERANCE. PART OF THE PHYSICS CONTRACT: it decides
   * the collision geometry every curve compiles to, so changing it changes what
   * the bike hits, changes simHash, and invalidates every time on every level
   * that contains an arc.
   */
  sagTolerance?: number;
  /** Reserved. Ignored by rev 1, preserved for contentHash. */
  zones?: unknown[];
  entities?: unknown[];
}

/**
 * A polygon with everything the narrowphase needs precomputed. Vertices are
 * normalised to counter-clockwise winding so that "the normal pointing out of
 * the solid" has one unambiguous formula per kind.
 */
export interface CompiledPolygon {
  kind: 'cave' | 'ground';
  /** True when the solid material is inside the ring (i.e. kind === 'ground'). */
  solidInside: boolean;
  vx: Float64Array;
  vy: Float64Array;
  /** Unit normal of edge i (vertex i -> i+1), pointing OUT OF THE SOLID. */
  nx: Float64Array;
  ny: Float64Array;
  /**
   * Angle-independent pseudo-normal at vertex i, = normalize(n[i-1] + n[i]).
   * This is what makes the signed distance LOCAL: the sign of the SDF at a
   * vertex-region query is sign(dot(p - v, pseudoNormal)), with no
   * point-in-polygon test and therefore no dependence on edges the broadphase
   * did not return.
   */
  pnx: Float64Array;
  pny: Float64Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Level {
  name: string;
  start: Vec2;
  flower: Vec2;
  apples: Vec2[];
  /** Collidable polygons, in file order. Decor is not here. */
  polys: CompiledPolygon[];
  decor: DecorPolygon[];
  /** The tolerance the arcs in this level were actually tessellated at. */
  sagTolerance: number;
  /** How many arc entries the file contained, across every polygon. */
  arcCount: number;
  /** How many vertices those arcs generated. Zero for an arc-free level. */
  arcSegments: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /**
   * Covers ONLY the fields the sim reads — collidable polygons in order, start,
   * apples in order, flower. Leaderboards key on this, so retitling or
   * recolouring a level preserves its leaderboard while moving an apple by
   * 1e-12 does not. Hashing the raw file bytes is the easy mistake here.
   *
   * It covers the TESSELLATED vertices, never the arc parameters that produced
   * them, because the collision geometry is what determines a time and the
   * collision geometry is straight segments. The consequence is deliberate and
   * has to be said out loud: raising or lowering `sagTolerance` moves the
   * vertices, moves this hash, and invalidates every recorded time on the
   * level. A tolerance is a physics constant wearing an authoring hat.
   */
  simHash: string;
  /** Covers the whole file, including name, decor and the reserved arrays. */
  contentHash: string;
}

export class LevelError extends Error {}

function bad(msg: string): never {
  throw new LevelError(msg);
}

function finite(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(`${what}: expected a finite number, got ${String(v)}`);
  return v as number;
}

function vec(v: unknown, what: string): Vec2 {
  if (!v || typeof v !== 'object') bad(`${what}: expected {x, y}`);
  const o = v as Record<string, unknown>;
  return { x: finite(o.x, `${what}.x`), y: finite(o.y, `${what}.y`) };
}

/** Shoelace. Positive is counter-clockwise in a y-up frame. */
function signedArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = i + 1 === pts.length ? 0 : i + 1;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return a * 0.5;
}

/**
 * Parse, validate and compile. Rejects HARD and at load time, because a
 * zero-length edge produces a NaN normal and one NaN poisons the entire state
 * buffer within a single tick. That is the likeliest way a hand-authored level
 * nukes the sim, and it must not be a runtime surprise.
 */
export function parseLevel(raw: unknown): Level {
  if (!raw || typeof raw !== 'object') bad('level: expected an object');
  const r = raw as RawLevel;

  if (r.format !== undefined && r.format !== 'velo-level') {
    bad(`level.format: expected "velo-level", got ${JSON.stringify(r.format)}`);
  }
  if (!Array.isArray(r.polygons) || r.polygons.length === 0) bad('level.polygons: expected a non-empty array');

  let sagTolerance = DEFAULT_SAG_TOLERANCE;
  if (r.sagTolerance !== undefined) {
    sagTolerance = finite(r.sagTolerance, 'level.sagTolerance');
    if (sagTolerance <= 0) bad(`level.sagTolerance: must be > 0, got ${sagTolerance}`);
  }

  const start = vec(r.start, 'level.start');
  const flower = vec(r.flower, 'level.flower');
  const apples: Vec2[] = [];
  if (r.apples !== undefined) {
    if (!Array.isArray(r.apples)) bad('level.apples: expected an array');
    r.apples.forEach((a, i) => apples.push(vec(a, `level.apples[${i}]`)));
  }

  const polys: CompiledPolygon[] = [];
  const decor: DecorPolygon[] = [];
  let arcCount = 0;
  let arcSegments = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  r.polygons.forEach((p, pi) => {
    const where = `level.polygons[${pi}]`;
    if (!p || typeof p !== 'object') bad(`${where}: expected an object`);
    const kind = p.kind;
    if (kind !== 'cave' && kind !== 'ground' && kind !== 'decor') {
      bad(`${where}.kind: expected "cave" | "ground" | "decor", got ${JSON.stringify(kind)}`);
    }
    if (!Array.isArray(p.points) || p.points.length < 2) bad(`${where}.points: need at least 3 vertices`);

    // Arcs are resolved to straight segments HERE, and never again after.
    // Everything below this line — the zero-length check, the area check, the
    // winding normalisation, both hashes, the whole sim — sees a plain list of
    // points and cannot tell which of them an author typed.
    const ring = readRing(p.points, where, sagTolerance);
    arcCount += ring.arcs;
    arcSegments += ring.generated;
    const pts = ring.pts;
    if (pts.length < 3) bad(`${where}.points: need at least 3 vertices`);

    for (let i = 0; i < pts.length; i++) {
      const j = i + 1 === pts.length ? 0 : i + 1;
      const dx = pts[j][0] - pts[i][0];
      const dy = pts[j][1] - pts[i][1];
      if (dx * dx + dy * dy < MIN_EDGE_LEN2) {
        bad(`${where}.points[${i}]..[${j}]: zero-length edge (duplicate consecutive vertices)`);
      }
    }

    const area = signedArea(pts);
    if (Math.abs(area) < 1e-9) bad(`${where}: degenerate polygon, area ${area}`);
    // Normalise winding to counter-clockwise. This is what makes an author's
    // vertex order irrelevant.
    if (area < 0) pts.reverse();

    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    if (kind === 'decor') {
      decor.push({ kind, points: pts });
      return;
    }
    polys.push(compilePolygon(kind, pts));
  });

  if (polys.length === 0) bad('level: no collidable polygons (every polygon was decor)');

  // Nothing may start or sit inside solid material. A start point inside solid
  // is an instant explosion; an apple inside solid is uncollectable and turns a
  // level into a silent impossibility, which is exactly the class of bug the
  // later solver exists to find and which is free to catch here.
  const probes: { what: string; p: Vec2 }[] = [{ what: 'start', p: start }, { what: 'flower', p: flower }];
  apples.forEach((a, i) => probes.push({ what: `apples[${i}]`, p: a }));
  for (const { what, p } of probes) {
    for (let i = 0; i < polys.length; i++) {
      if (pointInSolid(polys[i], p.x, p.y)) {
        bad(`level.${what}: (${p.x}, ${p.y}) is inside solid polygon ${i}`);
      }
    }
  }

  const level: Level = {
    name: typeof r.name === 'string' ? r.name : 'untitled',
    start,
    flower,
    apples,
    polys,
    decor,
    sagTolerance,
    arcCount,
    arcSegments,
    minX,
    minY,
    maxX,
    maxY,
    simHash: '',
    contentHash: '',
  };
  level.simHash = computeSimHash(level);
  level.contentHash = computeContentHash(r);
  return level;
}

interface Ring {
  pts: RawPoint[];
  /** How many entries were arcs. */
  arcs: number;
  /** How many vertices those arcs generated. */
  generated: number;
}

/**
 * Validate a `points` list and resolve every arc in it into literal vertices.
 *
 * The list is a RING, so the edge into entry i comes from entry i-1 with
 * wrap-around, and an arc at entry 0 therefore curves the closing edge. Points
 * are emitted vertex-then-arc-interior, which keeps entry 0 as vertex 0 of the
 * compiled polygon and makes a hash dump readable next to the file.
 *
 * Two entries is legal when they are arcs: two semicircles between the same
 * pair of points is a circle, and it is three lines of JSON. The "at least 3
 * vertices" rule is enforced on the RESULT, which is where it actually matters.
 */
function readRing(entries: RawVertex[], where: string, levelTol: number): Ring {
  const n = entries.length;
  const xs = new Array<number>(n);
  const ys = new Array<number>(n);
  const bulges = new Array<number | null>(n);
  const tols = new Array<number>(n);
  let arcs = 0;

  for (let i = 0; i < n; i++) {
    const at = `${where}.points[${i}]`;
    const e = entries[i];
    if (Array.isArray(e)) {
      if (e.length < 2) bad(`${at}: expected [x, y]`);
      xs[i] = finite(e[0], `${at}[0]`);
      ys[i] = finite(e[1], `${at}[1]`);
      bulges[i] = null;
      tols[i] = levelTol;
      continue;
    }
    if (!e || typeof e !== 'object') {
      bad(`${at}: expected [x, y] or { "arcTo": [x, y], "bulge": metres }`);
    }
    const o = e as unknown as Record<string, unknown>;
    if (!Array.isArray(o.arcTo)) {
      // Deliberately NOT tolerated the way an unknown zone is. A points list is
      // the collision surface; skipping an entry here puts a hole in the floor.
      bad(`${at}: expected [x, y] or { "arcTo": [x, y], "bulge": metres }`);
    }
    const to = o.arcTo as unknown[];
    if (to.length < 2) bad(`${at}.arcTo: expected [x, y]`);
    xs[i] = finite(to[0], `${at}.arcTo[0]`);
    ys[i] = finite(to[1], `${at}.arcTo[1]`);
    if (o.bulge === undefined) {
      bad(`${at}.bulge: required — the signed metres the arc bulges off its chord (0 is a straight line)`);
    }
    bulges[i] = finite(o.bulge, `${at}.bulge`);
    arcs++;
    let tol = levelTol;
    if (o.sagTolerance !== undefined) {
      tol = finite(o.sagTolerance, `${at}.sagTolerance`);
      if (tol <= 0) bad(`${at}.sagTolerance: must be > 0, got ${tol}`);
    }
    tols[i] = tol;
  }

  const pts: RawPoint[] = [];
  const flat: number[] = [];
  let generated = 0;
  for (let i = 0; i < n; i++) {
    pts.push([xs[i], ys[i]]);
    const j = i + 1 === n ? 0 : i + 1;
    const bulge = bulges[j];
    if (bulge === null) continue;
    flat.length = 0;
    const status = tessellateArc(xs[i], ys[i], xs[j], ys[j], bulge, tols[j], flat);
    if (status !== 'ok') bad(`${where}.points[${j}]: ${arcFailure(status)}`);
    for (let k = 0; k < flat.length; k += 2) pts.push([flat[k], flat[k + 1]]);
    generated += flat.length / 2;
  }
  return { pts, arcs, generated };
}

function arcFailure(status: ArcStatus): string {
  switch (status) {
    case 'zero-chord':
      return 'arc between coincident points — every circle passes through them, so none is meant';
    case 'too-many-segments':
      return `arc needs more than ${MAX_ARC_SEGMENTS} segments at this sagTolerance; raise the tolerance or split the arc`;
    default:
      return 'arc tessellates to segments shorter than a zero-length edge';
  }
}

function compilePolygon(kind: 'cave' | 'ground', pts: [number, number][]): CompiledPolygon {
  const n = pts.length;
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const nx = new Float64Array(n);
  const ny = new Float64Array(n);
  const pnx = new Float64Array(n);
  const pny = new Float64Array(n);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < n; i++) {
    vx[i] = pts[i][0];
    vy[i] = pts[i][1];
    if (vx[i] < minX) minX = vx[i];
    if (vy[i] < minY) minY = vy[i];
    if (vx[i] > maxX) maxX = vx[i];
    if (vy[i] > maxY) maxY = vy[i];
  }

  // With counter-clockwise winding the polygon interior is to the LEFT of
  // edge direction d, so (-dy, dx) points inward and (dy, -dx) points outward.
  // We store the normal pointing OUT OF THE SOLID, which is outward for
  // `ground` (solid inside) and inward for `cave` (solid outside).
  const sign = kind === 'ground' ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const dx = vx[j] - vx[i];
    const dy = vy[j] - vy[i];
    const inv = 1 / Math.sqrt(dx * dx + dy * dy);
    nx[i] = sign * dy * inv;
    ny[i] = sign * -dx * inv;
  }

  for (let i = 0; i < n; i++) {
    const h = i === 0 ? n - 1 : i - 1;
    const sx = nx[h] + nx[i];
    const sy = ny[h] + ny[i];
    const m2 = sx * sx + sy * sy;
    if (m2 < EPS) {
      // A 180-degree spike: the two adjacent normals cancel. Fall back to the
      // outgoing edge normal rather than producing a NaN.
      pnx[i] = nx[i];
      pny[i] = ny[i];
    } else {
      const inv = 1 / Math.sqrt(m2);
      pnx[i] = sx * inv;
      pny[i] = sy * inv;
    }
  }

  return { kind, solidInside: kind === 'ground', vx, vy, nx, ny, pnx, pny, minX, minY, maxX, maxY };
}

/**
 * Crossing-number test against the ring, then interpreted through the kind.
 * Only used at LOAD time — the narrowphase never calls it, because it is O(n)
 * in the polygon and would defeat the broadphase.
 */
export function pointInSolid(p: CompiledPolygon, x: number, y: number): boolean {
  const n = p.vx.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = p.vy[i];
    const yj = p.vy[j];
    if (yi > y !== yj > y) {
      const t = (y - yi) / (yj - yi);
      if (x < p.vx[i] + t * (p.vx[j] - p.vx[i])) inside = !inside;
    }
  }
  return p.solidInside ? inside : !inside;
}

function computeSimHash(level: Level): string {
  const h = new Hasher();
  h.str('velo-sim-level-1');
  h.num(level.start.x);
  h.num(level.start.y);
  h.num(level.flower.x);
  h.num(level.flower.y);
  h.int(level.apples.length);
  for (const a of level.apples) {
    h.num(a.x);
    h.num(a.y);
  }
  h.int(level.polys.length);
  for (const p of level.polys) {
    h.str(p.kind);
    h.int(p.vx.length);
    for (let i = 0; i < p.vx.length; i++) {
      h.num(p.vx[i]);
      h.num(p.vy[i]);
    }
  }
  return h.digest();
}

function computeContentHash(raw: RawLevel): string {
  const h = new Hasher();
  h.str(stableStringify(raw));
  return h.digest();
}

/** Key-sorted JSON, so that re-ordering keys in a text editor is not a change. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v as object).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k])).join(',') + '}';
}
