// Milestone 1: one bike, a handful of hand-written levels, a tuning panel, and
// record-and-replay with export/import. No server, no menus, no art.
import './style.css';
import { createSim } from '@/sim/sim.ts';
import type { Sim } from '@/sim/sim.ts';
import { cloneSpec, parseSpec, specHash } from '@/sim/spec.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import { copyState } from '@/sim/step.ts';
import type { SimState } from '@/sim/step.ts';
import { applySpecOverride, diffSpec } from '@/sim/spec.ts';
import { parseLevel } from '@/sim/level.ts';
import { checkReplayCompat, decodeInputs, replaySpec, ticksToSeconds } from '@/sim/replay.ts';
import type { Replay, ReplayFile } from '@/sim/replay.ts';
import { SIM_REV } from '@/sim/rev.ts';
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '@/sim/consts.ts';
import { createInput } from './input.ts';
import { createTouch, wantsTouch } from './touch.ts';
import { createLoop } from './loop.ts';
import { interpolate, render } from './render.ts';
import type { GhostDraw, Pose } from './render.ts';
import { createCamera, cloneCamera, DEFAULT_CAMERA } from './camera.ts';
import { cloneOverview, createOverview, DEFAULT_OVERVIEW, overviewFrame } from './overview.ts';
import { createArmed } from './armed.ts';
import { createSimHold } from './hold.ts';
import { createPanel } from './panel.ts';
import { BOOT_PRESET, PRESETS } from './presets.ts';
import { createAttemptLog, createRecorder, MIN_BANKED_FRAMES, verify } from './recorder.ts';
import { crossCheck } from '@/sim/crosscheck.ts';
import { LEVELS, adoptLevel, findBySimHash, resolveLevel, upsertLevel } from './levels.ts';
import type { LevelEntry } from './levels.ts';
import { createLegend, createLevelBar } from './chrome.ts';
import type { Legend } from './chrome.ts';
import { buildChooser, chooserSummary, CHOOSER_SORTS, flatten } from './chooser.ts';
import type { ChooserGroup, ChooserSort } from './chooser.ts';
import { createChooserUi } from './chooserui.ts';
import type { ChooserView } from './chooserui.ts';
import { buildBrowse, createBoardCache } from './browse.ts';
import type { BoardSlot, BrowseModel } from './browse.ts';
import { avatarImg } from './avatar.ts';
import { createThumbs } from './thumbs.ts';
import { persistentBadges } from './hudmode.ts';
import type { HudWarnState } from './hudmode.ts';
import { downloadReplay, onReplayDropped, pickReplay } from './replayio.ts';
import { clearStoredSpec, loadBests, loadChoice, loadFlag, loadLastLevel, loadNum, loadStoredSpec, recordBest, saveChoice, saveFlag, saveLastLevel, saveNum, saveStoredSpec } from './store.ts';
import { fetchBoard, fetchPlayer, fetchReplay, submitRun } from './api.ts';
import type { BoardEntry, BoardPayload, Category } from './api.ts';
import { chooseGhost, createGhost, createRider, ghostCompat, ghostNoteFor, GHOST_KINDS, GHOST_LABELS, watchableCategory } from './ghost.ts';
import type { Ghost, GhostKind, Rider, Standing } from './ghost.ts';
import { montageAlpha, montageLabel, MONTAGE_MIN, selectMontage, visibleRiders } from './montage.ts';
import {
  adoptPlayerId, hasName, loadIdentity, previousPlayerId, restorePreviousPlayerId,
  rotatePlayerId, setAppearance, setName,
} from './identity.ts';
import { createBoardUi } from './boardui.ts';
import { createResultsUi } from './resultsui.ts';
import { createLookUi } from './lookui.ts';
import type { LookMode } from './lookui.ts';
import { createClaimUi } from './claimui.ts';
import { CLAIM_PARAM, claimCode, parseClaim } from '@/shared/claim.ts';
import { actionForKey, buildResults } from './results.ts';
import type { ActionId, ResultsModel, SubmitState } from './results.ts';
import { parseReplayFile } from '@/sim/replay.ts';
import { createLiveTune } from './livetune.ts';
import { renderArt } from './artrender.ts';
import { makeLook } from './art/bikeart.ts';
import type { BikeLook } from './art/bikeart.ts';
import { appearanceFor, appearanceLabel, DEFAULT_APPEARANCE, labelFor, parseAppearance, resolveAppearance } from '@/shared/appearance.ts';
import type { Appearance, AppearanceKey } from '@/shared/appearance.ts';
import { bakeLevel, bakeSignature } from './art/bake.ts';
import type { BakedLevel } from './art/bake.ts';
import { cloneArt, DEFAULT_ART } from './art/params.ts';
import { createAudio } from './audio/index.ts';
import { cloneAudio, DEFAULT_AUDIO } from './audio/params.ts';
import { sampleRide } from './audio/sample.ts';
import { CONCRETE, levelPalette } from './art/palette.ts';
import { createEditor } from './editor/index.ts';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const panelRoot = document.getElementById('panel') as HTMLElement;
const levelbarRoot = document.getElementById('levelbar') as HTMLElement;
const toastRoot = document.getElementById('toast') as HTMLElement;
const legendRoot = document.getElementById('legend') as HTMLElement;
const boardRoot = document.getElementById('board') as HTMLElement;
const resultsRoot = document.getElementById('results') as HTMLElement;
const chooserRoot = document.getElementById('chooser') as HTMLElement;
const lookRoot = document.getElementById('look') as HTMLElement;
const claimRoot = document.getElementById('claim') as HTMLElement;
const touchRoot = document.getElementById('touch') as HTMLElement;
const editorRoot = document.getElementById('editor') as HTMLElement;
const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;

// --- which level ------------------------------------------------------------
//
// Order of authority: the URL, then what you played last, then the first level
// that loads. The URL wins so a link to a level is a link to that level, and it
// is kept in sync with `history.replaceState` so the address bar is always a
// shareable link to what is on screen.

const urlWanted = new URLSearchParams(location.search).get('level');
let entry: LevelEntry = resolveLevel(urlWanted ?? loadLastLevel()) ?? resolveLevel(null)!;
if (!entry?.level) {
  hud.textContent = `no loadable level found${entry?.error ? `: ${entry.error}` : ''}`;
  throw new Error('no loadable level');
}
let level = entry.level;

// --- the bike ---------------------------------------------------------------
//
// A tune restored from localStorage beats the preset, because the user tunes
// live through bin/dev and every source edit hot-reloads the page. Losing an
// hour of slider work to somebody else's commit has already happened once; it
// does not get to happen twice. The restore is validated through parseSpec and
// falls back silently to the preset, because a stale or corrupt stored spec
// must never be able to stop the game booting.

let presetId = BOOT_PRESET.id;
let presetLabel = BOOT_PRESET.label;

// THREE specs, and the distinction is the whole of how live tune and the panel
// coexist:
//
//   localSpec  what the PANEL writes and what localStorage remembers. Yours.
//   remote     the partial override from data/spec.json, driven by bin/spec.
//   spec       the EFFECTIVE bike: localSpec with remote layered on top,
//              per field. This is what the sim runs and what a replay records.
//
// Precedence is per FIELD, not whole-spec: `bin/spec set gravity 9.2` takes
// gravity and leaves every slider you touched alone, and `bin/spec unset
// gravity` hands gravity back to your value rather than to the preset's. That
// is the only precedence under which both halves stay usable at once, and the
// panel makes it visible by greying out exactly the rows that are held.
let localSpec: BikeSpec = cloneSpec(BOOT_PRESET.spec);
let remoteOverride: Record<string, unknown> = {};
let spec: BikeSpec = cloneSpec(localSpec);
let specIsTuned = false;

(function restoreSpec(): void {
  const stored = loadStoredSpec();
  if (!stored) return;
  const p = PRESETS.find((x) => x.id === stored.preset);
  if (!p) return;
  let parsed: BikeSpec;
  try {
    parsed = parseSpec(stored.spec);
  } catch {
    clearStoredSpec();
    return;
  }
  presetId = p.id;
  presetLabel = p.label;
  localSpec = parsed;
  spec = cloneSpec(parsed);
  specIsTuned = specHash(parsed) !== specHash(p.spec);
})();

let sim: Sim = createSim(level, spec);
let prevState: SimState = sim.snapshot();
const recorder = createRecorder();
const attempts = createAttemptLog();
let bests = loadBests();

// The last completed run, kept so T can replay it and E can export it. Cleared
// by anything that would make the input stream un-reproducible — a spec edit,
// most of all.
let lastReplay: Replay | null = null;
let replayNote = '';
let playback: { masks: number[]; at: number } | null = null;

/**
 * THE MONTAGE, while it is riding. Null the rest of the time, which is almost
 * always — it is a thing you press A for on the results screen and it ends the
 * moment you restart.
 *
 * The riders here are the FAILURES. The winning line is the player's own sim
 * running the ordinary playback path, which is what makes the camera follow it
 * and what makes it the only bike on screen at full strength.
 */
interface MontageRun {
  riders: Rider[];
  /** What each failure is drawn at. montage.ts owns the curve. */
  alpha: number;
  /** "37 attempts (31 dead, 5 given up on)" — the HUD line and the toast. */
  label: string;
}
let montage: MontageRun | null = null;

// --- leaderboard and ghosts -------------------------------------------------
//
// The identity is a device-local id plus a name you type. Nothing authenticates
// either — see identity.ts for why there is nothing to authenticate WITH, and
// what the migration path is. Re-simulation on the server means a TIME cannot
// be faked; whose time it is can be.
const identity = loadIdentity();
let boardCategory = loadChoice<Category>('boardCategory', ['human', 'tas'], 'human');

// --- what the bikes look like -----------------------------------------------
//
// COSMETICS, AND STRICTLY NOTHING ELSE. Nothing below is in `BikeSpec`, nothing
// below is in `specHash`, and nothing below can change a time or stop one
// counting. That separation is the whole design (see src/shared/appearance.ts)
// and it is why a colour picker is safe to ship next to a leaderboard that
// refuses a tuned bike.
//
// A LIVERY IS SOLVED AGAINST THE LEVEL IT IS RIDDEN ON, so every look is
// memoised per level and thrown away when the level or the appearance changes.
// Resolving one is a dozen bisections — nothing once, silly sixty times a
// second.
let paletteCache: { key: string; P: ReturnType<typeof levelPalette> } | null = null;
function levelP(): ReturnType<typeof levelPalette> {
  // Mirrors bakeLevel's own choice exactly, including `art.derive` being the
  // switch that turns per-level palettes off. Two answers to "what colour is
  // this level" would be two different bikes in the same frame.
  const key = `${level.simHash}|${artParams.derive > 0 ? 1 : 0}`;
  if (!paletteCache || paletteCache.key !== key) {
    paletteCache = { key, P: artParams.derive > 0 ? levelPalette(level.style, level.simHash) : CONCRETE };
  }
  return paletteCache.P;
}

/**
 * The control legend, built down in the wiring section.
 *
 * Declared up here and optional because `dropLooks` runs on the boot path,
 * BEFORE the wiring — a const down there would be in its temporal dead zone and
 * the first level load would throw on it. The legend draws the player's bike in
 * the level's palette, so it is one of the things a look change invalidates.
 */
let legend: Legend | null = null;

let myLookCache: BikeLook | null = null;
/** The player's own bike, on this level. */
function myLook(): BikeLook {
  if (!myLookCache) myLookCache = makeLook(identity.appearance, levelP(), identity.playerId);
  return myLookCache;
}
/** Called whenever the level or the chosen appearance moves under a cached look. */
function dropLooks(): void {
  paletteCache = null;
  myLookCache = null;
  ghostLook = null;
  lastReplayLook = null;
  legend?.refresh();
}

/**
 * THE GHOST'S OWN LIVERY. Theirs, never yours — the same argument as
 * `ghostFacing`, and the reason the feature is worth building rather than a
 * toybox: a ghost in your colours is a second copy of you, and a ghost in the
 * colours the person who set it chose is a person.
 */
let ghostLook: BikeLook | null = null;

/**
 * The livery the CURRENT PLAYBACK is in, when it is not yours.
 *
 * T replays your own run and shows your own bike. A file dragged in, or a board
 * row watched, shows the bike it was ridden on — resolved once, here, at the
 * moment the replay is adopted, so there is exactly one answer to "whose run is
 * this" and no two code paths can disagree about it.
 */
let lastReplayLook: BikeLook | null = null;
// `above` by default: racing the run one place ahead of you is the one that
// makes you ride harder, and it degrades to your own PB when nobody is ahead.
let ghostKind = loadChoice<GhostKind>('ghost', GHOST_KINDS, 'above');
let boardVisible = loadFlag('board', true);
/** The board on SCREEN — whichever category the player has selected. */
let board: BoardPayload | null = null;
/**
 * The HUMAN board, always fetched and never optional.
 *
 * Kept separately from `board` because the two answer different questions and
 * conflating them is exactly the bug this split fixes: the board on screen is
 * whatever category you asked to look at, and the ghost is ALWAYS human. Before
 * this, opening the TAS category quietly changed which line rode beside you.
 */
let humanBoard: BoardPayload | null = null;
/**
 * The TAS board. Its TIMES are shown; its LINES are gated on having finished the
 * level yourself. See the note above `chooseGhost` for why those are different
 * things.
 */
let tasBoard: BoardPayload | null = null;
let boardStatus = '';
let boardStatusKind: 'ok' | 'warn' | 'bad' | '' = '';
let ghostNote = '';
let ghost: Ghost | null = null;
/** Which replay the live ghost was built from, so a refetch is not repeated. */
let ghostReplayId = '';
/**
 * A finished run banked because it cannot be posted YET — no name chosen. It is
 * kept rather than dropped because the alternative is somebody's first clean
 * run disappearing while the game asks them who they are.
 */
let pendingSubmit: Replay | null = null;
/**
 * A spec the server has already refused. Live tuning makes every run
 * unpostable, and re-asking on every finish would be one wasted round trip per
 * death for as long as the panel is open.
 */
let refusedSpec = '';
/** Guards against a slow fetch for level A landing after you switched to B. */
let boardToken = 0;

/**
 * The end-of-level screen's state. Non-null exactly while the panel is up, and
 * it goes up on a FINISH and never on a death — dying is the common case, it
 * already has instant restart, and putting a panel in front of that would ruin
 * the loop this whole game is.
 */
interface ResultsState {
  replay: Replay;
  levelName: string;
  simHash: string;
  applesTotal: number;
  /**
   * The local best that stood BEFORE this run. Captured in `finishRun` ahead of
   * `recordBest`, which overwrites in place — read after it, every run compares
   * against itself and looks like a tie.
   */
  previousBestTicks: number | null;
  submit: SubmitState;
}
let results: ResultsState | null = null;
/**
 * The model the panel last drew.
 *
 * Kept so the key handler matches on exactly the actions that are PRINTED — an
 * action list computed twice is an action list that can disagree with itself,
 * and "C did nothing and there was no C on screen" is the shape that bug takes.
 */
let resultsModel: ResultsModel | null = null;

const cam = createCamera(cloneCamera(DEFAULT_CAMERA));
// THE ZOOM IS DERIVED FROM THE VIEWPORT, so the camera needs one before the
// first snap. Every frame after this sets it again from `resize()`, which is
// what handles a window drag and a rotated phone; this is only the boot case,
// and without it the first frame on a phone starts at the desktop's framing and
// visibly eases out — on the one screen the whole derivation exists for.
cam.setViewport(canvas.clientWidth, canvas.clientHeight);
cam.snap({ x: level.start.x, y: level.start.y, vx: 0, vy: 0 });
/**
 * EVERY REASON THE SIM MIGHT BE HELD, IN ONE REGISTER.
 *
 * `step()` asks this once, above every line that can move anything, and a true
 * answer returns before `sim.advance`, before `recorder.capture` and before
 * `ghost.advance` — so no tick runs, the clock does not move, the input stream
 * gains no frame and the ghost waits where it is. A run held for a minute banks
 * a byte-identical replay to one never held at all.
 *
 * It is a register rather than a second `||` because there are now two sources
 * and a third is queued, and separate answers to "is the sim running" are how
 * two of them end up disagreeing. See hold.ts, which carries the argument and
 * the proof; the sources themselves are wired at the bottom of this file, next
 * to the things they are about.
 */
const hold = createSimHold();

// Hold-to-overview, and the start-of-level peek. It owns the freeze: while
// `overview.frozen` is true, `step()` returns before touching the sim, so no
// tick advances, no input frame is recorded and the clock does not move.
const overview = createOverview(cloneOverview(DEFAULT_OVERVIEW));
overview.startIntro();
hold.add('overview', () => overview.frozen);
// THE ARMED START LINE. A restart and a level load set the run up and freeze it
// until the first sim input, so the clock, the recorder and the GHOST all leave
// the line together with the player instead of ahead of them. It is the same
// freeze mechanism the overview owns and deliberately not a second one: it is
// consulted in `step()` at the one place that can move the sim, one line below
// the overview's own gate. See armed.ts for why held-counts and why only sim
// input, and armed.test.ts for the replay-identity proof.
const armed = createArmed();
armed.arm();

/**
 * ONE WAY IN AND OUT OF THE WIDE VIEW, for TAB and for the pad both.
 *
 * TWO INPUTS, ONE STATE MACHINE, ONE FREEZE. The phone's overview pad is a
 * toggle and TAB is a hold, but both of them mean the same thing to
 * `overview.hold`, and neither of them may own a second copy of "is it up" —
 * a pad that disagreed with the frozen sim would be the worst kind of wrong,
 * and two freezes would be two ways for a replay to go missing a tick.
 *
 * `touch.setOverview` is told what happened rather than asked: it is the pad's
 * LABEL, and the label has to follow the state even when the state was moved by
 * a key the phone does not have.
 */
function holdOverview(on: boolean): void {
  overview.hold(on);
  touch.setOverview(on);
}
let debug = false;

/**
 * Is the bike moving right now? Drives `body.riding`, which fades the control
 * legend to a fifth.
 *
 * THIS IS THE ART DIRECTION'S OWN RULE APPLIED TO A DOM PANEL. "The player and
 * the collision edge are always the highest-contrast things on screen" is easy
 * to keep while the chrome is grey text, and the new legend is a block of
 * little drawings of the bike in the bottom-left corner — which is the most
 * obvious way there has ever been to break it. So it stands down while you
 * ride and comes back the moment you stop, hover it, or put the keyboard in it
 * (the last two are CSS; see #legend).
 *
 * A latched boolean rather than a class set every frame: `classList.toggle`
 * with the same value is cheap but not free, and this runs at 60 Hz forever.
 */
let riding = false;
let hudCache = '';
// THE DEBUG READOUT, ON OR OFF. Remembered, and the user's own reason for it:
// "starting to feel like the hud overlay should be toggleable too, almost ready
// to just play it straight up." What survives being off is decided by
// hudmode.ts — warnings stay, telemetry goes.
//
// ON UNDER bin/dev, OFF IN A BUILD — the split live tune already makes.
// It is a developer's readout: sim hashes, contact counts, frame times. The
// first thing a stranger saw on the public game was eleven lines of that over
// the top-left of the level, and everything a PLAYER needs from it (level name,
// clock, apples) is drawn in the game regardless. ` still toggles it, the
// choice is still remembered, and anyone who had already toggled it keeps what
// they chose — only the default for a browser that never has moved. (MODE, not
// DEV: DEV follows NODE_ENV, which this box exports as production everywhere.)
let hudVisible = loadFlag('hud', import.meta.env.MODE !== 'production');
// The art. `enabled` is the A/B switch — V, or the slider on the panel — and it
// is deliberately kept rather than deleted once the art lands: readability is
// the acceptance criterion for the whole look, and readability is judged by
// flipping between two frames of the same moment.
const artParams = cloneArt(DEFAULT_ART);
// The audio. It reads sim state once a rendered frame and never writes it —
// audio/audio.test.ts asserts that with a Proxy that throws — so a replay is
// bit-identical whether the tab is muted, loud, or has no output device.
//
// The context is not constructed until the first gesture, which is the
// browser's rule and also the reason nothing here can fail on the boot path.
const audioParams = cloneAudio(DEFAULT_AUDIO);
audioParams.muted = loadFlag('mute', false) ? 1 : 0;
const audio = createAudio(() => audioParams);

