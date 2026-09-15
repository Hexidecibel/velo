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
import { Hasher } from './hash.ts';
import { EPS } from './consts.ts';
import type { Vec2 } from './spec.ts';

export type PolyKind = 'cave' | 'ground' | 'decor';

export interface RawPolygon {
  kind: PolyKind;
  /** [x, y] pairs. Closing vertex implied; do not repeat the first point. */
  points: [number, number][];
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
  decor: RawPolygon[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /**
   * Covers ONLY the fields the sim reads — collidable polygons in order, start,
   * apples in order, flower. Leaderboards key on this, so retitling or
   * recolouring a level preserves its leaderboard while moving an apple by
   * 1e-12 does not. Hashing the raw file bytes is the easy mistake here.
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

  const start = vec(r.start, 'level.start');
  const flower = vec(r.flower, 'level.flower');
  const apples: Vec2[] = [];
  if (r.apples !== undefined) {
    if (!Array.isArray(r.apples)) bad('level.apples: expected an array');
    r.apples.forEach((a, i) => apples.push(vec(a, `level.apples[${i}]`)));
  }

  const polys: CompiledPolygon[] = [];
  const decor: RawPolygon[] = [];
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
    if (!Array.isArray(p.points) || p.points.length < 3) bad(`${where}.points: need at least 3 vertices`);

    const pts: [number, number][] = p.points.map((pt, vi) => {
      if (!Array.isArray(pt) || pt.length < 2) bad(`${where}.points[${vi}]: expected [x, y]`);
      return [finite(pt[0], `${where}.points[${vi}][0]`), finite(pt[1], `${where}.points[${vi}][1]`)];
    });

    for (let i = 0; i < pts.length; i++) {
      const j = i + 1 === pts.length ? 0 : i + 1;
      const dx = pts[j][0] - pts[i][0];
      const dy = pts[j][1] - pts[i][1];
      if (dx * dx + dy * dy < 1e-14) {
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
