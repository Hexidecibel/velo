// The tuning panel. This, not the renderer, is the milestone-1 deliverable.
//
// "Ride it until it feels good" means changing the BikeSpec dozens of times in
// a sitting, and doing that by editing a source file and waiting for HMR is
// roughly ten times slower than dragging a slider. The groups below are ordered
// by how much of the feel they own: suspension and wheel friction first (call
// it 80%), then volt authority, then drive, then chassis and world.
//
// The camera lives here too. It is not physics and it is not in the BikeSpec —
// it never touches the sim and it must not, or a replay would depend on how
// somebody framed their screen. But it has FEEL, and the panel is the house
// pattern for anything with feel, so the same slider machinery drives both. The
// field/group types are generic over the object they edit; that is the whole of
// what it took.
//
// The "Copy spec JSON" button is not a convenience. A slider emits doubles like
// 0.30000000000000004, and the exact doubles that were tuned with must be the
// exact doubles that ship — JSON.stringify emits the shortest representation
// that round-trips to the identical double, so the panel hands over the spec
// and nobody retypes it.
import type { BikeSpec } from '@/sim/spec.ts';
import { specHash } from '@/sim/spec.ts';
import type { CameraParams } from './camera.ts';
import type { OverviewParams } from './overview.ts';
import { PRESETS, leanAngleOf, leanVectors } from './presets.ts';
import { loadFlag, saveFlag } from './store.ts';

interface Field<T> {
  label: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
  /**
   * The dotted BikeSpec paths this row writes. Present on bike fields, absent
   * on the camera's (which is not a spec and cannot be driven remotely).
   *
   * It is what lets a row know that `bin/spec` is holding its field: the panel
   * greys those rows out and badges them LIVE rather than letting somebody drag
   * a slider that a poll two seconds later will silently overwrite.
   */
  paths?: string[];
  get(s: T): number;
  set(s: T, v: number): void;
}

interface Group<T> {
  title: string;
  why: string;
  fields: Field<T>[];
}

