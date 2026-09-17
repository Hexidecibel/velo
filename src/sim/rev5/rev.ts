// The rev number of THIS directory, and nothing else.
//
// `src/sim/rev.ts` is the dispatcher — the file that knows every rev exists and
// hands out engines. This one is the rev's own identity constant, kept local so
// that `replay.ts` in this directory stamps and checks rev 5 without importing
// anything from outside the directory. That import is the whole reason the file
// exists: the isolation rule for a rev directory is that it imports NOTHING
// beyond itself, which is what makes a rev freezable.
export const SIM_REV = 5;
