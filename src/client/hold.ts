// WHO IS HOLDING THE SIM, AND WHY.
//
// There is one gate in `main.ts`'s `step()` above every line that can move
// anything, and returning from it is a TOTAL guarantee rather than a best
// effort: `sim.advance` is not called, so no tick runs and `state.tick` — the
// clock — does not move; `recorder.capture` is not called, so the input stream
// gains no frame; `ghost.advance` is not called, so the ghost waits where it is.
// A run held for a minute banks a byte-identical replay to one never held at
// all, and that is the property every screen that covers the game has to keep.
//
// THIS FILE EXISTS BECAUSE THERE ARE NOW THREE OF THEM AND A FOURTH IS COMING.
// It started as one boolean — `overview.frozen` — and the second one (the about
// page) could have been a second `||` in the same `if`. Three could have been a
// third. The reason not to is not tidiness: it is that every one of those is a
// separate answer to the same question, and separate answers are how two of
// them end up disagreeing about whether the sim is running. One register, one
// question, one place to add the fourth.
//
// IT IS A REGISTER AND NOT A COUNTER. A holder is a NAMED PREDICATE that is
// asked every input frame, rather than something that pushes and pops. That is
// deliberate and it is the difference between this and a lock: a counter has to
// be balanced, and the failure mode of an unbalanced counter is a game that is
// permanently frozen with nothing on screen to say why. A predicate cannot leak
// — if the panel is shut, the panel is not holding anything, and there is no
// second piece of state that could disagree with it.
//
// WHAT IS *NOT* HERE: the armed start line. `armed.release(mask)` consumes the
// mask it is given and has to sit below `step()`'s dead-run branch so that a
// finished run still banks its replay, so it is a gate at a different place
// answering a different question — "has this run started" rather than "may
// anything move at all". Folding it in would move it, and moving it is the bug.
//
// No DOM, no clock, no imports, so it tests in plain node like everything else.

export interface SimHold {
  /**
   * Register a reason the sim might be held, with a name for the diagnostic.
   *
   * Wiring only — called once per source at boot, never from a frame. The
   * predicate is read late on purpose: the thing being asked usually does not
   * exist yet when this is called.
   */
  add(what: string, holding: () => boolean): void;
  /**
   * True when ANY registered source is holding.
   *
   * This is the one thing `step()` asks, at 128 Hz, so it short-circuits and
   * allocates nothing.
   */
  readonly held: boolean;
  /**
   * The names of everything currently holding, for the HUD and for a test that
   * wants to say WHICH one rather than merely that something did.
   *
   * Allocates, and is therefore for diagnostics rather than for the gate.
   */
  readonly by: readonly string[];
}

export function createSimHold(): SimHold {
  const sources: { what: string; holding: () => boolean }[] = [];
  return {
    add(what: string, holding: () => boolean): void {
      sources.push({ what, holding });
    },
    get held(): boolean {
      for (let i = 0; i < sources.length; i++) {
        if (sources[i].holding()) return true;
      }
      return false;
    },
    get by(): readonly string[] {
      const out: string[] = [];
      for (const s of sources) {
        if (s.holding()) out.push(s.what);
      }
      return out;
    },
  };
}