const BIKE_GROUPS: Group<BikeSpec>[] = [
  {
    title: 'Suspension & grip',
    why: 'About 80% of the feel lives here. Start with stiffness, then the two damping values, then friction.',
    fields: [
      {
        label: 'spring stiffness', paths: ['suspension.stiffness'], min: 1000, max: 40000, step: 50,
        hint: 'Zero rest length: the wheel is pulled to its anchor in ANY direction. Lower = longer, softer travel.',
        get: (s) => s.suspension.stiffness, set: (s, v) => { s.suspension.stiffness = v; },
      },
      {
        label: 'compression damping', paths: ['suspension.compressionDamping'], min: 0, max: 2500, step: 5,
        hint: 'The LANDING half — resists the wheel coming up into the bike. High keeps a landing planted.',
        get: (s) => s.suspension.compressionDamping, set: (s, v) => { s.suspension.compressionDamping = v; },
      },
      {
        label: 'rebound damping', paths: ['suspension.reboundDamping'], min: 0, max: 2500, step: 5,
        hint: 'The LAUNCH half — resists the spring pushing back out. LOWER returns more of what a bump stored, so features pop you. Equal to compression is exactly the old symmetric feel; far below it goes pogo.',
        get: (s) => s.suspension.reboundDamping, set: (s, v) => { s.suspension.reboundDamping = v; },
      },
      {
        label: 'max deflection (m)', paths: ['suspension.maxDeflection'], min: 0.03, max: 0.6, step: 0.005,
        hint: 'Hard radial clamp. Hitting it dumps the impact into the wheel alone and is felt as the bike sticking; bin/replay counts how often a run reaches it.',
        get: (s) => s.suspension.maxDeflection, set: (s, v) => { s.suspension.maxDeflection = v; },
      },
      {
        label: 'wheel friction', paths: ['wheel.friction'], min: 0.05, max: 3, step: 0.01,
        hint: 'Coulomb mu at the contact patch. This is what converts drive torque into motion.',
        get: (s) => s.wheel.friction, set: (s, v) => { s.wheel.friction = v; },
      },
      {
        label: 'wheel restitution', paths: ['wheel.restitution'], min: 0, max: 0.6, step: 0.005,
        hint: 'Keep it near zero. The SPRING should do the bouncing, not the tyre — that is what rebound damping is for.',
        get: (s) => s.wheel.restitution, set: (s, v) => { s.wheel.restitution = v; },
      },
      {
        label: 'wheel radius (m)', paths: ['wheel.radius'], min: 0.1, max: 0.5, step: 0.005,
        get: (s) => s.wheel.radius, set: (s, v) => { s.wheel.radius = v; },
      },
      {
        label: 'wheel mass (kg)', paths: ['wheel.mass'], min: 0.5, max: 15, step: 0.1,
        hint: 'Unsprung mass. Heavy wheels hop; light ones skitter.',
        get: (s) => s.wheel.mass, set: (s, v) => { s.wheel.mass = v; },
      },
      {
        label: 'wheel inertia', paths: ['wheel.inertia'], min: 0.01, max: 0.8, step: 0.005,
        hint: 'The spin scalar. Low = instant wheelspin; high = the wheel stores energy and launches you on landing.',
        get: (s) => s.wheel.inertia, set: (s, v) => { s.wheel.inertia = v; },
      },
      {
        label: 'wheelbase / 2 (m)', paths: ['wheel.anchors.0.x', 'wheel.anchors.1.x'], min: 0.25, max: 1.2, step: 0.01,
        hint: 'Anchors stay symmetric — flip depends on that.',
        get: (s) => s.wheel.anchors[1].x,
        set: (s, v) => { s.wheel.anchors[0].x = -v; s.wheel.anchors[1].x = v; },
      },
      {
        label: 'anchor height (m)', paths: ['wheel.anchors.0.y', 'wheel.anchors.1.y'], min: -0.6, max: 0.4, step: 0.01,
        hint: 'Negative hangs the wheels below the frame. Raises or lowers the effective ride height.',
        get: (s) => s.wheel.anchors[0].y,
        set: (s, v) => { s.wheel.anchors[0].y = v; s.wheel.anchors[1].y = v; },
      },
    ],
  },
  {
    title: 'Volt authority',
    why: 'Attitude torque is the big one — it is the primary rotation control and it works identically upright, inverted and spinning. Weight transfer and inertial transfer are the two halves of the rider\'s load on the pivot: one static, one from acceleration. The pendulum below them moves the rider and therefore the HEAD, which is what makes volting under a low ceiling lethal.',
    fields: [
      {
        label: 'attitude torque', paths: ['rider.attitudeTorque'], min: 0, max: 900, step: 5,
        hint: 'Constant N m on the chassis while a lean key is held. Against angular damping c this converges to tau/(I*c); a tap is a nudge, a hold flips you.',
        get: (s) => s.rider.attitudeTorque, set: (s, v) => { s.rider.attitudeTorque = v; },
      },
      {
        label: 'weight transfer', paths: ['rider.weightTransfer'], min: 0, max: 1, step: 0.01,
        hint: 'Scales the rider-weight torque. 1 lets gravity dominate rotation and settles the bike inverted in the air; ~0.6 keeps the wheelie and not the fight.',
        get: (s) => s.rider.weightTransfer, set: (s, v) => { s.rider.weightTransfer = v; },
      },
      {
        label: 'inertial transfer', paths: ['rider.inertialTransfer'], min: 0, max: 3, step: 0.05,
        hint: 'BRAKE DIVE. The rider\'s mass reacting to the pivot\'s acceleration — brake and the nose slams down, gas and it lifts, land and the weight lands with you. 0 is the old bike with no dive at all. Full brake at 9 m/s, nose-down at 0.15 s: 0 -> 17 deg, 0.6 -> 33, 1.0 -> 42.',
        get: (s) => s.rider.inertialTransfer, set: (s, v) => { s.rider.inertialTransfer = v; },
      },
      {
        label: 'lean angle (deg)', paths: ['rider.leanL.x', 'rider.leanL.y', 'rider.leanR.x', 'rider.leanR.y'], min: 0, max: 90, step: 0.5,
        hint: 'Where the rider WEIGHT and HEAD go. Baked to a unit vector here; the sim never calls Math.cos.',
        get: (s) => leanAngleOf(s),
        set: (s, v) => { Object.assign(s.rider, leanVectors(v)); },
      },
      {
        label: 'servo P', paths: ['rider.servoP'], min: 0, max: 8000, step: 25,
        hint: 'Torque per unit of sine-error. How hard the rider yanks toward the target.',
        get: (s) => s.rider.servoP, set: (s, v) => { s.rider.servoP = v; },
      },
      {
        label: 'servo D', paths: ['rider.servoD'], min: 0, max: 1500, step: 5,
        hint: 'Damps the arm against the CHASSIS, not the world — this is the rider gripping the bars.',
        get: (s) => s.rider.servoD, set: (s, v) => { s.rider.servoD = v; },
      },
      {
        label: 'servo max torque', paths: ['rider.servoMaxTorque'], min: 0, max: 3000, step: 10,
        get: (s) => s.rider.servoMaxTorque, set: (s, v) => { s.rider.servoMaxTorque = v; },
      },
      {
        label: 'rider mass (kg)', paths: ['rider.mass'], min: 5, max: 90, step: 0.5,
        hint: 'Volt authority is roughly (m*L^2*dTheta)/I_chassis.',
        get: (s) => s.rider.mass, set: (s, v) => { s.rider.mass = v; },
      },
      {
        label: 'arm length (m)', paths: ['rider.armLength'], min: 0.2, max: 1.2, step: 0.01,
        hint: 'Squared in the volt formula, so this moves it faster than mass does.',
        get: (s) => s.rider.armLength, set: (s, v) => { s.rider.armLength = v; },
      },
      {
        label: 'head radius (m)', paths: ['rider.headRadius'], min: 0.04, max: 0.4, step: 0.005,
        hint: 'The death sphere. Bigger = volting under a low ceiling kills sooner.',
        get: (s) => s.rider.headRadius, set: (s, v) => { s.rider.headRadius = v; },
      },
    ],
  },
  {
    title: 'Drive',
    why: 'Torque goes on the WHEEL with the reaction on the chassis — which is why too much of it loops the bike instead of accelerating it.',
    fields: [
      {
        label: 'max drive torque', paths: ['drive.maxTorque'], min: 0, max: 900, step: 5,
        hint: 'Above ~160 with the plan geometry, full throttle backflips the bike from a standstill.',
        get: (s) => s.drive.maxTorque, set: (s, v) => { s.drive.maxTorque = v; },
      },
      {
        label: 'max wheel spin', paths: ['drive.maxWheelSpin'], min: 10, max: 200, step: 1,
        hint: 'Torque falls off linearly to zero here. Times the radius, it is your theoretical top speed.',
        get: (s) => s.drive.maxWheelSpin, set: (s, v) => { s.drive.maxWheelSpin = v; },
      },
      {
        label: 'brake torque', paths: ['drive.brakeTorque'], min: 0, max: 2000, step: 10,
        hint: 'Clamped per tick so it can never reverse the spin. 900 locks the wheel almost instantly.',
        get: (s) => s.drive.brakeTorque, set: (s, v) => { s.drive.brakeTorque = v; },
      },
    ],
  },
  {
    title: 'Chassis & world',
    why: 'Chassis inertia trades volt authority against how easily the throttle loops you. It is the sharpest knob on this panel. Gravity is the one that decides hang time — no suspension slider touches it.',
    fields: [
      {
        label: 'chassis mass (kg)', paths: ['chassis.mass'], min: 5, max: 120, step: 0.5,
        get: (s) => s.chassis.mass, set: (s, v) => { s.chassis.mass = v; },
      },
      {
        label: 'chassis inertia', paths: ['chassis.inertia'], min: 1, max: 40, step: 0.25,
        hint: 'Lower = the volt rotates the bike harder AND the throttle loops it sooner.',
        get: (s) => s.chassis.inertia, set: (s, v) => { s.chassis.inertia = v; },
      },
      {
        label: 'linear damping', paths: ['damping.linear'], min: 0, max: 1.5, step: 0.005,
        hint: 'v /= (1 + c*DT). Air drag, roughly.',
        get: (s) => s.damping.linear, set: (s, v) => { s.damping.linear = v; },
      },
      {
        label: 'angular damping', paths: ['damping.angular'], min: 0, max: 6, step: 0.01,
        hint: 'Takes the ring out of the pitch axis after a landing.',
        get: (s) => s.damping.angular, set: (s, v) => { s.damping.angular = v; },
      },
      {
        label: 'gravity (m/s^2)', paths: ['gravity'], min: 0, max: 30, step: 0.1,
        hint: 'HANG TIME lives here and nowhere else. 8 is a quarter more jump height than 10 for the same launch, and about 12% longer in the air.',
        get: (s) => s.gravity, set: (s, v) => { s.gravity = v; },
      },
    ],
  },
];

