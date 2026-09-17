// The submission pipeline, against a REAL replay.
//
// `fixture.replay.json` is `bin/level-drive`'s run of `01-first-light`, with
// the embedded level and spec stripped because the server looks the level up by
// simHash and pins the bike itself. It is 1,499 bytes for an 11.7-second run,
// which is the "~1 KB replay" claim made concrete rather than asserted.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fixture from './fixture.replay.json' with { type: 'json' };
import { SIM_REV } from '@/sim/rev.ts';
import { encodeInputs } from '@/sim/replay.ts';
import { parseSubmission, statusFor, submit } from './runs.ts';
import { MAX_FRAMES, MAX_HASHES } from './limits.ts';
import { OFFICIAL_SPEC_HASH } from './levels.ts';
import { ranked, sectionOf, standing } from './board.ts';
import { listReplays, readBoard, readPlayer, readSubmissions } from './store.ts';
import { DEFAULT_APPEARANCE } from '@/shared/appearance.ts';

const REPLAY = fixture as unknown as Record<string, unknown>;
const LEVEL_HASH = REPLAY.simHash as string;
const TICKS = REPLAY.timeTicks as number;

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'velo-runs-'));
  process.env.VELO_DATA_DIR = dir;
});
afterEach(() => {
  delete process.env.VELO_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const good = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  playerId: 'aaaaaaaa1111',
  name: 'Hexi',
  category: 'human',
  replay: REPLAY,
  ...over,
});

describe('the fixture itself', () => {
  it('is the shipped bike, the live rev, and about a kilobyte', () => {
    expect(REPLAY.simRev).toBe(SIM_REV);
    expect(REPLAY.specHash).toBe(OFFICIAL_SPEC_HASH);
    expect(JSON.stringify(REPLAY).length).toBeLessThan(2048);
  });
});

