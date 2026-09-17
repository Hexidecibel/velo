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
import type { ArtParams } from './art/params.ts';
import type { AudioParams } from './audio/params.ts';
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
    why: 'Attitude torque is the big one — it is the primary rotation control and it works identically upright, inverted and spinning. Weight transfer and the two inertial transfers are the rider\'s load on the pivot: one static, and one from acceleration split by its SIGN — a real rider shifts forward under power to keep the front down, so the nose-lift half is not the nose-dive half. The pendulum below them moves the rider and therefore the HEAD, which is what makes volting under a low ceiling lethal.',
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
        label: 'inertial transfer — brake', paths: ['rider.inertialTransferBrake'], min: 0, max: 3, step: 0.05,
        hint: 'BRAKE DIVE. The rider\'s mass reacting to the pivot DECELERATING — brake and the nose slams down, land and the weight lands with you. 0 is the old bike with no dive at all. Full brake at 9 m/s, nose-down at 0.15 s: 0 -> 17 deg, 0.6 -> 33, 1.0 -> 42.',
        get: (s) => s.rider.inertialTransferBrake, set: (s, v) => { s.rider.inertialTransferBrake = v; },
      },
      {
        label: 'inertial transfer — drive', paths: ['rider.inertialTransferDrive'], min: 0, max: 3, step: 0.05,
        hint: 'LAUNCH WHEELIE. The same mass reacting to the pivot ACCELERATING, and a separate number because a real rider shifts their weight forward to keep the front down. Above 0.37 at maxTorque 126 the front lifts at full throttle; match it to the brake slider for the symmetric rev-3 bike.',
        get: (s) => s.rider.inertialTransferDrive, set: (s, v) => { s.rider.inertialTransferDrive = v; },
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
    why: 'Not physics — the sim never sees any of this, and it must not, or a time would depend on how somebody framed their screen. The unit that matters is METRES OF WORLD ON SCREEN, not px/m: the base zoom is an anchor measured on one window width and every other viewport derives from it, so a phone and an ultrawide see comparable amounts of level. The one rule that outranks that: the collision edge must stay readable, so min zoom is a hard floor and a narrow screen sees less world rather than a mushier edge.',
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
        label: 'base zoom (px/m @ ref)', min: 20, max: 140, step: 1,
        hint: 'An ANCHOR, not the zoom: px/m on a reference-width window. Every other viewport derives from it, so what the number really sets is how many metres of level are on screen — 1600 / 62 = 25.8 m, which is what the levels were authored at.',
        get: (c) => c.baseZoom, set: (c, v) => { c.baseZoom = v; },
      },
      {
        label: 'reference width (px)', min: 320, max: 3840, step: 10,
        hint: 'The window width the base zoom was measured on. 1600 px, because that is the window all twenty levels were played at while they were being tuned.',
        get: (c) => c.refWidth, set: (c, v) => { c.refWidth = v; },
      },
      {
        label: 'viewport exponent', min: 0, max: 1, step: 0.05,
        hint: '0 = fixed px/m, so a phone sees half the level a desktop does (this is what was wrong). 1 = fixed world width, which asks a phone for less than the readability floor. 0.5 is the geometric mean of "same level visible" and "same apparent size", and it is what ships.',
        get: (c) => c.widthExp, set: (c, v) => { c.widthExp = v; },
      },
      {
        label: 'MIN zoom (px/m)', min: 20, max: 140, step: 1,
        hint: 'The readability floor and the highest-priority rule here. Below ~34 the 1.7 m bike is under 58 px and you are guessing at clearances. It is also the ratio the speed zoom-out uses: min/base is how far out speed takes you on ANY viewport, floored by this same number.',
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
      {
        label: 'screen bias up', min: 0, max: 0.4, step: 0.01,
        hint: 'Pushes the bike UP the frame. 0 on a desktop; the touch controls raise it, because in landscape your hands cover the bottom corners — which is exactly where a grounded bike sits when the camera centres it.',
        get: (c) => c.screenBiasY, set: (c, v) => { c.screenBiasY = v; },
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


const AUDIO_GROUPS: Group<AudioParams>[] = [
  {
    title: 'Sound',
    why: 'Everything is synthesised — oscillators and one buffer of noise, no samples, no files — so every one of these is a real continuous parameter rather than a choice between two recordings. The engine is the one that matters: its pitch is bound to WHEEL ANGULAR VELOCITY, not to ground speed, which is why wheelspin and mid-air throttle sound like something is happening. Tune it by ear against a RESTART LOOP rather than a single play: the launch is the sound you will hear hundreds of times in a session, and anything sharp there is hated by attempt fifty.',
    fields: [
      {
        label: 'MUTE (0/1)', min: 0, max: 1, step: 1,
        hint: 'Also the M key, and remembered. Muting SUSPENDS the audio context rather than turning a gain down, so a muted game costs nothing at all — same as a backgrounded tab.',
        get: (a) => a.muted, set: (a, v) => { a.muted = v; },
      },
      {
        label: 'master volume', min: 0, max: 1, step: 0.01,
        get: (a) => a.master, set: (a, v) => { a.master = v; },
      },
      {
        label: 'engine idle (Hz)', min: 20, max: 160, step: 1,
        hint: 'Pitch at a stopped wheel. THE most-heard sound in the game, so it is deliberately low and dull — every restart starts here.',
        get: (a) => a.engineIdleHz, set: (a, v) => { a.engineIdleHz = v; },
      },
      {
        label: 'engine max (Hz)', min: 80, max: 900, step: 5,
        hint: 'Pitch at spec.drive.maxWheelSpin, where drive torque has tapered to zero. Above that spin the sound stops climbing, because the bike has stopped being able to push.',
        get: (a) => a.engineRevHz, set: (a, v) => { a.engineRevHz = v; },
      },
      {
        label: 'engine pitch curve', min: 0.2, max: 2, step: 0.02,
        hint: 'Exponent on normalised wheel spin. Below 1 spreads the bottom of the range, where the riding actually happens; at 1 the whole audible change is in the top third and pulling away sounds like nothing.',
        get: (a) => a.engineCurve, set: (a, v) => { a.engineCurve = v; },
      },
      {
        label: 'engine level', min: 0, max: 1, step: 0.01,
        get: (a) => a.engineLevel, set: (a, v) => { a.engineLevel = v; },
      },
      {
        label: 'engine detune (cents)', min: 0, max: 60, step: 1,
        hint: 'Between the two saw layers, split either side of the fundamental so this is not also a tuning slider. The "synthetic" in the tone — 0 is a clean single saw and reads as a test signal.',
        get: (a) => a.engineDetune, set: (a, v) => { a.engineDetune = v; },
      },
      {
        label: 'engine sub', min: 0, max: 1, step: 0.01,
        hint: 'Square wave an octave down. Body, not pitch. On a laptop speaker most of this is inaudible and it costs nothing to leave in for headphones.',
        get: (a) => a.engineSub, set: (a, v) => { a.engineSub = v; },
      },
      {
        label: 'impact sensitivity', min: 0, max: 2, step: 0.02,
        hint: 'Landing thump. Strength comes from the speed the wheel was falling at AND how far the suspension compressed — a drop onto a flat and the same speed into a berm are different landings and the springs already know it.',
        get: (a) => a.impact, set: (a, v) => { a.impact = v; },
      },
      {
        label: 'impact floor (m/s)', min: 0, max: 8, step: 0.1,
        hint: 'Fall speed below which a touchdown is silent. Raise it if ordinary riding is thumping.',
        get: (a) => a.impactFrom, set: (a, v) => { a.impactFrom = v; },
      },
      {
        label: 'impact full (m/s over floor)', min: 2, max: 25, step: 0.5,
        hint: 'How much more fall speed takes a landing from just-audible to full strength.',
        get: (a) => a.impactSpan, set: (a, v) => { a.impactSpan = v; },
      },
      {
        label: 'tyre scrub', min: 0, max: 1, step: 0.01,
        hint: 'Wheelspin and lockup, from the contact-patch slip the sim solves friction against. Zero while the tyre grips.',
        get: (a) => a.scrub, set: (a, v) => { a.scrub = v; },
      },
      {
        label: 'scrub deadband (m/s)', min: 0, max: 3, step: 0.05,
        hint: 'Slip below this counts as grip. Without a deadband the tyre hisses continuously and you stop hearing the one case that matters.',
        get: (a) => a.scrubFloor, set: (a, v) => { a.scrubFloor = v; },
      },
      {
        label: 'suspension creak', min: 0, max: 1, step: 0.01,
        hint: 'Tracks compression RATE, so a parked bike is silent and a bike crossing a ridge is not. This is also what covers every bump that never leaves the ground.',
        get: (a) => a.suspension, set: (a, v) => { a.suspension = v; },
      },
      {
        label: 'wind', min: 0, max: 1, step: 0.01,
        hint: 'Air noise rising with speed, loudest airborne.',
        get: (a) => a.wind, set: (a, v) => { a.wind = v; },
      },
      {
        label: 'flip whoosh', min: 0, max: 1, step: 0.01,
        hint: 'Space is free and legal mid-air, so this is one of the most-repeated sounds in the game. Keep it short and quiet or turn it off.',
        get: (a) => a.flip, set: (a, v) => { a.flip = v; },
      },
      {
        label: 'apple pickup', min: 0, max: 1, step: 0.01,
        hint: 'Climbs a pentatonic ladder within a run, so a clean sweep of a level is a rising phrase and not the same blip eight times.',
        get: (a) => a.pickup, set: (a, v) => { a.pickup = v; },
      },
      {
        label: 'flower / finish', min: 0, max: 1, step: 0.01,
        get: (a) => a.finish, set: (a, v) => { a.finish = v; },
      },
      {
        label: 'death', min: 0, max: 1, step: 0.01,
        hint: 'Your head hitting terrain is the core tension of the game and this is the one sound allowed any weight. It is still half a second of dull crunch, because it is also the sound of the loop restarting.',
        get: (a) => a.death, set: (a, v) => { a.death = v; },
      },
    ],
  },
];

const ART_GROUPS: Group<ArtParams>[] = [
  {
    title: 'Art',
    why: 'Solids are DARK and air is LIGHT — the inverse of the flat renderer — and every collidable edge carries ink plus a coloured lip: yellow on tops, orange on sides, lilac on undersides. That inversion plus the ink rule is the whole bet, and the acceptance test for it is not "does it look good" but "is the collision boundary still the most legible line in the frame". Leave the first slider here so you can A/B it (V does the same) — that comparison is the only honest way to judge it.',
    fields: [
      {
        label: 'ART ON (0/1)', min: 0, max: 1, step: 1,
        hint: '0 is the old flat renderer, on the same frame. Kept deliberately: readability is judged by flipping, not by staring.',
        get: (a) => a.enabled, set: (a, v) => { a.enabled = v; },
      },
      {
        label: 'ink width (px)', min: 0, max: 12, step: 0.5,
        hint: 'SCREEN pixels, not metres — the readability rule is about what an eye can resolve, so this must not shrink when you zoom out. Centred on the true collision boundary.',
        get: (a) => a.inkWidth, set: (a, v) => { a.inkWidth = v; },
      },
      {
        label: 'lip width (px)', min: 0, max: 12, step: 0.5,
        hint: 'Coloured band just INSIDE the edge, and the thing that says which way a surface faces. It is stroked wide enough to survive the ink covering half of it; at 2.5 it came out as one blended pixel.',
        get: (a) => a.lipWidth, set: (a, v) => { a.lipWidth = v; },
      },
      {
        label: 'ink full-size zoom', min: 10, max: 120, step: 1,
        hint: 'Above this zoom ink and lip are full width; below it they shrink, because 5 px of ink on every edge of a 330 m level in the overview is a hairball and the overview is about shape.',
        get: (a) => a.inkFullZoom, set: (a, v) => { a.inkFullZoom = v; },
      },
      {
        label: 'ink min scale', min: 0.1, max: 1, step: 0.05,
        get: (a) => a.inkMinScale, set: (a, v) => { a.inkMinScale = v; },
      },
      {
        label: 'texture opacity', min: 0, max: 1, step: 0.05,
        hint: 'Blotches and cracks on the terrain. Opacity rather than density on purpose: density is baked, and rebuilding a level\'s geometry mid-drag would make this slider useless. One of the two most expensive layers.',
        get: (a) => a.detail, set: (a, v) => { a.detail = v; },
      },
      {
        label: 'hatch', min: 0, max: 1, step: 0.05,
        hint: 'Diagonal tooth over the terrain. The other expensive layer, and the first thing to turn down on a slow machine — it is a five per cent wash.',
        get: (a) => a.hatch, set: (a, v) => { a.hatch = v; },
      },
      {
        label: 'wall detail', min: 0, max: 1, step: 0.05,
        hint: 'Concrete panel grid, seeded panel tones and stains behind the play space.',
        get: (a) => a.wall, set: (a, v) => { a.wall = v; },
      },
      {
        label: 'stencils', min: 0, max: 1, step: 0.05,
        hint: 'Stamped marks along long top edges and on wall panels. Kept quiet: these must never compete with the edge.',
        get: (a) => a.stamps, set: (a, v) => { a.stamps = v; },
      },
      {
        label: 'hazard chevrons', min: 0, max: 1, step: 0.05,
        hint: 'Striped blocks at every convex top-to-side corner, which is every ledge you can ride off. The cheapest safety feature in the game: it marks the drop-offs of a level nobody has looked at.',
        get: (a) => a.chevrons, set: (a, v) => { a.chevrons = v; },
      },
      {
        label: 'under-ledge works', min: 0, max: 1, step: 0.05,
        hint: 'Shadow bands under ceilings, and bracketed pipework under the long ones. Pipework only appears where there is real clearance below — slinging a pipe through a low corridor would look like collidable geometry.',
        get: (a) => a.underworks, set: (a, v) => { a.underworks = v; },
      },
      {
        label: 'cel band scale', min: 0, max: 2, step: 0.05,
        hint: 'Width of the lit / mid / dark bands along each edge class. World units, unlike the ink: a band is material catching light.',
        get: (a) => a.bandScale, set: (a, v) => { a.bandScale = v; },
      },
      {
        label: 'dust motes', min: 0, max: 200, step: 5,
        get: (a) => a.motes, set: (a, v) => { a.motes = v; },
      },
      {
        label: 'game HUD (0/1)', min: 0, max: 1, step: 1,
        hint: 'The in-canvas card, clock and apple count. Separate from the developer readout in the top left, which is not the game HUD and never was.',
        get: (a) => a.hud, set: (a, v) => { a.hud = v; },
      },
      {
        label: 'bloom', min: 0, max: 0.6, step: 0.01,
        hint: 'Screen-blended, at an eighth resolution. A full-res blur of a 1080p frame is several milliseconds and this is atmosphere.',
        get: (a) => a.bloom, set: (a, v) => { a.bloom = v; },
      },
      {
        label: 'bloom radius', min: 1, max: 20, step: 0.5,
        get: (a) => a.bloomRadius, set: (a, v) => { a.bloomRadius = v; },
      },
      {
        label: 'texture off below (px/m)', min: 3, max: 60, step: 1,
        hint: 'Texture is gone below this and full above the next slider. Both sit under the play camera\'s 38 px/m floor, so this only ever fires in the overview — where the texture is sub-pixel mud AND by far the most expensive thing on screen.',
        get: (a) => a.artOffZoom, set: (a, v) => { a.artOffZoom = v; },
      },
      {
        label: 'texture full above (px/m)', min: 3, max: 90, step: 1,
        get: (a) => a.artFadeZoom, set: (a, v) => { a.artFadeZoom = v; },
      },
      {
        label: 'floor/ceiling angle (deg)', min: 20, max: 80, step: 1,
        hint: 'Degrees off horizontal at which a face stops counting as a floor and starts counting as a wall. It decides the colour of every lip in the level, so it is the one art parameter that REBUILDS the bake when you move it.',
        get: (a) => a.faceAngle, set: (a, v) => { a.faceAngle = v; },
      },
    ],
  },
  {
    title: 'Per-level look',
    why: 'Twenty levels used to share one palette and one set of seeded parameters, so they read as twenty screenshots of the same room. Each level now derives its own palette from its simHash — with the collision lip held above a contrast floor by construction, so a generated palette cannot break the one rule the look exists to serve — and its own panel pitch, hatch, stain density, band contrast and light-wedge angle on top. The first two sliders are the A/B for whether that earned its place: at 0 every level is drawn exactly the way Phase 1 drew it.',
    fields: [
      {
        label: 'per-level palettes (0/1)', min: 0, max: 1, step: 1,
        hint: '1 derives a palette from each level\'s simHash; 0 paints every level in the one hand-authored concrete palette, which is Phase 1\'s look. An explicit style.palette or style.colors in the level file still wins over both. REBUILDS the bake.',
        get: (a) => a.derive, set: (a, v) => { a.derive = v; },
      },
      {
        label: 'variety', min: 0, max: 1, step: 0.05,
        hint: 'How far a level\'s NON-colour look may stray from the mid parameters — panel pitch, hatch pitch and run, stain density, band contrast, number of light shafts and where they fall. A palette swap alone still reads as the same room repainted, so this is the other half. REBUILDS the bake.',
        get: (a) => a.variety, set: (a, v) => { a.variety = v; },
      },
      {
        label: 'props', min: 0, max: 1, step: 0.05,
        hint: 'Set dressing: pieces, tags, signage, posters, ladders, lamps, vents, conduit, banners and painted floor markings. Placed from the level\'s own clearance field and budgeted by area AND by how solid a typical frame of the level is, so the levels with no headroom get the fewest. A draw-time gate, so moving it does not rebuild anything.',
        get: (a) => a.props, set: (a, v) => { a.props = v; },
      },
      {
        label: 'parallax depth layers', min: 0, max: 1, step: 0.05,
        hint: 'Silhouettes of the level\'s OWN geometry, scaled and held back behind the play space. One fill per polygon per layer and no bake at all, which is why it earns its place; it is also the only backdrop that cannot contradict the level, because it is the level.',
        get: (a) => a.parallax, set: (a, v) => { a.parallax = v; },
      },
    ],
  },
  {
    title: 'Adaptive detail',
    why: 'Reported from play on a machine WITH a GPU, on 20-close-quarters: "feels choppy a lil bit sometimes", and then "its not like SUPER choppy, just a tiny bit here and there". Occasional dropped frames, not a low frame rate — which matches that level measuring 89% of the budget in Phase 1. It is the SHORTEST level in the set, so its whole height is on screen and the solid fills nine tenths of the frame; cost tracks visible solid area, not level size. This gives back what a long frame costs and no more: bloom first, then blotches and cracks, then hatch, then wall detail, then nothing. It never touches the ink, the lip or the cel bands. The HUD shows a DETAIL chip whenever it is doing anything at all.',
    fields: [
      {
        label: 'adaptive (0/1)', min: 0, max: 1, step: 1,
        hint: '0 always draws full detail, which is what bin/artbench measures — a standing budget check that let the renderer turn layers off to pass would not be a check.',
        get: (a) => a.adaptive, set: (a, v) => { a.adaptive = v; },
      },
      {
        label: 'art budget (ms)', min: 4, max: 16, step: 0.5,
        hint: 'Milliseconds the ART RENDER CALL may take, not the whole frame. The sim step, the HUD and the browser\'s own compositing come out of the same 16.7, so aiming this at the full budget is how you ship something that drops frames while every measurement says it fits.',
        get: (a) => a.adaptTarget, set: (a, v) => { a.adaptTarget = v; },
      },
      {
        label: 'detail floor', min: 0.1, max: 1, step: 0.05,
        hint: 'How far detail may be scaled back. 1 disables the scaling entirely. At 0.2 the cel bands, the ink, the lip, the silhouette and a trace of texture all survive — below that the look stops being the look.',
        get: (a) => a.adaptFloor, set: (a, v) => { a.adaptFloor = v; },
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
  /** An art field moved. Read every frame; `faceAngle` triggers a rebake. */
  onArtChange(art: ArtParams): void;
  /** An audio field moved. Read every frame, except mute, which is lifecycle. */
  onAudioChange(audio: AudioParams): void;
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
  art: ArtParams,
  audio: AudioParams,
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
  buildGroups(ART_GROUPS, art, (a) => hooks.onArtChange(a));
  buildGroups(AUDIO_GROUPS, audio, (a) => hooks.onAudioChange(a));

  const keys = document.createElement('div');
  keys.className = 'keys';
  keys.innerHTML =
    '<h2 style="margin-top:18px">Keys</h2>' +
    '<b>arrows / WASD</b> gas, brake, volt left, volt right<br>' +
    '<b>space</b> FLIP direction &nbsp; <b>R</b> restart &nbsp; <b>T</b> replay last run<br>' +
    '<b>E</b> export replay &nbsp; <b>L</b> load a replay file (or drop one on the window)<br>' +
    '<b>TAB</b> (hold) see the whole level — the sim and the clock freeze<br>' +
    '<b>[ / ]</b> previous / next level &nbsp; <b>G</b> contacts &amp; normals<br>' +
    '<b>H</b> hide this panel &nbsp; <b>+ / -</b> zoom &nbsp; <b>P</b> pause<br>' +
    '<b>V</b> art on / off — the A/B for readability &nbsp; <b>M</b> mute' +
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