const CAMERA_GROUPS: Group<CameraParams>[] = [
  {
    title: 'Camera',
    why: 'Not physics — the sim never sees any of this, and it must not, or a time would depend on how somebody framed their screen. The one rule that outranks framing: the collision edge must stay readable, so min zoom is a hard floor.',
    fields: [
      {
        label: 'follow half-life (s)', min: 0.01, max: 0.6, step: 0.005,
        hint: 'Seconds to close half the gap. Lower = tighter and twitchier; higher = smoother and laggier.',
        get: (c) => c.followHalfLife, set: (c, v) => { c.followHalfLife = v; },
      },
      {
        label: 'lead time (s)', min: 0, max: 1, step: 0.01,
        hint: 'Seconds of velocity used as look-ahead, so you see what you are riding into. From VELOCITY, never from facing — that is why a flip does not move the camera.',
        get: (c) => c.leadTime, set: (c, v) => { c.leadTime = v; },
      },
      {
        label: 'lead half-life (s)', min: 0.01, max: 1, step: 0.01,
        hint: 'How fast the lead itself turns around. This is the knob that stops a direction reversal lurching.',
        get: (c) => c.leadHalfLife, set: (c, v) => { c.leadHalfLife = v; },
      },
      {
        label: 'max lead x (m)', min: 0, max: 10, step: 0.1,
        get: (c) => c.maxLeadX, set: (c, v) => { c.maxLeadX = v; },
      },
      {
        label: 'max lead y (m)', min: 0, max: 10, step: 0.1,
        hint: 'Smaller than x on purpose: vertical reversals are faster and more surprising.',
        get: (c) => c.maxLeadY, set: (c, v) => { c.maxLeadY = v; },
      },
      {
        label: 'base zoom (px/m)', min: 20, max: 140, step: 1,
        get: (c) => c.baseZoom, set: (c, v) => { c.baseZoom = v; },
      },
      {
        label: 'MIN zoom (px/m)', min: 20, max: 140, step: 1,
        hint: 'The readability floor and the highest-priority rule here. Below ~34 the 1.7 m bike is under 58 px and you are guessing at clearances.',
        get: (c) => c.minZoom, set: (c, v) => { c.minZoom = v; },
      },
      {
        label: 'max zoom (px/m)', min: 20, max: 240, step: 1,
        get: (c) => c.maxZoom, set: (c, v) => { c.maxZoom = v; },
      },
      {
        label: 'zoom-out from (m/s)', min: 0, max: 30, step: 0.5,
        hint: 'Below this speed the zoom does not move at all.',
        get: (c) => c.zoomFromSpeed, set: (c, v) => { c.zoomFromSpeed = v; },
      },
      {
        label: 'zoom-out by (m/s)', min: 1, max: 40, step: 0.5,
        hint: 'Speed at which the zoom has reached its floor.',
        get: (c) => c.zoomToSpeed, set: (c, v) => { c.zoomToSpeed = v; },
      },
      {
        label: 'zoom-out half-life (s)', min: 0.02, max: 2, step: 0.01,
        hint: 'Zooming out is urgent — something is about to arrive.',
        get: (c) => c.zoomOutHalfLife, set: (c, v) => { c.zoomOutHalfLife = v; },
      },
      {
        label: 'zoom-in half-life (s)', min: 0.02, max: 3, step: 0.01,
        hint: 'Zooming back in is not urgent. Slower here is what stops the view pumping over rolling terrain.',
        get: (c) => c.zoomInHalfLife, set: (c, v) => { c.zoomInHalfLife = v; },
      },
      {
        label: 'safe box', min: 0.05, max: 1, step: 0.01,
        hint: 'Hard guarantee, applied after the smoothing: the bike never leaves this fraction of the half-frame. 1 disables it and lets a fast reversal outrun the camera.',
        get: (c) => c.safeBox, set: (c, v) => { c.safeBox = v; },
      },
    ],
  },
];

