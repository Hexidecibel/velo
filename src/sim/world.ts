// Everything that is constant for the duration of a run: the compiled level,
// its broadphase grid, the bike spec, and the scratch buffers the tick reuses.
//
// Split out from the sim state on purpose. A solver branching a search wants to
// snapshot STATE thousands of times and never the world; keeping the two apart
// makes snapshot() a small fixed-size copy instead of a deep clone of the level.
import { buildGrid, queryCircle } from './broadphase.ts';
import type { Grid } from './broadphase.ts';
import { EPS } from './consts.ts';
import { circleEdge, makeContact } from './collide.ts';
import type { Contact } from './collide.ts';
import type { Level } from './level.ts';
import type { BikeSpec } from './spec.ts';
import { cloneSpec } from './spec.ts';

/**
 * Collider indices, and therefore the contact sort order. Wheels first because
 * they carry the run; chassis circles after; the head is tested separately and
 * never resolved, it only kills.
 */
export const COL_WHEEL0 = 0;
export const COL_WHEEL1 = 1;
export const COL_CHASSIS0 = 2;
export const COL_HEAD = 1000;

export interface World {
  level: Level;
  grid: Grid;
  spec: BikeSpec;

  // --- derived, so the tick never divides ---
  invChassisMass: number;
  invChassisInertia: number;
  invWheelMass: number;
  invWheelInertia: number;
  invArmInertia: number;

  // --- scratch, reused every tick; never part of a snapshot ---
  stamp: Int32Array;
  queryId: number;
  candPoly: Int32Array;
  candEdge: Int32Array;
  contacts: Contact[];
  contactCount: number;
}

export function createWorld(level: Level, spec: BikeSpec): World {
  const grid = buildGrid(level.polys);
  const own = cloneSpec(spec);
  // The rider's target directions are stored as pre-baked unit vectors — that
  // is how the sim avoids Math.cos — so a hand-edited spec can hand us a
  // non-unit one. Renormalise once here rather than every tick.
  own.rider.rest = unit(own.rider.rest);
  own.rider.leanL = unit(own.rider.leanL);
  own.rider.leanR = unit(own.rider.leanR);
  // The rider rides on the chassis, so its weight translates with the chassis.
  // The arm's own swing reaction on the chassis is applied as a torque by the
  // servo; the linear reaction is neglected, which is the one deliberate
  // simplification in the body model. See step.ts.
  const chassisMass = own.chassis.mass + own.rider.mass;
  const armInertia = own.rider.mass * own.rider.armLength * own.rider.armLength;

  const contacts: Contact[] = [];
  for (let i = 0; i < 128; i++) contacts.push(makeContact());

  return {
    level,
    grid,
    spec: own,
    invChassisMass: 1 / chassisMass,
    invChassisInertia: 1 / own.chassis.inertia,
    invWheelMass: 1 / own.wheel.mass,
    invWheelInertia: 1 / own.wheel.inertia,
    invArmInertia: 1 / armInertia,
    stamp: new Int32Array(grid.totalEdges),
    queryId: 0,
    // Sized to the total edge count so the broadphase capacity guard can never
    // truncate a candidate list.
    candPoly: new Int32Array(grid.totalEdges),
    candEdge: new Int32Array(grid.totalEdges),
    contacts,
    contactCount: 0,
  };
}

function unit(v: { x: number; y: number }): { x: number; y: number } {
  const m2 = v.x * v.x + v.y * v.y;
  if (m2 < EPS) return { x: 0, y: 1 };
  const inv = 1 / Math.sqrt(m2);
  return { x: v.x * inv, y: v.y * inv };
}

/** Effective translational mass of the chassis, including the rider. */
export function chassisMass(w: World): number {
  return w.spec.chassis.mass + w.spec.rider.mass;
}

function nextQueryId(w: World): number {
  w.queryId++;
  if (w.queryId > 0x7ffffff0) {
    // Stamps are int32. Rather than let the counter wrap into a value that
    // already sits in the array — which would silently drop a candidate — reset
    // both. Deterministic, because it depends only on how many queries have
    // been made, which is itself a deterministic function of the tick count.
    w.stamp.fill(0);
    w.queryId = 1;
  }
  return w.queryId;
}

function pushContact(w: World, src: Contact): void {
  if (w.contactCount >= w.contacts.length) {
    // Growing preserves ordering and never drops a contact. In practice a bike
    // touches fewer than a dozen edges at once; this exists so that a pathological
    // level degrades in performance rather than in correctness.
    for (let i = 0; i < 64; i++) w.contacts.push(makeContact());
  }
  const c = w.contacts[w.contactCount++];
  c.colliderIdx = src.colliderIdx;
  c.polyIdx = src.polyIdx;
  c.edgeIdx = src.edgeIdx;
  c.px = src.px;
  c.py = src.py;
  c.nx = src.nx;
  c.ny = src.ny;
  c.depth = src.depth;
}

const PROBE = makeContact();

/** Append every contact between this circle and the level to `w.contacts`. */
export function collectContacts(w: World, colliderIdx: number, cx: number, cy: number, r: number): void {
  const q = nextQueryId(w);
  const n = queryCircle(w.grid, cx, cy, r, q, w.stamp, w.candPoly, w.candEdge);
  for (let i = 0; i < n; i++) {
    const pi = w.candPoly[i];
    const poly = w.level.polys[pi];
    if (circleEdge(poly, pi, w.candEdge[i], cx, cy, r, colliderIdx, PROBE)) pushContact(w, PROBE);
  }
}

/** True if this circle touches solid at all. Used for the head, which only kills. */
export function circleTouchesSolid(w: World, cx: number, cy: number, r: number): boolean {
  const q = nextQueryId(w);
  const n = queryCircle(w.grid, cx, cy, r, q, w.stamp, w.candPoly, w.candEdge);
  for (let i = 0; i < n; i++) {
    const pi = w.candPoly[i];
    if (circleEdge(w.level.polys[pi], pi, w.candEdge[i], cx, cy, r, COL_HEAD, PROBE)) return true;
  }
  return false;
}