describe('submit — the happy path', () => {
  it('re-simulates, derives the time itself, and persists only then', async () => {
    const r = await submit(good());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.timeTicks).toBe(TICKS);
    expect(r.placement.rank).toBe(1);
    expect(r.placement.pb).toBe(true);

    // The blob, the board, the player file and the log — in that order of
    // dependence, all present.
    expect(listReplays(LEVEL_HASH).map((x) => x.id)).toEqual([r.replayId]);
    const board = readBoard(LEVEL_HASH);
    expect(ranked(sectionOf(board!, SIM_REV, 'human'))[0].playerId).toBe('aaaaaaaa1111');
    expect(readPlayer('aaaaaaaa1111')!.pbs[LEVEL_HASH][`rev${SIM_REV}`].human.timeTicks).toBe(TICKS);
    expect(readSubmissions().records.length).toBe(1);
  });

  it('IGNORES a lie about the time, because it never reads one', async () => {
    // The claimed time is checked against the re-simulation and a disagreement
    // is a rejection, so there is no way to submit a faster time than the
    // inputs produce. This is the property the whole design exists for.
    const r = await submit(good({ replay: { ...REPLAY, timeTicks: 1 } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('verification-failed');
    expect(r.reason).toMatch(/time disagrees/);
    // Nothing was written. Verify BEFORE persisting.
    expect(listReplays().length).toBe(0);
    expect(readBoard(LEVEL_HASH)).toBeNull();
  });

  it('rejects a tampered input stream through the hash chain', async () => {
    // Flip the BRAKE bit on one run of input frames, a third of the way in.
    // The periodic state hashes then disagree at the frame it happened, which
    // is the point of carrying them: a desync is loud and located rather than
    // discovered from a dispute months later.
    const parts = (REPLAY.inputs as string).split(',');
    const at = Math.floor(parts.length / 3);
    const [maskStr, count] = parts[at].split('*');
    parts[at] = `${Number(maskStr) ^ 2}${count ? `*${count}` : ''}`;
    const r = await submit(good({ replay: { ...REPLAY, inputs: parts.join(',') } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('verification-failed');
    expect(listReplays().length).toBe(0);
  });

  it('dedupes: the same stream from two players is one blob, two entries', async () => {
    const a = await submit(good());
    const b = await submit(good({ playerId: 'bbbbbbbb2222', name: 'Somebody' }));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.replayId).toBe(b.replayId);
    expect(listReplays().length).toBe(1);
    expect(Object.keys(sectionOf(readBoard(LEVEL_HASH)!, SIM_REV, 'human').best).length).toBe(2);
  });

  it('keeps human and TAS apart end to end', async () => {
    await submit(good());
    await submit(good({ playerId: 'velobot0000', name: 'bin/level-drive', category: 'tas' }));
    const board = readBoard(LEVEL_HASH)!;
    expect(ranked(sectionOf(board, SIM_REV, 'human')).map((e) => e.playerId)).toEqual(['aaaaaaaa1111']);
    expect(ranked(sectionOf(board, SIM_REV, 'tas')).map((e) => e.playerId)).toEqual(['velobot0000']);
  });

  it('offers the entry above a newcomer: the slowest time on the board', async () => {
    await submit(good());
    const board = readBoard(LEVEL_HASH)!;
    const s = standing(sectionOf(board, SIM_REV, 'human'), 'newcomer0000');
    expect(s.rank).toBeNull();
    expect(s.above?.playerId).toBe('aaaaaaaa1111');
  });

  it('a rename does not fork the player or their entry', async () => {
    await submit(good());
    const r = await submit(good({ name: 'renamed' }));
    expect(r.ok).toBe(true);
    const section = sectionOf(readBoard(LEVEL_HASH)!, SIM_REV, 'human');
    expect(Object.keys(section.best)).toEqual(['aaaaaaaa1111']);
    expect(section.best.aaaaaaaa1111.name).toBe('renamed');
    expect(section.accepted).toBe(2);
    expect(readPlayer('aaaaaaaa1111')!.name).toBe('renamed');
  });

  // --- appearance: presentation metadata, all the way through ---------------
  //
  // THE ASSERTION THAT LICENSES THE WHOLE CUSTOMISATION FEATURE: a run recorded
  // on a repainted bike still verifies and still counts. If a colour could
  // reach `specHash`, repainting would produce the "this bike is not the
  // shipped one" refusal — the message that has already confused this user
  // twice from the tuning panel — and that is the one failure mode nobody would
  // forgive.

  it('a run with a custom appearance verifies and counts exactly the same', async () => {
    const plain = await submit(good());
    expect(plain.ok).toBe(true);
    const painted = await submit(
      good({
        playerId: 'bbbbbbbb2222',
        appearance: { bike: 'bobber', paint: 'acid', helmet: 'bucket', jacket: 'vest', scarf: 'none', decal: 'checks' },
      }),
    );
    expect(painted.ok).toBe(true);
    if (!plain.ok || !painted.ok) return;
    // The SAME input stream, the same derived time, the same spec hash. The
    // only thing that differs is what the bike looks like.
    expect(painted.entry.timeTicks).toBe(plain.entry.timeTicks);
    expect(painted.entry.specHash).toBe(plain.entry.specHash);
    expect(painted.entry.specHash).toBe(OFFICIAL_SPEC_HASH);
    expect(painted.entry.appearance).toEqual({
      bike: 'bobber', paint: 'acid', helmet: 'bucket', jacket: 'vest', scarf: 'none', decal: 'checks',
    });
  });

  it('a repaint refreshes the appearance in place on a slower run', async () => {
    // EXACTLY THE BUG A TEST CAUGHT FOR THE NAME. A slower run does not
    // displace the entry — the time, the replay and the timestamp all stay —
    // but the denormalised presentation has to move, or repainting your bike
    // leaves every row you already hold showing the old one and repainting
    // looks broken while the data underneath is perfectly correct.
    await submit(good({ appearance: { bike: 'cafe', paint: 'ice' } }));
    const slower = await submit(
      good({
        appearance: { bike: 'mono', paint: 'orchid' },
        replay: { ...REPLAY, timeTicks: TICKS },
      }),
    );
    expect(slower.ok).toBe(true);
    const section = sectionOf(readBoard(LEVEL_HASH)!, SIM_REV, 'human');
    const held = section.best.aaaaaaaa1111;
    expect(held.timeTicks).toBe(TICKS);
    expect(held.appearance!.bike).toBe('mono');
    expect(held.appearance!.paint).toBe('orchid');
    // ...and the player file's PB carries the same refresh, for the same reason.
    const pb = readPlayer('aaaaaaaa1111')!.pbs[LEVEL_HASH][`rev${SIM_REV}`].human;
    expect(pb.appearance!.bike).toBe('mono');
  });

  it('a nonsense appearance is repaired rather than refusing the run', async () => {
    // A cosmetic hint must never be able to lose somebody their time — the same
    // posture `levelPalette` takes for a malformed `style.colors` override, and
    // the opposite of everything else in this pipeline.
    const r = await submit(good({ appearance: { bike: 'from-the-future', paint: 'mint', gravity: 3 } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.appearance!.paint).toBe('mint');
    expect(r.entry.appearance!.bike).toBe('scrambler');
  });

  it('an absent appearance is the shipped bike, not a refusal', async () => {
    // Every client older than this feature sends none, and `bin/submit` still
    // does. Absent must be ordinary.
    const r = await submit(good());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.appearance).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('submit — refusals', () => {
  it('refuses a mismatched SIM_REV with the SAME wording the CLI gives', async () => {
    const r = await submit(good({ replay: { ...REPLAY, simRev: SIM_REV - 1 } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('sim-rev-mismatch');
    expect(r.reason).toMatch(/SIM_REV mismatch/);
    expect(r.reason).toMatch(/refusal rather than a warning/);
    expect(statusFor(r.code)).toBe(409);
  });

  it('refuses a level it does not ship, whatever the file carries', async () => {
    const r = await submit(good({ replay: { ...REPLAY, simHash: 'ffffffffffffffff' } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('unknown-level');
    expect(statusFor(r.code)).toBe(404);
  });

  it('refuses a bike that is not the shipped one', async () => {
    const r = await submit(good({ replay: { ...REPLAY, specHash: 'ffffffffffffffff' } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('unknown-bike');
    expect(r.reason).toMatch(/shipped bike/);
  });

  it('refuses a run that did not finish', async () => {
    const r = await submit(good({ replay: { ...REPLAY, finished: false } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('not-a-finish');
  });
});

describe('parseSubmission — the caps', () => {
  it('refuses the unbounded RLE run outright', () => {
    // `[0, 4294967295]` — the trivial CPU/memory kill. Eight bytes of JSON
    // would otherwise become four billion array entries.
    const r = parseSubmission(good({ replay: { ...REPLAY, inputs: '0*4294967295', frames: 4294967295 } }));
    expect('ok' in r && r.ok === false).toBe(true);
    if (!('ok' in r)) return;
    expect(r.code).toBe('bad-replay');
  });

  it('refuses many SMALL runs that add up past the cap', () => {
    // The subtler version: each run is individually legal, and there are tens
    // of thousands of them. A per-run limit alone does not stop this, which is
    // why the cap is on the DECODED TOTAL.
    const part = '0*1000000';
    const inputs = new Array(200).fill(part).join(',');
    const r = parseSubmission(good({ replay: { ...REPLAY, inputs, frames: 200_000_000 } }));
    expect('ok' in r && r.ok === false).toBe(true);
    if (!('ok' in r)) return;
    expect(r.code).toBe('bad-replay');
  });

  it('refuses a run longer than ten minutes', () => {
    const r = parseSubmission(
      good({ replay: { ...REPLAY, inputs: encodeInputs(new Array(MAX_FRAMES + 1).fill(0)), frames: MAX_FRAMES + 1 } }),
    );
    expect('ok' in r && r.ok === false).toBe(true);
  });

  it('refuses an unbounded hashes array', () => {
    const r = parseSubmission(good({ replay: { ...REPLAY, hashes: new Array(MAX_HASHES + 1).fill('0000000000000000') } }));
    expect('ok' in r && r.ok === false).toBe(true);
    if (!('ok' in r)) return;
    expect(r.reason).toMatch(/hashes/);
  });

  it('refuses a bad envelope with a message about the field', () => {
    for (const [over, pattern] of [
      [{ playerId: 'no' }, /playerId/],
      [{ playerId: 'has-dashes-in-it' }, /playerId/],
      [{ name: '   ' }, /name/],
      [{ category: 'speedrun' }, /category/],
      [{ replay: null }, /replay/],
    ] as const) {
      const r = parseSubmission(good(over));
      expect('ok' in r && r.ok === false, JSON.stringify(over)).toBe(true);
      if ('ok' in r && r.ok === false) expect(r.reason).toMatch(pattern);
    }
    expect('ok' in parseSubmission('not an object')).toBe(true);
  });

  it('defaults an absent category to human', () => {
    const r = parseSubmission({ playerId: 'aaaaaaaa1111', name: 'Hexi', replay: REPLAY });
    expect('category' in r && r.category).toBe('human');
  });
});
