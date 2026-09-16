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
import { checkReplayCompat, decodeInputs, replaySpec, ticksToSeconds } from '@/sim/replay.ts';
import type { Replay, ReplayFile } from '@/sim/replay.ts';
import { SIM_REV } from '@/sim/rev.ts';
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '@/sim/consts.ts';
import { createInput } from './input.ts';
import { createLoop } from './loop.ts';
import { interpolate, render } from './render.ts';
import type { Pose } from './render.ts';
import { createCamera, cloneCamera, DEFAULT_CAMERA } from './camera.ts';
import { cloneOverview, createOverview, DEFAULT_OVERVIEW, overviewFrame } from './overview.ts';
import { createPanel } from './panel.ts';
import { BOOT_PRESET, PRESETS } from './presets.ts';
import { createAttemptLog, createRecorder, verify } from './recorder.ts';
import { crossCheck } from '@/sim/crosscheck.ts';
import { LEVELS, adoptLevel, findBySimHash, resolveLevel } from './levels.ts';
import type { LevelEntry } from './levels.ts';
import { createLegend, createLevelBar } from './chrome.ts';
import { downloadReplay, onReplayDropped, pickReplay } from './replayio.ts';
import { clearStoredSpec, loadBests, loadChoice, loadFlag, loadLastLevel, loadStoredSpec, recordBest, saveChoice, saveFlag, saveLastLevel, saveStoredSpec } from './store.ts';
import { fetchBoard, fetchReplay, submitRun } from './api.ts';
import type { BoardEntry, BoardPayload, Category } from './api.ts';
import { canWatchLine, chooseGhost, createGhost, ghostCompat, ghostNoteFor, GHOST_KINDS, GHOST_LABELS } from './ghost.ts';
import type { Ghost, GhostKind, Standing } from './ghost.ts';
import { hasName, loadIdentity, setName } from './identity.ts';
import { createBoardUi } from './boardui.ts';
import { createResultsUi } from './resultsui.ts';
import { actionForKey, buildResults } from './results.ts';
import type { ActionId, ResultsModel, SubmitState } from './results.ts';
import { parseReplayFile } from '@/sim/replay.ts';
import { createLiveTune } from './livetune.ts';
import { renderArt } from './artrender.ts';
import { bakeLevel, bakeSignature } from './art/bake.ts';
import type { BakedLevel } from './art/bake.ts';
import { cloneArt, DEFAULT_ART } from './art/params.ts';
import { createAudio } from './audio/index.ts';
import { cloneAudio, DEFAULT_AUDIO } from './audio/params.ts';
import { sampleRide } from './audio/sample.ts';
import { CONCRETE } from './art/palette.ts';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const panelRoot = document.getElementById('panel') as HTMLElement;
const levelbarRoot = document.getElementById('levelbar') as HTMLElement;
const toastRoot = document.getElementById('toast') as HTMLElement;
const legendRoot = document.getElementById('legend') as HTMLElement;
const boardRoot = document.getElementById('board') as HTMLElement;
const resultsRoot = document.getElementById('results') as HTMLElement;
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

// --- leaderboard and ghosts -------------------------------------------------
//
// The identity is a device-local id plus a name you type. Nothing authenticates
// either — see identity.ts for why there is nothing to authenticate WITH, and
// what the migration path is. Re-simulation on the server means a TIME cannot
// be faked; whose time it is can be.
const identity = loadIdentity();
let boardCategory = loadChoice<Category>('boardCategory', ['human', 'tas'], 'human');
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
cam.snap({ x: level.start.x, y: level.start.y, vx: 0, vy: 0 });
// Hold-to-overview, and the start-of-level peek. It owns the freeze: while
// `overview.frozen` is true, `step()` returns before touching the sim, so no
// tick advances, no input frame is recorded and the clock does not move.
const overview = createOverview(cloneOverview(DEFAULT_OVERVIEW));
overview.startIntro();
let debug = false;
let hudCache = '';
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