/**
 * THE ONE PLACE A CHOSEN APPEARANCE IS WRITTEN.
 *
 * Every route into it — the picker, the dice, the reset button, adopting
 * somebody else's identity across devices, and the hook bin/smoke drives — goes
 * through here, because an appearance now has a side effect. It used to be
 * three lines of cache invalidation that a new call site could plausibly get
 * away with forgetting; with a motor attached to it, forgetting means your bike
 * looks like a lawnmower and sounds like an inline four.
 *
 * AND IT IS THE ONLY CALLER OF `audio.setEngine`, with the local player's own
 * appearance, which is how ghost silence is enforced rather than hoped for:
 * there is no second path by which any other bike's engine could reach the
 * synth. `audio.test.ts` asserts that by reading this file.
 */
function applyAppearance(next: Appearance): void {
  identity.appearance = setAppearance(next);
  identity.chosenLook = true;
  myLookCache = null;
  audio.setEngine(identity.appearance.engine);
}
// The engine chosen on a previous visit, or the default for somebody who has
// never chosen. Safe before any gesture: the model remembers it and the synth
// picks it up when a context is finally allowed to exist.
audio.setEngine(identity.appearance.engine);
let baked: BakedLevel | null = null;
let bakeMs = 0;
const bootTime = performance.now();

/**
 * Bake the level's art if it is not already baked for this level and these
 * parameters. Called from the frame rather than from setLevel so that a
 * parameter that changes the GEOMETRY (the floor/wall angle) rebuilds without
 * anybody having to remember to call it, and so that a level that never gets
 * drawn never pays.
 */
function ensureBake(): BakedLevel {
  const want = bakeSignature(level, artParams);
  if (!baked || baked.signature !== want) {
    const t0 = performance.now();
    baked = bakeLevel(level, artParams, CONCRETE);
    bakeMs = performance.now() - t0;
  }
  return baked;
}
let fps = 0;
let liveTuneError: string | null = null;

// FRAME TIME, NOT FRAME RATE — and specifically the WORST one.
//
// `fps` above is an exponential average with a ~12-frame time constant, which
// is the wrong statistic for the only question anyone asks it. Reported from
// play: "it feels choppy a lil bit sometimes", while the HUD read 60. Both were
// true. A single dropped frame is a visible stutter and barely moves a mean,
// and the mean recovers within a few frames — averaging is exactly the
// operation that erases the outliers that choppiness IS.
//
// So: the worst frame in a rolling one-second window, plus how many frames in
// that window blew the 16.7 ms budget. "60 fps, worst 38 ms, 3 over" describes
// what a player actually feels; "60 fps" does not.
const FRAME_WINDOW_MS = 1000;
const BUDGET_MS = 1000 / 60;
const frameTimes: { t: number; ms: number }[] = [];
let worstMs = 0;
let overCount = 0;

function recordFrame(nowMs: number, dtMs: number): void {
  frameTimes.push({ t: nowMs, ms: dtMs });
  const cutoff = nowMs - FRAME_WINDOW_MS;
  while (frameTimes.length > 0 && frameTimes[0].t < cutoff) frameTimes.shift();
  // Recomputed over the window rather than tracked incrementally, because a
  // running max cannot forget: one 90 ms hitch on level load would pin the
  // readout at 90 for the rest of the session and tell you nothing after.
  let w = 0;
  let over = 0;
  for (const f of frameTimes) {
    if (f.ms > w) w = f.ms;
    if (f.ms > BUDGET_MS * 1.5) over++;
  }
  worstMs = w;
  overCount = over;
}

const input = createInput();

// --- run lifecycle ----------------------------------------------------------

/**
 * Bank the attempt in progress as one that was GIVEN UP ON.
 *
 * `finishRun` banks the attempts that ended themselves — a death or a finish.
 * This banks the third kind, the one where you saw it going wrong and hit R,
 * and it is worth keeping for exactly the reason the montage exists: the giving
 * up is part of the story of learning a level, and a montage missing every run
 * you abandoned would be missing the runs where you already knew.
 *
 * CALLED BEFORE ANYTHING MOVES, always. It builds from the CURRENT level, spec
 * and sim, so calling it after a level switch would bank this level's buttons
 * against the next level's identity — which is why `setLevel` calls it at the
 * very top rather than leaving it to the `restart` it ends with. Resetting the
 * recorder here is what makes the second call a no-op.
 */
function bankAbandoned(): void {
  if (recorder.frames < MIN_BANKED_FRAMES) return;
  if (sim.state.dead || sim.state.finished) return;
  const r = recorder.build(level, spec, sim);
  if (r) attempts.add(r);
  recorder.reset();
}

function restart(keepReplay = true): void {
  if (!keepReplay) {
    lastReplay = null;
    lastReplayLook = null;
  }
  bankAbandoned();
  // Auto-throttle goes back to waiting for a tap. See `TouchControls.arm`.
  touch.disarm();
  // The montage is over the moment you ride again. It is a thing you watch,
  // and leaving forty faint bikes on screen over a live attempt would be the
  // exact opposite of the readability rule the whole art direction rests on.
  montage = null;
  // Instant, and first. R is the key this game is played with and the results
  // screen must never be felt as something standing between the line and the
  // next attempt.
  closeResults();
  // Every tail cut, and the model's idea of the run forgotten, BEFORE the sim
  // moves. A death crunch still ringing over the first second of the next
  // attempt is exactly the sound a die-and-retry loop cannot afford.
  audio.reset();
  sim.reset();
  prevState = sim.snapshot();
  recorder.reset();
  playback = null;
  wasOver = false;
  // ON THE LINE, WAITING FOR YOU. Not a countdown and not a delay — the frame
  // that sees a control is the frame that rides — but the clock does not start
  // until you do, and neither does the ghost. Restarting into a moving ghost
  // opened a gap in the first half-second that had nothing to do with riding.
  armed.arm();
  // The ghost restarts WITH you. The loop is die-retry-die-retry and a ghost
  // that kept its position across a restart would be racing a phantom you are
  // forty metres behind, which is worse than no ghost at all.
  if (ghost) {
    ghost.reset();
    // Clears the "it starts with you on your next restart" note, which this IS.
    if (ghostNote) {
      ghostNote = '';
      syncBoardUi();
    }
  }
  cam.snap({ x: level.start.x, y: level.start.y, vx: 0, vy: 0 });
}

/**
 * `peek` is the opening overview, and the editor turns it OFF.
 *
 * The peek exists because seeing the whole level is route planning, which you
 * do once. Riding a level you are in the middle of editing is the opposite: it
 * is the die-retry loop with a geometry change in it, forty times an hour, and
 * a second of camera before each attempt would be the single most expensive
 * thing in the editor. R already knows this; Q has to know it too.
 */
function setLevel(next: LevelEntry, note = '', peek = true): void {
  if (!next.level) {
    replayNote = `"${next.label}" does not load: ${next.error ?? '?'}`;
    return;
  }
  // BEFORE the level moves under it. See `bankAbandoned`.
  bankAbandoned();
  entry = next;
  level = next.level;
  baked = null;
  // A livery is solved against the level's palette, so every look on screen is
  // for the level that just left.
  dropLooks();
  audio.reset();
  sim = createSim(level, spec);
  lastReplay = null;
  lastReplayLook = null;
  replayNote = note;
  restart(false);
  // The opening peek happens on a LEVEL LOAD and not on a restart. Seeing the
  // whole level is route planning, which you do once; R is the die-retry loop,
  // which you do forty times, and putting anything at all in front of it is how
  // a retry loop stops being instant. See `peek` — the editor is the third case.
  if (peek) overview.startIntro();
  saveLastLevel(entry.id);
  // Keep the address bar a shareable link to what is actually on screen.
  const url = new URL(location.href);
  url.searchParams.set('level', entry.id);
  history.replaceState(null, '', url);
  levelBar.update(entry.id, bests);
  // `[` and `]` still work with the chooser open, so the card marked as current
  // has to follow them rather than going stale behind the menu.
  if (chooserUi.visible) renderChooser();
  // A ghost belongs to a level. Dropped before the fetch rather than after, so
  // there is never a frame where last level's ghost is drawn on this one.
  dropGhost('');
  board = null;
  humanBoard = null;
  tasBoard = null;
  refreshBoard();
}

function stepLevel(delta: number): void {
  const playable = LEVELS.filter((l) => l.level !== null);
  if (playable.length < 2) return;
  const i = playable.findIndex((l) => l.id === entry.id);
  const next = playable[((i < 0 ? 0 : i) + delta + playable.length) % playable.length];
  setLevel(next);
}

/**
 * Recompute the effective spec from `localSpec` + `remoteOverride` and rebuild
 * the world around it.
 *
 * `carry` keeps the bike exactly where it is rather than teleporting it to the
 * start. Live tuning is the whole point of the panel and being thrown to the
 * start line on every slider drag would make it useless mid-air. A REMOTE
 * change does not get that treatment — see `applyRemote`.
 *
 * The recording dies either way: a replay whose spec changed halfway through is
 * not reproducible, and silently keeping one would be worse than losing it.
 */
function recomputeSpec(carry: boolean): void {
  spec = applySpecOverride(localSpec, remoteOverride).spec;
  const carried = carry ? sim.snapshot() : null;
  sim = createSim(level, spec);
  if (carried) sim.restore(carried);
  prevState = sim.snapshot();
  recorder.reset();
  lastReplay = null;
  lastReplayLook = null;
  playback = null;
  const p = PRESETS.find((x) => x.id === presetId);
  specIsTuned = p ? specHash(localSpec) !== specHash(p.spec) : true;
  panel.setTuned(specIsTuned);

  // A ghost is a run on a SPECIFIC bike. Once the bike moves, those inputs
  // describe a line nobody rode, so the ghost goes rather than lying quietly.
  if (ghost) dropGhost('the bike changed, so the ghost was dropped — it was a run on a different bike');
  // The montage is forty of the same argument.
  montage = null;
  syncBoardUi();
}

/** A panel slider moved: `localSpec` has already been mutated in place. */
function onPanelEdit(): void {
  recomputeSpec(true);
  replayNote = 'spec changed — press R for a clean run to record';
  saveStoredSpec(presetId, localSpec);
  panel.setRemote(liveTune.heldPaths, remoteNote());
}

/** Set the whole local spec — a preset swap, a reset, or a replay's own bike. */
function setLocalSpec(next: BikeSpec, opts: { persist: boolean; carry: boolean }): void {
  localSpec = next;
  recomputeSpec(opts.carry);
  if (opts.persist) saveStoredSpec(presetId, localSpec);
  else clearStoredSpec();
  panel.sync();
  panel.setRemote(liveTune.heldPaths, remoteNote());
}

/**
 * A new override arrived from `data/spec.json`.
 *
 * It RESTARTS the attempt, deliberately and always. A replay records the bike
 * spec's hash, so a spec that changes mid-run makes that run meaningless — and
 * silently so, which is the worse half. Restarting costs nothing while tuning
 * and it is honest. Playback is cancelled for the same reason.
 *
 * And it SAYS WHAT CHANGED. A bike that silently changes under somebody
 * concentrating on a run is the worst possible outcome: they conclude they have
 * lost their touch rather than that the numbers moved.
 */
function applyRemote(
  override: Record<string, unknown>,
  held: ReadonlySet<string>,
  dropped: readonly string[],
): void {
  const before = spec;
  remoteOverride = override;
  recomputeSpec(false);
  restart(false);
  panel.setRemote(held, remoteNote());
  panel.sync();

  const changes = diffSpec(before, spec);

  // THE DROPPED PATHS COME FIRST, and they get their own toast even when
  // nothing else moved.
  //
  // A path this build has no field for is not an error anywhere: the value is
  // simply not applied and the bike keeps the local default. `bin/spec` says
  // "IGNORED n unknown path(s)" at the TERMINAL, which the person playing is
  // not looking at. That gap has already cost a real session — an override held
  // `rider.inertialTransfer`, the field became a brake/drive pair, the client
  // dropped it, fell back to 0.6 against maxTorque 126 (lifts like the default,
  // less power to recover) and it was ridden for twenty minutes with nothing on
  // screen to explain it.
  //
  // A rename is exactly when this matters most, because it is also exactly when
  // nothing looks broken, so this is deliberately loud: its own toast, its own
  // HUD line, and it names the keys rather than counting them.
  if (dropped.length > 0) {
    const names = dropped.slice(0, 3).join(', ');
    const more = dropped.length > 3 ? ` and ${dropped.length - 3} more` : '';
    toast(
      `data/spec.json sets ${names}${more}, which this build has no such field for — ` +
        'those keys are NOT in force and the bike is using its own value. Renamed? Check bin/spec.',
      'live tune',
    );
  }

  if (changes.length === 0) return;
  const shown = changes.slice(0, 4).map((c) => `${c.path} ${fmtNum(c.from)} → ${fmtNum(c.to)}`);
  if (changes.length > shown.length) shown.push(`and ${changes.length - shown.length} more`);
  // Two toasts in one frame would clobber each other; the dropped-key warning is
  // the one that must survive, so the change list joins it rather than
  // replacing it.
  if (dropped.length === 0) toast(shown.join('   '), 'live tune');
  replayNote = `live tune: ${shown.join(', ')} — attempt restarted`;
}

function remoteNote(): string {
  const n = liveTune.heldPaths.size;
  if (n === 0) return '';
  return (
    `LIVE TUNE holding ${n} field${n === 1 ? '' : 's'} from data/spec.json. ` +
    'Those rows are read-only here; run `bin/spec unset <path>` (or `bin/spec reset`) to take them back. ' +
    'Your own tuning underneath is untouched.'
  );
}

function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(6)));
}

let toastTimer = 0;
/** Brief, non-blocking, and never in the way of the collision edge. */
function toast(message: string, label = ''): void {
  toastRoot.textContent = '';
  if (label) {
    const tag = document.createElement('b');
    tag.textContent = label;
    toastRoot.append(tag);
  }
  toastRoot.append(document.createTextNode(message));
  toastRoot.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastRoot.classList.remove('show'), 6000);
}

function finishRun(): void {
  const r = recorder.build(level, spec, sim);
  if (!r) return;
  lastReplay = r;
  // Your own run, so T replays it in your own colours.
  lastReplayLook = null;
  attempts.add(r);
  // READ BEFORE `recordBest` WRITES. It overwrites the stored best in place, so
  // a comparison taken afterwards is a run against itself.
  const previousBestTicks = bests[level.simHash] ?? null;
  if (r.finished && recordBest(level.simHash, r.timeTicks)) {
    bests = loadBests();
    levelBar.update(entry.id, bests);
    replayNote = `new local best: ${ticksToSeconds(r.timeTicks).toFixed(3)}s — E exports this run`;
  } else {
    replayNote = 'run banked — T replays it, E exports it as a file';
  }
  // THE RESULTS SCREEN, ON A FINISH AND NOTHING ELSE.
  //
  // Opened before the submission is attempted, not after, because the summary is
  // complete without the network and the network must never be something the
  // player waits through. Posting fills its own line in afterwards.
  if (r.finished) {
    results = {
      replay: r,
      levelName: level.name,
      simHash: level.simHash,
      applesTotal: level.apples.length,
      previousBestTicks,
      submit: { kind: 'posting' },
    };
    syncResults();
  }

  // Post it. Only a finish goes on a board, and `submitRunIfPossible` is the
  // one that decides that — not this line — so that "what gets posted" lives in
  // one place beside the reasons it might not.
  submitRunIfPossible(r);

  // ASK ONCE MORE, ON THE FIRST FINISH, IF THEY SKIPPED.
  //
  // This is where the motivation actually is. At the first load there is
  // nothing to attach a name to and the honest answer to "why would I" is "you
  // would not, yet"; here there is a TIME, it is banked and unposted, and the
  // board row it would sit on is the thing the panel draws. It opens OVER the
  // results screen rather than instead of it — `openLook('finish')` is the one
  // mode that does not close it — so dismissing this reveals the time again,
  // and nothing is between the player and `next level` but one tap.
  //
  // ONCE, EVER, and the flag is written when it is SHOWN. A prompt that came
  // back on every finish until it was answered would be the tollbooth this
  // design refuses, delivered late instead of early. Everything it offers stays
  // one pad away forever afterwards.
  if (r.finished && !hasName(identity) && !loadFlag(PROFILE_ASKED_AT_FINISH, false)) {
    saveFlag(PROFILE_ASKED_AT_FINISH, true);
    openLook('finish');
  }
}

function startPlayback(): void {
  if (!lastReplay) {
    replayNote = 'nothing recorded yet — drive, then die or finish';
    return;
  }
  // Pressing T mid-run gives that run up, so it banks like any other giving up.
  bankAbandoned();
  const v = verify(level, spec, lastReplay);
  replayNote = v.result.ok
    ? `replay verified: ${lastReplay.frames} frames, hash ${v.result.finalHash}`
    : `REPLAY DESYNC: ${v.result.reason ?? '?'}${v.result.atFrame !== undefined ? ` at frame ${v.result.atFrame}` : ''}`;
  audio.reset();
  sim.reset();
  prevState = sim.snapshot();
  recorder.reset();
  playback = { masks: decodeInputs(lastReplay.inputs), at: 0 };
  // A playback is something you WATCH, so it does not wait to be told to go —
  // there is no input coming and the armed banner over a replay that never
  // starts would read as a hang. The montage rides on this same path.
  armed.disarm();
  cam.snap({ x: level.start.x, y: level.start.y, vx: 0, vy: 0 });
}

// --- the montage -------------------------------------------------------------
//
// Every attempt of the session, at once, over the one that worked.
//
// The shape is the cheap one and it is cheap for a day-one reason: a replay is
// an INPUT STREAM, so a rider is a second sim fed buttons rather than a
// trajectory played back, and forty of them is forty sims stepping in parallel
// — which the sim has supported since the first commit because the solver
// needed it to be cheap to instantiate and steppable headlessly.
//
// The WINNING LINE IS NOT ONE OF THE RIDERS. It runs on the player's own sim
// through the ordinary playback path, which is what makes the camera follow it,
// what makes it the only bike drawn at full strength, and what means this
// function adds no second idea of what "watching a run" is.

/** How many attempts the montage would ride right now. Null when not worth it. */
function montageCount(): number | null {
  const sel = selectMontage(attempts.all, {
    simHash: level.simHash,
    specHash: specHash(spec),
    winner: results?.replay ?? lastReplay,
  });
  return sel.picks.length >= MONTAGE_MIN ? sel.picks.length : null;
}

function startMontage(): void {
  const hero = results?.replay ?? lastReplay;
  if (!hero) {
    replayNote = 'nothing to ride against yet — finish the level first';
    return;
  }
  const sel = selectMontage(attempts.all, {
    simHash: level.simHash,
    specHash: specHash(spec),
    winner: hero,
  });
  if (sel.picks.length < MONTAGE_MIN) {
    replayNote =
      sel.incompatible > 0
        ? `only one attempt can ride: ${sel.incompatible} of this session's runs were on a different bike or a different sim rev`
        : 'only one attempt so far — the montage needs a few failures to be worth watching';
    return;
  }

  // The failures only. The winner rides the player's sim, below.
  const riders: Rider[] = [];
  for (const p of sel.picks) {
    if (p.winner) continue;
    riders.push(createRider(level, spec, decodeInputs(p.replay.inputs)));
  }

  // The hero goes through the SAME playback path T uses. `startPlayback` resets
  // the sim and the camera, so the montage is built after it and every rider
  // starts on the line together with the player's own.
  lastReplay = hero;
  lastReplayLook = null;
  closeResults();
  startPlayback();
  montage = { riders, alpha: montageAlpha(riders.length + 1), label: montageLabel(sel) };
  // `startPlayback` verifies the hero's hash chain and says so. A DESYNC there
  // is the loudest thing this client can report and it must not be quietly
  // overwritten by a caption — so the caption goes after it rather than over it.
  const desync = replayNote.startsWith('REPLAY DESYNC') ? `${replayNote} — ` : '';
  replayNote = `${desync}montage — ${montage.label}. R rides again, ] is the next level.`;
  toast(montage.label, 'every attempt');
}

