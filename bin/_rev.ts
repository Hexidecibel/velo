// Picking a physics rev from a command line, in one place.
//
// Every measuring rig in bin/ now has to be able to run on more than one rev,
// because rev 4 is the game and rev 5 is the experiment and a measurement that
// cannot state which one it was taken on is not a measurement. The flags are
// identical everywhere on purpose:
//
//   --rev N        which engine. Defaults to SIM_REV — the LIVE rev, not the
//                  newest one, so an existing invocation keeps meaning exactly
//                  what it meant before rev 5 existed.
//   --linear K     rev 5's `rider.inertialTransferLinear`. Ignored on rev 4,
//                  loudly, rather than silently accepted and dropped.
//
// The presets in src/client/presets.ts are rev-4 shaped and stay that way: a
// spec is a rev's own structure, `specHash` covers it, and adding a field to a
// preset is a decision about what the game ships, not about what a rig measures.
// So the rigs take the shipped bike and add the one field on the way past.
import { getEngine, SIM_REV, REVS } from '../src/sim/rev.ts';
import type { Engine } from '../src/sim/rev.ts';
import type { BikeSpec } from '../src/sim/spec.ts';

export interface RevChoice {
  rev: number;
  engine: Engine;
  /** rev 5's linear rider reaction. Meaningless below rev 5. */
  linear: number;
}

export function chooseRev(rev = SIM_REV, linear = 0): RevChoice {
  if (!REVS.includes(rev)) {
    console.error(`unknown --rev ${rev}; this build knows ${REVS.join(', ')}`);
    process.exit(2);
  }
  if (rev < 5 && linear !== 0) {
    console.error(`--linear ${linear} means nothing on rev ${rev}: the rider's linear reaction arrived in rev 5.`);
    process.exit(2);
  }
  return { rev, engine: getEngine(rev), linear };
}

/**
 * The shipped bike, expressed on the chosen rev.
 *
 * Going through the rev's own `parseSpec` rather than spreading an object is
 * deliberate: it is the rev that decides whether a field is required, and a
 * spec that would not parse is a spec no replay recorded with it could ever be
 * verified against.
 */
export function specOn(choice: RevChoice, base: BikeSpec): BikeSpec {
  if (choice.rev < 5) return base;
  return choice.engine.parseSpec({
    ...base,
    rider: { ...base.rider, inertialTransferLinear: choice.linear },
  });
}

/** How the rig should label its output. Always printed, never inferred. */
export function revLabel(choice: RevChoice): string {
  return choice.rev < 5 ? `rev ${choice.rev}` : `rev ${choice.rev}, linear ${choice.linear}`;
}
