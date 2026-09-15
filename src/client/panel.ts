// The tuning panel. This, not the renderer, is the milestone-1 deliverable.
//
// "Ride it until it feels good" means changing the BikeSpec dozens of times in
// a sitting, and doing that by editing a source file and waiting for HMR is
// roughly ten times slower than dragging a slider. The groups below are ordered
// by how much of the feel they own: suspension and wheel friction first (call
// it 80%), then volt authority, then drive, then chassis and world.
//
// The "Copy spec JSON" button is not a convenience. A slider emits doubles like
// 0.30000000000000004, and the exact doubles that were tuned with must be the
// exact doubles that ship — JSON.stringify emits the shortest representation
// that round-trips to the identical double, so the panel hands over the spec
// and nobody retypes it.
import type { BikeSpec } from '@/sim/spec.ts';
import { specHash } from '@/sim/spec.ts';
import { PRESETS, leanAngleOf, leanVectors } from './presets.ts';

interface Field {
  label: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
  get(s: BikeSpec): number;
  set(s: BikeSpec, v: number): void;
}

interface Group {
  title: string;
  why: string;
  fields: Field[];
}

const GROUPS: Group[] = [
  {
    title: 'Suspension & grip',
    why: 'About 80% of the feel lives here. Start with stiffness, then damping, then friction.',
    fields: [
      {
        label: 'spring stiffness', min: 1000, max: 40000, step: 50,
        hint: 'Zero rest length: the wheel is pulled to its anchor in ANY direction.',
        get: (s) => s.suspension.stiffness, set: (s, v) => { s.suspension.stiffness = v; },
      },
      {
        label: 'spring damping', min: 0, max: 2500, step: 5,
        hint: 'Critical for the sprung mass is around 1300. Below it the bike pogos.',
        get: (s) => s.suspension.damping, set: (s, v) => { s.suspension.damping = v; },
      },
      {
        label: 'max deflection (m)', min: 0.03, max: 0.6, step: 0.005,
        hint: 'Hard radial clamp. At these spring rates you almost never reach it.',
        get: (s) => s.suspension.maxDeflection, set: (s, v) => { s.suspension.maxDeflection = v; },
      },
      {
        label: 'wheel friction', min: 0.05, max: 3, step: 0.01,
        hint: 'Coulomb mu at the contact patch. This is what converts drive torque into motion.',
        get: (s) => s.wheel.friction, set: (s, v) => { s.wheel.friction = v; },
      },
      {
        label: 'wheel restitution', min: 0, max: 0.6, step: 0.005,
        hint: 'Keep it near zero. The SPRING should do the bouncing, not the tyre.',
        get: (s) => s.wheel.restitution, set: (s, v) => { s.wheel.restitution = v; },
      },
      {
        label: 'wheel radius (m)', min: 0.1, max: 0.5, step: 0.005,
        get: (s) => s.wheel.radius, set: (s, v) => { s.wheel.radius = v; },
      },
      {
        label: 'wheel mass (kg)', min: 0.5, max: 15, step: 0.1,
        hint: 'Unsprung mass. Heavy wheels hop; light ones skitter.',
        get: (s) => s.wheel.mass, set: (s, v) => { s.wheel.mass = v; },
      },
      {
        label: 'wheel inertia', min: 0.01, max: 0.8, step: 0.005,
        hint: 'The spin scalar. Low = instant wheelspin; high = the wheel stores energy and launches you on landing.',
        get: (s) => s.wheel.inertia, set: (s, v) => { s.wheel.inertia = v; },
      },
      {
        label: 'wheelbase / 2 (m)', min: 0.25, max: 1.2, step: 0.01,
        hint: 'Anchors stay symmetric — flip depends on that.',
        get: (s) => s.wheel.anchors[1].x,
        set: (s, v) => { s.wheel.anchors[0].x = -v; s.wheel.anchors[1].x = v; },
      },
      {
        label: 'anchor height (m)', min: -0.6, max: 0.4, step: 0.01,
        hint: 'Negative hangs the wheels below the frame. Raises or lowers the effective ride height.',
        get: (s) => s.wheel.anchors[0].y,
        set: (s, v) => { s.wheel.anchors[0].y = v; s.wheel.anchors[1].y = v; },
      },
    ],
  },
  {
    title: 'Volt authority',
    why: 'The rider is a driven pendulum. Lean angle is the big one — below ~50 degrees the servo reaction wins and a volt pitches the bike the WRONG way.',
    fields: [
      {
        label: 'lean angle (deg)', min: 0, max: 90, step: 0.5,
        hint: 'Baked to a unit vector here. The sim never calls Math.cos.',
        get: (s) => leanAngleOf(s),
        set: (s, v) => { Object.assign(s.rider, leanVectors(v)); },
      },
      {
        label: 'servo P', min: 0, max: 8000, step: 25,
        hint: 'Torque per unit of sine-error. How hard the rider yanks toward the target.',
        get: (s) => s.rider.servoP, set: (s, v) => { s.rider.servoP = v; },
      },
      {
        label: 'servo D', min: 0, max: 1500, step: 5,
        hint: 'Damps the arm against the CHASSIS, not the world — this is the rider gripping the bars.',
        get: (s) => s.rider.servoD, set: (s, v) => { s.rider.servoD = v; },
      },
      {
        label: 'servo max torque', min: 0, max: 3000, step: 10,
        get: (s) => s.rider.servoMaxTorque, set: (s, v) => { s.rider.servoMaxTorque = v; },
      },
      {
        label: 'rider mass (kg)', min: 5, max: 90, step: 0.5,
        hint: 'Volt authority is roughly (m*L^2*dTheta)/I_chassis.',
        get: (s) => s.rider.mass, set: (s, v) => { s.rider.mass = v; },
      },
      {
        label: 'arm length (m)', min: 0.2, max: 1.2, step: 0.01,
        hint: 'Squared in the volt formula, so this moves it faster than mass does.',
        get: (s) => s.rider.armLength, set: (s, v) => { s.rider.armLength = v; },
      },
      {
        label: 'head radius (m)', min: 0.04, max: 0.4, step: 0.005,
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
        label: 'max drive torque', min: 0, max: 900, step: 5,
        hint: 'Above ~160 with the plan geometry, full throttle backflips the bike from a standstill.',
        get: (s) => s.drive.maxTorque, set: (s, v) => { s.drive.maxTorque = v; },
      },
      {
        label: 'max wheel spin', min: 10, max: 200, step: 1,
        hint: 'Torque falls off linearly to zero here. Times the radius, it is your theoretical top speed.',
        get: (s) => s.drive.maxWheelSpin, set: (s, v) => { s.drive.maxWheelSpin = v; },
      },
      {
        label: 'brake torque', min: 0, max: 2000, step: 10,
        hint: 'Clamped per tick so it can never reverse the spin. 900 locks the wheel almost instantly.',
        get: (s) => s.drive.brakeTorque, set: (s, v) => { s.drive.brakeTorque = v; },
      },
    ],
  },
  {
    title: 'Chassis & world',
    why: 'Chassis inertia trades volt authority against how easily the throttle loops you. It is the sharpest knob on this panel.',
    fields: [
      {
        label: 'chassis mass (kg)', min: 5, max: 120, step: 0.5,
        get: (s) => s.chassis.mass, set: (s, v) => { s.chassis.mass = v; },
      },
      {
        label: 'chassis inertia', min: 1, max: 40, step: 0.25,
        hint: 'Lower = the volt rotates the bike harder AND the throttle loops it sooner.',
        get: (s) => s.chassis.inertia, set: (s, v) => { s.chassis.inertia = v; },
      },
      {
        label: 'linear damping', min: 0, max: 1.5, step: 0.005,
        hint: 'v /= (1 + c*DT). Air drag, roughly.',
        get: (s) => s.damping.linear, set: (s, v) => { s.damping.linear = v; },
      },
      {
        label: 'angular damping', min: 0, max: 6, step: 0.01,
        hint: 'Takes the ring out of the pitch axis after a landing.',
        get: (s) => s.damping.angular, set: (s, v) => { s.damping.angular = v; },
      },
      {
        label: 'gravity (m/s^2)', min: 0, max: 30, step: 0.1,
        get: (s) => s.gravity, set: (s, v) => { s.gravity = v; },
      },
    ],
  },
];

