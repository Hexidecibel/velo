// Keyboard to input bitmask.
//
// The mask is sampled by the fixed-step loop, once per SIM input frame, never
// once per rendered frame — see loop.ts. That is the fairness decision from the
// plan: a 144 Hz display must not buy finer input timing than a 60 Hz one.
import { IN_BRAKE, IN_FLIP, IN_LEAN_L, IN_LEAN_R, IN_THROTTLE } from '@/sim/consts.ts';

const BINDINGS: Record<string, number> = {
  ArrowUp: IN_THROTTLE,
  KeyW: IN_THROTTLE,
  ArrowDown: IN_BRAKE,
  KeyS: IN_BRAKE,
  ArrowLeft: IN_LEAN_L,
  KeyA: IN_LEAN_L,
  ArrowRight: IN_LEAN_R,
  KeyD: IN_LEAN_R,
  Space: IN_FLIP,
  ShiftLeft: IN_FLIP,
};

/**
 * Keys whose BROWSER default must not fire even though they are not sim input.
 * Tab is hold-to-overview, and without this it walks focus through the tuning
 * panel's sliders the moment you hold it — and then the keyup lands on a
 * different element and the overview sticks on.
 */
const PREVENT_DEFAULT_COMMANDS = new Set(['Tab']);

export interface Input {
  mask(): number;
  /**
   * Add another producer of sim bits — the touch pads, today.
   *
   * IT GOES THROUGH `mask()` RATHER THAN AROUND IT, and that is the whole of
   * why a phone run and a desktop run are the same kind of thing. The fixed
   * step loop samples `mask()` once per input frame at 128 Hz, the recorder
   * captures what the sim was advanced with, and neither learns where a bit came
   * from. A touch-played run therefore records a byte-identical stream to the
   * same buttons pressed on a keyboard and re-verifies on the server the same
   * way — which would not be true of a second mask OR-ed in at the call site,
   * because there are three call sites and one of them would eventually be
   * missed.
   */
  addSource(fn: () => number): void;
  /** Commands that are not part of the sim's input stream. */
  onCommand(fn: (code: string) => void): void;
  /**
   * Command key RELEASES, for hold-to-<something> bindings.
   *
   * Also fired for every command key still held when the window loses focus,
   * for the same reason `blur` clears the sim mask: alt-tabbing away mid-hold
   * must not leave the hold latched on forever with no key to release.
   */
  onCommandUp(fn: (code: string) => void): void;
  detach(): void;
}

export function createInput(target: HTMLElement | Window = window): Input {
  let held = 0;
  /** Other producers of sim bits, OR-ed into every sample. See `addSource`. */
  const sources: (() => number)[] = [];
  const commands: ((code: string) => void)[] = [];
  const releases: ((code: string) => void)[] = [];
  // Command keys currently down, so a release can be reported for exactly the
  // presses that were reported — never for one that was swallowed by a text
  // field, and never twice.
  const downCommands = new Set<string>();

  const release = (code: string): void => {
    if (!downCommands.delete(code)) return;
    for (const fn of releases) fn(code);
  };

  const down = (e: KeyboardEvent): void => {
    if (e.repeat) {
      if (BINDINGS[e.code] !== undefined || PREVENT_DEFAULT_COMMANDS.has(e.code)) e.preventDefault();
      return;
    }
    const bit = BINDINGS[e.code];
    if (bit !== undefined) {
      held |= bit;
      e.preventDefault();
      return;
    }
    // Typing in the tuning panel must not restart the run — and Tab in a text
    // field must still move to the next field, which is why this check comes
    // before the preventDefault below.
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (PREVENT_DEFAULT_COMMANDS.has(e.code)) e.preventDefault();
    downCommands.add(e.code);
    for (const fn of commands) fn(e.code);
  };
  const up = (e: KeyboardEvent): void => {
    const bit = BINDINGS[e.code];
    if (bit !== undefined) {
      held &= ~bit;
      e.preventDefault();
      return;
    }
    if (PREVENT_DEFAULT_COMMANDS.has(e.code)) e.preventDefault();
    release(e.code);
  };
  // Alt-tabbing away with the throttle down must not leave it down. Nor a hold.
  const blur = (): void => {
    held = 0;
    for (const code of [...downCommands]) release(code);
  };

  const el = target as Window;
  el.addEventListener('keydown', down as EventListener);
  el.addEventListener('keyup', up as EventListener);
  window.addEventListener('blur', blur);

  return {
    mask: () => {
      let m = held;
      for (const src of sources) m |= src();
      return m;
    },
    addSource: (fn) => sources.push(fn),
    onCommand: (fn) => commands.push(fn),
    onCommandUp: (fn) => releases.push(fn),
    detach: () => {
      el.removeEventListener('keydown', down as EventListener);
      el.removeEventListener('keyup', up as EventListener);
      window.removeEventListener('blur', blur);
    },
  };
}