function restart(keepReplay = true): void {
  if (!keepReplay) lastReplay = null;
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

function setLevel(next: LevelEntry, note = ''): void {
  if (!next.level) {
    replayNote = `"${next.label}" does not load: ${next.error ?? '?'}`;
    return;
  }
  entry = next;
  level = next.level;
  baked = null;
  audio.reset();
  sim = createSim(level, spec);
  lastReplay = null;
  replayNote = note;
  restart(false);
  // The opening peek happens on a LEVEL LOAD and not on a restart. Seeing the
  // whole level is route planning, which you do once; R is the die-retry loop,
  // which you do forty times, and putting anything at all in front of it is how
  // a retry loop stops being instant.
  overview.startIntro();
  saveLastLevel(entry.id);
  // Keep the address bar a shareable link to what is actually on screen.
  const url = new URL(location.href);
  url.searchParams.set('level', entry.id);
  history.replaceState(null, '', url);
  levelBar.update(entry.id, bests);
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
  playback = null;
  const p = PRESETS.find((x) => x.id === presetId);
  specIsTuned = p ? specHash(localSpec) !== specHash(p.spec) : true;
  panel.setTuned(specIsTuned);
  // A ghost is a run on a SPECIFIC bike. Once the bike moves, those inputs
  // describe a line nobody rode, so the ghost goes rather than lying quietly.
  if (ghost) dropGhost('the bike changed, so the ghost was dropped — it was a run on a different bike');
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
function applyRemote(override: Record<string, unknown>, held: ReadonlySet<string>): void {
  const before = spec;
  remoteOverride = override;
  recomputeSpec(false);
  restart(false);
  panel.setRemote(held, remoteNote());
  panel.sync();

  const changes = diffSpec(before, spec);
  if (changes.length === 0) return;
  const shown = changes.slice(0, 4).map((c) => `${c.path} ${fmtNum(c.from)} → ${fmtNum(c.to)}`);
  if (changes.length > shown.length) shown.push(`and ${changes.length - shown.length} more`);
  toast(shown.join('   '), 'live tune');
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
}

function startPlayback(): void {
  if (!lastReplay) {
    replayNote = 'nothing recorded yet — drive, then die or finish';
    return;
  }
  const v = verify(level, spec, lastReplay);
  replayNote = v.result.ok
    ? `replay verified: ${lastReplay.frames} frames, hash ${v.result.finalHash}`
    : `REPLAY DESYNC: ${v.result.reason ?? '?'}${v.result.atFrame !== undefined ? ` at frame ${v.result.atFrame}` : ''}`;
  audio.reset();
  sim.reset();
  prevState = sim.snapshot();
  recorder.reset();
  playback = { masks: decodeInputs(lastReplay.inputs), at: 0 };
  cam.snap({ x: level.start.x, y: level.start.y, vx: 0, vy: 0 });
}

// --- the leaderboard, and the ghost --------------------------------------------

function boardStatusSet(text: string, kind: 'ok' | 'warn' | 'bad' | '' = 'warn'): void {
  boardStatus = text;
  boardStatusKind = text ? kind : '';
  syncBoardUi();
}

/**
 * Have you finished THIS level on THIS rev?
 *
 * Two independent witnesses, either of which is sufficient: a local best (which
 * `store.ts` keys by rev, so a rev bump retires it automatically) or a human
 * board entry of your own. The local one is what makes the gate work with no
 * server at all; the board one is what makes it survive clearing site data.
 *
 * It gates one thing: whether a TAS LINE may be watched. Never a time.
 */
function completedThisLevel(): boolean {
  return bests[level.simHash] !== undefined || humanBoard?.you != null;
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
    completed: completedThisLevel(),
  });
}