// --- the leaderboard, and the ghost --------------------------------------------

function boardStatusSet(text: string, kind: 'ok' | 'warn' | 'bad' | '' = 'warn'): void {
  boardStatus = text;
  boardStatusKind = text ? kind : '';
  syncBoardUi();
}

function syncBoardUi(): void {
  boardUi.update({
    visible: boardVisible,
    category: boardCategory,
    ghost: ghostKind,
    playerId: identity.playerId,
    name: identity.name,
    board,
    status: boardStatus,
    statusKind: boardStatusKind,
    ghostNote,
    palette: levelP(),
    appearance: identity.appearance,
  });
}

function dropGhost(note: string): void {
  ghost = null;
  ghostReplayId = '';
  ghostLook = null;
  ghostNote = note;
}

/**
 * Fetch the board for the level on screen, then pick a ghost from it.
 *
 * `boardToken` is the whole of the concurrency story: switching levels twice
 * quickly leaves two fetches in flight and the FIRST one can land last. Without
 * the guard that shows level A's board under level B's name, which is the kind
 * of bug that gets reported as "the leaderboard is wrong sometimes".
 */
function refreshBoard(): void {
  const token = ++boardToken;
  const forLevel = level.simHash;
  const want = boardCategory;
  // BOTH boards, always, and the human one is not optional.
  //
  // The ghost is chosen from the human board no matter which board is on screen,
  // so the human board has to be in hand even while somebody is looking at the
  // TAS times. Two small GETs against a loopback server; the alternative is a
  // ghost that changes because you glanced at another tab of the same panel.
  Promise.all([
    fetchBoard(forLevel, { category: 'human', playerId: identity.playerId }),
    want === 'human'
      ? Promise.resolve(null)
      : fetchBoard(forLevel, { category: want, playerId: identity.playerId }),
    // The TAS board is fetched for its TIMES — shown on the results screen and
    // in its own category — never for its lines.
    want === 'tas' ? Promise.resolve(null) : fetchBoard(forLevel, { category: 'tas', playerId: identity.playerId }),
  ]).then(([h, other, tas]) => {
    if (token !== boardToken || forLevel !== level.simHash) return;
    if (!h.ok) {
      board = null;
      humanBoard = null;
      tasBoard = null;
      boardStatusSet(
        h.offline
          ? 'leaderboard offline — the game works fine without it; times are banked locally'
          : h.error,
        h.offline ? 'warn' : 'bad',
      );
      // The panel still says everything it can say without a server.
      syncResults();
      return;
    }
    humanBoard = h.value;
    const shown = want === 'human' ? h : other;
    board = shown && shown.ok ? shown.value : null;
    if (want === 'tas') tasBoard = board;
    else if (tas && tas.ok) tasBoard = tas.value;
    // The human half landing while the SHOWN half did not is rare and it is
    // also the one combination that would otherwise sit on "loading…" forever,
    // because the panel reads emptiness as not-yet-arrived.
    if (!board && shown && !shown.ok) boardStatusSet(shown.error, shown.offline ? 'warn' : 'bad');
    else if (boardStatusKind !== 'ok') boardStatusSet('', '');
    ensureGhost();
    syncResults();
  });
}

/** The human board reduced to what `chooseGhost` reads. */
function standingOf(b: BoardPayload | null): Standing | null {
  return b ? { above: b.above, you: b.you, best: b.best, rank: b.rank, total: b.total } : null;
}

/**
 * Make the live ghost match what the selector asks for and what the board
 * offers. Idempotent and safe to call on every board refresh: it returns early
 * when the right ghost is already running, which is what keeps a ghost from
 * being rebuilt (and therefore restarted) under a player mid-run.
 */
function ensureGhost(): void {
  if (!humanBoard) return;
  // THE HUMAN BOARD, WHATEVER IS ON SCREEN. `chooseGhost` is handed the TAS
  // standing too and pointedly never reads it — the parameter is there so the
  // rule is stated where it is enforced and so a test can assert that a level
  // with a TAS entry and no human entry produces NO ghost.
  const boards = { human: standingOf(humanBoard), tas: standingOf(tasBoard) };
  const pick = chooseGhost(ghostKind, boards);
  if (!pick.entry) {
    dropGhost(ghostNoteFor(ghostKind, pick, boards));
    syncBoardUi();
    return;
  }
  if (pick.entry.replayId === ghostReplayId) return;

  const want = pick.entry;
  const forLevel = level.simHash;
  fetchReplay(want.replayId, forLevel).then((r) => {
    if (forLevel !== level.simHash) return;
    if (!r.ok) {
      dropGhost(`could not load that ghost: ${r.error}`);
      syncBoardUi();
      return;
    }
    // Checked before it is built, never after. A ghost from another rev or
    // another bike CANNOT be shown — playing those inputs under this build's
    // physics would draw a line nobody rode, with somebody's name on it.
    const compat = ghostCompat(level, spec, r.value);
    if (!compat.ok) {
      dropGhost(compat.reason);
      syncBoardUi();
      return;
    }
    // WHOSE APPEARANCE WINS, decided in one place. The BOARD ENTRY is preferred
    // over anything the stored replay remembers, because the entry is refreshed
    // in place on every submission — so the bike riding beside you is the bike
    // on the row you are chasing, and the two can never disagree. A row from
    // before any of this existed has none, and `resolveAppearance` turns that
    // into a stable derivation from their playerId rather than into your bike.
    const theirs = resolveAppearance(want.appearance, want.playerId);
    ghost = createGhost(level, spec, r.value, {
      kind: pick.kind,
      name: want.name,
      replayId: want.replayId,
      rank: pick.rank,
      appearance: theirs,
    });
    ghostLook = makeLook(theirs, levelP(), want.playerId);
    ghostReplayId = want.replayId;
    ghostNote = '';
    // Line it up with where the player already is, because a ghost that arrived
    // mid-run would otherwise start on the line racing nobody.
    //
    // BOUNDED, and the bound is the point. Fast-forwarding is synchronous, and
    // a ten-minute run is 76,800 input frames — about 0.8 s of straight-line
    // arithmetic on the main thread, which is a visible freeze rather than a
    // hitch. 4,096 frames is 32 seconds of run and roughly 0.14 s, which is one
    // dropped frame. Past that the ghost waits for the next restart and says
    // so, which is honest and cannot stall the game.
    const GHOST_CATCHUP_MAX = 4096;
    if (recorder.frames > GHOST_CATCHUP_MAX) {
      ghostNote = `${want.name}'s ghost is loaded — it starts with you on your next restart (R)`;
    } else {
      for (let i = 0; i < recorder.frames && !ghost.done; i++) ghost.advance();
    }
    syncBoardUi();
  });
}

function setGhostKind(k: GhostKind): void {
  ghostKind = k;
  saveChoice('ghost', k);
  if (k === 'off') {
    dropGhost('');
    syncBoardUi();
    return;
  }
  ghostReplayId = '';
  ensureGhost();
}

function setCategory(c: Category): void {
  boardCategory = c;
  saveChoice('boardCategory', c);
  board = null;
  ghostReplayId = '';
  syncBoardUi();
  refreshBoard();
}

/**
 * Post a finished run.
 *
 * THE CLIENT NEVER POSTS A TIME, only the buttons that produced it: the server
 * re-simulates the input stream and derives the time itself. That is what makes
 * the board cheat-proof by construction, and it is why this function is allowed
 * to be this trusting — there is nothing here worth lying to.
 *
 * Browser runs always go in as `human`. The TAS category exists because a
 * solver-generated stream verifies perfectly and always will, so it is a
 * declared category rather than a detected one — and it is posted with
 * `bin/submit --category tas`, from the machine that generated it, rather than
 * being a dropdown next to the player's own runs.
 */
function submitRunIfPossible(r: Replay): void {
  if (!r.finished) return;
  if (r.specHash === refusedSpec) {
    setSubmitState(r, { kind: 'not-posted' });
    boardStatusSet('not posted: this bike is not the shipped one (live tune or the tuning panel)', 'warn');
    return;
  }
  if (!hasName(identity)) {
    pendingSubmit = r;
    setSubmitState(r, { kind: 'needs-name' });
    boardStatusSet('pick a name above and this run gets posted', 'warn');
    return;
  }
  pendingSubmit = null;
  setSubmitState(r, { kind: 'posting' });
  boardStatusSet('posting…', '');
  submitRun({
    playerId: identity.playerId,
    name: identity.name,
    // POSTED ON EVERY RUN, not only the first. The server refreshes it in place
    // exactly as it refreshes the name, so repainting your bike repaints the
    // rows you already hold — the alternative makes repainting look broken
    // while the data underneath is perfectly correct, which is the bug a test
    // caught the last time this pattern was built.
    appearance: identity.appearance,
    category: 'human',
    replay: r,
  }).then((res) => {
    if (!res.ok) {
      // Latch on the CODE now that the wire carries one. Matching on the prose
      // worked only for as long as nobody reworded the refusal.
      if (res.code === 'unknown-bike' || res.error.includes('shipped bike')) refusedSpec = r.specHash;
      setSubmitState(
        r,
        res.offline
          ? { kind: 'offline', reason: res.error }
          : { kind: 'refused', code: res.code, reason: res.error },
      );
      boardStatusSet(
        res.offline ? 'leaderboard offline — the time is yours locally, it just did not post' : res.error,
        res.offline ? 'warn' : 'bad',
      );
      return;
    }
    const v = res.value;
    setSubmitState(r, {
      kind: 'posted',
      rank: v.placement.rank,
      total: v.placement.total,
      pb: v.placement.pb,
    });
    boardStatusSet(
      v.placement.pb
        ? `posted: #${v.placement.rank} of ${v.placement.total} at ${v.timeSeconds.toFixed(3)}s` +
            (v.placement.previousTicks !== null
              ? ` — ${ticksToSeconds(v.placement.previousTicks - v.entry.timeTicks).toFixed(3)}s off your best`
              : '')
        : `verified in ${v.verifyMs} ms, but slower than your ${ticksToSeconds(v.entry.timeTicks).toFixed(3)}s`,
      'ok',
    );
    refreshBoard();
  });
}

/**
 * Record where the submission got to, for the results panel.
 *
 * Guarded on the replay's identity rather than applied blindly: a slow POST for
 * the run you just did must not overwrite the panel of the NEXT run, which on a
 * die-and-retry loop can be seconds later.
 */
function setSubmitState(forReplay: Replay, state: SubmitState): void {
  if (!results || results.replay !== forReplay) return;
  results.submit = state;
  syncResults();
}

function onNameChosen(raw: string): void {
  const clean = setName(raw);
  identity.name = clean;
  syncBoardUi();
  if (clean && pendingSubmit) {
    const r = pendingSubmit;
    pendingSubmit = null;
    submitRunIfPossible(r);
  }
}

/**
 * Watch one board entry's run from the start, with the normal playback path.
 *
 * HUMAN RUNS ONLY, and the refusal is enforced HERE as well as in the panel that
 * decides which rows get a button, because "the UI does not show it" is a
 * presentation fact and this is the function that actually fetches somebody's
 * route. There is no unlock: route choice is this game's depth and a searched
 * optimal line deletes the puzzle permanently. A time is information; a line is
 * a solution.
 */
/**
 * Play one board row's run from the start.
 *
 * `simHash` is the LEVEL THE ROW IS ON, and it defaults to the one loaded
 * because the board panel is per-level. The browser is not: a row there can
 * belong to any of the twenty-four, and fetching its replay against the wrong
 * level is a 404 that reads as "that run is broken". `loadReplay` then switches
 * to the level the file names, so watching a rival on a level you are not on
 * takes you there.
 */
function watchEntry(e: BoardEntry, simHash: string = level.simHash): void {
  if (!watchableCategory(e.category)) {
    boardStatusSet(
      'that is a machine run — its time is the whole of what this board shows. A solver picked the apple ' +
        'order by searching for it, and that order is the level.',
      'warn',
    );
    return;
  }
  fetchReplay(e.replayId, simHash).then((r) => {
    if (!r.ok) {
      boardStatusSet(`could not load that run: ${r.error}`, 'bad');
      return;
    }
    try {
      const file = parseReplayFile(r.value);
      loadReplay(file, `${e.name} — ${ticksToSeconds(e.timeTicks).toFixed(3)}s`);
      // The ROW wins over what the stored blob remembers, so the bike you watch
      // is the bike on the row you clicked. `loadReplay` has already resolved a
      // look from the file alone; this is the one caller that knows better.
      lastReplayLook = replayLook(file, e);
    } catch (err) {
      boardStatusSet(`that run did not parse: ${err instanceof Error ? err.message : String(err)}`, 'bad');
    }
  });
}

// --- the end-of-level screen -------------------------------------------------
//
// THE RULE IT EXISTS UNDER: the fastest path back into the game is the default,
// and dismissal is instant. Enter goes onward, R retries exactly as R does
// everywhere else in this game, Escape closes. Nothing here animates in and
// nothing here is waited on — the summary is complete on the frame the run ends,
// with or without a server, and the posting line fills itself in afterwards.
//
// It is shown on a FINISH and never on a death. That is decided in `finishRun`.

/** How many board rows the panel prints before it starts eliding. */
const RESULTS_ROWS = 5;

/** The level Enter goes to. Wraps, because a twenty-level list should. */
function nextLevelEntry(): LevelEntry | null {
  const playable = LEVELS.filter((l) => l.level !== null);
  if (playable.length < 2) return null;
  const i = playable.findIndex((l) => l.id === entry.id);
  return playable[((i < 0 ? 0 : i) + 1) % playable.length];
}

/**
 * The human entry whose line the panel offers to play — the one you are racing.
 *
 * It follows the ghost selector rather than inventing a second policy, so "watch
 * the ghost" on this screen is the same run that was riding beside you.
 */
function resultsGhostEntry(): BoardEntry | null {
  if (!humanBoard) return null;
  const pick = chooseGhost(ghostKind === 'off' ? 'above' : ghostKind, {
    human: standingOf(humanBoard),
    tas: standingOf(tasBoard),
  });
  if (!pick.entry) return null;
  return humanBoard.top.find((e) => e.replayId === pick.entry?.replayId)
    ?? (humanBoard.above?.replayId === pick.entry.replayId ? humanBoard.above : null)
    ?? (humanBoard.you?.replayId === pick.entry.replayId ? humanBoard.you : null)
    ?? (humanBoard.best?.replayId === pick.entry.replayId ? humanBoard.best : null);
}

function syncResults(): void {
  if (!results) return;
  const next = nextLevelEntry();
  const ghostEntry = resultsGhostEntry();
  const tasTicks = tasBoard?.top[0]?.timeTicks ?? null;
  resultsModel = buildResults({
    levelName: results.levelName,
    timeTicks: results.replay.timeTicks,
    // A finish is only possible with `applesLeft === 0` (step.ts gates the
    // flower on it), so a finished run took all of them by construction.
    applesTaken: results.applesTotal,
    applesTotal: results.applesTotal,
    previousBestTicks: results.previousBestTicks,
    submit: results.submit,
    board: humanBoard,
    tasTimeTicks: tasTicks,
    playerId: identity.playerId,
    rowLimit: RESULTS_ROWS,
    actions: {
      nextLabel: next?.label ?? null,
      canWatchRun: lastReplay !== null,
      ghostName: ghostEntry?.name ?? null,
      montageCount: montageCount(),
      // The leaderboard row comes off on touch, because the panel it opens is
      // hidden there. See `ActionInput.touch`.
      touch: touch.enabled,
    },
  });
  resultsUi.update(resultsModel, levelP());
  // The panel's own buttons are UNDER the pads and they are the only way a
  // phone reaches "next level". The controls stay live — dismissing the panel
  // puts them straight back — they just get out of the way.
  touch.setHidden(true);
}

function closeResults(): void {
  if (!results) return;
  results = null;
  resultsModel = null;
  resultsUi.hide();
  // Through the legend rather than straight at the pads: the control legend
  // hides them too, and a panel closing on top of an open legend must not put a
  // `gas` pad back under its close button.
  syncLegendPads(legend?.open ?? false);
}

function resultsAction(id: ActionId): void {
  switch (id) {
    case 'next': {
      const next = nextLevelEntry();
      closeResults();
      if (next) setLevel(next);
      break;
    }
    case 'retry':
      // Exactly what R does everywhere else, and deliberately routed through the
      // same function rather than reimplemented.
      restart(false);
      break;
    case 'watchRun':
      closeResults();
      startPlayback();
      break;
    case 'watchGhost': {
      const e = resultsGhostEntry();
      closeResults();
      if (e) watchEntry(e);
      break;
    }
    case 'montage':
      // It closes the panel itself, after it has read the finishing run off it.
      startMontage();
      break;
    case 'board':
      // The fuller view. The results panel stays up: they are on opposite sides
      // of the screen and B is a toggle everywhere else in the game.
      boardVisible = true;
      saveFlag('board', true);
      syncBoardUi();
      refreshBoard();
      break;
    case 'levels':
      // The chooser, not the dropdown. This action has always been called
      // "level select"; now there is something worth selecting from.
      closeResults();
      openChooser();
      break;
    case 'dismiss':
      closeResults();
      break;
    default:
      break;
  }
}

// --- replay files -----------------------------------------------------------

