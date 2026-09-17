// Live tune: follow `data/spec.json` while somebody at a terminal drives
// `bin/spec`.
//
// The problem it solves is a workflow one. Tuning by talking a player through a
// table of sliders to drag puts the person who can MEASURE the result furthest
// from the knob, and it is slow enough that most changes never get tried. This
// closes that loop: change the file, and the bike changes in the browser within
// a couple of seconds, saying what moved.
//
// Four rules, and all four are about not being a nuisance:
//
//   * NEVER throw into the game loop. A poll is a side channel; a dev server
//     that went away, a 404, a half-written file must all look like "no news".
//   * Back off on errors — 2 s, then doubling to 30 s — so a server that is
//     down does not turn into a request every two seconds forever, and comes
//     straight back to 2 s the moment one succeeds.
//   * Skip while the tab is hidden. Nobody is tuning a bike they cannot see.
//   * Never touch the sim. This changes WHICH spec is loaded and nothing about
//     how a tick is computed; determinism, the purity guard and the hash chain
//     are all exactly as they were, and a replay still verifies against the
//     spec hash embedded in it.
import { applySpecOverride } from '@/sim/spec.ts';
import type { BikeSpec } from '@/sim/spec.ts';

export const POLL_MS = 2000;
const MAX_BACKOFF_MS = 30000;

export interface SpecPayload {
  version: string;
  present: boolean;
  override: Record<string, unknown>;
  error: string | null;
}

export interface LiveTune {
  readonly enabled: boolean;
  /** The override in force, `{}` when there is none. */
  readonly override: Record<string, unknown>;
  /** Dotted paths the override actually sets — what the panel greys out. */
  readonly heldPaths: ReadonlySet<string>;
  /**
   * Dotted paths in the file that this build has no such field for.
   *
   * THIS IS THE DANGEROUS CASE AND IT USED TO BE SILENT. `applySpecOverride`
   * applies what it recognises and falls back to the local value for anything
   * it does not, so a RENAMED field does not error — it quietly stops being
   * overridden and the bike reverts to a default nobody chose. `bin/spec`
   * prints "IGNORED n unknown path(s)" at the terminal, which the person
   * PLAYING never sees.
   *
   * It has already cost a real session: a live override held
   * `rider.inertialTransfer`, that field became a brake/drive pair, the client
   * dropped it, fell back to 0.6 against `maxTorque` 126 — the worst pairing
   * available, lifting like the default with less power to recover — and it was
   * ridden for twenty minutes with nothing on screen to say why.
   *
   * A rename is exactly when this is most dangerous, because it is also exactly
   * when nothing looks broken.
   */
  readonly droppedPaths: readonly string[];
  /** Last thing that went wrong, for the HUD. Null when healthy. */
  readonly error: string | null;
  setEnabled(on: boolean): void;
  /** Poll now rather than waiting out the interval. */
  poke(): void;
  stop(): void;
}

export interface LiveTuneHooks {
  /**
   * A NEW override arrived. Called only on a version change, never on every
   * poll, so the caller can restart the run here without it happening twice a
   * second.
   */
  onChange(
    override: Record<string, unknown>,
    heldPaths: ReadonlySet<string>,
    droppedPaths: readonly string[],
  ): void;
  /** Transport or file trouble, already made readable. Null clears it. */
  onError(message: string | null): void;
}

/**
 * Which dotted paths an override sets, and which it names that do not exist.
 *
 * Both halves are returned because the second one is the half that bites. A
 * path the build does not have is not an error anywhere in the apply path — the
 * value is simply not used — so unless somebody carries it out to the UI, a
 * renamed field silently reverts the bike and says nothing.
 */
export function specPathsOf(
  base: BikeSpec,
  override: Record<string, unknown>,
): { held: Set<string>; dropped: string[] } {
  const r = applySpecOverride(base, override);
  return { held: new Set(r.applied), dropped: r.unknown };
}

export function createLiveTune(base: () => BikeSpec, hooks: LiveTuneHooks, enabled: boolean): LiveTune {
  let on = enabled;
  let timer = 0;
  let stopped = false;
  let backoff = POLL_MS;
  let version: string | null = null;
  let override: Record<string, unknown> = {};
  let held: ReadonlySet<string> = new Set<string>();
  let dropped: readonly string[] = [];
  let error: string | null = null;

  const fail = (msg: string): void => {
    if (error !== msg) {
      error = msg;
      hooks.onError(msg);
    }
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };

  const ok = (): void => {
    if (error !== null) {
      error = null;
      hooks.onError(null);
    }
    backoff = POLL_MS;
  };

  async function poll(): Promise<void> {
    if (!on || stopped) return;
    // Nobody is tuning a bike they cannot see, and a backgrounded tab's timers
    // are throttled anyway — polling from one just produces a burst on return.
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const res = await fetch('/api/spec', { cache: 'no-store' });
      if (!res.ok) {
        // A 404 is the ordinary case for a static host with no server behind
        // it, so it gets a message that says what to do rather than a status
        // code nobody can act on.
        fail(
          res.status === 404
            ? 'live tune: no /api/spec on this host — run bin/dev, or bin/start for a built server'
            : `live tune: /api/spec answered ${res.status}`,
        );
        return;
      }
      const payload = (await res.json()) as SpecPayload;
      if (!payload || typeof payload.version !== 'string') {
        fail('live tune: /api/spec sent something that is not a spec payload');
        return;
      }
      ok();
      if (payload.error) {
        // The file exists and is broken. Say so and keep the last good
        // override: a typo mid-edit must not yank the bike back to the preset.
        fail(`live tune: ${payload.error}`);
        return;
      }
      if (payload.version === version) return;
      version = payload.version;
      override = payload.override ?? {};
      const paths = specPathsOf(base(), override);
      held = paths.held;
      dropped = paths.dropped;
      hooks.onChange(override, held, dropped);
    } catch (e) {
      fail(`live tune: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function schedule(): void {
    if (stopped) return;
    timer = window.setTimeout(() => {
      void poll().finally(schedule);
    }, on ? backoff : POLL_MS);
  }
  schedule();
  void poll();

  return {
    get enabled() {
      return on;
    },
    get override() {
      return override;
    },
    get heldPaths() {
      return held;
    },
    get droppedPaths() {
      return dropped;
    },
    get error() {
      return error;
    },
    setEnabled(next: boolean): void {
      if (on === next) return;
      on = next;
      backoff = POLL_MS;
      if (!on) {
        // Turning it OFF drops the override entirely rather than freezing the
        // last one in place. "Off" has to mean "my bike again", or the toggle
        // is a trap: you switch it off to stop being interfered with and keep
        // riding somebody else's numbers.
        version = null;
        override = {};
        held = new Set<string>();
        dropped = [];
        if (error !== null) {
          error = null;
          hooks.onError(null);
        }
        hooks.onChange(override, held, dropped);
      } else {
        void poll();
      }
    },
    poke(): void {
      void poll();
    },
    stop(): void {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
