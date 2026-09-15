// Post a replay file to a running velo server.
//
// The reason this exists rather than being a curl line: the TAS category is a
// first-class category from the start, and `bin/level-drive --save` is the tool
// that produces TAS runs. Without a way to post them, the TAS board is an empty
// promise — and a category split that only becomes real later is exactly the
// retrofit the split was created to avoid.
//
// The default category is `tas`, DELIBERATELY. Anything submitted from a
// terminal was produced by a program, and declaring that is the whole point of
// having the category. `--category human` is available and prints a warning,
// because it is a claim about a run that this script cannot check — nothing
// can; a solver-generated input stream verifies exactly as well as a person's,
// which is why the split is declared rather than detected.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseReplayFile, ticksToSeconds } from '../src/sim/replay.ts';

interface Args {
  paths: string[];
  url: string;
  player: string;
  name: string;
  category: 'human' | 'tas';
}

function die(msg: string): never {
  console.error(`bin/submit: ${msg}`);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    paths: [],
    url: `http://127.0.0.1:${process.env.PORT || '9422'}`,
    // A stable, obviously-synthetic identity for machine-produced runs, so the
    // TAS board does not fill up with one-off ids nobody can attribute. Override
    // with --player when a person is posting their own file from a terminal.
    player: 'velobot0000',
    name: 'bin/level-drive',
    category: 'tas',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i] ?? die('--url needs a value');
    else if (a === '--player') out.player = argv[++i] ?? die('--player needs a value');
    else if (a === '--name') out.name = argv[++i] ?? die('--name needs a value');
    else if (a === '--category') {
      const c = argv[++i];
      if (c !== 'human' && c !== 'tas') die('--category must be human or tas');
      out.category = c;
    } else if (a.startsWith('-')) die(`unknown option ${a}`);
    else out.paths.push(a);
  }
  if (out.paths.length === 0) {
    die('usage: bin/submit <file.replay.json | dir> [...] [--category human|tas] [--player ID] [--name N] [--url U]');
  }
  if (!/^[0-9a-z]{8,32}$/.test(out.player)) die('--player must be 8-32 characters of [0-9a-z]');
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.category === 'human') {
  console.log('!!  posting to the HUMAN board from a terminal.');
  console.log('    Nothing here or on the server can check that claim — a solver-generated input stream');
  console.log('    verifies exactly as well as a person\'s, which is why the category is declared rather');
  console.log('    than detected. This is on you.');
  console.log('');
}

function expand(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) if (f.endsWith('.json')) out.push(join(p, f));
    } else {
      out.push(p);
    }
  }
  return out;
}

const files = expand(args.paths);
console.log(`==> ${files.length} file(s) -> ${args.url}/api/runs   as ${args.name} (${args.player}), category ${args.category}`);

let posted = 0;
let refused = 0;

for (const file of files) {
  let replay: unknown;
  try {
    // Parsed locally FIRST. A malformed file should waste a message from this
    // script, not a round trip and a server-side rejection that reads like the
    // server is broken.
    replay = parseReplayFile(JSON.parse(readFileSync(file, 'utf8')));
  } catch (e) {
    console.log(`    SKIP  ${file}: ${e instanceof Error ? e.message : String(e)}`);
    refused++;
    continue;
  }
  const r = replay as { finished: boolean; timeTicks: number };
  if (!r.finished) {
    console.log(`    SKIP  ${file}: not a finished run`);
    refused++;
    continue;
  }

  let res: Response;
  try {
    res = await fetch(`${args.url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: args.player, name: args.name, category: args.category, replay }),
    });
  } catch (e) {
    die(`cannot reach ${args.url} — is the server running? (bin/status) — ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; reason?: string; code?: string; placement?: { rank: number; total: number; pb: boolean }; verifyMs?: number; levelName?: string }
    | null;

  if (!res.ok || !body?.ok) {
    console.log(`    ${res.status}  ${file}`);
    console.log(`          ${body?.code ?? 'error'}: ${body?.reason ?? '(no reason given)'}`);
    refused++;
    continue;
  }
  console.log(
    `    OK    ${body.levelName} — ${ticksToSeconds(r.timeTicks).toFixed(3)}s — ` +
      `#${body.placement?.rank}/${body.placement?.total}${body.placement?.pb ? ' (PB)' : ''}, verified in ${body.verifyMs} ms`,
  );
  posted++;
}

console.log('');
console.log(`==> ${posted} posted, ${refused} refused`);
process.exit(refused > 0 && posted === 0 ? 1 : 0);