function exportReplay(): void {
  if (!lastReplay) {
    replayNote = 'nothing to export yet — drive, then die or finish';
    return;
  }
  try {
    const name = downloadReplay(lastReplay, {
      levelRaw: entry.raw,
      levelName: level.name,
      spec,
      // So the file shows the bike it was ridden on when somebody else opens
      // it. Presentation metadata; the verifier cannot see it.
      playerId: identity.playerId,
      appearance: identity.appearance,
    });
    replayNote = `exported ${name} — re-run it with: bin/replay ${name}`;
  } catch (e) {
    replayNote = `export failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Load a replay and watch it play. Everything about this path is written to
 * FAIL LOUDLY rather than to play something that is not what was recorded —
 * this is the first real user of the versioning scheme and a silent
 * near-miss here would make the whole rev mechanism decorative.
 */
function loadReplay(file: ReplayFile, name: string): void {
  // Rev first, and it is fatal. Rev-mismatched physics means a different run.
  if (file.simRev !== SIM_REV) {
    replayNote =
      `CANNOT PLAY ${name}: recorded under SIM_REV ${file.simRev}, this build is rev ${SIM_REV}. ` +
      'The physics changed between them, so replaying it here would show you a different run. ' +
      'Through milestone 1 the rev bumps freely and replays do not survive it.';
    return;
  }

  // The level, by simHash and nothing else. If we ship it, switch to it; if the
  // file carries one we do not have, take that on.
  const notes: string[] = [];
  let target = findBySimHash(file.simHash);
  if (!target && file.level !== undefined) {
    try {
      target = adoptLevel(file.level, file.levelName ?? 'replay level');
      notes.push('level taken from the replay file');
    } catch (e) {
      replayNote = `CANNOT PLAY ${name}: its embedded level does not load — ${e instanceof Error ? e.message : String(e)}`;
      return;
    }
  }
  if (!target?.level) {
    replayNote =
      `CANNOT PLAY ${name}: it is for level ${file.simHash}` +
      (file.levelName ? ` ("${file.levelName}")` : '') +
      ', which this build does not have and the file does not carry.';
    return;
  }
  if (target.id !== entry.id) setLevel(target);

  // The bike. A mismatch is recoverable when the file carries its own spec, and
  // adopting it is stated rather than silent.
  if (specHash(spec) !== file.specHash) {
    const embedded = replaySpec(file);
    if (!embedded) {
      replayNote =
        `CANNOT PLAY ${name}: recorded on bike spec ${file.specHash}, the current bike is ${specHash(spec)}, ` +
        'and the file carries no usable spec of its own.';
      return;
    }
    // Live tune has to come OFF here, not just be layered under. A replay only
    // reproduces against the exact spec it was recorded on, and the next poll
    // two seconds from now would quietly change the bike underneath the
    // playback and make the hash chain diverge. Turning it off is stated, and
    // the toggle is right there.
    if (liveTune.enabled) {
      liveTune.setEnabled(false);
      saveFlag('livetune', false);
      panel.setLiveTune(false);
      notes.push('live tune switched off so the recorded bike can be reproduced');
    }
    setLocalSpec(embedded, { persist: false, carry: false });
    notes.push(`adopted the replay's bike spec ${file.specHash}`);
  }

  const compat = checkReplayCompat(file, { level: target.level, spec });
  if (!compat.ok) {
    replayNote = `CANNOT PLAY ${name}: ${compat.problems.join(' / ')}`;
    return;
  }

  lastReplay = file;
  // THE BIKE IT WAS RIDDEN ON. `meta` is the replay file's presentation block —
  // never read by the sim, never hashed, and absent on every file recorded
  // before today and on every pilot and solver run in `replays/`. Absent falls
  // back to the shipped bike rather than erroring or drawing nothing.
  lastReplayLook = replayLook(file, null);
  startPlayback();
  const claimed = `${file.finished ? 'FINISHED' : file.dead ? 'DEAD' : 'unfinished'} at ${ticksToSeconds(file.timeTicks).toFixed(3)}s`;
  replayNote = `${name}: ${claimed}${notes.length ? ` (${notes.join('; ')})` : ''} — ${replayNote}`;
}

/**
 * Whose bike a replay shows.
 *
 * ONE resolution order, in one function, because the hazard is two code paths
 * disagreeing about it:
 *
 *   1. the board entry we clicked, when there is one — it is refreshed in place
 *      on every submission, so it is the current truth about that person and it
 *      is what the row beside the button is already showing;
 *   2. otherwise whatever the FILE remembers in its `meta` block, which is what
 *      makes an exported replay stand alone when it is handed to somebody;
 *   3. otherwise the stable derivation from the playerId, if we know one;
 *   4. otherwise the shipped bike.
 *
 * Steps 3 and 4 are `resolveAppearance`'s, so this function is only ever
 * choosing which source to hand it.
 */
function replayLook(file: ReplayFile, want: BoardEntry | null): BikeLook {
  const carried = want?.appearance ?? (file.meta ? (file.meta as Record<string, unknown>).appearance : undefined);
  const who = want?.playerId ?? (typeof file.meta?.playerId === 'string' ? file.meta.playerId : null);
  const app = resolveAppearance(carried, who);
  return makeLook(app, levelP(), who);
}

function importReplay(): void {
  pickReplay().then(
    (r) => {
      if (r) loadReplay(r.file, r.name);
    },
    (e: unknown) => {
      replayNote = `could not read that file: ${e instanceof Error ? e.message : String(e)}`;
    },
  );
}

// --- the frame --------------------------------------------------------------

let wasOver = false;
/**
 * The mask the sim last ran on — the live keyboard, or a replay's. Audio reads
 * it rather than the keyboard so that a replay sounds like the run it is.
 */
let appliedMask = 0;

/**
 * A fixed input stream, driven through the real frame loop.
 *
 * This exists for `bin/smoke`, and specifically for the one assertion that
 * cannot be made any other way: that a MUTED run records a byte-identical
 * replay to an unmuted one. Driving with keyboard events and a wall-clock timer
 * cannot answer that, because the number of input frames then depends on how
 * long the browser took, and two runs of different lengths are trivially
 * different for reasons that have nothing to do with audio.
 *
 * It feeds masks instead of the keyboard and leaves everything else — the loop,
 * the recorder, the draw, the audio sampling — exactly as it is in play.
 */
let scripted: { masks: number[]; at: number; done: (r: Replay | null) => void } | null = null;

function scriptRun(masks: number[]): Promise<Replay | null> {
  // The opening peek freezes the sim until any input, and a scripted run is not
  // input. Skipping it explicitly keeps the harness from waiting forever on a
  // level it has just switched to.
  overview.skipIntro();
  // A second call while one is still running would orphan the first promise and
  // hang whatever was awaiting it. Resolve it instead: the run it described did
  // not finish, and saying so is better than never answering.
  scripted?.done(null);
  restart(false);
  // `restart` arms the start line and a scripted run is not input either. The
  // scripted branch in `step()` sits above the gate, so this is belt and
  // braces — but it also keeps the banner off a run nobody is waiting to start.
  armed.disarm();
  return new Promise((resolve) => {
    scripted = { masks, at: 0, done: resolve };
  });
}

function step(): void {
  prevState = copyState(sim.state);

  // THE FREEZE. Everything below this line is the only code that can move the
  // sim, so returning here is a total guarantee rather than a best effort:
  // `sim.advance` is not called, so no tick runs and `state.tick` — the clock —
  // does not move; `recorder.capture` is not called, so the input stream gains
  // no frame. An overview held for a minute produces a bit-identical replay to
  // the same run never held at all. overview.test.ts asserts that rather than
  // trusting this comment.
  //
  // `prevState` is copied ABOVE the return on purpose: the renderer interpolates
  // between prevState and state by a varying alpha every frame, so leaving them
  // different would make the frozen bike shimmer between two poses.
  // Any input at all cancels the opening peek. A deliberate TAB hold is not
  // cancelled by driving — that is what `hold` outranking `intro` is for.
  if (overview.mode === 'intro' && input.mask() !== 0) overview.skipIntro();
  // ONE QUESTION, whatever is covering the screen — the overview, the about
  // page, and whatever the fourth one turns out to be. See hold.ts.
  if (hold.held) return;

  // THE MONTAGE, ONE FRAME FOR ONE FRAME, and above every branch below so that
  // it keeps riding after the winning line has crossed the finish. The failures
  // are not all shorter than the run that worked — a long doomed attempt is
  // exactly the kind the montage is worth watching for — and a rider frozen
  // mid-air because the hero got there first would be a lie about when it died.
  //
  // `advance()` is a no-op once a rider is done, so the stopped ones cost
  // nothing and stay exactly where they stopped. That pile IS the story.
  if (montage) {
    for (const r of montage.riders) r.advance();
  }

  if (playback) {
    if (playback.at >= playback.masks.length) {
      playback = null;
      return;
    }
    appliedMask = playback.masks[playback.at];
    sim.advance(playback.masks[playback.at++]);
    ghost?.advance();
    return;
  }

  if (scripted) {
    if (scripted.at >= scripted.masks.length || sim.state.dead || sim.state.finished) {
      const s = scripted;
      scripted = null;
      // A scripted run that ENDED THE RUN goes through the same `finishRun` a
      // played one does — which is what lets bin/smoke prove the end-of-level
      // screen appears on a finish and stays away on a death, through the real
      // bundle. A scripted run that merely ran out of masks did not end
      // anything, so it only banks what was recorded.
      if ((sim.state.dead || sim.state.finished) && !wasOver) {
        finishRun();
        wasOver = true;
      } else {
        lastReplay = recorder.build(level, spec, sim);
      }
      s.done(lastReplay);
      return;
    }
    const m = scripted.masks[scripted.at++];
    appliedMask = m;
    sim.advance(m);
    recorder.capture(m, sim);
    ghost?.advance();
    return;
  }

  const mask = input.mask();
  const over = sim.state.dead || sim.state.finished;
  if (over) {
    // The run is frozen by the sim itself. Keep feeding it nothing so the
    // recorder does not grow, and bank the replay once.
    if (!wasOver) {
      finishRun();
      wasOver = true;
    }
    return;
  }
  // THE ARMED GATE, AND IT IS THE OVERVIEW'S FREEZE ONE LINE LOWER. Same
  // guarantee and for the same reason: returning here is above every line that
  // can move anything, so `sim.advance` does not run and the clock does not
  // move, `recorder.capture` does not run and the input stream gains no frame,
  // and `ghost.advance` does not run — the ghost waits on the line with you,
  // which is the entire point. A run armed for a minute banks a byte-identical
  // replay to one started instantly; armed.test.ts asserts that against the
  // real sim and the real recorder, and bin/smoke asserts it in Chrome through
  // the real key path.
  //
  // BELOW the `over` branch on purpose. A dead run must still bank its replay
  // even in the impossible case of arriving here armed, and `finishRun` is up
  // there. Any sim bit at all releases it, HELD OR FRESHLY PRESSED — see
  // armed.ts.
  if (!armed.release(mask)) return;
  wasOver = false;
  appliedMask = mask;
  sim.advance(mask);
  recorder.capture(mask, sim);
  // ONE GHOST FRAME FOR ONE PLAYER FRAME, and strictly after the player's own
  // step. The ghost owns a separate Sim with a separate World and a cloned
  // spec, so this line cannot reach the player's state — ghost.test.ts hashes a
  // run with and without a ghost attached and asserts the chains are identical,
  // which is the only way that claim stays true as this file changes.
  ghost?.advance();
  if (sim.state.dead || sim.state.finished) {
    finishRun();
    wasOver = true;
  }
}

/**
 * The montage's riders, posed and culled, or null when none is running.
 *
 * CULLS THE DRAW AND NEVER THE SIM — the riders were all advanced in `step`
 * whatever this returns. On a sprawling level most of the crowd is nowhere near
 * the camera and drawing a bike costs more than stepping one, so this is where
 * the frame budget is actually won; on a tight level like 20-close-quarters it
 * saves nothing at all, because they are all in the same few metres, which is
 * the case `MONTAGE_CAP` was measured against.
 */
function montageDraws(
  alpha: number,
  view: { x: number; y: number; zoom: number },
  cssW: number,
  cssH: number,
): GhostDraw[] | null {
  if (!montage) return null;
  const box = {
    x: view.x,
    y: view.y,
    halfW: cssW * 0.5 / view.zoom,
    halfH: cssH * 0.5 / view.zoom,
  };
  const out: GhostDraw[] = [];
  for (const i of visibleRiders(montage.riders, box)) {
    const r = montage.riders[i];
    // ALWAYS the silhouette tier. Readability and cost both say so, and
    // montage.ts carries the measurement and the cliff it avoids.
    // NO `look`, DELIBERATELY, AND THIS IS THE DECISION. A montage rider is one
    // of the PLAYER'S OWN attempts, so it falls back to the player's current
    // livery rather than carrying one per attempt. Appearance could have been
    // embedded per attempt — repainting mid-session would then show
    // historically, which is arguably nicer — but the failure mode of two code
    // paths disagreeing is a crowd of forty split down the middle between two
    // liveries, which reads as a bug. One answer, resolved live: the montage is
    // about you, so it is all you, in the colours you are wearing now.
    out.push({ pose: r.pose(alpha), facing: r.facing, alpha: montage.alpha, coarse: true });
  }
  return out;
}

function draw(alpha: number, dtMs: number): void {
  fps += (1000 / Math.max(dtMs, 1) - fps) * 0.08;
  recordFrame(performance.now(), dtMs);
  const { cssW, cssH } = resize();
  const dtSec = dtMs / 1000;
  const pose = interpolate(prevState, sim.state, alpha);

  // See `riding`. The threshold is a speed and not "is a key held", because the
  // answer wanted is "is the player's eye on the bike" — coasting down a slope
  // with nothing pressed is exactly when the legend must not be in the way, and
  // sitting on the start line holding the brake is exactly when it may be.
  const moving = !editor.active && !loop.paused && !sim.state.dead
    && Math.abs(sim.state.vx) + Math.abs(sim.state.vy) > 0.6;
  if (moving !== riding) {
    riding = moving;
    document.body.classList.toggle('riding', moving);
  }

  // WHERE THE HANDS ARE, in CSS px, read from the pads themselves rather than
  // guessed. The camera turns it into `screenBiasY` — see `screenBiasFor` — and
  // it is read every frame for the same reason the viewport is: a rotation, a
  // URL bar collapsing and a switch to auto-throttle all change it, and all
  // three should ease rather than need a listener.
  cam.params.thumbInsetPx = touch.thumbInset();

  overview.tick(dtSec);
  // WHAT THE FREEZE SAYS ON THE CANVAS. The debug readout in the corner already
  // says it, and the readout is hidden on a phone — which is right, and which
  // left the one device with an overview PAD as the one device that got a
  // silently frozen game. The sentence is built here rather than in the renderer
  // because the way out is a key on one machine and a pad on another.
  const overviewText = !overview.frozen
    ? null
    : {
      title: 'TIME STOPPED',
      hint: overview.mode === 'held'
        ? (touch.enabled ? 'tap anything to ride' : 'release TAB to ride')
        // The opening peek used to promise "any key to start", and since the
        // start line became ARMED that is a promise it cannot keep: any key
        // ends the peek, but only a control starts the run. Skipping is what
        // this hint is actually about; the armed banner underneath takes over
        // and says how to go.
        : (touch.enabled ? 'tap to skip' : 'any key to skip'),
    };
  // WHAT THE ARMED LINE SAYS, and it says GO rather than STOPPED.
  //
  // Same argument as the overview's banner — a frozen game that does not say it
  // is frozen reads as a crashed one, and the corner readout that says so is
  // hidden on a phone — but the opposite sentence. The overview is a thing that
  // HAPPENED to the game and the player is waiting for it to end; this is the
  // game waiting for the PLAYER, so it is an instruction rather than a status.
  //
  // Short, because it is on screen once per retry in a game whose loop is R,
  // and because it goes the instant a control is touched: `armed.armed` is
  // false on the frame that starts the run, so the banner is gone on that
  // frame's draw. No blend, no fade-out — a fade would be a hundred
  // milliseconds of "did that register" at exactly the moment the answer has to
  // be obvious. The overview's fade exists because its camera is easing; this
  // has no camera move to wait for.
  //
  // Not while the overview is up (one freeze speaks at a time, and both banners
  // are drawn in the same place), and not in the editor, where the bike is
  // parked on purpose and the player is looking at the ground.
  const armedText = armed.armed && !overview.frozen && !editor.active
    ? {
      title: 'GO WHEN READY',
      // Names the controls rather than "any key", because it IS only the
      // controls: R, TAB, the chooser and the legend all leave it armed.
      hint: touch.enabled ? 'tap any pad' : 'gas, brake or lean',
    }
    : null;
  const ov = overview.blend > 0
    ? { ...overviewFrame(level, { x: pose.px, y: pose.py }, cssW, cssH, overview.params), blend: overview.blend }
    : null;
  cam.update({ x: pose.px, y: pose.py, vx: sim.state.vx, vy: sim.state.vy }, dtSec, cssW, cssH, ov);

  // WHILE EDITING, THE EDITOR OWNS THE CAMERA. It pans and zooms freely and
  // does not follow the bike, because the bike is parked and the thing you are
  // moving is the ground. The play camera keeps smoothing underneath, so
  // pressing Q to ride returns to a camera that is already on the bike rather
  // than one that has to catch up.
  const view = editor.view ?? cam;

  const ghostPose: Pose | null = ghost ? ghost.pose(alpha) : null;
  const opts = {
    debug,
    // THE LEADERBOARD GHOST STANDS DOWN DURING A MONTAGE. It is somebody else's
    // line and the montage is about yours; one more faint bike, drawn at the
    // same alpha as the forty, would read as a forty-first attempt that you
    // never made.
    // Somebody else's line through a level that no longer exists. Gone while
    // editing, like the rest of the play chrome.
    ghost: montage || editor.active ? null : ghostPose,
    ghostFacing: ghost?.facing,
    ghosts: montageDraws(alpha, cam, cssW, cssH),
    overview: overview.blend,
    // Indicators are for driving, not for the overview — while the whole level
    // is on screen there is nothing off it to point at, and eight arrows
    // sliding to the edges during the zoom is exactly the noise the readability
    // rule exists to prevent. They fade out as the overview fades in.
    markers: overview.params.markerAlpha > 0 && !editor.active
      ? { inset: overview.params.markerInset, alpha: overview.params.markerAlpha * (1 - overview.blend) }
      : null,
  };
  if (artParams.enabled > 0) {
    const art = ensureBake();
    renderArt(ctx, cssW, cssH, view, sim.world, sim.state, pose, spec,
      // The in-canvas level card, clock and apple counter are the GAME talking
      // and stay whatever the readout is doing. The detail chip beside them is
      // an instrument, so it goes with the readout.
      {
        ...opts,
        time: (performance.now() - bootTime) / 1000,
        detailChip: hudVisible,
        // No R key on a phone, so the death banner must not name one.
        touch: touch.enabled,
        overviewText,
        armedText,
        // THE BIKE ON SCREEN IS WHOEVER IS RIDING IT. During a playback of
        // somebody else's file or somebody else's board row that is THEIR
        // livery, because the player's own sim is what carries the line — see
        // `lastReplayLook`. Everything else is yours.
        look: playback && lastReplayLook ? lastReplayLook : myLook(),
        ghostLook,
      }, artParams, art);
  } else {
    render(ctx, cssW, cssH, view, sim.world, sim.state, pose, spec, opts);
  }

  // The handles, the grid, the warnings and the bike-as-a-ruler, on top of the
  // real renderer's real picture. Drawing the level twice — once for play, once
  // for editing — is how an editor ends up lying about what you will ride.
  editor.draw(ctx, cssW, cssH);

  // AUDIO IS PER FRAME, NOT PER TICK. The sim runs at 512 Hz; sampling it once
  // a frame is the same discipline the renderer follows, and for the same
  // reason — nothing downstream of either is verified, so neither may drive the
  // rate at which the sim is asked anything.
  //
  // It goes after the draw so that a frame which is already over budget pays
  // the drawing first; the audio thread has its own buffer and does not care
  // about a millisecond of jitter in when its parameters arrive.
  //
  // Ducked under the overview, because the overview FREEZES the sim: every
  // reading audio has is held constant for as long as TAB is down, and a
  // engine note held dead flat for a second is the one case where being
  // perfectly faithful to the state sounds like a bug.
  // Ducked under anything holding the sim, because holding it means every
  // reading audio has is frozen, and an engine note held dead flat for as long
  // as a panel is up is the one case where being perfectly faithful to the
  // state sounds like a bug. The overview fades with its own blend so releasing
  // TAB is instant; the about page is a hard cover and gets a flat duck.
  audio.setDuck(Math.min(1 - overview.blend * 0.85, legend?.about.open ? 0.15 : 1));
  audio.update(sampleRide(sim.world, sim.state, spec, appliedMask), dtSec);

  updateHud();
}

// --- chrome -----------------------------------------------------------------

function resize(): { cssW: number; cssH: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { cssW, cssH };
}

/**
 * One line of HUD for the sound. It is here rather than left invisible because
 * every failure mode of browser audio is silent by design — no gesture yet, a
 * context the OS refused to start, a muted tab — and "I hear nothing" with
 * nothing on screen to explain it is indistinguishable from "it is broken".
 */
function audioLine(): string {
  if (audio.error) return `<span class="bad">off — ${esc(audio.error)}</span>`;
  if (audio.muted) return '<span class="warn">MUTED</span> — M unmutes';
  switch (audio.state) {
    case 'idle':
    case 'starting':
      return '<span class="warn">waiting for a click or a key</span> — browsers will not start sound before one';
    case 'suspended':
      return '<span class="warn">suspended</span> (tab hidden)';
    case 'running':
      // Bangs a second rather than a frequency, because that is what the number
      // now is and because it is the one figure that means the same thing on
      // all four engines. See Voices.engineHz.
      return `on, ${labelFor('engine', audio.engine)}, ${audioParams.engineHz.toFixed(0)}/s, `
        + `${audio.lastMs.toFixed(2)} ms/frame — M mutes`;
    default:
      return 'off';
  }
}

