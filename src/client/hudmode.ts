// What survives the debug HUD being switched off.
//
// The HUD is eleven lines of telemetry — speed, spin, contacts, zoom, fps,
// worst frame, recorded frames, the rev line. It was built for tuning and it is
// exactly right for tuning, and the user's own words are the reason this file
// exists: "starting to feel like the hud overlay should be toggleable too,
// almost ready to just play it straight up."
//
// THE LINE THIS FILE DRAWS. Two of those lines are not telemetry at all, they
// are WARNINGS, and hiding them would hide the thing they warn about:
//
//   * THE TUNED-SPEC NOTICE. A bike that is not the shipped one — your own
//     sliders, or a field held by `bin/spec` — still rides, still finishes, and
//     is then silently refused by the leaderboard. That exact confusion has
//     already cost this user an afternoon once, which is why the notice was put
//     on the HUD in the first place. Switching the telemetry off must not
//     switch it back off again.
//   * THE DROPPED-PATHS WARNING. `data/spec.json` naming a field this build
//     does not have means the tune you think you are riding is NOT the tune you
//     are riding. It stays up rather than being a toast precisely because it is
//     the answer to a question asked an hour later.
//
// So the HUD toggle hides the readout and keeps these, compactly: a badge of a
// line or two rather than a wall of text. A warning nobody can see is not a
// warning, and a warning too long to read in a glance is not one either.
//
// Pure, so the rule is assertable in plain node.

export interface HudWarnState {
  /** The local spec differs from the preset as shipped. */
  tuned: boolean;
  /** How many fields `bin/spec` is holding over your sliders. */
  heldFields: number;
  /** Fields data/spec.json named that this build does not have. */
  droppedPaths: readonly string[];
  /** Live tune could not read its file at all. */
  liveTuneError: string | null;
}

export type BadgeTone = 'warn' | 'bad';

export interface Badge {
  text: string;
  tone: BadgeTone;
}

/** Names, clipped so a badge stays a badge. */
function some(paths: readonly string[], n: number): string {
  return paths.length <= n ? paths.join(', ') : `${paths.slice(0, n).join(', ')} +${paths.length - n} more`;
}

/**
 * The warnings that must stay visible with the readout hidden.
 *
 * Empty is the normal case and the point: playing a shipped bike with no live
 * tune leaves NOTHING on screen but the game and the art HUD, which is what
 * "play it straight up" means.
 */
export function persistentBadges(s: HudWarnState): Badge[] {
  const out: Badge[] = [];
  if (s.tuned || s.heldFields > 0) {
    const what = s.tuned && s.heldFields > 0
      ? `tuned, ${s.heldFields} field(s) held by bin/spec`
      : s.tuned
        ? 'tuned'
        : `${s.heldFields} field(s) held by bin/spec`;
    // Says the CONSEQUENCE, not just the state: "tuned" alone is a fact about
    // the sliders, and the thing somebody needs to know is that their time will
    // not post.
    out.push({ text: `bike is not as shipped (${what}) — times will not post · H`, tone: 'warn' });
  }
  if (s.droppedPaths.length > 0) {
    out.push({
      text: `data/spec.json: ${some(s.droppedPaths, 2)} — no such field in this build, NOT applied`,
      tone: 'bad',
    });
  }
  if (s.liveTuneError) out.push({ text: s.liveTuneError, tone: 'bad' });
  return out;
}

/**
 * True when something is wrong that the player would otherwise have no way to
 * see. The HUD toggle is allowed to hide everything else.
 */
export function hasPersistentWarning(s: HudWarnState): boolean {
  return persistentBadges(s).length > 0;
}
