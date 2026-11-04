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

// TWO GLOBS, BECAUSE levels/ HOLDS TWO KINDS OF FILE. The numbered levels are
// the game. `test01` and `test02-bowl` are tooling — the fixtures the sim, the
// unit tests and `bin/smoke` were built against — and a published build does
// not list them. See src/shared/levelset.ts for the rule and for why none of
// this can move a hash.
//
// They are left out of the BUNDLE, not merely hidden: the second glob sits
// behind a condition Vite resolves at build time, so in a production build the
// branch is dead and the two files are never imported. `bin/dev` (and vitest)
// take the other branch and see everything, exactly as before; a build that
// wants them — `bin/smoke`'s — sets VITE_DEV_LEVELS=1.
//
// The patterns are literals because `import.meta.glob` accepts nothing else.
// `test*.json` here is `DEV_LEVEL_PREFIX` there, and levelset.test.ts fails if
// the two ever disagree about a file.
//
// MODE, not DEV. `import.meta.env.DEV` follows NODE_ENV, and this box exports
// NODE_ENV=production in every shell — under which `bin/dev` and vitest both
// report DEV as false. MODE is what was actually run: `development` for the dev
// server, `test` for vitest, `production` only for a build.
export const DEV_LEVELS_ON: boolean =
  import.meta.env.MODE !== 'production' || import.meta.env.VITE_DEV_LEVELS === '1';

const SHIPPED_MODULES = import.meta.glob(['../../levels/*.json', '!../../levels/test*.json'], {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

const DEV_MODULES = DEV_LEVELS_ON
  ? (import.meta.glob('../../levels/test*.json', { eager: true, import: 'default' }) as Record<string, unknown>)
  : {};

const MODULES: Record<string, unknown> = { ...SHIPPED_MODULES, ...DEV_MODULES };

function idOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.endsWith('.json') ? base.slice(0, -5) : base;
}

/** Ids the unconditional glob matched. Exported for levelset.test.ts only. */
export const SHIPPED_LEVEL_IDS: readonly string[] = Object.keys(SHIPPED_MODULES).map(idOf).sort();

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
 * Take on a level the EDITOR is producing, keyed by its own id.
 *
 * Different from `adoptLevel` in the one way that matters: a draft is edited
 * and ridden over and over, so the entry has to be UPDATED in place rather than
 * appended, or the level list grows a row per keystroke.
 *
 * It refuses to write over an entry that came from `levels/`. That is the same
 * fork rule the authoring endpoint enforces, applied to the in-memory list: a
 * draft that happened to share a filename with a shipped level would otherwise
 * replace it in the level bar for the rest of the session, which is a confusing
 * way to discover you have not forked. The draft gets its own id and says so.
 */
export function upsertLevel(raw: unknown, id: string, label?: string): LevelEntry {
  const level = parseLevel(raw);
  const clash = LEVELS.find((l) => l.id === id && l.path !== '(editor)');
  const useId = clash ? `${id}-unsaved` : id;
  const existing = LEVELS.find((l) => l.id === useId);
  if (existing) {
    existing.raw = raw;
    existing.level = level;
    existing.label = label ?? level.name;
    existing.error = null;
    return existing;
  }
  const entry: LevelEntry = {
    id: useId,
    label: label ?? level.name,
    path: '(editor)',
    raw,
    level,
    error: null,
  };
  LEVELS.push(entry);
  return entry;
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