const OVERVIEW_GROUPS: Group<OverviewParams>[] = [
  {
    title: 'Overview (TAB)',
    why: 'Hold TAB and the camera eases out to frame the whole level; the sim and the clock freeze while it is held, which is what lets this ignore the readability floor above and what makes it impossible for it to affect a recorded run. Not a minimap, on purpose: this shows the real level through the real renderer rather than an abstraction of it that has to be maintained separately.',
    fields: [
      {
        label: 'padding', min: 0, max: 0.4, step: 0.01,
        hint: 'Margin around the level as a fraction of its longest span. 0 puts the outer wall exactly on the screen edge, which reads as "cut off" rather than "the end".',
        get: (o) => o.padding, set: (o, v) => { o.padding = v; },
      },
      {
        label: 'overview MIN zoom (px/m)', min: 3, max: 40, step: 0.5,
        hint: 'Floor for the wide view — far below the driving floor, because nobody is driving. A level too big to fit above this frames a generous radius around the bike instead, clamped to stay inside the level.',
        get: (o) => o.minZoom, set: (o, v) => { o.minZoom = v; },
      },
      {
        label: 'ease-out half-life (s)', min: 0.02, max: 1, step: 0.01,
        hint: 'Going INTO the overview. A snap at this scale is disorienting.',
        get: (o) => o.inHalfLife, set: (o, v) => { o.inHalfLife = v; },
      },
      {
        label: 'ease-in half-life (s)', min: 0.02, max: 1, step: 0.01,
        hint: 'Coming BACK. The sim unfreezes the instant TAB is released, not when this finishes — a half-second of stuck controls would be worse than a fast zoom.',
        get: (o) => o.outHalfLife, set: (o, v) => { o.outHalfLife = v; },
      },
      {
        label: 'start-of-level hold (s)', min: 0, max: 4, step: 0.1,
        hint: 'How long the opening peek lasts. Route planning IS the game — apples come in any order — so a player who never sees the whole level cannot plan one. Any input skips it; 0 disables it. It fires on a LEVEL LOAD and never on R.',
        get: (o) => o.introHold, set: (o, v) => { o.introHold = v; },
      },
      {
        label: 'marker inset (px)', min: 0, max: 120, step: 1,
        hint: 'How far in from the window edge the off-screen apple and flower arrows sit.',
        get: (o) => o.markerInset, set: (o, v) => { o.markerInset = v; },
      },
      {
        label: 'marker alpha', min: 0, max: 1, step: 0.01,
        hint: 'Subtlety knob, and the readability rule is what it is for: these must never compete with the collision edge. 0 turns them off entirely.',
        get: (o) => o.markerAlpha, set: (o, v) => { o.markerAlpha = v; },
      },
    ],
  },
];

