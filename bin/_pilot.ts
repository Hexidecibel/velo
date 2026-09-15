// A scripted rider, good enough to answer "is this level completable at all".
//
// It is NOT the solver. The solver is a later milestone and the physics is still
// moving; this is the cheap thing that catches the failure that actually
// happened — a hand-authored level with apples nobody can reach — by DRIVING
// rather than by looking at coordinates.
//
// The policy is the technique a person uses without thinking about it: throttle
// while a wheel is down, let go in the air (drive torque is reacted on the
// chassis, so holding gas through airtime rotates you backwards), and lean so
// the chassis matches the surface just ahead. That last part is what converts
// momentum into climb on a slope instead of into a backflip.
//
// Speed caps per x-range are how a route gets expressed: an apple down a hole is
// reachable only if you arrive slowly enough to drop in rather than fly over,
// and "slow down here" is the whole of what a player decides at that moment.
import { createSim } from '../src/sim/sim.ts';
import type { Level } from '../src/sim/level.ts';
import type { BikeSpec } from '../src/sim/spec.ts';
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '../src/sim/consts.ts';

/** [fromX, toX, maxSpeed] — the route's "ease off here". */
export type Cap = [number, number, number];

export interface PilotOpts {
  /** How far ahead to read the surface, metres. The single most sensitive knob. */
  look?: number;
  vmax?: number;
  seconds?: number;
  caps?: Cap[];
}

export interface Run {
  outcome: 'finished' | 'dead' | 'timeout';
  frames: number;
  seconds: number;
  x: number;
  applesTaken: number[];
  applesLeft: number;
  masks: number[];
}

/**
 * Highest floor surface at `x` at or below `yRef`, taken from the FIRST
 * collidable polygon only — the cave. Including `ground` polygons would have the
 * pilot steer for the top of a boulder it is about to hit the side of.
 */
export function floorAt(level: Level, x: number, yRef: number): number {
  let best = -Infinity;
  const p = level.polys[0];
  if (!p) return best;
  const n = p.vx.length;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const a = p.vx[i];
    const b = p.vx[j];
    if ((x >= a && x <= b) || (x >= b && x <= a)) {
      const t = Math.abs(b - a) < 1e-9 ? 0 : (x - a) / (b - a);
      const y = p.vy[i] + t * (p.vy[j] - p.vy[i]);
      if (y <= yRef + 0.35 && y > best) best = y;
    }
  }
  return best;
}

export function drive(level: Level, spec: BikeSpec, opts: PilotOpts = {}): Run {
  const look = opts.look ?? 1.0;
  const vmax = opts.vmax ?? 99;
  const limit = Math.round((opts.seconds ?? 90) * 128);
  const sim = createSim(level, spec);
  const masks: number[] = [];

  for (let f = 0; f < limit; f++) {
    const s = sim.state;
    const dir = s.vx < 0 ? -1 : 1;
    const here = floorAt(level, s.px, s.py);
    const ahead = floorAt(level, s.px + look * dir, s.py);
    let target = 0;
    if (s.grounded && Number.isFinite(here) && Number.isFinite(ahead)) {
      // sin of the slope, clamped: the chassis attitude that matches the face.
      const slope = Math.atan2(ahead - here, look);
      target = Math.sin(Math.max(-0.9, Math.min(0.9, slope)));
    }
    let cap = vmax;
    for (const [x0, x1, v] of opts.caps ?? []) if (s.px >= x0 && s.px < x1 && v < cap) cap = v;
    const speed = Math.hypot(s.vx, s.vy);

    let m = s.grounded && speed < cap ? IN_THROTTLE : 0;
    if (s.grounded && speed > cap * 1.3) m |= IN_BRAKE;
    // Proportional on attitude plus a rate term. Without the rate term the
    // correction is always late by however long the bike has been rotating, and
    // 340 N m of attitude torque then overshoots into the opposite failure.
    const err = s.oy - target + s.w * 0.18;
    if (err > 0.05) m |= IN_LEAN_R;
    else if (err < -0.05) m |= IN_LEAN_L;

    masks.push(m);
    sim.advance(m);
    const t = sim.state;
    const common = { frames: f + 1, seconds: (f + 1) / 128, x: t.px, applesTaken: [...t.applesTaken], applesLeft: t.applesLeft, masks };
    if (t.dead) return { outcome: 'dead', ...common };
    if (t.finished) return { outcome: 'finished', ...common };
  }
  const t = sim.state;
  return { outcome: 'timeout', frames: limit, seconds: limit / 128, x: t.px, applesTaken: [...t.applesTaken], applesLeft: t.applesLeft, masks };
}

