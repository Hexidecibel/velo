// The live-tune override file: `data/spec.json`.
//
// One file, one job. It holds a PARTIAL BikeSpec — any subset of the fields —
// which is layered over whatever preset the client booted on. No file means no
// override, which is the state the game shipped in and stays the default.
//
// Why a file on disk rather than an endpoint that accepts writes: the thing
// being built is a way for somebody at a terminal to change the bike while
// somebody else rides it, and a file is already the right shape for that. It
// survives a server restart, it can be read and edited and diffed and put in a
// gist, `bin/spec` is a thin wrapper over it rather than an RPC client, and the
// HTTP surface stays strictly read-only — so nothing on the network can change
// the bike even if this ever ends up behind something less careful than the
// cush-auth gate.
//
// Shared by three callers that must agree exactly: `bin/spec` (writes),
// `src/server/index.ts` (serves), and the Vite dev middleware (serves, during
// `bin/dev`, which is where this will actually get used). One module, so they
// cannot drift.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Relative, not the '@' alias: vite.config.ts imports this module to serve the
// same endpoint during `bin/dev`, and the config file itself is evaluated
// before the alias it declares exists.
import { Hasher } from '../sim/hash.ts';

/** Derived, never hardcoded — the same rule every bin/ script follows. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SPEC_FILE = join(ROOT, 'data', 'spec.json');

export interface SpecFileState {
  /** False when there is no override file at all. */
  present: boolean;
  /** The partial BikeSpec-shaped override. `{}` when absent. */
  override: Record<string, unknown>;
  /**
   * Cheap change marker for the client's poll. A CONTENT hash rather than an
   * mtime: rewriting the same values — which `bin/spec set` does whenever a
   * value is set to what it already was — must not read as a change and
   * restart somebody's run for nothing.
   */
  version: string;
  /** Set when the file exists but could not be used. Served, never thrown. */
  error: string | null;
}

const EMPTY: Record<string, unknown> = {};

function versionOf(override: Record<string, unknown>): string {
  const h = new Hasher();
  h.str(JSON.stringify(override));
  return h.digest();
}

/**
 * Read the override. NEVER throws: this is called from a request handler and
 * from a poll loop, and a half-written or hand-mangled file must degrade to
 * "no override, and here is why" rather than taking down the endpoint that
 * every client is polling.
 */
export function readSpecFile(): SpecFileState {
  if (!existsSync(SPEC_FILE)) {
    return { present: false, override: EMPTY, version: versionOf(EMPTY), error: null };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(SPEC_FILE, 'utf8'));
  } catch (e) {
    const error = `data/spec.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
    return { present: true, override: EMPTY, version: versionOf(EMPTY), error };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      present: true,
      override: EMPTY,
      version: versionOf(EMPTY),
      error: 'data/spec.json must be a JSON object holding a partial BikeSpec',
    };
  }
  const override = raw as Record<string, unknown>;
  return { present: true, override, version: versionOf(override), error: null };
}

/** Replace the override wholesale. Writes pretty-printed, for hand-editing. */
export function writeSpecFile(override: Record<string, unknown>): SpecFileState {
  mkdirSync(dirname(SPEC_FILE), { recursive: true });
  writeFileSync(SPEC_FILE, JSON.stringify(override, null, 2) + '\n');
  return { present: true, override, version: versionOf(override), error: null };
}

/** Remove the override entirely — back to the preset the client booted on. */
export function clearSpecFile(): void {
  if (existsSync(SPEC_FILE)) rmSync(SPEC_FILE);
}

/** What `GET /api/spec` answers with, in both the server and the dev middleware. */
export function specPayload(): {
  version: string;
  present: boolean;
  override: Record<string, unknown>;
  error: string | null;
} {
  const s = readSpecFile();
  return { version: s.version, present: s.present, override: s.override, error: s.error };
}
