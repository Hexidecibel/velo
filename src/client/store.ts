// Per-viewer conveniences in localStorage. Never game state.
//
// The line this file draws matters: nothing in here is authoritative about
// anything. Times recorded here are LOCAL and unverified, the tuned spec is one
// person's sliders, and all of it is gone the moment someone opens a private
// window. Real times live on the server behind re-simulation, which is
// milestone 4. Nothing here is allowed to grow into that.
//
// Every access is wrapped: a private window, cleared site data and a browser
// configured to block storage all THROW on access rather than returning null,
// and an uncaught throw on the boot path would take the whole game with it.
import { SIM_REV } from '@/sim/rev.ts';

const PREFIX = 'velo.';

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Storage full, blocked, or unavailable. A lost convenience, not an error.
  }
}

function drop(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // as above
  }
}

function readJson<T>(key: string): T | null {
  const raw = read(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt or from an older shape. Drop it rather than failing forever.
    drop(key);
    return null;
  }
}

// --- the level last played ---------------------------------------------------

export function loadLastLevel(): string | null {
  return read('lastLevel');
}

export function saveLastLevel(id: string): void {
  write('lastLevel', id);
}

// --- the tuned spec ----------------------------------------------------------
//
// This one is not a nicety. The user tunes by hand through `bin/dev`, and every
// edit to a source file hot-reloads the page and would otherwise throw an hour
// of slider work away silently — which has already happened once. The spec is
// stored as the panel's exact doubles, keyed by the preset it was derived from
// so that switching preset does not resurrect a tune that belonged to another
// bike.

export interface StoredSpec {
  preset: string;
  /** The raw BikeSpec object, as JSON. Validated by parseSpec on the way back. */
  spec: unknown;
  /** Rev it was tuned under. A physics change can re-map what a number means. */
  rev: number;
}

export function loadStoredSpec(): StoredSpec | null {
  const s = readJson<StoredSpec>('spec');
  if (!s || typeof s.preset !== 'string' || !s.spec) return null;
  return s;
}

export function saveStoredSpec(preset: string, spec: unknown): void {
  write('spec', JSON.stringify({ preset, spec, rev: SIM_REV } satisfies StoredSpec));
}

export function clearStoredSpec(): void {
  drop('spec');
}

// --- local best times --------------------------------------------------------
//
// Keyed by the level's simHash AND the sim rev, because a time set under
// different physics is not a time on the same level. A rev bump therefore
// retires every local best automatically, which is exactly what the rev
// mechanism is for and what the HUD already warns about.

export type Bests = Record<string, number>;

function bestsKey(): string {
  return `bests.rev${SIM_REV}`;
}

export function loadBests(): Bests {
  const b = readJson<Bests>(bestsKey());
  if (!b || typeof b !== 'object') return {};
  const out: Bests = {};
  for (const [k, v] of Object.entries(b)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}

/** Returns true when this is a new personal best. */
export function recordBest(simHash: string, ticks: number): boolean {
  const b = loadBests();
  const prev = b[simHash];
  if (prev !== undefined && prev <= ticks) return false;
  b[simHash] = ticks;
  write(bestsKey(), JSON.stringify(b));
  return true;
}

// --- misc flags --------------------------------------------------------------

export function loadFlag(name: string, dflt: boolean): boolean {
  const v = read(`flag.${name}`);
  return v === null ? dflt : v === '1';
}

export function saveFlag(name: string, on: boolean): void {
  write(`flag.${name}`, on ? '1' : '0');
}

/**
 * A remembered NUMBER, validated on the way back.
 *
 * The zoom bias is the one of these: screens differ, people differ, and a
 * player who found their zoom should not have to find it again on every load.
 * It is clamped by the CALLER against the camera's own range rather than here,
 * because what is a legal zoom depends on the viewport — and a value stored on
 * a tablet must not be able to put a phone below the readability floor.
 */
export function loadNum(name: string, dflt: number): number {
  const v = read(`num.${name}`);
  if (v === null) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

export function saveNum(name: string, value: number): void {
  if (!Number.isFinite(value)) return;
  write(`num.${name}`, String(value));
}

/**
 * A remembered choice from a fixed set — the leaderboard category, which ghost
 * to race. Validated against `allowed` on the way back rather than trusted,
 * because a value stored by an older build (or by hand, in devtools) must not
 * be able to put the UI in a state it has no code for.
 */
export function loadChoice<T extends string>(name: string, allowed: readonly T[], dflt: T): T {
  const v = read(`choice.${name}`);
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
}

export function saveChoice(name: string, value: string): void {
  write(`choice.${name}`, value);
}