export interface PanelHooks {
  /** A spec field moved. The sim is rebuilt around the new spec in place. */
  onSpecChange(spec: BikeSpec): void;
  /** The live-tune toggle moved. */
  onLiveTune(on: boolean): void;
  /** A camera field moved. Nothing physical happens. */
  onCameraChange(cam: CameraParams): void;
  /** An overview field moved. Read every frame, so also nothing to rebuild. */
  onOverviewChange(ov: OverviewParams): void;
  /** A whole preset was selected; the run restarts. */
  onPreset(spec: BikeSpec, label: string): void;
  /** Throw away the stored tune and go back to the preset as shipped. */
  onResetSpec(): void;
  onRestart(): void;
  onReplay(): void;
  onExport(): void;
  onImport(): void;
}

export interface Panel {
  /** Re-read every field from the EFFECTIVE spec (after a preset swap, a reset,
   * or a live-tune poll). */
  sync(): void;
  /** Say, visibly, that the live spec is not the preset as shipped. */
  setTuned(tuned: boolean): void;
  /**
   * Which dotted paths `bin/spec` is currently holding. Those rows go
   * read-only and get a LIVE badge — a slider you can still drag but that a
   * poll overwrites two seconds later is worse than no slider at all.
   */
  setRemote(paths: ReadonlySet<string>, note: string): void;
  /** Reflect the live-tune toggle when something other than a click moved it. */
  setLiveTune(on: boolean): void;
  toggle(): void;
  readonly visible: boolean;
}