function setMuted(on: boolean): void {
  audio.setMuted(on);
  saveFlag('mute', on);
  panel.sync();
  // The LABEL on the toast is a key, and on a phone there is no key. It says
  // where the control actually is on the device reading it.
  toast(on ? 'sound off' : 'sound on', touch.enabled ? 'your bike' : 'M');
}

/** The two things that are warnings rather than telemetry. See hudmode.ts. */
function hudWarnState(): HudWarnState {
  return {
    tuned: specIsTuned,
    heldFields: liveTune.heldPaths.size,
    droppedPaths: liveTune.droppedPaths,
    liveTuneError,
  };
}

/**
 * THE RULE FOR `hud.innerHTML`: every interpolated STRING goes through this.
 *
 * The readout is the one place in the client that builds markup out of a
 * template literal — everything else (the board, the chooser, the results
 * screen, the legend) builds DOM nodes and sets `textContent`, which cannot be
 * got wrong. This one can, and it did: a ghost's display name, which is typed
 * by ANOTHER PERSON, was interpolated raw. `cleanName` is hygiene and not
 * sanitisation by its own admission — it collapses control characters and caps
 * the length at 24, and it passes `<` and `>` straight through, because a name
 * is text and text is allowed to contain angle brackets. So the escaping has to
 * happen where the text becomes MARKUP, which is here.
 *
 * Stored, not reflected: a name travels with a submitted run, comes back off
 * the board or out of a replay file, and lands in somebody else's readout. The
 * readout is on by default. Twenty-four characters is a working payload.
 *
 * Quotes as well as angle brackets, because "not today's call sites" is not a
 * property of an escaper: the day somebody writes `title="${...}"` the quote is
 * what breaks out, and it costs two more replaces to be safe in an attribute
 * too. Numbers, hex digests and enum branches do not need it and do not have it;
 * anything that is a string somebody could have typed does.
 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function setHudVisible(on: boolean): void {
  hudVisible = on;
  saveFlag('hud', on);
  hud.classList.toggle('compact', !on);
  // Force a rewrite: the cache is keyed on the HTML, and the two modes can
  // agree on an empty string.
  // The sentinel is written ESCAPED on purpose. As a raw NUL byte it made GNU
  // grep treat this whole file as binary, so every search silently matched
  // nothing and exited 1 -- which cost an hour and produced a confident,
  // wrong claim that the zoom keys below were never wired.
  hudCache = '\u0000';
  updateHud();
  toast(
    on
      ? 'debug readout on'
      : 'debug readout off — the level name, clock and apples are drawn in the game. Warnings still show.',
    '`',
  );
}

function updateHud(): void {
  // HIDDEN MEANS HIDDEN, except for the warnings. A tuned bike that silently
  // fails to post, and a live-tune file naming a field this build does not
  // have, are both things a player cannot discover any other way — so they
  // survive as a compact badge rather than as eleven lines of telemetry.
  if (!hudVisible) {
    const html = persistentBadges(hudWarnState())
      .map((b) => `<span class="${b.tone}">${esc(b.text)}</span>`)
      .join('\n');
    if (html !== hudCache) {
      hudCache = html;
      hud.innerHTML = html;
    }
    return;
  }
  const s = sim.state;
  const m = input.mask();
  const keys =
    (m & IN_THROTTLE ? 'GAS ' : '&middot;&nbsp;&nbsp;&nbsp; ') +
    (m & IN_BRAKE ? 'BRK ' : '&middot;&nbsp;&nbsp;&nbsp; ') +
    (m & IN_LEAN_L ? '&lt;L&nbsp; ' : '&middot;&nbsp;&nbsp; ') +
    (m & IN_LEAN_R ? 'R&gt;&nbsp; ' : '&middot;&nbsp;&nbsp; ') +
    (m & IN_FLIP ? 'FLIP' : '&middot;');
  const status = overview.frozen
    ? `<span class="warn">OVERVIEW — sim and clock frozen at ${ticksToSeconds(s.tick).toFixed(2)}s${overview.mode === 'held' ? (touch.enabled ? ', tap to ride' : ', release TAB') : (touch.enabled ? ', tap to skip' : ', any key to skip')}</span>`
    : armed.armed
      // The dev readout's own version of the canvas banner, and it names the
      // half the canvas does not have room for: the clock and the GHOST are
      // both held. That is the thing to check first when a run looks stuck.
      ? `<span class="warn">ARMED — clock and ghost held at ${ticksToSeconds(s.tick).toFixed(2)}s, ${touch.enabled ? 'tap any pad' : 'gas/brake/lean'} to go</span>`
    : s.finished
      ? `<span class="ok">FINISHED ${ticksToSeconds(s.endTick).toFixed(3)}s</span>`
      : s.dead
        ? `<span class="bad">DEAD at ${ticksToSeconds(s.endTick).toFixed(3)}s — R to restart</span>`
        : playback
          ? `<span class="warn">REPLAY ${playback.at}/${playback.masks.length}</span>`
          : `${ticksToSeconds(s.tick).toFixed(2)}s`;
  const best = bests[level.simHash];

  // While the editor is open the readout's first line is the DOCUMENT rather
  // than the run: nothing is running, and the numbers that matter are how many
  // polygons there are, whether it still loads and whether it is saved.
  const editLine = editor.hud();

  const lines = [
    editLine ? `<span class="warn">${esc(editLine)}</span>` : '',
    `<span class="k">velo</span> <span class="v">rev ${SIM_REV}</span>  <span class="k">preset</span> <span class="v">${esc(presetLabel)}${specIsTuned ? ' <span class="warn">+tuned</span>' : ''}</span>`,
    `<span class="k">level</span> ${esc(level.name)}  <span class="k">simHash</span> ${level.simHash}`,
    `<span class="k">spec </span> ${specHash(spec)}`,
    '',
    `${status}   <span class="k">apples</span> ${level.apples.length - s.applesLeft}/${level.apples.length}` +
      (best !== undefined ? `   <span class="k">best</span> ${ticksToSeconds(best).toFixed(3)}s` : ''),
    `<span class="k">speed</span> ${Math.sqrt(s.vx * s.vx + s.vy * s.vy).toFixed(2)} m/s   <span class="k">spin</span> ${s.wspin[0].toFixed(1)} / ${s.wspin[1].toFixed(1)}   <span class="k">ground</span> ${s.grounded === 3 ? 'both' : s.grounded === 1 ? 'rear' : s.grounded === 2 ? 'front' : 'air'}`,
    `<span class="k">keys </span> ${keys}`,
    `<span class="k">facing</span> ${s.facing > 0 ? '+x' : '-x'}   <span class="k">contacts</span> ${sim.world.contactCount}   <span class="k">zoom</span> ${cam.zoom.toFixed(0)} px/m (${(canvas.clientWidth / Math.max(cam.zoom, 1e-6)).toFixed(1)} m${cam.zoomBias === 1 ? '' : `, ${cam.zoomBias.toFixed(2)}\u00d7`})   <span class="k">fps</span> ${fps.toFixed(0)}` +
    `   <span class="k">worst</span> ${worstMs.toFixed(1)}ms` +
    (overCount > 0 ? `   <span class="bad">${overCount} dropped</span>` : ''),
    '',
    `<span class="k">audio</span> ${audioLine()}`,
    liveTuneError
      ? `<span class="bad">${esc(liveTuneError)}</span>`
      : liveTune.enabled
        ? `<span class="k">live tune</span> on${liveTune.heldPaths.size ? `, holding ${liveTune.heldPaths.size} field(s)` : ', no override'}`
        : '<span class="k">live tune</span> off',
    // Stays up for as long as the file names a field this build does not have,
    // rather than being a toast that expires. The toast is the alert; this is
    // the answer when somebody comes back to the screen an hour later asking
    // why the bike feels wrong.
    liveTune.droppedPaths.length > 0
      ? `<span class="bad">data/spec.json: ${esc(liveTune.droppedPaths.join(', '))} — no such field in this build, NOT applied` +
        ' (renamed? bin/spec lists the real paths)</span>'
      : '',
    // The panel is closed by default now, so the two things it would otherwise
    // be shouting about have to be visible without it. A stale hand-tune or a
    // remote override that nobody can SEE is how somebody spends an afternoon
    // debugging a feel problem that is their own leftover slider.
    !panel.visible && (specIsTuned || liveTune.heldPaths.size > 0)
      ? `<span class="warn">bike is not the preset as shipped${specIsTuned ? ' (tuned)' : ''}${liveTune.heldPaths.size ? ` (${liveTune.heldPaths.size} field(s) held by bin/spec)` : ''} — H opens the panel</span>`
      : '',
    `<span class="k">recorded</span> ${recorder.frames} frames${lastReplay ? `  <span class="k">banked</span> ${lastReplay.frames}` : ''}  <span class="k">attempts</span> ${attempts.forLevel(level.simHash).length}`,
    // The ghost gets a HUD line of its own because it is the thing on screen
    // that is easiest to mistake for a bug: a second bike appears, and if you
    // cannot see whose it is and how far ahead, it reads as a rendering fault.
    // The montage gets its own line for as long as it is riding, because a
    // screen with forty faint bikes on it needs to say what they are — and
    // because when it stops, the thing you are looking at is a still picture of
    // where the level beat you, which deserves a caption.
    montage
      ? (() => {
          const riding = montage.riders.filter((r) => !r.done).length;
          return (
            `<span class="k">montage</span> ${esc(montage.label)}   ` +
            (riding > 0
              ? `<span class="v">${riding} still riding</span>`
              : '<span class="warn">all stopped — this is where the level beat you</span>') +
            '   <span class="k">R rides again</span>'
          );
        })()
      : '',
    ghost
      // SOMEBODY ELSE'S NAME, ESCAPED. See `esc`: this is the sink the bug
      // was in, and the name arrives here from the leaderboard or from a
      // replay file rather than from anything this machine typed.
      ? `<span class="k">ghost</span> ${esc(ghost.meta.name)}${ghost.meta.rank !== null ? ` (#${ghost.meta.rank})` : ''} ` +
        `<span class="v">${ticksToSeconds(ghost.timeTicks).toFixed(3)}s</span>  ` +
        `<span class="k">${GHOST_LABELS[ghost.meta.kind]}</span>  ` +
        // Which bike that is, so the one riding beside you is identifiable as
        // theirs rather than as a second copy of yours.
        `<span class="k">${esc(appearanceLabel(ghost.meta.appearance))}</span>  ` +
        `${ghost.done ? 'finished' : `${ghost.at}/${ghost.frames}`}` +
        // A gap in METRES, not seconds. The ghost is stepped one frame for one
        // frame with you, so the two clocks are identical by construction and a
        // time gap would always read 0.00s. What differs is where you each are.
        `   <span class="${s.px - ghost.x >= 0 ? 'ok' : 'warn'}">${Math.abs(s.px - ghost.x).toFixed(1)} m ${s.px - ghost.x >= 0 ? 'ahead' : 'behind'}</span>`
      : ghostNote
        ? `<span class="k">ghost</span> <span class="warn">${esc(ghostNote)}</span>`
        : '',
    // `replayNote` is assembled from a board row's NAME, a level's title out of
    // a loaded file, and parser error text that quotes both. Every one of those
    // is somebody else's string; the class beside it is chosen from our own
    // prefixes and is not.
    replayNote ? `<span class="${replayNote.startsWith('REPLAY DESYNC') || replayNote.startsWith('CANNOT PLAY') ? 'bad' : 'warn'}">${esc(replayNote)}</span>` : '',
    '',
    `<span class="k">rev ${SIM_REV} bumps freely during M1 — times reset on every physics change.</span>`,
  ];
  const html = lines.join('\n');
  if (html !== hudCache) {
    hudCache = html;
    hud.innerHTML = html;
  }
}

// --- wiring -----------------------------------------------------------------

const levelBar = createLevelBar(levelbarRoot, LEVELS, (id) => {
  const hit = LEVELS.find((l) => l.id === id);
  if (hit) setLevel(hit);
}, () => openChooser());
levelBar.update(entry.id, bests);
/**
 * THE CONTROL LEGEND, AND THE DEV TOOLBAR BEHIND ONE SWITCH.
 *
 * See chrome.ts for the split and why it exists. The only thing main.ts owns
 * here is what each dev tool DOES — every one of them is the same statement the
 * key case runs, called from the same place, so a button and its key can never
 * drift into meaning two different things.
 */
legend = createLegend(legendRoot, {
  touch: wantsTouch(location.search, (q) => window.matchMedia(q).matches),
  palette: () => levelP(),
  look: () => myLook(),
  dev: {
    panel: () => panel.toggle(),
    readout: () => setHudVisible(!hudVisible),
    collision: () => {
      debug = !debug;
    },
    art: () => {
      artParams.enabled = artParams.enabled > 0 ? 0 : 1;
      panel.sync();
    },
    replay: () => startPlayback(),
    exportReplay: () => exportReplay(),
    importReplay: () => importReplay(),
    montage: () => startMontage(),
    editor: () => editor.toggle(),
  },
  /**
   * ON A PHONE THE PADS GO UNDER IT, and this is the ONE place that happens —
   * the `?` key, the `controls` pad and the card's own `×` all arrive here.
   * Same move `openResults` makes and for the same reason: the card's buttons
   * sit exactly where the thumb clusters are, and a close button you cannot
   * press because a `gas` pad is on top of it is a trap rather than a panel.
   * The controls are not switched OFF — `setHidden` only hides them — so
   * closing the card puts them straight back.
   */
  onOpen: (on) => syncLegendPads(on),
});

/**
 * THE ABOUT PAGE HOLDS THE SIM, through the same register the overview uses.
 *
 * It is a full-screen overlay and it does not pause anything by itself — the
 * only thing it does to the game is dispatch a window `blur`, which is the door
 * `input.ts` already uses for alt-tab, so a held throttle drops. That is not
 * enough: the bike still coasts, still falls and still dies while you read.
 * Open it mid-run on a ledge and you come back to a corpse.
 *
 * A PREDICATE ON THE PAGE'S OWN STATE, read late, and nothing about.ts had to
 * change for it. There is no second flag here that could disagree with whether
 * the page is up — if it is shut, it is not holding anything, which is the
 * whole reason hold.ts asks questions rather than counting locks.
 *
 * No TIME STOPPED banner, unlike the overview: the page is covering the screen,
 * so nothing reads as crashed.
 */
hold.add('about', () => legend?.about.open ?? false);

function syncLegendPads(open: boolean): void {
  if (touch.enabled) touch.setHidden(open || results !== null);
}

function setLegendOpen(on: boolean): void {
  legend?.setOpen(on);
}

// --- the level chooser ------------------------------------------------------
//
// A picture of each level, its measured difficulty, and whether you have done
// it. It is deliberately NOT on the path that changes level in a hurry: `[` and
// `]` still step instantly and never open this, and the dropdown in the level
// bar still works exactly as it did. This answers the other question — which of
// the twenty to ride — which a list of names cannot.
//
// IT PAUSES THE GAME while it is up, for the same reason the results screen
// takes the keyboard: it is a menu. Pausing is the existing P, it cannot touch
// a recording (no input frames are captured while the loop is paused), and it
// is what makes the thumbnail queue free — nothing is competing for the frame.
let chooserSort: ChooserSort = loadChoice<ChooserSort>('chooserSort', CHOOSER_SORTS, 'number');
/**
 * WHICH VIEW OF THE ONE BROWSE SURFACE IS UP — the grid you ride from, or the
 * leaderboards you browse.
 *
 * DELIBERATELY NOT REMEMBERED, unlike the sort beside it. Every way in names
 * the view it wants: `C` and the `levels` pad mean the grid, the `times` pad
 * and the board panel's button mean the ladder. Remembering it would make `C`
 * — advertised as "the level chooser" — open a leaderboard for anybody who had
 * looked at one earlier, which is a control that does different things on
 * different days. The tab is for switching once you are in there.
 */
let chooserView: ChooserView = 'levels';
/**
 * Which level the board browser is looking at, as an ID rather than an index.
 *
 * The index would be wrong the moment somebody changed the sort — "by
 * difficulty" reorders the same twenty-four — and quietly showing a different
 * level's board under the same heading is the exact class of bug `boardToken`
 * exists to stop on the other panel.
 */
let browseId = entry.id;
let pausedBeforeChooser = false;

const thumbs = createThumbs({
  onReady: (simHash, url) => chooserUi.setThumb(simHash, url),
});

/**
 * ONE BOARD PER LEVEL, FETCHED ONCE PER OPENING OF THE SCREEN.
 *
 * The whole ask was to see leaderboards "without having to load each one", and
 * a refetch on every `next ›` would put a loading state between a player and
 * every level in the set — which is the thing being removed, in a smaller and
 * more annoying form. It is cleared in `openChooser`, so a board is never older
 * than the screen it is on, and the `↻` button drops one when somebody suspects
 * it anyway.
 *
 * It is deliberately NOT the board that feeds the ghost. `refreshBoard` owns
 * that, it is token-guarded against a slow fetch landing after a level change,
 * and a browse of some other level must not be able to change which run is
 * riding beside you.
 */
const browseBoards = createBoardCache(
  (simHash, category): Promise<BoardSlot> =>
    fetchBoard(simHash, { category, playerId: identity.playerId }).then((r) =>
      r.ok
        ? { state: 'ready', payload: r.value, error: '' }
        : { state: 'offline', payload: null, error: r.error },
    ),
  (simHash, category) => {
    // Only the board actually on screen redraws. The neighbours are warmed on
    // purpose (see `browseModel`) and a rebuild for one of those would be a
    // panel flickering under somebody who is reading a different one.
    if (!chooserUi.visible || chooserView !== 'times') return;
    if (category !== boardCategory) return;
    if (browsedEntry()?.level?.simHash !== simHash) return;
    renderChooser();
  },
);

/**
 * A livery is solved against the level it is RIDDEN on, so a board of level 14
 * draws its bikes in level 14's room even while you are standing in level 3.
 *
 * Memoised by simHash, and that is load-bearing rather than tidy: `avatar.ts`
 * caches rendered bikes in a WeakMap keyed by the palette OBJECT, so handing it
 * a freshly derived palette per render would miss the cache on every row of
 * every step and redraw forty little bikes for nothing.
 */
const browsePalettes = new Map<string, ReturnType<typeof levelPalette>>();
function browseP(e: LevelEntry | null): ReturnType<typeof levelPalette> {
  const lvl = e?.level ?? null;
  if (!lvl || artParams.derive <= 0) return CONCRETE;
  if (lvl.simHash === level.simHash) return levelP();
  let P = browsePalettes.get(lvl.simHash);
  if (!P) {
    P = levelPalette(lvl.style, lvl.simHash);
    browsePalettes.set(lvl.simHash, P);
  }
  return P;
}

function browsedEntry(): LevelEntry | null {
  return LEVELS.find((l) => l.id === browseId) ?? null;
}

