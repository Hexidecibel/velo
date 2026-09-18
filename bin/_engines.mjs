// The cross-engine determinism check. See bin/engines for why it exists and
// what it is not (bin/smoke's "cross-engine check" compares two copies of V8).
//
// SHAPE OF THE RUN. The sim's own fixture — src/sim/crosscheck.ts, the same one
// bin/smoke uses — is bundled with esbuild into one standalone IIFE that
// assigns `globalThis.veloEngines`. That bundle is then handed unchanged to
// every engine: Node imports it, the browsers get it as a <script> on
// about:blank. One artefact, no per-engine build, so a difference in the output
// cannot be a difference in what was compiled.
//
// The chains are compared against NODE, because Node is the engine the server
// verifies in. A browser that disagrees with Node is a player whose runs get
// refused; that asymmetry is real, so the report names it rather than picking
// an arbitrary baseline.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// --- arguments ---------------------------------------------------------------

const args = process.argv.slice(2);
const opts = { frames: 2000, every: 1, level: null, strict: false, list: false, keep: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--frames') opts.frames = Number(args[++i]);
  else if (a === '--every') opts.every = Number(args[++i]);
  else if (a === '--level') opts.level = args[++i];
  else if (a === '--strict') opts.strict = true;
  else if (a === '--list') opts.list = true;
  else if (a === '--keep') opts.keep = true;
  else if (a === '-h' || a === '--help') {
    process.stdout.write(
      readFileSync(join(ROOT, 'bin/engines'), 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('#') && !l.startsWith('#!'))
        .map((l) => l.replace(/^# ?/, ''))
        .join('\n') + '\n',
    );
    process.exit(0);
  } else {
    console.error(`bin/engines: unknown argument ${a}`);
    process.exit(2);
  }
}
if (!Number.isInteger(opts.frames) || opts.frames < 1) {
  console.error('bin/engines: --frames needs a positive integer');
  process.exit(2);
}
if (!Number.isInteger(opts.every) || opts.every < 1) {
  console.error('bin/engines: --every needs a positive integer');
  process.exit(2);
}

// --- finding playwright ------------------------------------------------------
//
// velo's own dependency list is Hono and nothing else, and a 300 MB browser
// toolkit is not a thing to add to it for a check that runs by hand. So this
// LOOKS for a playwright-core, in the order of least surprise, and prints which
// one it found — a borrowed dependency that does not say it is borrowed is how
// a script works on one machine and mystifies on the next.

function playwrightCandidates() {
  const out = [];
  if (process.env.VELO_PLAYWRIGHT) out.push(process.env.VELO_PLAYWRIGHT);
  out.push(join(ROOT, 'node_modules/playwright-core'));
  // Sibling checkouts. Several projects on this box already carry one; reading
  // a peer's node_modules is unusual enough to be worth the explicit list.
  const src = join(homedir(), 'local/src');
  if (existsSync(src)) {
    try {
      for (const name of readdirSync(src)) out.push(join(src, name, 'node_modules/playwright-core'));
    } catch { /* no peers is a normal state */ }
  }
  return out;
}

// playwright-core is CommonJS, so it needs a require rather than an import.
const require_ = createRequire(import.meta.url);

function findPlaywright() {
  const seen = new Set();
  let best = null;
  for (const dir of playwrightCandidates()) {
    const pkg = join(dir, 'package.json');
    if (seen.has(pkg) || !existsSync(pkg)) continue;
    seen.add(pkg);
    let version = '0.0.0';
    try {
      version = JSON.parse(readFileSync(pkg, 'utf8')).version ?? '0.0.0';
    } catch { continue; }
    // An explicit VELO_PLAYWRIGHT wins outright; otherwise the newest found.
    const forced = process.env.VELO_PLAYWRIGHT && resolve(dir) === resolve(process.env.VELO_PLAYWRIGHT);
    if (forced) return { dir, version };
    if (!best || cmpVersion(version, best.version) > 0) best = { dir, version };
  }
  return best;
}

function cmpVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function findSystemChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const c of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      return execFileSync('which', [c], { encoding: 'utf8' }).trim();
    } catch { /* not this one */ }
  }
  return null;
}

// --- the bundle --------------------------------------------------------------
//
// Generated rather than committed, so the entry point cannot drift from the
// driver that reads its output. The `@` alias is passed to esbuild explicitly:
// it is a tsconfig path, and esbuild does not read tsconfig paths for a file
// outside the project's own directory.

