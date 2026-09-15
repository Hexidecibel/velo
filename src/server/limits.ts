// Every number here exists because without it something unbounded reaches the
// sim. They are separated from the route handler so the rejections can be
// tested in plain node, and so that "what does this server refuse" is one
// screen rather than a hunt through `api.ts`.
import { INPUT_HZ, TICKS_PER_FRAME } from '@/sim/consts.ts';

/**
 * Wall-clock ceiling on a submitted run: ten minutes. A real run on the hardest
 * shipped level is well under two, and the orientation-drift measurement that
 * justified the rotor scheme was taken at exactly this length, so it is also
 * the longest run the determinism work has ever been checked at.
 */
export const MAX_RUN_SECONDS = 600;
export const MAX_FRAMES = MAX_RUN_SECONDS * INPUT_HZ;
export const MAX_TICKS = MAX_FRAMES * TICKS_PER_FRAME;

/**
 * 512 KB of encoded body. A real replay is about a kilobyte — the input stream
 * is run-length encoded — and the slack is for the level and spec a
 * self-contained file carries. This is checked BEFORE `JSON.parse`, because
 * `JSON.parse` on an attacker-chosen 200 MB string is itself the denial of
 * service.
 */
export const MAX_BODY_BYTES = 512 * 1024;

/**
 * One hash per `hashEvery` frames plus slack. An unbounded `hashes` array is
 * the same class of hazard as an unbounded RLE run: it is a length the
 * submitter chooses and the server allocates against. The body cap bounds it
 * too, but only accidentally, and a limit that holds by accident is not a limit.
 */
export const MAX_HASHES = Math.ceil(MAX_FRAMES / 8) + 16;

/**
 * How long one verification may take before it is abandoned.
 *
 * The honest measurement: a three-minute run is ~23k input frames — 92k sim
 * ticks — and re-simulates in roughly 0.15 s. Ten minutes is ~0.5 s. Two
 * seconds is therefore four times the worst legitimate case, which makes a
 * timeout mean "something is wrong" rather than "the box was busy".
 */
export const VERIFY_BUDGET_MS = 2000;

/**
 * Input frames simulated between yields to the event loop.
 *
 * This is why verification is not inline in the request handler. The work is
 * cheap but it is SYNCHRONOUS, and a synchronous 0.5 s in a single-threaded
 * server stalls the health probe, the static file serving and every other
 * player's poll for 0.5 s. Slicing hands the loop back about forty times
 * across the longest legal run, which keeps the process responsive and is what
 * makes the wall-clock budget above enforceable at all — you cannot time out a
 * loop that never yields.
 *
 * It cannot affect a verdict: `verifyReplaySteps` only decides where to pause.
 */
export const VERIFY_SLICE_FRAMES = 2048;

/**
 * Submissions waiting at once. Beyond this the server says "busy" rather than
 * queueing unboundedly, because an unbounded queue is just a slower way to run
 * out of memory. Twelve is far past what a friend group generates.
 */
export const MAX_QUEUE_DEPTH = 12;

/**
 * Per-player submission rate. Not a security control — there is no
 * authentication here and a playerId is self-asserted, so this is a guard
 * against a wedged client resubmitting in a loop, which is a real incident on
 * this box (a spin-looping client made 49k failed requests in six hours).
 */
export const SUBMIT_PER_MINUTE = 30;