const chooserUi = createChooserUi(chooserRoot, {
  onPick: (id) => {
    const hit = LEVELS.find((l) => l.id === id);
    closeChooser();
    if (hit) setLevel(hit);
  },
  onSort: (s) => {
    chooserSort = s;
    saveChoice('chooserSort', s);
    renderChooser();
  },
  onClose: () => closeChooser(),
  thumbUrl: (simHash) => {
    const hit = findBySimHash(simHash);
    return hit?.level ? thumbs.peek(hit.level) : null;
  },
  wantThumb: (simHash) => {
    const hit = findBySimHash(simHash);
    if (hit?.level) thumbs.request(hit.level);
  },
  onView: (v) => {
    chooserView = v;
    renderChooser();
  },
  onBrowse: (id) => {
    browseId = id;
    chooserView = 'times';
    renderChooser();
  },
  onStep: (d) => stepBrowse(d),
  // The SAME category state the board panel uses, rather than a second one.
  // Two answers to "which board am I looking at" is how the ghost ended up
  // changing because somebody glanced at another tab, which is the bug the
  // human/board split upstairs exists to prevent.
  onCategory: (c) => {
    setCategory(c);
    renderChooser();
  },
  onGhost: (k) => {
    setGhostKind(k);
    renderChooser();
  },
  onWatch: (e) => {
    const hit = browsedEntry();
    closeChooser();
    watchEntry(e, hit?.level?.simHash ?? level.simHash);
  },
  onRefresh: () => {
    const hash = browsedEntry()?.level?.simHash;
    if (hash) browseBoards.drop(hash, boardCategory);
    renderChooser();
  },
  // The ROW SHOWS A PERSON. An appearance that never travelled — every row
  // written before customisation existed — resolves to a stable derivation from
  // the playerId rather than to one shared default, so an old board is still a
  // board of different people.
  avatarFor: (e) => avatarImg(resolveAppearance(e.appearance, e.playerId), browseP(browsedEntry()), e.playerId),
});

/**
 * The model for the board browser: one level of the list, its board, and where
 * it sits in the order the current sort produced.
 *
 * The neighbours are warmed on the way past. Stepping is the verb this screen
 * was asked for, and a board that is already in hand when `next ›` is pressed
 * is the difference between browsing and waiting.
 */
function browseModel(groups: readonly ChooserGroup[]): BrowseModel | null {
  const items = flatten(groups);
  if (items.length === 0) return null;
  let i = items.findIndex((x) => x.id === browseId);
  if (i < 0) i = Math.max(0, items.findIndex((x) => x.current));
  const item = items[i];
  const board: BoardSlot = item.simHash
    ? browseBoards.get(item.simHash, boardCategory)
    : { state: 'ready', payload: null, error: '' };
  for (const d of [1, -1]) {
    const n = items[(i + d + items.length) % items.length];
    if (n.simHash && n.simHash !== item.simHash) browseBoards.want(n.simHash, boardCategory);
  }
  return buildBrowse(item, {
    playerId: identity.playerId,
    category: boardCategory,
    at: i + 1,
    of: items.length,
    board,
  });
}

/** `‹ prev` / `next ›`. Wraps, because a twenty-four-level list should. */
function stepBrowse(delta: number): void {
  const items = flatten(chooserGroups());
  if (items.length === 0) return;
  let i = items.findIndex((x) => x.id === browseId);
  if (i < 0) i = Math.max(0, items.findIndex((x) => x.current));
  browseId = items[(i + delta + items.length) % items.length].id;
  renderChooser();
}

function chooserGroups(): ChooserGroup[] {
  return buildChooser(LEVELS, {
    bests,
    currentId: entry.id,
    sort: chooserSort,
    rev: SIM_REV,
  });
}

function renderChooser(): void {
  const groups = chooserGroups();
  chooserUi.show({
    groups,
    summary: chooserSummary(groups, SIM_REV),
    sort: chooserSort,
    view: chooserView,
    browse: chooserView === 'times' ? browseModel(groups) : null,
    ghost: ghostKind,
  });
}

function openChooser(view: ChooserView = 'levels'): void {
  chooserView = view;
  // Every board it shows is fetched fresh for this opening of the screen, and
  // never again while it is up. See `browseBoards`.
  browseBoards.clear();
  // Follow the level on screen unless somebody has already browsed elsewhere
  // during this opening — arriving at "level 3's board" while standing in level
  // 17 would be a screen that is about nothing you did.
  browseId = entry.id;
  if (chooserUi.visible) {
    renderChooser();
    return;
  }
  closeResults();
  pausedBeforeChooser = loop.paused;
  loop.paused = true;
  // Same as the results screen: on a phone the thumb pads sit exactly where the
  // cards are, and a pad that is underneath a menu is a pad that eats a tap.
  touch.setHidden(true);
  renderChooser();
}

function closeChooser(): void {
  if (!chooserUi.visible) return;
  // The queue goes first: a thumbnail still being drawn after the menu closed
  // is exactly the frame cost this is not allowed to have. Everything already
  // drawn stays cached, so reopening is instant.
  thumbs.stop();
  chooserUi.hide();
  loop.paused = pausedBeforeChooser;
  // Through the legend rather than straight at the pads: the control legend
  // hides them too, and a panel closing on top of an open legend must not put a
  // `gas` pad back under its close button.
  syncLegendPads(legend?.open ?? false);
}

/**
 * THE BROWSE SURFACE HOLDS THE SIM, through the one register every other screen
 * that covers the game uses.
 *
 * It also pauses the loop, which it has always done, and that is not a second
 * freeze so much as a stronger one — a paused loop does not draw either. The
 * hold is registered anyway and deliberately: the guarantee that matters is
 * "no tick advances while this is up", `step()`'s gate is the one place that is
 * decided, and a screen whose freeze depends on a scheduling flag somewhere
 * else is a screen whose freeze can be removed by an edit that was about
 * something else entirely. hold.test.ts asserts the bytes.
 */
hold.add('browse', () => chooserUi.visible);

// The leaderboard panel. Created before live tune, because live tune's first
// poll fires immediately and can reach `syncBoardUi` through recomputeSpec.
const boardUi = createBoardUi(boardRoot, {
  onCategory: (c) => setCategory(c),
  onGhost: (k) => setGhostKind(k),
  onName: (n) => onNameChosen(n),
  onRefresh: () => refreshBoard(),
  onWatch: (e) => watchEntry(e),
  onCustomise: () => openLook(),
  onLinkDevice: () => openClaim('mine'),
  // This panel is the board for the level you are riding. Everybody else's, on
  // everything else, is the browser in the chooser — which already owns the
  // level list and so is the one place that list lives.
  onBrowseAll: () => openChooser('times'),
});

// --- being the same player on two devices ------------------------------------
//
// Identity lives in ONE browser's localStorage, which was fine until touch
// controls shipped: picking up the phone made you a different person, with no
// times and — now that a bike can be chosen — not even the same bike.
//
// This solves cross-device identity and NOTHING ELSE. It is not authentication
// and the README's note stands unchanged: re-simulation proves a time is real;
// nothing proves whose it is. See src/shared/claim.ts for why a bare playerId is
// an honest thing to put in a QR code.
let claimMode: 'mine' | 'adopt' = 'mine';
let claimOffered: string | null = null;
let claimOfferedName: string | null = null;
let claimStatus = '';
let claimStatusKind: 'ok' | 'warn' | 'bad' | '' = '';
let pausedBeforeClaim = false;

const claimUi = createClaimUi(claimRoot, {
  onAdopt: (id) => {
    if (id === identity.playerId) {
      claimStatus = 'that is already this device — nothing to do';
      claimStatusKind = 'ok';
      renderClaim();
      return;
    }
    const before = identity.playerId;
    const next = adoptPlayerId(id, identity);
    identity.playerId = next.playerId;
    // The NAME and the BIKE follow the id, because claiming means being that
    // person: posting under their id with your label would put your name on
    // their rows, which is the one outcome nobody wants.
    adoptRemoteIdentity(id);
    claimMode = 'mine';
    claimOffered = null;
    claimStatus = `this device is now ${claimCode(id)} — it was ${claimCode(before)}, and “go back” undoes this`;
    claimStatusKind = 'ok';
    clearClaimParam();
    onIdentityChanged();
    renderClaim();
  },
  onUndo: () => {
    const next = restorePreviousPlayerId(identity);
    if (next.playerId === identity.playerId) {
      claimStatus = 'there is no previous id on this device';
      claimStatusKind = 'warn';
      renderClaim();
      return;
    }
    identity.playerId = next.playerId;
    adoptRemoteIdentity(next.playerId);
    claimStatus = `back to ${claimCode(next.playerId)}`;
    claimStatusKind = 'ok';
    onIdentityChanged();
    renderClaim();
  },
  onRotate: () => {
    const before = identity.playerId;
    const next = rotatePlayerId(identity);
    identity.playerId = next.playerId;
    claimStatus =
      `this device is now ${claimCode(next.playerId)}. Times posted as ${claimCode(before)} stay on the board `
      + 'under that id — “go back” returns to it.';
    claimStatusKind = 'ok';
    onIdentityChanged();
    renderClaim();
  },
  onClose: () => closeClaim(),
});

/**
 * Pull the claimed player's NAME and BIKE down, so the device looks like them
 * rather than posting under their id wearing your label.
 *
 * Degrades silently and completely: the server may be down, the device gate may
 * have expired, the player may have no file yet because they have never posted.
 * In every one of those the claim still stands — the id is what matters — and
 * the label simply stays whatever it was until their next run refreshes it.
 */
function adoptRemoteIdentity(playerId: string): void {
  fetchPlayer(playerId).then((r) => {
    if (!r.ok || identity.playerId !== playerId) return;
    if (r.value.name) {
      identity.name = setName(r.value.name);
    }
    // Their bike too. Claiming means BEING that person, and a device that
    // posted under their id in somebody else's livery would put the wrong bike
    // on their rows the moment it finished a level.
    if (r.value.appearance) {
      applyAppearance(parseAppearance(r.value.appearance));
    }
    onIdentityChanged();
    renderClaim();
  });
}

/** Everything that has to move when this device becomes somebody else. */
function onIdentityChanged(): void {
  // A board is answered per player — `above`, `you` and `rank` are all computed
  // for whoever asked — so the one on screen is now about the wrong person.
  board = null;
  humanBoard = null;
  tasBoard = null;
  ghostReplayId = '';
  dropGhost('');
  myLookCache = null;
  syncBoardUi();
  refreshBoard();
}

/** Take `?claim=` off the address bar once it has been answered either way. */
function clearClaimParam(): void {
  const url = new URL(location.href);
  if (!url.searchParams.has(CLAIM_PARAM)) return;
  url.searchParams.delete(CLAIM_PARAM);
  history.replaceState(null, '', url);
}

function renderClaim(): void {
  claimUi.show({
    mode: claimMode,
    playerId: identity.playerId,
    name: identity.name,
    offered: claimOffered,
    offeredName: claimOfferedName,
    previous: previousPlayerId(),
    status: claimStatus,
    statusKind: claimStatusKind,
  });
}

function openClaim(mode: 'mine' | 'adopt'): void {
  claimMode = mode;
  if (!claimUi.visible) {
    closeResults();
    closeChooser();
    closeLook();
    pausedBeforeClaim = loop.paused;
    loop.paused = true;
    touch.setHidden(true);
  }
  renderClaim();
}

function closeClaim(): void {
  if (!claimUi.visible) return;
  claimUi.hide();
  claimStatus = '';
  claimStatusKind = '';
  claimOffered = null;
  claimOfferedName = null;
  clearClaimParam();
  loop.paused = pausedBeforeClaim;
  // Through the legend rather than straight at the pads: the control legend
  // hides them too, and a panel closing on top of an open legend must not put a
  // `gas` pad back under its close button.
  syncLegendPads(legend?.open ?? false);
}

/**
 * A claim link, answered on boot.
 *
 * ASKED, NEVER APPLIED SILENTLY. Adopting an id replaces who this device is,
 * and a URL doing that without a question is exactly the behaviour nobody
 * expects from a link — especially one that arrived by being scanned off
 * somebody else's screen.
 *
 * A FUNCTION, CALLED FROM THE BOOT SECTION AT THE BOTTOM, AND IT USED TO BE AN
 * IIFE RIGHT HERE. That crashed the entire bundle on exactly the URLs it exists
 * for: `openClaim` reads `loop` and `touch`, both of which are `const`s declared
 * two hundred lines further down, so running it at this point in the module hit
 * their temporal dead zone — `ReferenceError: Cannot access 'loop' before
 * initialization`, thrown out of the module's top level, so `window.velo` never
 * appeared and NOTHING loaded. Every ordinary load was fine because
 * `parseClaim` returns null and the function stops one line in; the one path
 * that reached the rest of it was a scanned QR code, which is the whole feature
 * and the phone half of it at that. Verified in Chrome against the built
 * bundle, not deduced.
 */
function offerClaimFromUrl(): void {
  const id = parseClaim(location.href);
  if (!id) return;
  if (id === identity.playerId) {
    clearClaimParam();
    return;
  }
  claimOffered = id;
  claimOfferedName = null;
  fetchPlayer(id).then((r) => {
    if (r.ok && claimOffered === id) {
      claimOfferedName = r.value.name;
      renderClaim();
    }
  });
  openClaim('adopt');
}

// --- the customiser ---------------------------------------------------------
//
// Six bikes, ten liveries, and what the rider is wearing. NONE OF IT TOUCHES
// THE PHYSICS: same spec, same colliders, same head, one specHash — asserted in
// bikeart.test.ts rather than promised, because a cosmetic that could refuse a
// time would be the third time this user has been told their bike is not the
// shipped one.
//
// IT IS ALSO THE PROFILE SCREEN, and that is the whole first-run design — see
// the header of lookui.ts, which carries the argument. A form before the first
// ride is the worst thing to put in front of somebody who has just clicked a
// link; "build your rider" is a toy with the name as one field inside it, and
// one tap gets out of it. It is offered ONCE on a first load and asked ONCE
// more on a first finish, because that is when there is a time to put a name on.
//
// IT HOLDS THE SIM rather than pausing the loop, and the change is deliberate.
// `loop.paused = true` stops the frame loop, which stops the RENDERER too — the
// game behind the panel becomes a still, which is fine for a menu you opened
// mid-run and wrong for the first thing a player ever sees: the level should be
// alive behind the toy. `hold` gives the stronger guarantee anyway (no tick, no
// recorded frame, no ghost step — a run held for a minute banks a byte-identical
// replay) and it gives it through the one register every other screen answers.
// See hold.ts, hold.test.ts and the profile block in bin/smoke.
let lookMode: LookMode = 'plain';
/**
 * The legend's state before an intro took the screen, so it can be put back.
 *
 * On a first run BOTH of these want the middle of a phone's glass — the legend
 * because a phone has no keyboard to fumble the flip out of, this because it is
 * the welcome — and two modals stacked on each other is not a welcome. So the
 * profile goes first (who are you), the legend follows when it closes (how do
 * you ride), and neither has to know about the other beyond this one flag.
 */
let legendBeforeIntro = false;

const lookUi = createLookUi(lookRoot, {
  onPick: (key: AppearanceKey, id: string) => {
    applyAppearance({ ...identity.appearance, [key]: id });
    // A picture previews itself; a noise does not. The customiser PAUSES the
    // sim, so choosing an engine would otherwise change an idle you have to
    // take on faith — and the whole character of these four is in how they
    // behave when they are revved, which a stationary bike never does.
    if (key === 'engine') audio.blip();
    renderLook();
    syncBoardUi();
    if (results) syncResults();
  },
  onRandom: () => {
    // Somebody else's bike, borrowed. `appearanceFor` is the same derivation
    // that gives a player who has never chosen a livery of their own, so the
    // die roll produces a bike that already exists on somebody's board row
    // rather than a nineteenth thing.
    applyAppearance(appearanceFor(`${identity.playerId}:${Date.now()}`));
    audio.blip();
    renderLook();
    syncBoardUi();
  },
  onReset: () => {
    applyAppearance(DEFAULT_APPEARANCE);
    audio.blip();
    renderLook();
    syncBoardUi();
  },
  // The name, typed into the toy rather than into a form in front of it. It
  // goes through the SAME function the leaderboard panel's field goes through,
  // which is what makes a run banked for want of a name post the moment one
  // exists — from either screen, with one copy of that rule.
  onName: (raw: string) => {
    onNameChosen(raw);
    renderLook();
  },
  // "just ride", "not now", and the ✕. One tap, asks nothing, and never
  // discards anything: whatever was picked is already stored.
  onSkip: () => closeLook(),
  onLinkDevice: () => openClaim('mine'),
  // THE SAME MUTE THE `M` KEY CALLS, and there is deliberately only one — the
  // flag, the toast and the panel checkbox all move together because they all
  // move through here. It is on the customiser rather than on a pad because a
  // phone had NO mute at all (setMuted had two callers and both were the
  // keyboard), the drawer has one slot left and this is not what it is for, and
  // this panel already owns the engine axis: somebody deciding what their bike
  // sounds like is exactly the person who wants to know how to turn it off.
  onMute: (on: boolean) => {
    setMuted(on);
    renderLook();
  },
  onClose: () => closeLook(),
});

/**
 * Where the player stands, for the row the profile screen shows them.
 *
 * REAL NUMBERS OR NONE, and this is the function that keeps that true. The
 * time is the run that just finished when there is one on screen, and this
 * browser's local best otherwise; the rank comes off the human board when one
 * has been fetched. Every one of them is nullable and the panel prints a dash,
 * because the whole point of that row is that it is a picture of the real
 * board — an invented rank would make the one honest thing on the screen a lie.
 */
function lookStanding(): { rank: number | null; total: number; timeTicks: number | null } {
  const mine = humanBoard?.you ?? null;
  return {
    rank: humanBoard?.rank ?? null,
    total: humanBoard?.total ?? 0,
    timeTicks: results?.replay.timeTicks ?? mine?.timeTicks ?? bests[level.simHash] ?? null,
  };
}

function renderLook(): void {
  lookUi.show({
    appearance: identity.appearance,
    palette: levelP(),
    playerId: identity.playerId,
    levelName: level.name,
    mode: lookMode,
    name: identity.name,
    standing: lookStanding(),
    touch: touch.enabled,
    muted: audio.muted,
  });
}

/**
 * Open the customiser, in whichever of its three jobs it is doing.
 *
 * `finish` DOES NOT CLOSE THE RESULTS SCREEN, and that is the one difference
 * between the modes here: the results panel is the thing underneath, the time is
 * the reason this is being asked at all, and shutting the panel that shows that
 * time to ask about it would be absurd. Closing this reveals it again.
 */
function openLook(mode: LookMode = 'plain'): void {
  if (lookUi.visible) {
    // Already up — an intro or a finish re-ask must not downgrade it to plain.
    if (mode !== 'plain') {
      lookMode = mode;
      renderLook();
    }
    return;
  }
  lookMode = mode;
  if (mode !== 'finish') closeResults();
  closeChooser();
  // ONLY ON TOUCH, because only on touch is the legend a MODAL. On a desktop it
  // is a card in the bottom-left corner that nothing is fighting for; on a
  // phone it is the middle of the glass, which is where this is too, and two
  // modals stacked on a first run is not a welcome. Closing something that was
  // not in the way would be a flicker for nothing.
  if (mode === 'intro' && touch.enabled) {
    legendBeforeIntro = legend?.open ?? false;
    setLegendOpen(false);
  }
  touch.setHidden(true);
  renderLook();
}

function closeLook(): void {
  if (!lookUi.visible) return;
  const wasIntro = lookMode === 'intro';
  lookUi.hide();
  lookMode = 'plain';
  // THE LEGEND GETS THE SCREEN BACK. On a first run it was open — a phone has
  // no keyboard to discover the flip on — and the intro borrowed the middle of
  // the glass from it. Handing it back here is what makes the first minute
  // read as one sequence rather than as two panels fighting.
  if (wasIntro && legendBeforeIntro) {
    legendBeforeIntro = false;
    setLegendOpen(true);
    return;
  }
  // Through the legend rather than straight at the pads: the control legend
  // hides them too, and a panel closing on top of an open legend must not put a
  // `gas` pad back under its close button.
  syncLegendPads(legend?.open ?? false);
}

