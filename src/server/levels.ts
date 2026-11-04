// What the server will accept a time ON, and what bike it will accept a time
// FROM. Both are deliberately narrow, and the narrowness is the anti-cheat that
// re-simulation alone does not give you.
//
// RE-SIMULATION PROVES A TIME IS REAL. It does not prove the time is on a level
// worth having a board for, or on the bike everyone else is riding. Those are
// separate holes and they are closed here:
//
//   * A submission must name a level THIS BUILD SHIPS, by simHash. A replay
//     file can carry its own level — that is what makes it a self-contained bug
//     report — and trusting that here would let anyone mint a board for a
//     one-metre ramp with the flower on top, and fill the disk doing it. So the
//     embedded level is ignored for identity: the server looks the simHash up
//     in `levels/` and verifies against ITS copy.
//
//   * A submission must be on the SHIPPED BIKE. The tuning panel and `bin/spec`
//     can produce any bike at all, and a time set on one with twice the drive
//     torque is not a time on the same game. The verifier would happily confirm
//     it, because it IS a real run — of a different sport. So the spec is
//     pinned to the one the client boots on, by hash, and anything else is
//     refused with a message that says which.
//
// Both refusals are stated to the player rather than logged quietly. "Your time
// did not count because live tune was on" is actionable; a silently missing
// entry is a bug report.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseLevel } from '@/sim/level.ts';
import type { Level } from '@/sim/level.ts';
import { specHash } from '@/sim/spec.ts';
import type { BikeSpec } from '@/sim/spec.ts';
// presets.ts lives under src/client but is pure data with no DOM in it —
// `bin/_replay.ts` already imports it under node for the same reason. The
// alternative, a second copy of the shipped numbers under src/server, is how
// the server and the client come to disagree about what the bike is.
import { BOOT_PRESET } from '@/client/presets.ts';
import { isDevLevelId } from '@/shared/levelset.ts';
import { ROOT } from './store.ts';

/** The one bike a time may be set on. Recorded on every entry regardless. */
export const OFFICIAL_SPEC: BikeSpec = BOOT_PRESET.spec;
export const OFFICIAL_SPEC_HASH: string = specHash(OFFICIAL_SPEC);

export interface LevelRef {
  /** Filename stem, e.g. `04-switchback`. Presentation and `bin/board` only. */
  id: string;
  name: string;
  simHash: string;
  level: Level;
  appleCount: number;
}

export function levelsDir(): string {
  return process.env.VELO_LEVELS_DIR ?? join(ROOT, 'levels');
}

/**
 * Whether the tooling-only levels (`test01`, `test02-bowl` — see
 * src/shared/levelset.ts) are offered alongside the real ones.
 *
 * Off unless asked for. A published server lists the numbered set and nothing
 * else; `bin/smoke`, which drives `test01` end to end against a real server,
 * sets VELO_DEV_LEVELS=1 on the one it spawns. Read per call rather than once
 * at import so a test can flip it.
 */
export function devLevelsEnabled(): boolean {
  return process.env.VELO_DEV_LEVELS === '1';
}

interface Cache {
  dir: string;
  mtimeMs: number;
  /** Every file that parses, listed or not. */
  known: Map<string, LevelRef>;
  /** `known` without the tooling-only levels. */
  listed: Map<string, LevelRef>;
}

let cache: Cache | null = null;

/**
 * Levels are read from disk and cached against the directory's mtime, so
 * dropping a new level in while the server runs is picked up without a restart
 * — which matters because the whole thesis of the level format is that adding a
 * level is adding a file. A level that does not parse is skipped rather than
 * fatal: `bin/level-check` is what reports those, and one broken file must not
 * take the leaderboard down for the other nineteen.
 */
function load(): Cache {
  const dir = levelsDir();
  const mtimeMs = existsSync(dir) ? statSync(dir).mtimeMs : 0;
  if (cache && cache.dir === dir && cache.mtimeMs === mtimeMs) return cache;

  const known = new Map<string, LevelRef>();
  const listed = new Map<string, LevelRef>();
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      try {
        const raw: unknown = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        const level = parseLevel(raw);
        const ref: LevelRef = {
          id: f.slice(0, -5),
          name: level.name,
          simHash: level.simHash,
          level,
          appleCount: level.apples.length,
        };
        known.set(level.simHash, ref);
        if (!isDevLevelId(ref.id)) listed.set(level.simHash, ref);
      } catch {
        // bin/level-check's problem, not the leaderboard's.
      }
    }
  }
  cache = { dir, mtimeMs, known, listed };
  return cache;
}

/**
 * The levels this server OFFERS: what `/api/levels` lists and what
 * `POST /api/runs` will take a time on. The tooling-only levels are in here
 * only when `devLevelsEnabled()`.
 */
export function loadLevels(): Map<string, LevelRef> {
  const c = load();
  return devLevelsEnabled() ? c.known : c.listed;
}

export function levelBySimHash(simHash: string): LevelRef | null {
  return loadLevels().get(simHash) ?? null;
}

const byId = (a: LevelRef, b: LevelRef): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function allLevels(): LevelRef[] {
  return [...loadLevels().values()].sort(byId);
}

/**
 * Every level with a file in `levels/`, offered or not.
 *
 * FOR STORED DATA, NEVER FOR ADMISSION. Runs were recorded on `test01` and
 * `test02-bowl` while they were listed, and those boards, replay blobs and log
 * records are kept. `bin/board` uses this so that `check` and
 * `rebuild --verify` can still name and re-simulate them instead of reporting
 * kept data as orphaned or dropping it from a rebuild. Nothing that decides
 * whether a NEW time is accepted may call it — that is `levelBySimHash`.
 */
export function knownLevelBySimHash(simHash: string): LevelRef | null {
  return load().known.get(simHash) ?? null;
}

export function allKnownLevels(): LevelRef[] {
  return [...load().known.values()].sort(byId);
}
