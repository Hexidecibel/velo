// Inspect, rebuild and prune the leaderboard store.
//
// The store is plain JSON on disk, so every one of these could be done with
// `jq` and `find`. That is exactly why they are scripts: an operational task
// that CAN be done with an ad-hoc pipeline is the one that quietly gets done
// three different ways, and the third way is the one that deletes a replay a
// board still points at.
//
//   bin/board                       every level, with entry counts
//   bin/board <level>               one board (id, name or simHash)
//   bin/board <level> --category tas --rev 2
//   bin/board player <playerId>     one player's personal bests
//   bin/board check                 integrity: entries whose replay is missing
//   bin/board rebuild [--verify]    boards and player files from the log
//   bin/board prune [--apply]       replay blobs nothing references
//
// `rebuild` is a real rebuild and not a comforting name, because every accepted
// submission is appended to `data/submissions.jsonl` and the boards are derived
// from it. `--verify` additionally re-simulates every replay on the way past,
// which is the one command that answers "is anything on this board not real".
import { readFileSync } from 'node:fs';
import { parseReplayFile, ticksToSeconds, verifyReplay } from '../src/sim/replay.ts';
import { SIM_REV } from '../src/sim/rev.ts';
import { CATEGORIES, emptyBoard, emptyPlayer, place, ranked, recordPb, revKey, sectionOf } from '../src/server/board.ts';
import type { BoardFile, Category, Entry, PlayerFile } from '../src/server/board.ts';
// The KNOWN set, not the offered one: this tool is about data already on disk,
// and runs kept for a level that is no longer listed (test01, test02-bowl) must
// still be nameable, checkable and re-simulable. See src/server/levels.ts.
import {
  allKnownLevels,
  allLevels,
  knownLevelBySimHash as levelBySimHash,
  levelBySimHash as listedLevelBySimHash,
  OFFICIAL_SPEC,
  OFFICIAL_SPEC_HASH,
} from '../src/server/levels.ts';
import {
  boardPath,
  dataRoot,
  deleteReplay,
  listBoards,
  listPlayers,
  listReplays,
  logFile,
  playerPath,
  putBoard,
  putPlayer,
  readBoard,
  readPlayer,
  readSubmissions,
  referencedReplayIds,
  replayExists,
  replayPath,
} from '../src/server/store.ts';

