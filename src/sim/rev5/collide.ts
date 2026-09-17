// Circle versus polygon, as a signed distance field evaluated LOCALLY.
//
// The obvious implementation — closest point on the boundary, then a
// point-in-polygon test for the sign — is O(n) in the polygon per query, which
// throws away everything the broadphase bought. Instead the sign comes from the
// angle-weighted pseudo-normal of the closest FEATURE, which is exact and needs
// only that feature:
//
//   * closest point in the interior of edge e  -> sign = dot(p - cp, n[e])
//   * closest point at vertex v                -> sign = dot(p - cp, pn[v])
//
// A contact is emitted only when the closest point is within the circle's
// radius; see circleEdge for why a sign-only test is a trapdoor.
//
// Each vertex is owned by exactly ONE edge — the edge that starts there — so a
// circle sitting on a convex corner produces one contact, not two. Without that
// rule the corner gets double the impulse and the bike pings off it.
import { EPS } from './consts.ts';
import type { CompiledPolygon } from './level.ts';

export interface Contact {
  /** Which circle on the bike. See world.ts for the ordering. */
  colliderIdx: number;
  polyIdx: number;
  edgeIdx: number;
  /** Contact point on the surface. */
  px: number;
  py: number;
  /** Unit normal pointing OUT OF THE SOLID, i.e. the push-out direction. */
  nx: number;
  ny: number;
  /** Penetration depth, > 0. */
  depth: number;
}

export function makeContact(): Contact {
  return { colliderIdx: 0, polyIdx: 0, edgeIdx: 0, px: 0, py: 0, nx: 0, ny: 1, depth: 0 };
}

/**
 * Test one circle against one edge and fill `out` if they overlap.
 * Returns true when a contact was produced.
 */
export function circleEdge(
  poly: CompiledPolygon,
  polyIdx: number,
  e: number,
  cx: number,
  cy: number,
  r: number,
  colliderIdx: number,
  out: Contact,
): boolean {
  const n = poly.vx.length;
  const j = e + 1 === n ? 0 : e + 1;
  const ax = poly.vx[e];
  const ay = poly.vy[e];
  const bx = poly.vx[j];
  const by = poly.vy[j];
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey;

  let t = ((cx - ax) * ex + (cy - ay) * ey) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;

  // Vertex ownership: this edge owns its START vertex only. The next edge owns
  // the shared vertex as ITS t === 0 case. Both edges are always in the same
  // broadphase cells as the vertex they share, so nothing is lost by skipping.
  if (t >= 1) return false;

  const qx = ax + ex * t;
  const qy = ay + ey * t;
  const dx = cx - qx;
  const dy = cy - qy;
  const d2 = dx * dx + dy * dy;

  // Feature normal: the edge normal in the interior, the vertex pseudo-normal
  // at the start vertex.
  const fnx = t <= 0 ? poly.pnx[e] : poly.nx[e];
  const fny = t <= 0 ? poly.pny[e] : poly.ny[e];

  // The circle must actually REACH this feature. Testing only the sign of the
  // SDF is not enough and this is the subtle bug in the obvious version: a
  // circle sitting a metre ABOVE a box is on the solid side of the box's
  // BOTTOM face, so a sign-only test reports it as penetrating that face by a
  // metre and shoves it straight down through the box.
  //
  // Requiring dist < r also makes the narrowphase exactly agree with the
  // broadphase, which only ever returns edges within r of the centre. The two
  // then share one assumption — that no body is ever buried more than its own
  // radius inside solid, i.e. that nothing tunnels — and at 512 Hz with 0.25 m
  // wheels against 0.5 m features, nothing does.
  const dist = Math.sqrt(d2);
  if (dist >= r) return false;

  const side = dx * fnx + dy * fny;
  const sep = side >= 0 ? dist : -dist;

  out.colliderIdx = colliderIdx;
  out.polyIdx = polyIdx;
  out.edgeIdx = e;
  out.px = qx;
  out.py = qy;
  out.depth = r - sep;
  if (side > 0 && dist > EPS) {
    // Outside the solid: the radial direction is the physically right normal,
    // and for a vertex contact it is the ONLY right one.
    const inv = 1 / dist;
    out.nx = dx * inv;
    out.ny = dy * inv;
  } else {
    // Buried: the radial direction is degenerate or inverted, so push out along
    // the feature normal.
    out.nx = fnx;
    out.ny = fny;
  }
  return true;
}

/**
 * Total order on contacts: (colliderIdx, polyIdx, edgeIdx).
 *
 * This sort is a DETERMINISM REQUIREMENT, not an optimisation. A sequential
 * impulse solver is order-dependent, and the broadphase emits candidates in
 * cell order, which depends on where the bike happens to be standing. Two
 * machines agreeing on the physics and disagreeing on the iteration order still
 * desync.
 */
export function compareContacts(a: Contact, b: Contact): number {
  if (a.colliderIdx !== b.colliderIdx) return a.colliderIdx - b.colliderIdx;
  if (a.polyIdx !== b.polyIdx) return a.polyIdx - b.polyIdx;
  return a.edgeIdx - b.edgeIdx;
}
