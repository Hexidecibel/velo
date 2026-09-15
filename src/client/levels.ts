// The level list, discovered from the levels/ directory rather than declared.
//
// A hand-maintained array is stale the first time somebody adds a level, and
// the entire thesis of the level format is that adding a level is dropping a
// JSON file in a directory. So the list is a build-time glob: add a file, it
// appears; delete it, it goes. No registry to forget to update.
//
// `eager: true` inlines the JSON into the bundle. That is deliberate: there is
// no server yet, and even when there is, ten hand-authored levels are a few KB
// each and a fetch per level would buy a loading state for nothing. When the
// library is hundreds of levels this becomes a fetch and a manifest — a change
// confined to this file.
//
// A level that FAILS to load still appears, marked broken, and says why. The
// alternative is that a level someone is halfway through authoring silently
// vanishes from the menu, which is the most confusing possible feedback.
import { parseLevel } from '@/sim/level.ts';
import type { Level } from '@/sim/level.ts';

export interface LevelEntry {
  /** Stable id, from the filename: `test02-bowl.json` -> `test02-bowl`. */
  id: string;
  /** What the file calls itself. Never the filename — that is an implementation detail. */
  label: string;
  path: string;
  raw: unknown;
  /** Null when the file does not load; `error` then says why. */
  level: Level | null;
  error: string | null;
}

/**
 * Legacy query-parameter aliases. `?level=bowl` was the only way to reach the
 * second level before there was a selector, and somebody has that URL. Aliases
 * are cheap; a dead link in someone's notes is not.
 */
const ALIASES: Record<string, string> = {
  bowl: 'test02-bowl',
  test: 'test01',
};

const MODULES = import.meta.glob('../../levels/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

function idOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.endsWith('.json') ? base.slice(0, -5) : base;
}

export const LEVELS: LevelEntry[] = Object.keys(MODULES)
  .sort()
  .map((path) => {
    const raw = MODULES[path];
    const id = idOf(path);
    const named = (raw && typeof raw === 'object' ? (raw as { name?: unknown }).name : undefined);
    let level: Level | null = null;
    let error: string | null = null;
    try {
      level = parseLevel(raw);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    return {
      id,
      label: level?.name ?? (typeof named === 'string' ? named : id),
      path,
      raw,
      level,
      error,
    };
  });

/**
 * Resolve whatever a URL or a stored preference says into a real entry:
 * exact id, then legacy alias, then a case-insensitive name match, then a
 * unique prefix. Falls back to the first level that actually loads — never to
 * a broken one, because booting into a parse error is a dead end.
 */
export function resolveLevel(want: string | null | undefined): LevelEntry | null {
  const playable = LEVELS.filter((l) => l.level !== null);
  if (want) {
    const key = want.trim();
    const byId = LEVELS.find((l) => l.id === key);
    if (byId) return byId;
    const alias = ALIASES[key.toLowerCase()];
    if (alias) {
      const hit = LEVELS.find((l) => l.id === alias);
      if (hit) return hit;
    }
    const byName = LEVELS.find((l) => l.label.toLowerCase() === key.toLowerCase());
    if (byName) return byName;
    const byPrefix = LEVELS.filter((l) => l.id.toLowerCase().startsWith(key.toLowerCase()));
    if (byPrefix.length === 1) return byPrefix[0];
  }
  return playable[0] ?? LEVELS[0] ?? null;
}

/** Find the level a replay was recorded on, by the only identity that counts. */
export function findBySimHash(simHash: string): LevelEntry | null {
  return LEVELS.find((l) => l.level?.simHash === simHash) ?? null;
}

/**
 * Take on a level that arrived from outside the levels/ directory — today, the
 * one embedded in a replay file. Without this, a replay of a level this build
 * does not ship simply cannot be watched, which would defeat most of the point
 * of making the file self-contained.
 *
 * It appends to LEVELS so the selector can show it like any other. That is a
 * deliberate mutation of a module-level array: the alternative is a parallel
 * "levels, plus the ad-hoc ones" concept threaded through every caller, for a
 * case that is always a handful of entries in one session.
 */
export function adoptLevel(raw: unknown, fallbackName: string): LevelEntry {
  const level = parseLevel(raw);
  const existing = LEVELS.find((l) => l.level?.simHash === level.simHash);
  if (existing) return existing;
  const entry: LevelEntry = {
    id: `replay-${level.simHash.slice(0, 8)}`,
    label: `${level.name || fallbackName} (from a replay)`,
    path: '(replay)',
    raw,
    level,
    error: null,
  };
  LEVELS.push(entry);
  return entry;
}