export interface PanelHooks {
  /** A spec field moved. The sim is rebuilt around the new spec in place. */
  onSpecChange(spec: BikeSpec): void;
  /** A whole preset was selected; the run restarts. */
  onPreset(spec: BikeSpec, label: string): void;
  onRestart(): void;
  onReplay(): void;
}

export interface Panel {
  /** Re-read every field from the spec (after a preset swap). */
  sync(): void;
  toggle(): void;
  readonly visible: boolean;
}

/** Readable, not exact. The COPY button is what carries the exact doubles. */
function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const s = v.toPrecision(7);
  return String(parseFloat(s));
}

export function createPanel(root: HTMLElement, spec: BikeSpec, hooks: PanelHooks): Panel {
  root.textContent = '';
  const syncers: (() => void)[] = [];

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

  const btns = document.createElement('div');
  btns.className = 'btns';
  const copy = button('Copy spec JSON', 'primary');
  const restart = button('Restart (R)');
  const replay = button('Replay (T)');
  btns.append(copy, restart, replay);
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

  for (const g of GROUPS) {
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
        const v = f.get(spec);
        range.value = String(v);
        num.value = fmt(v);
      };
      syncers.push(sync);
      sync();

      range.addEventListener('input', () => {
        f.set(spec, parseFloat(range.value));
        num.value = fmt(f.get(spec));
        hooks.onSpecChange(spec);
        refreshHash();
      });
      // Typing an exact value beats hunting for it with a slider.
      num.addEventListener('change', () => {
        const v = parseFloat(num.value);
        if (!Number.isFinite(v)) {
          sync();
          return;
        }
        f.set(spec, v);
        sync();
        hooks.onSpecChange(spec);
        refreshHash();
      });
    }
  }

  const keys = document.createElement('div');
  keys.className = 'keys';
  keys.innerHTML =
    '<h2 style="margin-top:18px">Keys</h2>' +
    '<b>arrows / WASD</b> gas, brake, volt left, volt right<br>' +
    '<b>space</b> flip &nbsp; <b>R</b> restart &nbsp; <b>T</b> replay last run<br>' +
    '<b>G</b> contacts &amp; normals &nbsp; <b>H</b> hide this panel<br>' +
    '<b>+ / -</b> zoom &nbsp; <b>P</b> pause';
  root.append(keys);

  function refreshHash(): void {
    sub.textContent = `spec ${specHash(spec)}`;
  }
  refreshHash();

  let visible = true;
  return {
    sync(): void {
      for (const s of syncers) s();
      refreshHash();
    },
    toggle(): void {
      visible = !visible;
      root.classList.toggle('hidden', !visible);
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