/** Readable, not exact. The COPY button is what carries the exact doubles. */
function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const s = v.toPrecision(7);
  return String(parseFloat(s));
}

export function createPanel(
  root: HTMLElement,
  /** The object the sliders WRITE to: the local, hand-tuned spec. */
  spec: BikeSpec,
  /**
   * The spec the bike is actually running — local tune with any live-tune
   * override layered on top. The sliders DISPLAY this, so a remotely driven
   * field shows the value in force rather than the one underneath it.
   */
  effective: () => BikeSpec,
  camera: CameraParams,
  overview: OverviewParams,
  liveTuneOn: boolean,
  hooks: PanelHooks,
): Panel {
  root.textContent = '';
  const syncers: (() => void)[] = [];
  const remoteSetters: ((paths: ReadonlySet<string>) => void)[] = [];

  const h1 = el('h1', 'Velo — bike spec');
  const sub = el('div', '');
  sub.className = 'sub';
  root.append(h1, sub);

  const select = document.createElement('select');
  for (const p of PRESETS) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.label;
    select.append(o);
  }
  const presetNote = el('div', PRESETS[0].note);
  presetNote.className = 'note';
  select.addEventListener('change', () => {
    const p = PRESETS.find((x) => x.id === select.value);
    if (!p) return;
    presetNote.textContent = p.note;
    hooks.onPreset(p.spec, p.label);
  });
  root.append(select, presetNote);

  // The tuned banner. Without it, a stale slider restored from a previous
  // session looks exactly like a physics regression, and somebody spends an
  // afternoon debugging their own leftover tune.
  const tuned = el('div', '');
  tuned.className = 'tuned';
  tuned.hidden = true;
  const resetBtn = button('Reset to preset');
  resetBtn.addEventListener('click', () => hooks.onResetSpec());
  root.append(tuned);

  // The live-tune banner: what bin/spec is currently holding, and how to give
  // it back. Hidden entirely when nothing is being driven remotely, so the
  // common case carries no extra chrome.
  const remoteBanner = el('div', '');
  remoteBanner.className = 'remote';
  remoteBanner.hidden = true;
  root.append(remoteBanner);

  const liveRow = document.createElement('label');
  liveRow.className = 'toggle';
  const liveBox = document.createElement('input');
  liveBox.type = 'checkbox';
  liveBox.checked = liveTuneOn;
  const liveText = document.createElement('span');
  liveText.textContent = 'Live tune — follow data/spec.json';
  liveRow.append(liveBox, liveText);
  const liveHint = el(
    'div',
    'Polls /api/spec every 2 s so someone at a terminal can change the bike with bin/spec while you ride. On by default under bin/dev, off in a build. Applying a change RESTARTS the attempt, because a replay records the spec hash.',
  );
  liveHint.className = 'hint';
  root.append(liveRow, liveHint);
  liveBox.addEventListener('change', () => hooks.onLiveTune(liveBox.checked));

  const btns = document.createElement('div');
  btns.className = 'btns';
  const copy = button('Copy spec JSON', 'primary');
  const restart = button('Restart (R)');
  const replay = button('Replay (T)');
  const exportBtn = button('Export replay (E)', 'primary');
  const importBtn = button('Load replay (L)');
  btns.append(copy, restart, replay, exportBtn, importBtn, resetBtn);
  root.append(btns);

  const copied = el('div', '');
  copied.className = 'note';
  root.append(copied);
  copy.addEventListener('click', () => {
    // JSON.stringify writes the shortest decimal that round-trips to the same
    // double, so what lands on the clipboard reparses bit-identically.
    const text = JSON.stringify(spec, null, 2);
    const ok = (): void => {
      copied.textContent = `copied ${text.length} chars — paste over DEFAULT_SPEC in src/sim/spec.ts`;
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(ok, () => fallbackCopy(text, ok));
    } else {
      fallbackCopy(text, ok);
    }
    // Also to the console, so a clipboard-permission prompt is never the only
    // route out of an hour of tuning.
    console.log(text);
  });
  restart.addEventListener('click', () => hooks.onRestart());
  replay.addEventListener('click', () => hooks.onReplay());
  exportBtn.addEventListener('click', () => hooks.onExport());
  importBtn.addEventListener('click', () => hooks.onImport());

  /**
   * `obj` is what a row WRITES to; `display` is what it READS. For the bike
   * those differ whenever live tune is holding a field — the slider shows the
   * value in force, and editing it still writes underneath, so unsetting the
   * override restores what you had rather than whatever the slider last showed.
   */
  function buildGroups<T>(groups: Group<T>[], obj: T, changed: (o: T) => void, display: () => T = () => obj): void {
    for (const g of groups) {
      const h = document.createElement('h2');
      h.textContent = g.title;
      const why = document.createElement('span');
      why.className = 'why';
      why.textContent = g.why;
      h.append(why);
      root.append(h);

      for (const f of g.fields) {
        const row = document.createElement('div');
        row.className = 'row';
        const label = el('label', f.label);
        const num = document.createElement('input');
        num.type = 'text';
        num.className = 'num';
        num.size = 10;
        const range = document.createElement('input');
        range.type = 'range';
        range.min = String(f.min);
        range.max = String(f.max);
        range.step = String(f.step);
        row.append(label, num, range);
        if (f.hint) {
          const hint = el('div', f.hint);
          hint.className = 'hint';
          row.append(hint);
        }
        root.append(row);

        const sync = (): void => {
          const v = f.get(display());
          range.value = String(v);
          num.value = fmt(v);
        };
        syncers.push(sync);
        sync();

        if (f.paths && f.paths.length) {
          const paths = f.paths;
          const badge = el('span', 'LIVE');
          badge.className = 'live-badge';
          badge.hidden = true;
          label.append(badge);
          remoteSetters.push((held) => {
            const driven = paths.some((p) => held.has(p));
            badge.hidden = !driven;
            row.classList.toggle('remote-held', driven);
            range.disabled = driven;
            num.readOnly = driven;
            num.title = driven ? `held by bin/spec — bin/spec unset ${paths[0]} to take it back` : '';
          });
        }

        range.addEventListener('input', () => {
          f.set(obj, parseFloat(range.value));
          num.value = fmt(f.get(obj));
          changed(obj);
          refreshHash();
        });
        // Typing an exact value beats hunting for it with a slider.
        num.addEventListener('change', () => {
          const v = parseFloat(num.value);
          if (!Number.isFinite(v)) {
            sync();
            return;
          }
          f.set(obj, v);
          sync();
          changed(obj);
          refreshHash();
        });
      }
    }
  }

  buildGroups(BIKE_GROUPS, spec, (s) => hooks.onSpecChange(s), effective);
  // The camera is not a BikeSpec and cannot be driven remotely, so it reads and
  // writes the same object and no row of it ever goes read-only.
  buildGroups(CAMERA_GROUPS, camera, (c) => hooks.onCameraChange(c));
  buildGroups(OVERVIEW_GROUPS, overview, (o) => hooks.onOverviewChange(o));

  const keys = document.createElement('div');
  keys.className = 'keys';
  keys.innerHTML =
    '<h2 style="margin-top:18px">Keys</h2>' +
    '<b>arrows / WASD</b> gas, brake, volt left, volt right<br>' +
    '<b>space</b> FLIP direction &nbsp; <b>R</b> restart &nbsp; <b>T</b> replay last run<br>' +
    '<b>E</b> export replay &nbsp; <b>L</b> load a replay file (or drop one on the window)<br>' +
    '<b>TAB</b> (hold) see the whole level — the sim and the clock freeze<br>' +
    '<b>[ / ]</b> previous / next level &nbsp; <b>G</b> contacts &amp; normals<br>' +
    '<b>H</b> hide this panel &nbsp; <b>+ / -</b> zoom &nbsp; <b>P</b> pause' +
    '<h2 style="margin-top:18px">Live tune</h2>' +
    'Someone at a terminal can change the bike while you ride:<br>' +
    '<code>bin/spec set gravity 9.2</code><br>' +
    '<code>bin/spec unset gravity</code> &nbsp; <code>bin/spec reset</code><br>' +
    '<code>bin/spec --paths</code> lists every field.<br>' +
    'Applying a change restarts the attempt, on purpose — a replay records the spec hash.';
  root.append(keys);

  function refreshHash(): void {
    // The EFFECTIVE hash, because that is the one a replay records and the one
    // bin/spec prints. Showing the local hash while a remote override is in
    // force would make the two disagree for no reason anybody could see.
    sub.textContent = `spec ${specHash(effective())}`;
  }
  refreshHash();

  // DEFAULT CLOSED, remembered once touched.
  //
  // Someone opening the link should get the game, not a wall of sliders — the
  // panel is a development instrument and it was the first thing a visitor saw.
  // This is PRESENTATION, not access control: H still opens it for anyone who
  // knows the key, and this app deliberately has no idea who is on the other end
  // of the connection (HAProxy and the cush-auth device gate decide that, and
  // they pass no identity down here). Live tune makes the panel much less
  // necessary anyway — the bike can be changed from `bin/spec` without anybody
  // opening a slider.
  //
  // Remembered because the person who tunes does it constantly and must not
  // have to re-open it on every hot reload.
  let visible = loadFlag('panel', false);
  root.classList.toggle('hidden', !visible);
  return {
    sync(): void {
      for (const s of syncers) s();
      refreshHash();
    },
    setTuned(on: boolean): void {
      tuned.hidden = !on;
      tuned.textContent = on
        ? 'TUNED — these sliders are yours, not the preset. Restored across reloads; "Reset to preset" undoes it.'
        : '';
    },
    setLiveTune(on: boolean): void {
      liveBox.checked = on;
    },
    setRemote(paths: ReadonlySet<string>, note: string): void {
      for (const set of remoteSetters) set(paths);
      remoteBanner.hidden = paths.size === 0;
      remoteBanner.textContent = note;
      for (const s of syncers) s();
      refreshHash();
    },
    toggle(): void {
      visible = !visible;
      root.classList.toggle('hidden', !visible);
      saveFlag('panel', visible);
    },
    get visible() {
      return visible;
    },
  };
}

function el(tag: string, text: string): HTMLElement {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}

function button(text: string, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  if (cls) b.className = cls;
  return b;
}

function fallbackCopy(text: string, done: () => void): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  try {
    document.execCommand('copy');
    done();
  } finally {
    ta.remove();
  }
}