/**
 * Drive a level several ways and report the best result plus which apples were
 * ever collected across all of them. "Some run reached it" is a lower bound on
 * reachability, which is the useful direction: it can prove an apple IS
 * reachable and can only ever suggest that one is not.
 */
export function probeReachability(level: Level, spec: BikeSpec, caps: Cap[][] = [[]], seconds = 90) {
  const ever = new Array(level.apples.length).fill(0);
  let best: Run | null = null;
  for (const capSet of caps) {
    for (const look of [0.9, 1.0, 1.1, 1.3]) {
      const r = drive(level, spec, { look, caps: capSet, seconds });
      r.applesTaken.forEach((v, i) => { if (v) ever[i] = 1; });
      const rank = (x: Run): number => (x.outcome === 'finished' ? 1e6 : 0) + x.applesTaken.reduce((a: number, b: number) => a + b, 0) * 1000 + x.x;
      if (!best || rank(r) > rank(best)) best = r;
      if (r.outcome === 'finished') return { best: r, ever, finished: true };
    }
  }
  return { best: best as Run, ever, finished: false };
}

// --- the navigator ----------------------------------------------------------
//
// `drive` above only ever goes one way, which was fine when every level was a
// left-to-right obstacle course. It is not fine now: half this set doubles back
// over itself, and a rider that never presses Space reports a perfectly good
// level as INCOMPLETE. That is the worst possible failure for this tool — it
// trains you to ignore it.
//
// So: a greedy navigator. Head for the nearest apple you have not got, flip
// when it is behind you, lean to match the face in whichever direction you are
// actually travelling, and when a target stops getting closer, shelve it and go
// for another one. It is not a solver and it does not find fast lines; it finds
// out whether a route exists at all, which is the question bin/level-drive asks.

/** Highest ridable surface at x at or below yRef, across EVERY solid polygon. */
export function surfaceAt(level: Level, x: number, yRef: number): number {
  let best = -Infinity;
  for (const p of level.polys) {
    const n = p.vx.length;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const a = p.vx[i];
      const b = p.vx[j];
      if ((x >= a && x <= b) || (x >= b && x <= a)) {
        const t = Math.abs(b - a) < 1e-9 ? 0 : (x - a) / (b - a);
        const y = p.vy[i] + t * (p.vy[j] - p.vy[i]);
        if (y <= yRef + 0.35 && y > best) best = y;
      }
    }
  }
  return best;
}

export interface NavOpts {
  look?: number;
  /** Speed cap along the direction of travel. */
  cap?: number;
  seconds?: number;
  /** Frames a target may fail to get closer before it is shelved. */
  patience?: number;
}

