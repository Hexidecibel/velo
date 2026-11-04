// Which levels are the GAME, and which are tooling that happens to be a level.
//
// `levels/` holds both. The numbered files are the set a player is offered;
// `test01` and `test02-bowl` are the two the sim was built against — a
// deliberately ugly collision fixture and the arc primitive's exercise — and
// they are still what the unit tests, `bin/smoke`, `bin/level-export` and
// `bin/level-drive` reach for. They stay on disk, in place, for that reason.
// What changed is that a published build no longer LISTS them:
//
//   * the client leaves them out of a production bundle (src/client/levels.ts),
//   * the server does not offer a board for them or take a time on them
//     (src/server/levels.ts),
//   * and both put them back when asked — `bin/dev` always, a build with
//     VITE_DEV_LEVELS=1, a server with VELO_DEV_LEVELS=1 — so nothing that
//     drives them had to be rewritten.
//
// NOTHING HERE TOUCHES IDENTITY. A level's `simHash` is computed from its own
// geometry by src/sim/level.ts and from nothing else; no hash anywhere is taken
// over the level LIST. Unlisting two files therefore cannot move another
// level's board, and the data already stored against these two is left exactly
// where it is — see `knownLevelBySimHash` in src/server/levels.ts.
//
// The rule is a filename prefix because the client's half of it has to be a
// literal glob (`import.meta.glob` takes no variables). src/client/levels.ts
// repeats the prefix as `test*.json`; levelset.test.ts holds the two together.

/** Filename prefix of a tooling-only level: `test01.json`, `test02-bowl.json`. */
export const DEV_LEVEL_PREFIX = 'test';

/** True for a level id (filename stem) that a published build does not list. */
export function isDevLevelId(id: string): boolean {
  return id.startsWith(DEV_LEVEL_PREFIX);
}
