// Shared headless-Chrome plumbing for bin/artbench and bin/shots.
//
// WHY THIS EXISTS, and it is not tidiness. Both scripts spawn Chrome with a
// throwaway profile under /tmp and kill it in a `finally`. That works when the
// script exits on its own. It does not work when the script is killed — and a
// long sweep gets killed routinely: interrupted, re-run with different
// arguments, or stopped because the code under test changed. `SIGKILL` cannot
// be trapped, so node dies and leaves Chrome running.
//
// A headless Chrome rasterising a canvas in software does not idle. It sits at
// most of a core. Three of them accumulated over an afternoon of re-runs here,
// and the result was not an obvious failure but a SILENTLY WRONG BENCHMARK: the
// same level measured 77% of the frame budget in the morning and 253% in the
// afternoon, and the difference was entirely this. A performance tool that
// quietly reports the load left over from its own previous runs is worse than
// no tool, because you believe it.
//
// So: sweep before spawning. Any Chrome holding one of our own profile
// directories is, by construction, an orphan — these scripts run one at a time.
import { spawn, execFileSync } from 'node:child_process';
import { rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Kill every Chrome left over from a previous run of these scripts, and remove
 * the profile directories they were holding.
 *
 * Matched on the profile path rather than on "chrome", so it can never touch a
 * browser the user has open.
 */
export function reapOrphans(prefixes = ['velo-bench-', 'velo-shots-']) {
  let killed = 0;
  for (const prefix of prefixes) {
    try {
      const out = execFileSync('pgrep', ['-f', `user-data-dir=${join(tmpdir(), prefix)}`], { encoding: 'utf8' });
      for (const pid of out.split('\n').map((x) => x.trim()).filter(Boolean)) {
        try { process.kill(Number(pid), 'SIGKILL'); killed++; } catch { /* already gone */ }
      }
    } catch { /* pgrep exits 1 when nothing matches, which is the normal case */ }
  }
  // Give the kernel a moment to reap before the directories go.
  if (killed) {
    try { execFileSync('sleep', ['1']); } catch { /* not important */ }
  }
  let dirs = 0;
  try {
    for (const name of readdirSync(tmpdir())) {
      if (!prefixes.some((p) => name.startsWith(p))) continue;
      rmSync(join(tmpdir(), name), { recursive: true, force: true });
      dirs++;
    }
  } catch { /* nothing to clean */ }
  if (killed || dirs) {
    console.log(`    reaped ${killed} orphaned chrome process(es) and ${dirs} stale profile(s) from a previous run`);
  }
}

/**
 * Spawn headless Chrome, and make a reasonable effort to take it with us.
 *
 * `detached: false` plus the signal handlers cover every exit this process can
 * observe. SIGKILL is still unobservable — which is exactly why `reapOrphans`
 * runs at startup rather than relying on this.
 */
export function spawnChrome(profile, cdpPort, w, h) {
  const child = spawn(process.env.CHROME || 'google-chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    `--window-size=${w},${h}`, '--hide-scrollbars',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const bye = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
  process.once('exit', bye);
  process.once('SIGINT', () => { bye(); process.exit(130); });
  process.once('SIGTERM', () => { bye(); process.exit(143); });
  process.once('SIGHUP', () => { bye(); process.exit(129); });
  return child;
}
