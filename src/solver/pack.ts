// A SimState as a run of doubles in a pooled buffer.
//
// The search holds hundreds of thousands of states at once. `sim.snapshot()` is
// 0.2 us and allocates seven typed arrays plus an object every time, which is
// fine for a handful and is several hundred megabytes of GC pressure for a
// search. Packing into chunked Float64Arrays makes a node ~300 bytes of flat
// memory that the collector never walks.
//
// IT LIVES HERE AND NOT IN src/sim DELIBERATELY. The physics is frozen at
// SIM_REV 4 and the solver is not a reason to touch it. The cost of that
// decision is that this file knows the state's field list, which would rot
// silently the first time a field was added to SimState — so pack.test.ts
// enumerates `Object.keys` of a real state and fails if it sees a name this
// file does not handle, and round-trips a stepped state through the pool and
// compares `hashState`. A field added to SimState breaks the build here,
// loudly, which is the only version of this that is safe to keep outside the
// sim.
import type { SimState } from '@/sim/step.ts';

/**
 * Every field of SimState, grouped by how it is stored. The grouping is the
 * drift guard: pack.test.ts asserts that the union of these three lists is
 * exactly `Object.keys(createState(world))`, so a new field fails the test
 * rather than being silently dropped from every node in the search.
 */
export const SCALAR_FIELDS = [
  'tick', 'px', 'py', 'vx', 'vy', 'ox', 'oy', 'w',
  'ax', 'ay', 'aw', 'facing', 'prevMask', 'applesLeft', 'endTick', 'grounded',
] as const;
export const PAIR_FIELDS = ['wx', 'wy', 'wvx', 'wvy', 'wspin'] as const;
export const BOOL_FIELDS = ['dead', 'finished'] as const;
export const ARRAY_FIELDS = ['applesTaken'] as const;

/** Offsets of the scalars read without unpacking a whole state. */
export const OFF_TICK = 0;
export const OFF_PX = 1;
export const OFF_PY = 2;
export const OFF_VX = 3;
export const OFF_VY = 4;

export function stateFloats(apples: number): number {
  return SCALAR_FIELDS.length + PAIR_FIELDS.length * 2 + BOOL_FIELDS.length + apples;
}

export function packState(s: SimState, b: Float64Array, o: number): void {
  b[o] = s.tick; b[o + 1] = s.px; b[o + 2] = s.py; b[o + 3] = s.vx; b[o + 4] = s.vy;
  b[o + 5] = s.ox; b[o + 6] = s.oy; b[o + 7] = s.w;
  b[o + 8] = s.ax; b[o + 9] = s.ay; b[o + 10] = s.aw;
  b[o + 11] = s.facing; b[o + 12] = s.prevMask; b[o + 13] = s.applesLeft;
  b[o + 14] = s.endTick; b[o + 15] = s.grounded;
  b[o + 16] = s.wx[0]; b[o + 17] = s.wx[1];
  b[o + 18] = s.wy[0]; b[o + 19] = s.wy[1];
  b[o + 20] = s.wvx[0]; b[o + 21] = s.wvx[1];
  b[o + 22] = s.wvy[0]; b[o + 23] = s.wvy[1];
  b[o + 24] = s.wspin[0]; b[o + 25] = s.wspin[1];
  b[o + 26] = s.dead ? 1 : 0; b[o + 27] = s.finished ? 1 : 0;
  const n = s.applesTaken.length;
  for (let i = 0; i < n; i++) b[o + 28 + i] = s.applesTaken[i];
}

export function unpackState(b: Float64Array, o: number, s: SimState): void {
  s.tick = b[o]; s.px = b[o + 1]; s.py = b[o + 2]; s.vx = b[o + 3]; s.vy = b[o + 4];
  s.ox = b[o + 5]; s.oy = b[o + 6]; s.w = b[o + 7];
  s.ax = b[o + 8]; s.ay = b[o + 9]; s.aw = b[o + 10];
  s.facing = b[o + 11]; s.prevMask = b[o + 12]; s.applesLeft = b[o + 13];
  s.endTick = b[o + 14]; s.grounded = b[o + 15];
  s.wx[0] = b[o + 16]; s.wx[1] = b[o + 17];
  s.wy[0] = b[o + 18]; s.wy[1] = b[o + 19];
  s.wvx[0] = b[o + 20]; s.wvx[1] = b[o + 21];
  s.wvy[0] = b[o + 22]; s.wvy[1] = b[o + 23];
  s.wspin[0] = b[o + 24]; s.wspin[1] = b[o + 25];
  s.dead = b[o + 26] !== 0; s.finished = b[o + 27] !== 0;
  const n = s.applesTaken.length;
  for (let i = 0; i < n; i++) s.applesTaken[i] = b[o + 28 + i];
}

/**
 * A growable pool of packed states, chunked so that a long search never has to
 * find one contiguous hundred-megabyte allocation.
 */
export class StatePool {
  readonly stride: number;
  private readonly perChunk: number;
  private chunks: Float64Array[] = [];
  private n = 0;

  constructor(apples: number, statesPerChunk = 1 << 14) {
    this.stride = stateFloats(apples);
    this.perChunk = statesPerChunk;
  }

  get size(): number {
    return this.n;
  }

  /** Bytes currently held. Reported by the solver so cost is never a surprise. */
  get bytes(): number {
    return this.chunks.length * this.perChunk * this.stride * 8;
  }

  push(s: SimState): number {
    const id = this.n++;
    const c = (id / this.perChunk) | 0;
    while (this.chunks.length <= c) this.chunks.push(new Float64Array(this.perChunk * this.stride));
    packState(s, this.chunks[c], (id % this.perChunk) * this.stride);
    return id;
  }

  load(id: number, s: SimState): void {
    const c = (id / this.perChunk) | 0;
    unpackState(this.chunks[c], (id % this.perChunk) * this.stride, s);
  }

  /** One packed field by offset, without unpacking the whole state. */
  at(id: number, offset: number): number {
    const c = (id / this.perChunk) | 0;
    return this.chunks[c][(id % this.perChunk) * this.stride + offset];
  }
}