function die(msg: string): never {
  console.error(`bin/board: ${msg}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--apply' || a === '--verify' || a === '--dry-run') flags.set(a.replace(/^--/, ''), '1');
  else if (a.startsWith('--')) flags.set(a.slice(2), argv[++i] ?? '');
  else positional.push(a);
}

const fmt = (ticks: number): string => `${ticksToSeconds(ticks).toFixed(3)}s`;
const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));

function categoryArg(): Category {
  const c = flags.get('category') ?? 'human';
  if (!(CATEGORIES as readonly string[]).includes(c)) die(`--category must be one of ${CATEGORIES.join(', ')}`);
  return c as Category;
}

function revArg(): number {
  const r = flags.get('rev');
  if (r === undefined) return SIM_REV;
  const n = Number(r);
  if (!Number.isInteger(n)) die('--rev must be an integer');
  return n;
}

/** A level by filename stem, by name, or by simHash — whichever the user typed. */
function resolveLevelArg(want: string): { simHash: string; label: string } {
  const levels = allKnownLevels();
  const byHash = levels.find((l) => l.simHash === want);
  if (byHash) return { simHash: byHash.simHash, label: `${byHash.id} — ${byHash.name}` };
  const byId = levels.find((l) => l.id === want);
  if (byId) return { simHash: byId.simHash, label: `${byId.id} — ${byId.name}` };
  const byName = levels.find((l) => l.name.toLowerCase() === want.toLowerCase());
  if (byName) return { simHash: byName.simHash, label: `${byName.id} — ${byName.name}` };
  const byPrefix = levels.filter((l) => l.id.startsWith(want));
  if (byPrefix.length === 1) return { simHash: byPrefix[0].simHash, label: `${byPrefix[0].id} — ${byPrefix[0].name}` };
  // A board can outlive its level file — the level was renamed out of the
  // directory, say — and refusing to show it would be the wrong answer.
  if (/^[0-9a-f]{16}$/.test(want)) return { simHash: want, label: `${want} (no level file for this hash)` };
  die(`no level matches ${JSON.stringify(want)}. Try bin/board with no arguments for the list.`);
}

// --- commands ----------------------------------------------------------------

function cmdList(): void {
  console.log(`==> velo boards   ${dataRoot()}`);
  console.log(`    sim rev ${SIM_REV} is live; older revs are kept and shown separately.`);
  console.log('');
  console.log(`    ${pad('level', 22)} ${pad('simHash', 18)} ${pad('human', 7)} ${pad('tas', 7)} other revs`);
  for (const l of allLevels()) {
    const b = readBoard(l.simHash);
    const counts = CATEGORIES.map((c) => (b ? Object.keys(sectionOf(b, SIM_REV, c).best).length : 0));
    const others = b
      ? Object.keys(b.revs)
          .filter((k) => k !== revKey(SIM_REV))
          .map((k) => `${k}:${Object.values(b.revs[k]).reduce((n, sec) => n + Object.keys(sec.best).length, 0)}`)
          .join(' ')
      : '';
    console.log(
      `    ${pad(l.id, 22)} ${pad(l.simHash, 18)} ${pad(String(counts[0]), 7)} ${pad(String(counts[1]), 7)} ${others}`,
    );
  }
  // Kept, not offered. A level that is still in levels/ but no longer listed
  // to players keeps every time ever set on it; say so here, by name, so the
  // boards below are not mistaken for orphans and nobody prunes them.
  const unlisted = allKnownLevels().filter((l) => !listedLevelBySimHash(l.simHash) && readBoard(l.simHash));
  if (unlisted.length) {
    console.log('');
    console.log(`    ${unlisted.length} board(s) kept for levels that are no longer listed to players:`);
    for (const l of unlisted) console.log(`      ${l.id} (${l.simHash}) — bin/board ${l.id} shows it`);
  }
  const orphans = listBoards().filter((h) => !levelBySimHash(h));
  if (orphans.length) {
    console.log('');
    console.log(`    ${orphans.length} board(s) with no level file: ${orphans.join(' ')}`);
    console.log('    That is not corruption — a board outlives the level file, by design, because it');
    console.log('    keys on simHash. It means the level was renamed out of levels/ or its geometry moved.');
  }
}

function cmdShow(want: string): void {
  const { simHash, label } = resolveLevelArg(want);
  const category = categoryArg();
  const rev = revArg();
  const board = readBoard(simHash);
  console.log(`==> ${label}`);
  console.log(`    simHash ${simHash}   category ${category}   rev ${rev}${rev === SIM_REV ? ' (live)' : ' (ARCHIVED — different physics)'}`);
  if (!board) {
    console.log('    no board file yet');
    return;
  }
  const section = sectionOf(board, rev, category);
  const order = ranked(section);
  console.log(`    ${order.length} player(s), ${section.accepted} accepted submission(s)`);
  console.log('');
  console.log(`    ${pad('#', 4)} ${pad('name', 24)} ${pad('time', 11)} ${pad('replayId', 18)} ${pad('playerId', 28)} at`);
  order.forEach((e, i) => {
    const missing = replayExists(simHash, e.replayId) ? '' : '   !! replay blob MISSING';
    console.log(
      `    ${pad(String(i + 1), 4)} ${pad(e.name, 24)} ${pad(fmt(e.timeTicks), 11)} ${pad(e.replayId, 18)} ${pad(e.playerId, 28)} ${e.at}${missing}`,
    );
  });
  const others = Object.keys(board.revs).filter((k) => k !== revKey(rev));
  if (others.length) console.log(`\n    other revs on this level: ${others.join(', ')}`);
}

function cmdPlayer(id: string): void {
  const p = readPlayer(id);
  if (!p) die(`no player file for ${id}. bin/board player with no id lists them.`);
  console.log(`==> ${p.name}   ${p.playerId}`);
  console.log(`    claimedBy ${p.claimedBy ?? '(local identity only — no account system yet)'}`);
  console.log(`    updated   ${p.updatedAt}`);
  console.log('');
  for (const [simHash, byRev] of Object.entries(p.pbs)) {
    const lvl = levelBySimHash(simHash);
    for (const [rk, byCat] of Object.entries(byRev)) {
      for (const [cat, e] of Object.entries(byCat)) {
        console.log(`    ${pad(lvl?.id ?? simHash, 22)} ${pad(rk, 7)} ${pad(cat, 7)} ${fmt(e.timeTicks)}   ${e.replayId}`);
      }
    }
  }
}

function cmdPlayers(): void {
  const ids = listPlayers();
  console.log(`==> ${ids.length} player(s)`);
  for (const id of ids) {
    const p = readPlayer(id);
    const n = p ? Object.keys(p.pbs).length : 0;
    console.log(`    ${pad(id, 28)} ${pad(p?.name ?? '(unreadable)', 24)} ${n} level(s)`);
  }
  console.log('');
  console.log('    Names are self-asserted and are NOT authenticated: nothing upstream of this app');
  console.log('    tells it who is playing. Identity is the opaque playerId; the name is a label.');
}

function cmdCheck(): void {
  let problems = 0;
  console.log(`==> checking ${dataRoot()}`);

  for (const simHash of listBoards()) {
    const b = readBoard(simHash);
    if (!b) {
      console.log(`    !! ${boardPath(simHash)} does not parse as a board`);
      problems++;
      continue;
    }
    for (const [rk, byCat] of Object.entries(b.revs)) {
      for (const [cat, sec] of Object.entries(byCat)) {
        for (const e of Object.values(sec.best)) {
          if (!replayExists(simHash, e.replayId)) {
            console.log(`    !! ${simHash} ${rk}/${cat} ${e.name}: replay ${e.replayId} is missing`);
            problems++;
          }
        }
        // `top` is derived from `best` on every write; a disagreement means a
        // hand-edit or a half-written file, and it is silent from the UI
        // because reads are served from `top`.
        const want = ranked(sec).slice(0, sec.top.length).map((e) => e.replayId).join(',');
        if (want !== sec.top.map((e) => e.replayId).join(',')) {
          console.log(`    !! ${simHash} ${rk}/${cat}: the cached top slice disagrees with best — run bin/board rebuild`);
          problems++;
        }
      }
    }
  }

  for (const id of listPlayers()) {
    if (!readPlayer(id)) {
      console.log(`    !! ${playerPath(id)} does not parse as a player file`);
      problems++;
    }
  }

  const { records, skipped } = readSubmissions();
  console.log(`    log      ${records.length} record(s)${skipped ? `, ${skipped} unparseable line(s)` : ''}`);
  const blobs = listReplays();
  const bytes = blobs.reduce((n, r) => n + r.bytes, 0);
  console.log(`    replays  ${blobs.length} blob(s), ${(bytes / 1024).toFixed(1)} KB`);
  console.log(`    boards   ${listBoards().length}`);
  console.log(`    players  ${listPlayers().length}`);
  console.log(problems === 0 ? '    OK' : `    ${problems} problem(s)`);
  if (problems > 0) process.exit(1);
}

async function cmdRebuild(): Promise<void> {
  const verify = flags.has('verify');
  const { records, skipped } = readSubmissions();
  console.log(`==> rebuilding boards and player files from ${logFile()}`);
  console.log(`    ${records.length} record(s)${skipped ? `, ${skipped} skipped` : ''}${verify ? ', RE-SIMULATING each one' : ''}`);
  if (records.length === 0) {
    console.log('    nothing to do. The log is the source of truth, so an empty log rebuilds to empty boards;');
    console.log('    it does NOT delete the existing ones, in case the log was lost rather than empty.');
    return;
  }

  const boards = new Map<string, BoardFile>();
  const players = new Map<string, PlayerFile>();
  let rejected = 0;

  for (const rec of records) {
    const entry: Entry = rec.entry;

    if (verify) {
      const lvl = levelBySimHash(rec.simHash);
      if (!lvl) {
        console.log(`    !! ${entry.replayId}: no level for ${rec.simHash}, cannot re-simulate`);
        rejected++;
        continue;
      }
      const path = replayPath(rec.simHash, entry.replayId);
      let ok = false;
      let why = 'replay blob missing';
      try {
        const file = parseReplayFile(JSON.parse(readFileSync(path, 'utf8')));
        if (file.specHash !== OFFICIAL_SPEC_HASH) {
          why = `bike spec ${file.specHash} is not the shipped one`;
        } else {
          const v = verifyReplay(lvl.level, OFFICIAL_SPEC, file);
          ok = v.ok && v.finished && v.applesLeft === 0 && v.timeTicks === entry.timeTicks;
          if (!ok) why = v.reason ?? `time disagrees: board says ${entry.timeTicks}, sim says ${v.timeTicks}`;
        }
      } catch (e) {
        why = e instanceof Error ? e.message : String(e);
      }
      if (!ok) {
        console.log(`    !! ${entry.replayId} (${entry.name}, ${fmt(entry.timeTicks)}): ${why} — DROPPED`);
        rejected++;
        continue;
      }
    }

    const board = boards.get(rec.simHash) ?? emptyBoard(rec.simHash, rec.levelName, rec.at);
    const next = place(board, entry, rec.levelName);
    boards.set(rec.simHash, next.board);

    const player = players.get(entry.playerId) ?? emptyPlayer(entry.playerId, entry.name, rec.at);
    players.set(entry.playerId, recordPb(player, rec.simHash, next.placement.entry));
  }

  for (const board of boards.values()) await putBoard(board);
  for (const player of players.values()) await putPlayer(player);

  console.log(`    wrote ${boards.size} board(s) and ${players.size} player file(s)`);
  if (rejected) console.log(`    dropped ${rejected} record(s)`);
  console.log('    Note: rebuilding rewrites `accepted` counts from the log, so a pruned or truncated');
  console.log('    log produces lower counts. The TIMES are unaffected — those come from the records.');
}

function cmdPrune(): void {
  const apply = flags.has('apply');
  const keep = referencedReplayIds();
  const blobs = listReplays();
  const dead = blobs.filter((b) => !keep.has(b.id));
  const bytes = dead.reduce((n, b) => n + b.bytes, 0);

  console.log(`==> prune   ${blobs.length} blob(s), ${keep.size} referenced by a board or a player file`);
  console.log(`    ${dead.length} unreferenced, ${(bytes / 1024).toFixed(1)} KB`);
  console.log('');
  console.log("    An unreferenced blob is a verified run that never became anybody's personal best —");
  console.log('    it happened, it was real, and nothing points at it. Deleting one costs the ability to');
  console.log('    watch that particular attempt back; it costs no board entry and no time.');
  console.log('    It DOES mean `bin/board rebuild --verify` can no longer re-simulate that record.');
  if (!apply) {
    console.log('');
    console.log('    DRY RUN. Nothing was deleted. Pass --apply to actually remove them.');
    for (const b of dead.slice(0, 20)) console.log(`      ${b.simHash}/${b.id}  ${b.bytes} B`);
    if (dead.length > 20) console.log(`      ... and ${dead.length - 20} more`);
    return;
  }
  let n = 0;
  for (const b of dead) if (deleteReplay(b.simHash, b.id)) n++;
  console.log(`    deleted ${n} blob(s)`);
}

// --- dispatch ----------------------------------------------------------------

const cmd = positional[0];
// `list` is a synonym for no arguments at all. It is not a command this script
// ever documented, and it is the first thing everybody types, because every
// other subcommand here is a verb — so `bin/board list` used to answer
// `no level matches "list"`, which is a true statement and a useless one.
if (cmd === undefined || cmd === 'list' || cmd === 'levels') cmdList();
else if (cmd === 'check') cmdCheck();
else if (cmd === 'rebuild') await cmdRebuild();
else if (cmd === 'prune') cmdPrune();
else if (cmd === 'player') {
  if (positional[1]) cmdPlayer(positional[1]);
  else cmdPlayers();
} else cmdShow(cmd);