function buildBundle(workDir) {
  const esbuild = join(ROOT, 'node_modules/.bin/esbuild');
  if (!existsSync(esbuild)) {
    throw new Error(
      `no esbuild at ${esbuild} — run bin/build once (it arrives as a vite dependency), or npm install`,
    );
  }

  let levelSource = "parseLevel(TEST_LEVEL)";
  if (opts.level) {
    const path = join(ROOT, 'levels', `${opts.level}.json`);
    if (!existsSync(path)) throw new Error(`no such level: levels/${opts.level}.json`);
    // Inlined as a literal rather than imported, so the bundle stays one file
    // with no loader configuration and no filesystem at run time — a browser
    // has neither.
    levelSource = `parseLevel(${JSON.stringify(JSON.parse(readFileSync(path, 'utf8')))})`;
  }

  const entry = join(workDir, 'entry.ts');
  writeFileSync(
    entry,
    [
      "import { parseLevel } from '@/sim/level.ts';",
      "import { TEST_LEVEL } from '@/sim/testlevel.ts';",
      "import { crossCheck } from '@/sim/crosscheck.ts';",
      "import { cloneSpec } from '@/sim/spec.ts';",
      "import { PRESETS } from '@/client/presets.ts';",
      '// PRESETS[0] is the shipped bike, cloned so the fixture cannot mutate it.',
      '// The same spec bin/smoke uses, so the two checks are comparable.',
      '(globalThis as unknown as Record<string, unknown>).veloEngines = {',
      '  run(frames: number, every: number) {',
      `    return crossCheck(${levelSource}, cloneSpec(PRESETS[0].spec), frames, every);`,
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  const out = join(workDir, 'bundle.js');
  execFileSync(
    esbuild,
    [
      entry,
      '--bundle',
      '--format=iife',
      // es2020 rather than esnext: the point is to run in whatever engine the
      // box has, and a downlevelled bundle removes "that engine lacks the
      // syntax" as an explanation for a failure to run.
      '--target=es2020',
      `--alias:@=${join(ROOT, 'src')}`,
      `--outfile=${out}`,
      '--log-level=warning',
    ],
    { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  return out;
}

// --- running one engine ------------------------------------------------------

async function runNode(bundle) {
  // Imported into THIS process. The bundle is an IIFE with no imports and no
  // exports, which is valid ESM, so `import()` runs it and the global it sets
  // is readable here.
  await import(pathToFileURL(bundle).href);
  const run = globalThis.veloEngines;
  if (!run) throw new Error('the bundle did not define globalThis.veloEngines');
  return {
    version: `Node ${process.version} (V8 ${process.versions.v8})`,
    result: run.run(opts.frames, opts.every),
  };
}

async function runBrowser(pw, type, launchOpts, src) {
  const browser = await pw[type].launch({ timeout: 120_000, ...launchOpts });
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    await page.addScriptTag({ content: src });
    const [ua, json] = await page.evaluate(
      ([frames, every]) => [navigator.userAgent, JSON.stringify(globalThis.veloEngines.run(frames, every))],
      [opts.frames, opts.every],
    );
    return { version: `${browser.version()} — ${ua}`, result: JSON.parse(json) };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

// --- the comparison ----------------------------------------------------------
//
// Full chains, not just the final digest. A final-only comparison tells you
// THAT two engines disagree; the frame index tells you WHERE, which is the
// difference between a bug report and a shrug.

function compare(base, other) {
  if (base.hashes.length !== other.hashes.length) {
    return { same: false, where: `chain lengths differ (${base.hashes.length} vs ${other.hashes.length})` };
  }
  for (let i = 0; i < base.hashes.length; i++) {
    if (base.hashes[i] !== other.hashes[i]) {
      return {
        same: false,
        where:
          `first divergence at frame ${(i + 1) * base.hashEvery} ` +
          `(node ${base.hashes[i]}, this engine ${other.hashes[i]})`,
      };
    }
  }
  if (base.final !== other.final) {
    return { same: false, where: `chains match but final digests differ (${base.final} vs ${other.final})` };
  }
  for (const k of ['ticks', 'runs', 'dead', 'finished', 'applesLeft']) {
    if (base[k] !== other[k]) return { same: false, where: `${k}: node ${base[k]}, this engine ${other[k]}` };
  }
  return { same: true, where: null };
}

// --- main --------------------------------------------------------------------

const FAMILY = { node: 'V8', chrome: 'V8', firefox: 'SpiderMonkey', webkit: 'JavaScriptCore' };

async function main() {
  console.log('==> engines available');
  const pwFound = findPlaywright();
  const chromePath = findSystemChrome();

  let pw = null;
  if (pwFound) {
    console.log(`    playwright-core ${pwFound.version} from ${pwFound.dir}`);
    pw = require_(join(pwFound.dir, 'index.js'));
  } else {
    console.log('    playwright-core NOT FOUND — every browser engine will be reported untested');
    console.log('    fix: npm i -D playwright-core && npx playwright-core install webkit firefox');
  }

  // What each engine needs, and what to say when it does not have it. The
  // remedy is printed rather than implied: an untested engine with no way
  // offered to test it is how "untested" becomes permanent.
  const plan = [
    { id: 'node', kind: 'node', reason: null },
    {
      id: 'chrome',
      kind: 'browser',
      type: 'chromium',
      launch: chromePath ? { executablePath: chromePath } : {},
      reason: !pw
        ? 'needs playwright-core (see above)'
        : !chromePath && !browserInstalled(pw, 'chromium')
          ? 'no system Chrome on PATH and playwright has no chromium downloaded — ' +
            'install Chrome, set CHROME=/path/to/chrome, or npx playwright-core install chromium'
          : null,
    },
    {
      id: 'firefox',
      kind: 'browser',
      type: 'firefox',
      launch: {},
      reason: !pw
        ? 'needs playwright-core (see above)'
        : !browserInstalled(pw, 'firefox')
          ? 'playwright firefox not downloaded — npx playwright-core install firefox'
          : null,
    },
    {
      id: 'webkit',
      kind: 'browser',
      type: 'webkit',
      launch: {},
      reason: !pw
        ? 'needs playwright-core (see above)'
        : !browserInstalled(pw, 'webkit')
          ? 'playwright webkit not downloaded — npx playwright-core install webkit ' +
            '(on Ubuntu it also needs libevent-2.1-7t64 and libavif16)'
          : null,
    },
  ];

  for (const p of plan) {
    console.log(`    ${p.id.padEnd(8)} ${FAMILY[p.id].padEnd(15)} ${p.reason ? `UNTESTED — ${p.reason}` : 'available'}`);
  }
  if (opts.list) return 0;

  console.log('==> bundling the fixture');
  const workDir = mkdtempSync(join(tmpdir(), 'velo-engines-'));
  let code = 0;
  try {
    const bundle = buildBundle(workDir);
    const src = readFileSync(bundle, 'utf8');
    console.log(
      `    ${(src.length / 1024).toFixed(1)} KB, ${opts.frames} frames, a hash every ${opts.every} frame(s)` +
        (opts.level ? `, level ${opts.level}` : ', the TEST_LEVEL fixture'),
    );

    console.log('==> running');
    const runs = new Map();
    const untested = [];
    for (const p of plan) {
      if (p.reason) {
        untested.push(p);
        continue;
      }
      const t0 = Date.now();
      try {
        const r = p.kind === 'node' ? await runNode(bundle) : await runBrowser(pw, p.type, p.launch, src);
        runs.set(p.id, r);
        console.log(`    ${p.id.padEnd(8)} ${r.result.final}  ${r.result.hashes.length} hashes, ${Date.now() - t0} ms`);
        console.log(`             ${r.version}`);
      } catch (e) {
        // A launch failure is not a desync, and calling it one would be the
        // same overstatement in the other direction.
        p.reason = `launch failed: ${String(e).split('\n')[0]}`;
        untested.push(p);
        console.log(`    ${p.id.padEnd(8)} UNTESTED — ${p.reason}`);
      }
    }

    console.log('==> comparison (against node, the engine the server verifies in)');
    const base = runs.get('node');
    if (!base) {
      console.log('    node itself did not run — there is no baseline, so nothing was compared');
      return 1;
    }
    console.log(
      `    baseline: ${base.result.final} over ${base.result.frames} frames / ${base.result.ticks} ticks / ` +
        `${base.result.runs + 1} run(s)`,
    );
    let desync = false;
    for (const [id, r] of runs) {
      if (id === 'node') continue;
      const c = compare(base.result, r.result);
      if (c.same) console.log(`    ${id.padEnd(8)} identical chain`);
      else {
        desync = true;
        console.log(`    ${id.padEnd(8)} DESYNC — ${c.where}`);
      }
    }

    console.log('==> verdict');
    const coveredFamilies = new Set([...runs.keys()].map((id) => FAMILY[id]));
    const missingFamilies = new Set(
      untested.map((p) => FAMILY[p.id]).filter((f) => !coveredFamilies.has(f)),
    );

    if (desync) {
      console.log('    DESYNC. The leaderboard rests on the server reproducing a client hash chain exactly;');
      console.log('    an engine that disagrees is a player whose runs are REFUSED, not mis-scored.');
      code = 1;
    } else if (missingFamilies.size === 0) {
      console.log(
        `    VERIFIED across ${runs.size} engines / ${coveredFamilies.size} engine families ` +
          `(${[...coveredFamilies].join(', ')}).`,
      );
      console.log('    A replay recorded in any of them re-simulates bit-identically in the others.');
    } else {
      console.log(
        `    PARTIAL. ${runs.size} engines agreed (${[...coveredFamilies].join(', ')}), but these families ` +
          'were NOT tested:',
      );
      for (const p of untested) {
        if (missingFamilies.has(FAMILY[p.id])) console.log(`      ${FAMILY[p.id]} (${p.id}) — ${p.reason}`);
      }
      console.log('    This run is not evidence about them. Do not read it as one.');
      if (opts.strict) code = 1;
    }
    if (!desync && !coveredFamilies.has('JavaScriptCore')) {
      console.log('    NOTE: JavaScriptCore is untested, and every browser on iOS is JavaScriptCore.');
    }
  } finally {
    if (opts.keep) console.log(`    kept ${workDir}`);
    else rmSync(workDir, { recursive: true, force: true });
  }
  return code;
}

function browserInstalled(pw, type) {
  try {
    return existsSync(pw[type].executablePath());
  } catch {
    return false;
  }
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(`bin/engines: ${e instanceof Error ? e.stack : String(e)}`);
    process.exit(1);
  },
);