export function navigate(level: Level, spec: BikeSpec, opts: NavOpts = {}): Run {
  const look = opts.look ?? 1.0;
  const cap = opts.cap ?? 99;
  const patience = opts.patience ?? 380; // ~3 s at 128 Hz
  const limit = Math.round((opts.seconds ?? 120) * 128);
  const sim = createSim(level, spec);
  const masks: number[] = [];

  const n = level.apples.length;
  const shelved = new Int32Array(n); // frame the target becomes eligible again
  let target = -1; // apple index, or -1 for the flower
  let bestDist = Infinity;
  let sinceImproved = 0;
  let flipHeld = false;

  for (let f = 0; f < limit; f++) {
    const s = sim.state;

    // --- choose a target ---
    const pick = (): number => {
      let best = -1;
      let bestScore = Infinity;
      for (let i = 0; i < n; i++) {
        if (s.applesTaken[i] !== 0 || shelved[i] > f) continue;
        const a = level.apples[i];
        // Horizontal distance dominates: the bike gets vertical separation for
        // free by falling, and cannot buy it at all by climbing.
        const score = Math.abs(a.x - s.px) + Math.abs(a.y - s.py) * 0.35;
        if (score < bestScore) { bestScore = score; best = i; }
      }
      return best;
    };
    if (target >= 0 && s.applesTaken[target] !== 0) { target = -1; bestDist = Infinity; sinceImproved = 0; }
    if (target < 0 || shelved[target] > f) {
      const next = s.applesLeft > 0 ? pick() : -1;
      if (next !== target) { target = next; bestDist = Infinity; sinceImproved = 0; }
    }
    if (s.applesLeft > 0 && target < 0) {
      // Everything is shelved. Let it all back in rather than standing still.
      shelved.fill(0);
      target = pick();
      bestDist = Infinity;
      sinceImproved = 0;
    }
    const tx = target >= 0 ? level.apples[target].x : level.flower.x;
    const ty = target >= 0 ? level.apples[target].y : level.flower.y;

    const d = Math.abs(tx - s.px) + Math.abs(ty - s.py) * 0.35;
    if (d < bestDist - 0.15) { bestDist = d; sinceImproved = 0; } else sinceImproved++;
    if (sinceImproved > patience && target >= 0) {
      shelved[target] = f + patience * 2;
      target = -1;
      bestDist = Infinity;
      sinceImproved = 0;
    }

    // --- steer ---
    // Within a bike length of the target's x, keep the current facing: flipping
    // back and forth on top of an apple is how a pilot spends a whole run
    // hunting and never touching it.
    const want: number = Math.abs(tx - s.px) < 0.9 ? s.facing : (tx > s.px ? 1 : -1);
    let m = 0;
    if (s.facing !== want && !flipHeld) { m |= IN_FLIP; flipHeld = true; } else flipHeld = false;

    const grounded = s.grounded !== 0;
    const here = surfaceAt(level, s.px, s.py);
    const ahead = surfaceAt(level, s.px + look * want, s.py);
    let attitude = 0;
    if (grounded && Number.isFinite(here) && Number.isFinite(ahead)) {
      // The chassis wants to lie along the surface. `oy` is signed against +x,
      // so the target mirrors with the direction of travel.
      const slope = Math.atan2(ahead - here, look);
      attitude = Math.sin(Math.max(-0.9, Math.min(0.9, slope))) * want;
    }
    const along = s.vx * want;
    if (grounded && along < cap) m |= IN_THROTTLE;
    if (grounded && along > cap * 1.15) m |= IN_BRAKE;

    const err = s.oy - attitude + s.w * 0.18;
    if (err > 0.05) m |= IN_LEAN_R;
    else if (err < -0.05) m |= IN_LEAN_L;

    masks.push(m);
    sim.advance(m);
    const t = sim.state;
    const common = { frames: f + 1, seconds: (f + 1) / 128, x: t.px, applesTaken: [...t.applesTaken], applesLeft: t.applesLeft, masks };
    if (t.dead) return { outcome: 'dead', ...common };
    if (t.finished) return { outcome: 'finished', ...common };
  }
  const t = sim.state;
  return { outcome: 'timeout', frames: limit, seconds: limit / 128, x: t.px, applesTaken: [...t.applesTaken], applesLeft: t.applesLeft, masks };
}

/**
 * Everything the tool knows how to try, in the order it tries it: the cheap
 * one-way rider first (most levels are still mostly one way, and it is fast),
 * then the navigator across a spread of look-aheads and speed caps.
 */
export function probeAll(level: Level, spec: BikeSpec, caps: Cap[][] = [[]], seconds = 90) {
  const ever = new Array(level.apples.length).fill(0);
  const runs: Run[] = [];
  const rank = (x: Run): number =>
    (x.outcome === 'finished' ? 1e9 - x.frames : 0) + x.applesTaken.reduce((a: number, b: number) => a + b, 0) * 1e4 + x.x;
  let finished = false;

  outer: {
    for (const capSet of caps) {
      for (const look of [0.9, 1.0, 1.1, 1.3]) {
        const r = drive(level, spec, { look, caps: capSet, seconds });
        runs.push(r);
        r.applesTaken.forEach((v, i) => { if (v) ever[i] = 1; });
        if (r.outcome === 'finished') { finished = true; break outer; }
      }
    }
    for (const cap of [99, 7, 5]) {
      for (const look of [0.9, 1.0, 1.2, 1.5]) {
        const r = navigate(level, spec, { look, cap, seconds: seconds * 2 });
        runs.push(r);
        r.applesTaken.forEach((v, i) => { if (v) ever[i] = 1; });
        if (r.outcome === 'finished') { finished = true; break outer; }
      }
    }
  }

  let best = runs[0];
  for (const r of runs) if (rank(r) > rank(best)) best = r;
  return { best, ever, finished };
}