/**
 * THE PROFILE SCREEN HOLDS THE SIM, through the same register the overview, the
 * armed line and the about page answer.
 *
 * It is registered here, next to the thing it is about, and read LATE — the
 * predicate is the panel's own visibility, so there is no second flag that could
 * disagree with whether the panel is up. A run held while somebody picks a
 * helmet banks a byte-identical replay to one never held at all: no tick, no
 * frame in the input stream, no ghost step. hold.test.ts asserts the register
 * and the replay identity; bin/smoke asserts that THIS panel, opened by the
 * real pad in the real bundle, actually lands in it.
 */
hold.add('profile', () => lookUi.visible);

// --- the first-run offer -----------------------------------------------------
//
// OFFERED, NEVER IMPOSED, AND EXACTLY ONCE. The flag is written when it is
// SHOWN rather than when it is answered, because "answered" would mean asking
// again on every reload until somebody filled the form in — which is the
// tollbooth this design exists to avoid, wearing a delay.
//
// The test for a first-timer is deliberately BOTH halves: no name AND no chosen
// look. Somebody who has picked a bike but no name has already met this screen,
// and somebody with a name has certainly met it.
const PROFILE_OFFERED = 'profileOffered';
/** Asked once more on a first finish, when there is a time to attach. */
const PROFILE_ASKED_AT_FINISH = 'profileAskedAtFinish';

function offerProfileOnFirstRun(): void {
  if (loadFlag(PROFILE_OFFERED, false)) return;
  saveFlag(PROFILE_OFFERED, true);
  if (hasName(identity) || identity.chosenLook) return;
  // Not over a claim link: somebody arriving by QR is answering a different
  // question about who they are, and two identity panels at once is neither.
  if (claimUi.visible) return;
  openLook('intro');
}

// The end-of-level screen. Every row it draws comes off the HUMAN board, and
// every action it offers goes through the same functions the keys do.
const resultsUi = createResultsUi(resultsRoot, {
  onAction: (id) => resultsAction(id),
  onWatchRow: (replayId) => {
    const e = humanBoard?.top.find((x) => x.replayId === replayId)
      ?? (humanBoard?.you?.replayId === replayId ? humanBoard.you : null);
    closeResults();
    if (e) watchEntry(e);
  },
});
// Sync the URL on boot as well as on every change, so that the address bar is a
// shareable link to what is on screen even when the level came from the stored
// preference rather than from the URL.
(function syncUrl(): void {
  const url = new URL(location.href);
  if (url.searchParams.get('level') === entry.id) return;
  url.searchParams.set('level', entry.id);
  history.replaceState(null, '', url);
})();

// On by default under `bin/dev` and off by default in a build, because that is
// where each is wanted: a dev server is somebody tuning, a built page is
// somebody playing. Either way the toggle is remembered once touched.
const liveTuneDefault = loadFlag('livetune', import.meta.env.DEV);

const panel = createPanel(panelRoot, localSpec, () => spec, cam.params, overview.params, artParams, audioParams, liveTuneDefault, {
  onSpecChange: () => onPanelEdit(),
  onCameraChange: () => {
    // Nothing to rebuild: the camera reads its params every frame. It is here
    // so that adding a camera parameter that DOES need work has a place to go.
  },
  onArtChange: () => {
    // Read every frame like the camera's, with one exception: `faceAngle`
    // decides which edges are floors and therefore what the bake contains.
    // ensureBake() compares a signature, so moving it rebuilds on the next
    // frame and moving anything else does not.
  },
  onAudioChange: () => {
    // Read every frame like the camera's and the art's, with one exception:
    // mute is a piece of browser lifecycle as well as a number, because a muted
    // game SUSPENDS the context rather than turning a gain down. So the slider
    // is routed through the same path the M key uses.
    const want = audioParams.muted > 0;
    if (want !== audio.muted) {
      audio.setMuted(want);
      saveFlag('mute', want);
    }
  },
  onOverviewChange: () => {
    // Likewise read every frame. Changing `introHold` does not retroactively
    // lengthen an intro already running, which is the behaviour you want while
    // dragging the slider to find a number.
  },
  onLiveTune: (on) => {
    saveFlag('livetune', on);
    liveTune.setEnabled(on);
    replayNote = on
      ? 'live tune ON — following data/spec.json, change it with bin/spec'
      : 'live tune OFF — the bike is yours again';
    toast(replayNote);
  },
  onPreset: (s, label) => {
    const p = PRESETS.find((x) => x.label === label);
    presetId = p?.id ?? presetId;
    presetLabel = label;
    setLocalSpec(cloneSpec(s), { persist: false, carry: false });
    restart(false);
  },
  onResetSpec: () => {
    const p = PRESETS.find((x) => x.id === presetId) ?? BOOT_PRESET;
    setLocalSpec(cloneSpec(p.spec), { persist: false, carry: false });
    restart(false);
    // Deliberately does NOT clear the remote override: that is somebody else's
    // and it is not this button's to throw away. The banner says how.
    replayNote = liveTune.heldPaths.size
      ? `reset to "${p.label}" as shipped — live tune still holds ${liveTune.heldPaths.size} field(s); bin/spec reset clears those`
      : `reset to "${p.label}" as shipped`;
  },
  onRestart: () => restart(false),
  onReplay: () => startPlayback(),
  onExport: () => exportReplay(),
  onImport: () => importReplay(),
});
panel.setTuned(specIsTuned);

// --- touch controls ----------------------------------------------------------
//
// LARGE ZONES, NEVER JOYSTICKS. The argument is at the top of touch.ts and it
// comes down to one fact: the sim takes a BITMASK, so a stick is a four-way pad
// wearing a costume and promising a partial throttle the physics does not have.
//
// Everything below is wiring. The pads produce sim bits, those bits go into
// `input.mask()` through `addSource` — the same function the fixed-step loop
// samples at 128 Hz for the keyboard — and nothing downstream of that can tell
// the difference. A phone run records the same stream and verifies the same way,
// which `touch.test.ts` asserts by pushing a thumb-shaped stream through the
// real verifier.

/**
 * What the camera does when there are hands on the screen.
 *
 * ONE NUMBER NOW, AND IT IS A CAP RATHER THAN A VALUE.
 *
 * `screenBiasY` — in landscape, hands cover the bottom corners, which is exactly
 * where a centred camera puts a grounded bike. The one thing the readability
 * rule says must always be legible would be under a thumb. Pushing the bike up
 * the frame moves it into the clear, and the ground it is about to hit comes
 * with it.
 *
 * IT USED TO BE A FLAT 0.17 AND THAT WAS WRONG ON A REAL PHONE. 0.17 of the
 * half-frame was chosen against an idealised 844 x 390 viewport; Chrome's URL
 * bar and Android's system bars make the real one about 915 x 348, and on a
 * frame that short the same fraction was pushing a grounded bike up UNDER the
 * in-canvas level card — the exact thing the offset exists to keep it out from
 * under. So the VALUE is derived per frame by `screenBiasFor` from the two
 * things actually covering the glass (the 52 px HUD band at the top and the
 * measured thumb pads at the bottom), and this is only the ceiling on it: 0.30
 * of the half-frame, which on any viewport still leaves the safe box's worst
 * case inside the picture.
 *
 * THE ZOOM IS NOT ONE OF THEM ANY MORE, and that was my mistake rather than the
 * previous agent's. There used to be a `zoomBias: 1.25` here, reasoned from "the
 * bike is only 6.6% of the screen width, so a phone wants to be closer". The
 * measurement says the opposite: at 62 px/m a 1600 px desktop sees 25.8 m of
 * level and an 844 px phone sees 13.6 m, and zooming IN took that to 10.9 m.
 * The bike being small was never the problem — the phone was being shown less
 * than half the world, and the fix is that the zoom is now derived from the
 * viewport for everybody (see `baseZoomFor`). The happy part is that deriving
 * it makes the bike bigger on a phone anyway, as a consequence rather than as
 * an aim: ~45 px/m at 844 px is 9.1% of the width against the desktop's 6.6%.
 */
const TOUCH_CAMERA = { screenBiasY: 0.30 };

// Remembered, and OFF by default: the plan's own framing is that some people
// will strongly prefer each, which makes it an option rather than a default.
const autoThrottleDefault = loadFlag('autothrottle', false);
// REMEMBERED PER DEVICE, like every other preference here. Screens differ and
// people differ, so the derived base zoom is a good default rather than an
// answer — and somebody who found their zoom on a phone should not have to find
// it again on every load. Clamped against this viewport's range on the way in:
// a value stored on a tablet must not be able to put a phone below the
// readability floor.
const storedZoom = loadNum('zoomBias', 1);
const touch = createTouch(
  touchRoot,
  {
    // There is no R key on a phone and this is a die-and-retry game, so the
    // restart has to be on the glass. Top-centre, away from both thumbs: a
    // restart you can brush by accident is worse than no restart at all.
    onRestart: () => restart(false),
    onAutoThrottle: (on) => {
      saveFlag('autothrottle', on);
      touch.setAutoThrottle(on);
      toast(
        on
          ? 'gas is held for you — lean, flip, and brake to stop. Tap to start.'
          : 'gas is yours again — the big pad in the bottom-right corner',
        'controls',
      );
    },
    // The pinch, and the zoom pad's reset. The gesture asks; the camera decides,
    // because what is a legal zoom depends on the viewport and on the
    // readability floor. What it decided is what the pad prints.
    onZoom: (bias) => applyZoom(bias),
    // The desktop level bar is HIDDEN on touch — it was being drawn straight
    // through the in-canvas level card, clock and apple counter, two HUDs
    // stacked on each other — so the chooser is how a phone changes level, and
    // this pad is the only way to it.
    onBrowse: () => openChooser('levels'),
    // THE LEADERBOARD, ON A PHONE, AT LAST. The board panel is `display: none`
    // on touch and always has been, so until this pad the only leaderboard a
    // phone ever saw was the handful of rows the results screen prints at the
    // end of a run. It opens the same screen `levels` does, on its other view —
    // one surface, two doors, because two browse screens listing the same
    // twenty-four levels would be the worse outcome.
    onTimes: () => openChooser('times'),
    // THE PHONE'S TAB KEY, and the reason it needed one: overview is the only
    // answer this game has to "where am I and where do I go", route planning is
    // its depth, and it was bound to a key no phone has. The pad asks; this is
    // the same `overview.hold` TAB drives, so there is exactly one freeze.
    onOverview: (on) => holdOverview(on),
    // The `controls` pad in the command drawer. A phone needs the legend more
    // than a desktop does — flip is the whole double-back design and there is no
    // keyboard to find it by accident — and this is the only way back to it once
    // it has been closed, because a permanent chip on a phone is a chip in a
    // thumb's way.
    onHelp: () => setLegendOpen(!(legend?.open ?? false)),
    // THE `your bike` PAD, AND IT IS THE ONLY WAY TO THE CUSTOMISER ON A PHONE.
    // It was bound to `Y` and to a button on the leaderboard panel, and
    // `body.touch #board` is `display: none` — so until this pad existed, a
    // phone could not repaint the bike, change the helmet, pick one of the four
    // engines, or type a name. The screen it opens is the profile screen too,
    // which is why the gap mattered twice over.
    onLook: () => openLook(),
    onNote: (msg) => toast(msg, 'controls'),
    // Persisted when the fingers come off and not before: a pinch fires this
    // path on every pointermove, and writing localStorage sixty times a second
    // for a value nobody has finished choosing is not a preference, it is a
    // syscall in the frame budget.
    onZoomEnd: () => saveNum('zoomBias', cam.zoomBias),
  },
  {
    enabled: wantsTouch(location.search, (q) => window.matchMedia(q).matches),
    autoThrottle: autoThrottleDefault,
    zoom: storedZoom,
    // The play area IS the canvas. A pinch finger has to have landed on it, so
    // a two-finger gesture on the results screen, the level chooser or the
    // level bar stays theirs.
    surface: canvas,
  },
);

/**
 * One way in for every manual zoom — the keys, the pinch and the reset pad.
 *
 * The bias is clamped against the zoom range ON THIS VIEWPORT rather than to a
 * fixed 0.35..3, so the gesture stops exactly where the picture does instead of
 * banking travel it has to give back. Returns what was applied.
 */
function applyZoom(bias: number): number {
  const applied = cam.setZoomBias(bias);
  touch.setZoom(applied);
  return applied;
}
applyZoom(storedZoom);

// FIRST RUN ON A PHONE OPENS THE LEGEND, AND THE PADS HAVE TO GO WITH IT. The
// flag defaults to open, so a phone that has never been told about flip gets
// told; the card's close button then sits where a thumb cluster is, which is
// why the pads are hidden underneath it rather than left live. Closing it is
// remembered, and the `controls` pad in the drawer is the way back.
syncLegendPads(legend?.open ?? false);
// AND THE FIRST-RUN OFFER GOES AFTER IT, because on a first run BOTH of these
// want the middle of a phone's glass and only one of them may have it. The
// profile takes it first and hands it to the legend on the way out — who you
// are, then how you ride — and `openLook('intro')` is the thing that borrows
// it, so the ordering lives in one place rather than in two panels' defaults.
// It is down here rather than beside the customiser because it needs `touch`,
// which is created in this section.
// ONE mask, assembled in one place. See `Input.addSource`.
input.addSource(() => touch.mask());
if (touch.enabled) {
  cam.params.screenBiasY = TOUCH_CAMERA.screenBiasY;
  panel.sync();
}

// Live tune. Created after the panel, because a poll that lands before the
// panel exists has nothing to grey out. The first poll fires immediately, so a
// spec file that is already in place is in force before the first frame the
// player sees rather than two seconds into their first run.
const liveTune = createLiveTune(() => localSpec, {
  onChange: (override, held, dropped) => applyRemote(override, held, dropped),
  onError: (msg) => {
    liveTuneError = msg;
  },
}, liveTuneDefault);

onReplayDropped(
  window,
  (r) => loadReplay(r.file, r.name),
  (msg) => {
    replayNote = `could not read that file: ${msg}`;
  },
);

const loop = createLoop({ step, draw });

/**
 * THE LEVEL EDITOR. Q in, Q out, and the level you are standing in is the level
 * you are drawing.
 *
 * It is wired here rather than owning its own boot because everything it needs
 * already exists at this point and none of it is worth duplicating: the camera
 * it opens on, the spec its ruler is measured from, the loop it freezes, the
 * toast it talks through, and `setLevel`, which is the one and only way a level
 * gets loaded in this program.
 *
 * `upsertLevel` rather than `adoptLevel`: a draft is edited and ridden over and
 * over, and appending a level entry per ride would grow the level bar by a row
 * a minute.
 */
const editor = createEditor({
  canvas,
  panelRoot: editorRoot,
  // `urlWanted` and not `entry.id`: the question is what the ADDRESS asked for,
  // and `entry` has already fallen back to something playable by now.
  urlLevel: urlWanted,
  spec: () => spec,
  source: () => ({
    raw: entry.raw,
    id: entry.id,
    name: level.name,
    simHash: level.simHash,
    tier: level.tier ?? null,
  }),
  playView: () => ({ x: cam.x, y: cam.y, zoom: cam.zoom }),
  onRide: (raw, id, name) => {
    try {
      setLevel(upsertLevel(raw, id, name), '', false);
    } catch (e) {
      toast(`that level does not load: ${e instanceof Error ? e.message : String(e)}`, 'editor');
    }
  },
  onWatchReplay: (file) => loadReplay(file, 'the solver'),
  onToast: (message, label) => toast(message, label),
  setEditing: (editing) => setEditing(editing),
  onPreview: (raw) => previewLevel(raw),
});

/**
 * Everything the GAME does differently while a level is being edited.
 *
 * Four things, and each one is a thing that would otherwise be actively wrong
 * rather than merely untidy:
 *
 *   the sim freezes            nothing is being ridden, and a clock running
 *                              under an editor is a recording of nothing.
 *   the in-canvas HUD goes     the level card, the clock and the apple counter
 *                              are the game saying where you are. There is no
 *                              run, and the card would name the level you
 *                              forked rather than the one on screen.
 *   the derived look is pinned  the palette, the panel variant and the prop
 *                              seeds are all derived from `simHash`, which
 *                              MOVES ON EVERY EDIT. Left alone, a level
 *                              re-rolls its entire appearance every time a
 *                              vertex is dragged, which is both distracting and
 *                              a lie about what the level will look like.
 *                              `derive = 0` is the base palette and it is
 *                              stable; the real look comes back on the way out.
 *   the props go               a prop can be dragged into a corridor and read
 *                              as terrain — the art's own rule — and while you
 *                              are drawing the corridor that is exactly the
 *                              confusion you cannot afford.
 */
let artBeforeEdit: { hud: number; derive: number; props: number } | null = null;
function setEditing(editing: boolean): void {
  loop.paused = editing;
  if (editing) {
    if (!artBeforeEdit) artBeforeEdit = { hud: artParams.hud, derive: artParams.derive, props: artParams.props };
    artParams.hud = 0;
    artParams.derive = 0;
    artParams.props = 0;
  } else if (artBeforeEdit) {
    artParams.hud = artBeforeEdit.hud;
    artParams.derive = artBeforeEdit.derive;
    artParams.props = artBeforeEdit.props;
    artBeforeEdit = null;
  }
  dropLooks();
  baked = null;
  panel.sync();
}

/**
 * Swap the level the renderer is drawing, without touching anything that
 * belongs to a RUN.
 *
 * `setLevel` is the real thing and does much more — it restarts, snaps the
 * camera, banks the attempt, fetches a leaderboard and re-frames the level.
 * Every one of those is wrong here: the editor owns the camera, there is no
 * attempt, and this happens several times a second while somebody drags a
 * vertex. So this is the narrow version, and `close()` on the editor still goes
 * through `setLevel` when the document becomes the level you ride.
 *
 * It only ever runs on a document the editor has already compiled, so the
 * try/catch is for the impossible case rather than the expected one.
 */
function previewLevel(raw: unknown): void {
  try {
    level = parseLevel(raw);
  } catch {
    return;
  }
  baked = null;
  sim = createSim(level, spec);
  prevState = sim.snapshot();
}

