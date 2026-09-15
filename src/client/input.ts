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

export interface Input {
  mask(): number;
  /** Commands that are not part of the sim's input stream. */
  onCommand(fn: (code: string) => void): void;
  detach(): void;
}

export function createInput(target: HTMLElement | Window = window): Input {
  let held = 0;
  const commands: ((code: string) => void)[] = [];

  const down = (e: KeyboardEvent): void => {
    if (e.repeat) {
      if (BINDINGS[e.code] !== undefined) e.preventDefault();
      return;
    }
    const bit = BINDINGS[e.code];
    if (bit !== undefined) {
      held |= bit;
      e.preventDefault();
      return;
    }
    // Typing in the tuning panel must not restart the run.
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    for (const fn of commands) fn(e.code);
  };
  const up = (e: KeyboardEvent): void => {
    const bit = BINDINGS[e.code];
    if (bit !== undefined) {
      held &= ~bit;
      e.preventDefault();
    }
  };
  // Alt-tabbing away with the throttle down must not leave it down.
  const blur = (): void => {
    held = 0;
  };

  const el = target as Window;
  el.addEventListener('keydown', down as EventListener);
  el.addEventListener('keyup', up as EventListener);
  window.addEventListener('blur', blur);

  return {
    mask: () => held,
    onCommand: (fn) => commands.push(fn),
    detach: () => {
      el.removeEventListener('keydown', down as EventListener);
      el.removeEventListener('keyup', up as EventListener);
      window.removeEventListener('blur', blur);
    },
  };
}