function dropGhost(note: string): void {
  ghost = null;
  ghostReplayId = '';
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
    ghost = createGhost(level, spec, r.value, {
      kind: pick.kind,
      name: want.name,
      replayId: want.replayId,
      rank: pick.rank,
    });
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
  submitRun({ playerId: identity.playerId, name: identity.name, category: 'human', replay: r }).then((res) => {
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
 * The category gate is enforced HERE as well as in the panel that offers the
 * button, because "the UI does not show it" is a presentation fact and this is
 * the function that actually fetches somebody's route.
 */
function watchEntry(e: BoardEntry): void {
  if (!canWatchLine(e.category, completedThisLevel())) {
    boardStatusSet(
      'that is a machine run. Its time is on the board; its line stays hidden until you finish this ' +
        'level yourself — a solver picked the apple order by searching for it, and route choice is the level.',
      'warn',
    );
    return;
  }
  fetchReplay(e.replayId, level.simHash).then((r) => {
    if (!r.ok) {
      boardStatusSet(`could not load that run: ${r.error}`, 'bad');
      return;
    }
    try {
      loadReplay(parseReplayFile(r.value), `${e.name} — ${ticksToSeconds(e.timeTicks).toFixed(3)}s`);
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
    // Always true in practice on this screen — you are reading it because you
    // just finished — but computed rather than assumed, so the rule stays one
    // rule and not a special case that drifts.
    tasUnlocked: canWatchLine('tas', completedThisLevel()),
    playerId: identity.playerId,
    rowLimit: RESULTS_ROWS,
    actions: {
      nextLabel: next?.label ?? null,
      canWatchRun: lastReplay !== null,
      ghostName: ghostEntry?.name ?? null,
      tasTimeTicks: tasTicks,
      tasUnlocked: canWatchLine('tas', completedThisLevel()),
    },
  });
  resultsUi.update(resultsModel);
}

function closeResults(): void {
  if (!results) return;
  results = null;
  resultsModel = null;
  resultsUi.hide();
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
    case 'watchTas': {
      const e = tasBoard?.top[0] ?? null;
      closeResults();
      if (e) watchEntry(e);
      break;
    }
    case 'board':
      // The fuller view. The results panel stays up: they are on opposite sides
      // of the screen and B is a toggle everywhere else in the game.
      boardVisible = true;
      saveFlag('board', true);
      syncBoardUi();
      refreshBoard();
      break;
    case 'levels':
      closeResults();
      levelBar.focus();
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
  startPlayback();
  const claimed = `${file.finished ? 'FINISHED' : file.dead ? 'DEAD' : 'unfinished'} at ${ticksToSeconds(file.timeTicks).toFixed(3)}s`;
  replayNote = `${name}: ${claimed}${notes.length ? ` (${notes.join('; ')})` : ''} — ${replayNote}`;
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
  if (overview.frozen) return;

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

function draw(alpha: number, dtMs: number): void {
  fps += (1000 / Math.max(dtMs, 1) - fps) * 0.08;
  recordFrame(performance.now(), dtMs);
  const { cssW, cssH } = resize();
  const dtSec = dtMs / 1000;
  const pose = interpolate(prevState, sim.state, alpha);

  overview.tick(dtSec);
  const ov = overview.blend > 0
    ? { ...overviewFrame(level, { x: pose.px, y: pose.py }, cssW, cssH, overview.params), blend: overview.blend }
    : null;
  cam.update({ x: pose.px, y: pose.py, vx: sim.state.vx, vy: sim.state.vy }, dtSec, cssW, cssH, ov);

  const ghostPose: Pose | null = ghost ? ghost.pose(alpha) : null;
  const opts = {
    debug,
    ghost: ghostPose,
    ghostFacing: ghost?.facing,
    overview: overview.blend,
    // Indicators are for driving, not for the overview — while the whole level
    // is on screen there is nothing off it to point at, and eight arrows
    // sliding to the edges during the zoom is exactly the noise the readability
    // rule exists to prevent. They fade out as the overview fades in.
    markers: overview.params.markerAlpha > 0
      ? { inset: overview.params.markerInset, alpha: overview.params.markerAlpha * (1 - overview.blend) }
      : null,
  };
  if (artParams.enabled > 0) {
    const art = ensureBake();
    renderArt(ctx, cssW, cssH, cam, sim.world, sim.state, pose, spec,
      { ...opts, time: (performance.now() - bootTime) / 1000 }, artParams, art);
  } else {
    render(ctx, cssW, cssH, cam, sim.world, sim.state, pose, spec, opts);
  }

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
  audio.setDuck(1 - overview.blend * 0.85);
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
  if (audio.error) return `<span class="bad">off — ${audio.error}</span>`;
  if (audio.muted) return '<span class="warn">MUTED</span> — M unmutes';
  switch (audio.state) {
    case 'idle':
    case 'starting':
      return '<span class="warn">waiting for a click or a key</span> — browsers will not start sound before one';
    case 'suspended':
      return '<span class="warn">suspended</span> (tab hidden)';
    case 'running':
      return `on, ${audioParams.engineHz.toFixed(0)} Hz, ${audio.lastMs.toFixed(2)} ms/frame — M mutes`;
    default:
      return 'off';
  }
}

function setMuted(on: boolean): void {
  audio.setMuted(on);
  saveFlag('mute', on);
  panel.sync();
  toast(on ? 'sound off' : 'sound on', 'M');
}

function updateHud(): void {
  const s = sim.state;
  const m = input.mask();
  const keys =
    (m & IN_THROTTLE ? 'GAS ' : '&middot;&nbsp;&nbsp;&nbsp; ') +
    (m & IN_BRAKE ? 'BRK ' : '&middot;&nbsp;&nbsp;&nbsp; ') +
    (m & IN_LEAN_L ? '&lt;L&nbsp; ' : '&middot;&nbsp;&nbsp; ') +
    (m & IN_LEAN_R ? 'R&gt;&nbsp; ' : '&middot;&nbsp;&nbsp; ') +
    (m & IN_FLIP ? 'FLIP' : '&middot;');
  const status = overview.frozen
    ? `<span class="warn">OVERVIEW — sim and clock frozen at ${ticksToSeconds(s.tick).toFixed(2)}s${overview.mode === 'held' ? ', release TAB' : ', any key to start'}</span>`
    : s.finished
      ? `<span class="ok">FINISHED ${ticksToSeconds(s.endTick).toFixed(3)}s</span>`
      : s.dead
        ? `<span class="bad">DEAD at ${ticksToSeconds(s.endTick).toFixed(3)}s — R to restart</span>`
        : playback
          ? `<span class="warn">REPLAY ${playback.at}/${playback.masks.length}</span>`
          : `${ticksToSeconds(s.tick).toFixed(2)}s`;
  const best = bests[level.simHash];

  const lines = [
    `<span class="k">velo</span> <span class="v">rev ${SIM_REV}</span>  <span class="k">preset</span> <span class="v">${presetLabel}${specIsTuned ? ' <span class="warn">+tuned</span>' : ''}</span>`,
    `<span class="k">level</span> ${level.name}  <span class="k">simHash</span> ${level.simHash}`,
    `<span class="k">spec </span> ${specHash(spec)}`,
    '',
    `${status}   <span class="k">apples</span> ${level.apples.length - s.applesLeft}/${level.apples.length}` +
      (best !== undefined ? `   <span class="k">best</span> ${ticksToSeconds(best).toFixed(3)}s` : ''),
    `<span class="k">speed</span> ${Math.sqrt(s.vx * s.vx + s.vy * s.vy).toFixed(2)} m/s   <span class="k">spin</span> ${s.wspin[0].toFixed(1)} / ${s.wspin[1].toFixed(1)}   <span class="k">ground</span> ${s.grounded === 3 ? 'both' : s.grounded === 1 ? 'rear' : s.grounded === 2 ? 'front' : 'air'}`,
    `<span class="k">keys </span> ${keys}`,
    `<span class="k">facing</span> ${s.facing > 0 ? '+x' : '-x'}   <span class="k">contacts</span> ${sim.world.contactCount}   <span class="k">zoom</span> ${cam.zoom.toFixed(0)} px/m   <span class="k">fps</span> ${fps.toFixed(0)}` +
    `   <span class="k">worst</span> ${worstMs.toFixed(1)}ms` +
    (overCount > 0 ? `   <span class="bad">${overCount} dropped</span>` : ''),
    '',
    `<span class="k">audio</span> ${audioLine()}`,
    liveTuneError
      ? `<span class="bad">${liveTuneError}</span>`
      : liveTune.enabled
        ? `<span class="k">live tune</span> on${liveTune.heldPaths.size ? `, holding ${liveTune.heldPaths.size} field(s)` : ', no override'}`
        : '<span class="k">live tune</span> off',
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
    ghost
      ? `<span class="k">ghost</span> ${ghost.meta.name}${ghost.meta.rank !== null ? ` (#${ghost.meta.rank})` : ''} ` +
        `<span class="v">${ticksToSeconds(ghost.timeTicks).toFixed(3)}s</span>  ` +
        `<span class="k">${GHOST_LABELS[ghost.meta.kind]}</span>  ${ghost.done ? 'finished' : `${ghost.at}/${ghost.frames}`}` +
        // A gap in METRES, not seconds. The ghost is stepped one frame for one
        // frame with you, so the two clocks are identical by construction and a
        // time gap would always read 0.00s. What differs is where you each are.
        `   <span class="${s.px - ghost.x >= 0 ? 'ok' : 'warn'}">${Math.abs(s.px - ghost.x).toFixed(1)} m ${s.px - ghost.x >= 0 ? 'ahead' : 'behind'}</span>`
      : ghostNote
        ? `<span class="k">ghost</span> <span class="warn">${ghostNote}</span>`
        : '',
    replayNote ? `<span class="${replayNote.startsWith('REPLAY DESYNC') || replayNote.startsWith('CANNOT PLAY') ? 'bad' : 'warn'}">${replayNote}</span>` : '',
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
});
levelBar.update(entry.id, bests);
createLegend(legendRoot);

// The leaderboard panel. Created before live tune, because live tune's first
// poll fires immediately and can reach `syncBoardUi` through recomputeSpec.
const boardUi = createBoardUi(boardRoot, {
  onCategory: (c) => setCategory(c),
  onGhost: (k) => setGhostKind(k),
  onName: (n) => onNameChosen(n),
  onRefresh: () => refreshBoard(),
  onWatch: (e) => watchEntry(e),
});

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

// Live tune. Created after the panel, because a poll that lands before the
// panel exists has nothing to grey out. The first poll fires immediately, so a
// spec file that is already in place is in force before the first frame the
// player sees rather than two seconds into their first run.
const liveTune = createLiveTune(() => localSpec, {
  onChange: (override, held) => applyRemote(override, held),
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
  switch (code) {
    case 'Tab':
      // HOLD to see the whole level. The sim is frozen while it is down, so
      // this cannot advance the clock or add a frame to the recording.
      overview.hold(true);
      break;
    case 'KeyR':
      restart(false);
      break;
    case 'KeyT':
      startPlayback();
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
    case 'KeyM':
      setMuted(audio.toggleMuted());
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
    case 'BracketLeft':
      stepLevel(-1);
      break;
    case 'BracketRight':
      stepLevel(1);
      break;
    case 'Equal':
    case 'NumpadAdd':
      // A bias on top of the auto zoom rather than a zoom value, so the
      // speed-driven zoom keeps working around whatever you chose.
      cam.zoomBias = Math.min(3, cam.zoomBias * 1.15);
      break;
    case 'Minus':
    case 'NumpadSubtract':
      cam.zoomBias = Math.max(0.35, cam.zoomBias / 1.15);
      break;
    default:
      break;
  }
});

input.onCommandUp((code) => {
  if (code === 'Tab') overview.hold(false);
});

// Clicking anywhere also ends the opening peek — "skippable by any input" has
// to mean any input, or the one person who reaches for the mouse sits through it.
window.addEventListener('pointerdown', () => overview.skipIntro());

loop.start();
syncBoardUi();
refreshBoard();

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
  liveTune,
  get cam() {
    return cam;
  },
  overview,
  /** Frames in the CURRENT recording. bin/smoke uses it to prove the freeze. */
  get recordedFrames() {
    return recorder.frames;
  },
  get attempts() {
    return attempts.all;
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
  renderAt(x: number, y: number, zoom: number, o?: { art?: boolean; debug?: boolean; overview?: number }) {
    const { cssW, cssH } = resize();
    const pose = interpolate(prevState, sim.state, 1);
    const view = { x, y, zoom };
    const opts = {
      debug: o?.debug ?? false,
      ghost: null,
      overview: o?.overview ?? 0,
      markers: null,
    };
    const useArt = o?.art ?? artParams.enabled > 0;
    if (useArt) {
      renderArt(ctx, cssW, cssH, view, sim.world, sim.state, pose, spec,
        { ...opts, time: (performance.now() - bootTime) / 1000 }, artParams, ensureBake());
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