input.onCommand((code) => {
  // Any key at all ends the opening peek.
  if (code !== 'Tab') overview.skipIntro();
  // THE RESULTS SCREEN GETS FIRST REFUSAL, and only while it is up.
  //
  // It owns a small set of keys and prints every one of them on itself, which is
  // what makes the mode honest: G is "watch the ghost" here and the collision
  // debug view everywhere else, L is "level select" here and "load a replay"
  // everywhere else. R is the exception that is not an exception — it is routed
  // straight at `restart(false)`, so it behaves exactly as R does in play, which
  // is the one binding this game cannot afford to make special.
  if (resultsModel && resultsUi.visible) {
    const act = actionForKey(code, resultsModel.actions);
    if (act !== null) {
      resultsAction(act);
      return;
    }
  }
  // The chooser swallows its own keys on its own element (see chooserui.ts).
  // This is the one that has to work even when focus has wandered off it —
  // Escape closing a menu is not allowed to depend on where the focus went.
  if (chooserUi.visible && code === 'Escape') {
    closeChooser();
    return;
  }
  // Same argument for the customiser: Escape closing a menu must not depend on
  // where the focus went.
  if (lookUi.visible && code === 'Escape') {
    closeLook();
    return;
  }
  if (claimUi.visible && code === 'Escape') {
    closeClaim();
    return;
  }
  switch (code) {
    case 'Tab':
      // HOLD to see the whole level. The sim is frozen while it is down, so
      // this cannot advance the clock or add a frame to the recording.
      holdOverview(true);
      break;
    case 'KeyR':
      restart(false);
      break;
    case 'KeyT':
      startPlayback();
      break;
    case 'KeyF':
      // F, not A: KeyA is LEAN LEFT under WASD, and input.ts returns on a
      // sim-bound key before any command dispatch runs — so the montage key was
      // dead from the keyboard on both this path and the results panel, while
      // the legend and the results screen both advertised it. Found by the
      // agent that built the chooser, not by a test, because nothing asserts
      // that an advertised key is reachable.
      //
      // The same montage the results screen offers, reachable after it has been
      // dismissed. A is unbound everywhere else, so this is not a mode: it does
      // the same thing whether the panel is up or not.
      startMontage();
      break;
    case 'KeyE':
      exportReplay();
      break;
    case 'KeyL':
      importReplay();
      break;
    case 'KeyG':
      debug = !debug;
      break;
    case 'KeyV':
      // A/B the art against the old flat renderer, on the same frame.
      artParams.enabled = artParams.enabled > 0 ? 0 : 1;
      panel.sync();
      break;
    case 'KeyH':
      panel.toggle();
      break;
    case 'KeyC':
      // Pictures of every level, with their measured difficulty and your best
      // time on each. A toggle, like every other panel in this game.
      if (chooserUi.visible) closeChooser();
      else openChooser();
      break;
    case 'Backquote':
      // The debug readout. Backquote because it is the universal key for a
      // developer overlay and because every letter that means anything here is
      // already a binding — and because this is the key you want to be able to
      // hit without thinking when somebody walks past and you want the screen
      // to be the game.
      setHudVisible(!hudVisible);
      break;
    case 'KeyM':
      setMuted(audio.toggleMuted());
      break;
    case 'KeyY':
      // Your bike: six silhouettes, ten liveries, and what the rider wears. A
      // toggle, like every other panel in this game.
      if (lookUi.visible) closeLook();
      else openLook();
      break;
    case 'KeyB':
      boardVisible = !boardVisible;
      saveFlag('board', boardVisible);
      syncBoardUi();
      if (boardVisible) refreshBoard();
      break;
    case 'KeyP':
      loop.paused = !loop.paused;
      break;
    case 'Slash':
      // `?` — the control legend. It is a toggle like every other panel here,
      // and it is the ONE key that has to be guessable without having read the
      // legend, because it is the key that opens the legend.
      setLegendOpen(!(legend?.open ?? false));
      break;
    case 'KeyQ':
      // EDIT AND RIDE. Q freezes the sim and hands you the handles; Q again
      // compiles what you drew and loads it. The editor takes the keyboard in
      // the capture phase while it is open, so this case only ever runs on the
      // way IN — the way out is the editor's own handler, which is what lets it
      // use A, S, D and the arrows without fighting the driving keys.
      editor.toggle();
      break;
    case 'BracketLeft':
      stepLevel(-1);
      break;
    case 'BracketRight':
      stepLevel(1);
      break;
    case 'Equal':
    case 'NumpadAdd':
      // A bias on top of the auto zoom rather than a zoom value, so the
      // speed-driven zoom keeps working around whatever you chose. The same
      // variable the pinch drives — one concept, two ways to say it.
      saveNum('zoomBias', applyZoom(cam.zoomBias * 1.15));
      break;
    case 'Minus':
    case 'NumpadSubtract':
      saveNum('zoomBias', applyZoom(cam.zoomBias / 1.15));
      break;
    case 'Digit0':
    case 'Numpad0':
      // The way back. A zoom that went wrong is annoying to undo by feel, and
      // it is remembered, so without this it is wrong on the next load too.
      saveNum('zoomBias', applyZoom(1));
      break;
    default:
      break;
  }
});

input.onCommandUp((code) => {
  if (code === 'Tab') holdOverview(false);
});

// Clicking anywhere also ends the opening peek — "skippable by any input" has
// to mean any input, or the one person who reaches for the mouse sits through it.
window.addEventListener('pointerdown', () => {
  overview.skipIntro();
  // TAP TO START. Auto-throttle withholds the gas until the first touch since
  // the last restart, so that a level does not begin with the bike already
  // driving off the line before anybody has looked at it. The gesture that
  // means "I am ready" is the one that already skipped the opening peek.
  touch.arm();
});

// Honour the remembered readout state before the first frame, so a player who
// turned it off does not get one frame of telemetry on every reload.
hud.classList.toggle('compact', !hudVisible);

// --- who is this, asked exactly once, at the last possible moment -----------
//
// A SCANNED QR FIRST, AND THE FIRST-RUN OFFER SECOND. Both are about who this
// device is, both want the screen, and they ask opposite questions — "are you
// this existing player?" and "who would you like to be?" — so the order between
// them is the whole of the interaction: a claim link is answered, and
// `offerProfileOnFirstRun` stands down while one is on screen.
//
// AND THEY ARE DOWN HERE, BELOW EVERY `const` THEY TOUCH, WHICH IS THE POINT.
// The claim offer used to be an IIFE beside its own definition, and it crashed
// the entire bundle on exactly the URLs it exists for: `openClaim` reads `loop`
// and `touch`, both declared further down the module, so running it up there hit
// their temporal dead zone and threw out of the module's top level — no
// `window.velo`, no game, nothing on screen. Every ordinary load was fine,
// because `parseClaim` returns null and the function stops one line in; the only
// path that reached the rest of it was a scanned QR code, which is the whole
// feature and the phone half of it at that. Verified in Chrome against the
// built bundle rather than deduced, and it is the reason both of these are
// called from the boot section instead of from where they are written.
offerClaimFromUrl();
offerProfileOnFirstRun();

loop.start();
syncBoardUi();
refreshBoard();

/**
 * What the board browser has on screen, read off the DOM.
 *
 * For bin/smoke and bin/shots. It counts elements rather than trusting the
 * model for the same reason the leaderboard assertions do: an escaper proves
 * nothing about a sink that forgot to call it, and `injected` is the count that
 * goes to zero only while every string on this screen is `textContent`. The
 * avatars are `<img>` the panel drew itself as data: URLs, so they are excluded
 * by their scheme rather than by their tag.
 */
function browseState(): Record<string, unknown> {
  const rows = [...chooserRoot.querySelectorAll('.ch-bdrow')];
  return {
    visible: chooserUi.visible,
    view: chooserUi.view,
    levelId: browseId,
    at: chooserRoot.querySelector('.ch-at')?.textContent ?? '',
    level: chooserRoot.querySelector('.ch-lvname')?.textContent ?? '',
    rows: rows.filter((r) => !r.classList.contains('par')).length,
    par: rows.filter((r) => r.classList.contains('par')).length,
    parText: chooserRoot.querySelector('.ch-bdrow.par .ch-bdtime')?.textContent ?? '',
    avatars: chooserRoot.querySelectorAll('.ch-bdrow img.avatar').length,
    watch: chooserRoot.querySelectorAll('.ch-bdwatch').length,
    gaps: chooserRoot.querySelectorAll('.ch-bdgap').length,
    ghost: chooserRoot.querySelectorAll('.ch-ghost select').length,
    text: chooserRoot.textContent ?? '',
    injected:
      [...chooserRoot.querySelectorAll('img')].filter((e) => !(e.getAttribute('src') ?? '').startsWith('data:')).length
      + chooserRoot.querySelectorAll('script, iframe, svg, object').length,
  };
}

// A handle for the headless smoke check in bin/smoke, and for poking at the sim
// from devtools while tuning. Not load-bearing.
interface VeloWindow extends Window {
  velo?: unknown;
}
(window as VeloWindow).velo = {
  get sim() {
    return sim;
  },
  get spec() {
    return spec;
  },
  get level() {
    return level;
  },
  get lastReplay() {
    return lastReplay;
  },
  specHash: () => specHash(spec),
  editor,
  liveTune,
  get cam() {
    return cam;
  },
  overview,
  /**
   * THE ARMED START LINE, for bin/smoke and for devtools. Exposed as the live
   * object rather than a boolean snapshot so a harness can watch it flip on the
   * frame the run starts — which is the property worth asserting.
   */
  armed,
  /**
   * WHAT IS HOLDING THE SIM, for bin/smoke and for devtools. `by` names them,
   * so a frozen game is a question with an answer rather than a bug report.
   */
  get hold() {
    return { held: hold.held, by: [...hold.by] };
  },
  /** The about page, for bin/smoke: it proves the hold through the real button. */
  get about() {
    return { open: legend?.about.open ?? false };
  },
  /** Frames in the CURRENT recording. bin/smoke uses it to prove the freeze. */
  get recordedFrames() {
    return recorder.frames;
  },
  get attempts() {
    return attempts.all;
  },
  /** What the montage is doing, for bin/smoke and for devtools. */
  get montage() {
    return montage
      ? {
          count: montage.riders.length,
          alpha: montage.alpha,
          label: montage.label,
          riding: montage.riders.filter((r) => !r.done).length,
        }
      : null;
  },
  startMontage,
  /**
   * The control legend, for `bin/shots`.
   *
   * It is a block of DRAWINGS now — the bike in the pose each control puts it
   * in — and "does that read at 46 px tall" is a question about an image, which
   * means the harness has to be able to open it, open the dev toolbar under it,
   * and shut it again. Through the same functions a click goes through.
   */
  legend: {
    get open() {
      return legend?.open ?? false;
    },
    setOpen: (on: boolean) => setLegendOpen(on),
  },

  // --- customisation and cross-device identity, for bin/smoke ---------------
  //
  // The unit tests cover what a livery RESOLVES to and what a claim URL
  // decodes to. What they cannot cover is the wiring: that the panels exist in
  // the built page, that a chosen bike reaches the renderer, and that the QR
  // actually gets drawn onto a canvas. Those are exactly the failures smoke
  // exists for — the ones where every unit test passes and the page is broken.
  get appearance() {
    return { ...identity.appearance, chosen: identity.chosenLook, playerId: identity.playerId };
  },
  setAppearance(key: string, id: string) {
    applyAppearance({ ...identity.appearance, [key]: id });
    if (lookUi.visible) renderLook();
    syncBoardUi();
    return { ...identity.appearance };
  },
  /**
   * The customiser, which is the profile screen — for bin/smoke and bin/shots.
   *
   * It takes the MODE so the harness can photograph and assert the first-run
   * state without having to clear localStorage and reload, and reports what is
   * actually in the document: the option chips, the axis rows, the preview
   * canvas, and the two things the profile half exists for — the name field and
   * the "this is what other people see" block.
   */
  openLook(mode?: string) {
    openLook(mode === 'intro' || mode === 'finish' ? mode : 'plain');
    return {
      visible: lookUi.visible,
      mode: lookMode,
      options: lookRoot.querySelectorAll('.lk-opt').length,
      rows: lookRoot.querySelectorAll('.lk-row').length,
      nameField: lookRoot.querySelectorAll('.lk-name-input').length,
      seen: lookRoot.querySelectorAll('.lk-seen').length,
      seenGhost: lookRoot.querySelectorAll('.lk-seen-ghost').length,
      skip: lookRoot.querySelectorAll('.lk-go-btn').length,
      name: identity.name,
      preview: (() => {
        const c = lookRoot.querySelector('canvas');
        return c ? { w: c.width, h: c.height } : null;
      })(),
    };
  },
  closeLook,
  /**
   * THE BOARD BROWSER, for bin/smoke and bin/shots.
   *
   * It reports what is actually in the document rather than what the model
   * said, because the failures this is here to catch are the ones where every
   * unit test passes and the screen is empty: the rows, the avatars the rows
   * drew, the par marker, and — the assertion that matters — how many elements
   * a hostile display name managed to create in it.
   */
  openBrowse(levelId?: string) {
    openChooser('times');
    if (typeof levelId === 'string' && LEVELS.some((l) => l.id === levelId)) {
      browseId = levelId;
      renderChooser();
    }
    return browseState();
  },
  /** Step the browser, the way the pads and the arrows do. */
  stepBrowse(delta: number) {
    stepBrowse(delta);
    return browseState();
  },
  get browse() {
    return chooserUi.visible && chooserUi.view === 'times' ? browseState() : null;
  },
  closeChooser,
  /** The display name, for bin/smoke: it is typed into the panel, not set here. */
  get playerName() {
    return identity.name;
  },
  openClaim() {
    openClaim('mine');
    const c = claimRoot.querySelector('canvas');
    return {
      visible: claimUi.visible,
      qr: c ? { w: c.width, h: c.height } : null,
      code: claimRoot.querySelector('.cl-code')?.textContent ?? '',
      playerId: identity.playerId,
    };
  },
  closeClaim,
  /**
   * Stand up a montage of `count` synthetic riders on this level, for
   * bin/montagebench.
   *
   * SYNTHETIC ON PURPOSE. The cost of a rider is the cost of its own sim
   * stepping and its own bike being drawn, and neither depends on where the
   * buttons came from — so generating a stream beats grinding forty real
   * attempts out of a headless browser to measure the same two numbers. It uses
   * a fixed seed so two runs of the bench measure the same work.
   *
   * It does NOT start a playback: the bench wants a stable frame to time, not
   * a run going past.
   */
  montageBench(count: number, frames = 2048) {
    // ONE STREAM PER RIDER, and the seed is the rider's index.
    //
    // They shared a stream at first, and that was wrong in a way a number would
    // never have shown: identical inputs are identical trajectories, so
    // twenty-four riders were twenty-four bikes in exactly the same place,
    // overdrawing the same pixels and — the half that mattered — making a
    // screenshot of the montage look like a montage of one. A real crowd is
    // spread out, culls differently and occludes differently.
    const streamFor = (seed: number): number[] => {
      const masks: number[] = [];
      let x = (0x5eed + seed * 7919) & 0x7fffffff;
      for (let i = 0; i < frames; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        // Held for eight frames at a time, like a hand on a keyboard rather
        // than a coin flipped at 128 Hz — which matters, because a bike being
        // driven travels and a bike twitching stays in one place and culls.
        masks.push(i % 8 === 0 ? x % 32 : masks[masks.length - 1]);
      }
      return masks;
    };
    const t0 = performance.now();
    const riders: Rider[] = [];
    for (let i = 0; i < count; i++) riders.push(createRider(level, spec, streamFor(i)));
    const buildMs = performance.now() - t0;
    montage = count > 0
      ? { riders, alpha: montageAlpha(count), label: `bench: ${count} synthetic riders` }
      : null;
    return { count, buildMs };
  },
  /** Time `frames` input frames of the montage stepping. Milliseconds, total. */
  montageStepBench(frames: number) {
    if (!montage) return 0;
    for (const r of montage.riders) r.reset();
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      for (const r of montage.riders) r.advance();
    }
    return performance.now() - t0;
  },
  // The leaderboard half, exposed for bin/smoke — which drives the real bundle
  // against a real server and is the only check that can see the board fetch,
  // the ghost fetch and the ghost's own sim all working through the built page.
  get board() {
    return board;
  },
  get ghost() {
    return ghost
      ? {
          name: ghost.meta.name,
          kind: ghost.meta.kind,
          rank: ghost.meta.rank,
          replayId: ghost.meta.replayId,
          frames: ghost.frames,
          at: ghost.at,
          done: ghost.done,
          x: ghost.x,
          y: ghost.y,
          timeTicks: ghost.timeTicks,
        }
      : null;
  },
  get ghostNote() {
    return ghostNote;
  },
  /** The end-of-level panel's model, or null while it is not up. */
  get results() {
    return resultsModel;
  },
  identity,
  refreshBoard,
  setGhostKind,
  levels: LEVELS,
  art: artParams,
  // The audio, for bin/smoke: it asserts the context initialises without
  // throwing, and that a MUTED run records a byte-identical replay to a loud
  // one. `scriptRun` is what makes the second of those answerable — see it.
  get audio() {
    return {
      state: audio.state,
      started: audio.started,
      muted: audio.muted,
      error: audio.error,
      lastMs: audio.lastMs,
      cues: audio.cueCount,
      engine: audio.engine,
      params: audioParams,
    };
  },
  setMuted,
  scriptRun,
  /** Exposed so bin/shots can stop the loop repainting over a captured frame. */
  loop,
  /**
   * Render ONE frame at an arbitrary camera, bypassing the loop.
   *
   * This is the instrument `bin/artbench` and `bin/shots` drive, and it exists
   * because the question the art has to answer is "what does a frame cost with
   * the camera MOVING" — which you cannot ask by screenshotting a stationary
   * bike, and cannot answer honestly by timing a loop that is also stepping the
   * sim and rewriting the HUD. It renders exactly what the frame renders, at a
   * camera position the caller chooses.
   */
  renderAt(
    x: number,
    y: number,
    zoom: number,
    o?: { art?: boolean; debug?: boolean; overview?: number; montage?: boolean },
  ) {
    const { cssW, cssH } = resize();
    const pose = interpolate(prevState, sim.state, 1);
    const view = { x, y, zoom };
    const opts = {
      debug: o?.debug ?? false,
      ghost: null,
      // The montage is part of what a frame costs, so it is part of what this
      // renders — bin/montagebench measures the real draw through this call and
      // an instrument that quietly left the crowd out would answer a question
      // nobody asked.
      // `montage: false` draws the same frame WITHOUT the crowd, which is how
      // bin/montagebench gets an honest delta on a loaded machine: it pairs the
      // two inside one loop rather than timing them in separate passes that a
      // load spike can land on unequally.
      ghosts: o?.montage === false ? null : montageDraws(1, view, cssW, cssH),
      overview: o?.overview ?? 0,
      markers: null,
    };
    const useArt = o?.art ?? artParams.enabled > 0;
    if (useArt) {
      renderArt(ctx, cssW, cssH, view, sim.world, sim.state, pose, spec,
        // The player's own livery, so `bin/shots SHOTS_BIKES=...` photographs
        // the bike that is actually selected rather than the shipped default.
        { ...opts, time: (performance.now() - bootTime) / 1000, look: myLook(), ghostLook },
        artParams, ensureBake());
    } else {
      render(ctx, cssW, cssH, view, sim.world, sim.state, pose, spec, opts);
    }
  },
  /**
   * Where in this level the ceiling comes closest to the floor.
   *
   * The framing bin/shots uses to check the one thing the art could genuinely
   * make WORSE rather than just uglier: a level whose lesson is head clearance
   * is unfair if the treatment on a ceiling edge hides where the ceiling is.
   */
  tightestGap() {
    let best = { x: level.start.x, y: level.start.y, gap: Infinity };
    for (const p of level.polys) {
      const n = p.vx.length;
      for (let i = 0; i < n; i++) {
        // Down-facing edge: a ceiling.
        if (p.ny[i] > -0.6) continue;
        const j = i + 1 === n ? 0 : i + 1;
        const cx = (p.vx[i] + p.vx[j]) / 2;
        const cy = (p.vy[i] + p.vy[j]) / 2;
        for (const q of level.polys) {
          const m = q.vx.length;
          for (let k = 0; k < m; k++) {
            if (q.ny[k] < 0.6) continue; // up-facing: a floor
            const l = k + 1 === m ? 0 : k + 1;
            const lo = Math.min(q.vx[k], q.vx[l]);
            const hi = Math.max(q.vx[k], q.vx[l]);
            if (cx < lo || cx > hi) continue;
            const t = hi - lo < 1e-9 ? 0 : (cx - lo) / (hi - lo);
            const fy = q.vx[k] <= q.vx[l]
              ? q.vy[k] + (q.vy[l] - q.vy[k]) * t
              : q.vy[l] + (q.vy[k] - q.vy[l]) * t;
            const gap = cy - fy;
            if (gap <= 0.2 || gap >= best.gap) continue;
            best = { x: cx, y: (cy + fy) / 2, gap };
          }
        }
      }
    }
    return best;
  },
  /** Throw the bake away, so the next frame pays the cold cost. */
  rebake() {
    baked = null;
    const t0 = performance.now();
    const b = ensureBake();
    return { ms: performance.now() - t0, stats: b.stats };
  },
  get baked() {
    return baked;
  },
  get bakeMs() {
    return bakeMs;
  },
  restart,
  startPlayback,
  exportReplay,
  // Run the fixed cross-engine harness in THIS engine. bin/smoke runs the same
  // thing under node and compares the hash chains; that comparison is the only
  // real proof that a server can re-simulate a browser's replay.
  crossCheck: (frames?: number) => crossCheck(level, spec, frames),
};
