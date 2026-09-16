// A binary min-heap over (priority, int payload), on typed arrays.
//
// Shared by the grid Dijkstra in field.ts and the best-first search in
// search.ts. Both push millions of entries, so this stays allocation-free after
// its growth doublings and never boxes a number.
export class Heap {
  private k: Float64Array;
  private v: Int32Array;
  private n = 0;

  constructor(cap = 1 << 12) {
    this.k = new Float64Array(cap);
    this.v = new Int32Array(cap);
  }

  get size(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  /** Priority of the minimum, or Infinity when empty. */
  peekKey(): number {
    return this.n > 0 ? this.k[0] : Infinity;
  }

  push(key: number, val: number): void {
    if (this.n === this.k.length) {
      const nk = new Float64Array(this.n * 2);
      nk.set(this.k);
      this.k = nk;
      const nv = new Int32Array(this.n * 2);
      nv.set(this.v);
      this.v = nv;
    }
    let i = this.n++;
    this.k[i] = key;
    this.v[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= this.k[i]) break;
      this.swap(p, i);
      i = p;
    }
  }

  /** Payload of the minimum. Caller must check `size` first. */
  pop(): number {
    const top = this.v[0];
    this.n--;
    if (this.n > 0) {
      this.k[0] = this.k[this.n];
      this.v[0] = this.v[this.n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.n && this.k[l] < this.k[m]) m = l;
        if (r < this.n && this.k[r] < this.k[m]) m = r;
        if (m === i) break;
        this.swap(m, i);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const tk = this.k[a];
    this.k[a] = this.k[b];
    this.k[b] = tk;
    const tv = this.v[a];
    this.v[a] = this.v[b];
    this.v[b] = tv;
  }
}
