// The game API. Mounted under /api by src/server/index.ts, and kept in its own
// file so the server entry stays the thing you read to find out how velo is
// served rather than how it is played.
//
// STILL NO AUTHENTICATION HERE, AND STILL ON PURPOSE. This binds loopback;
// HAProxy fronts it and the cush-auth device gate decides who gets in. What the
// gate does NOT do is tell this app who it let in — it sets no identity header,
// and HAProxy adds only `X-Forwarded-*`. That was verified directly rather than
// assumed. So the playerId and the display name below are self-asserted by the
// client, and the README says so in as many words instead of implying a
// guarantee that does not exist. Re-simulation means a TIME cannot be faked;
// WHOSE time it is can be.
import { Hono } from 'hono';
import { ticksToSeconds } from '@/sim/replay.ts';
import { SIM_REV } from '@/sim/rev.ts';
import { CATEGORIES, isCategory, ranked, sectionOf, standing, TOP_N } from './board.ts';
import type { Category } from './board.ts';
import { allLevels, levelBySimHash, OFFICIAL_SPEC_HASH } from './levels.ts';
import { MAX_BODY_BYTES, MAX_FRAMES, MAX_RUN_SECONDS } from './limits.ts';
import { queueStats, statusFor, submit } from './runs.ts';
import { isHashId, isPlayerId, readBoard, readPlayer, readReplay, findReplay } from './store.ts';

/**
 * Read a request body with a hard ceiling, refusing as soon as the ceiling is
 * crossed rather than after the whole thing is in memory.
 *
 * `content-length` alone is not enough: it is a header the client writes, and a
 * chunked request simply omits it. So the stream is counted as it arrives and
 * abandoned mid-flight. This is the difference between a size limit and a size
 * suggestion.
 */
async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<string | null> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

function categoryParam(v: string | undefined): Category | null {
  if (v === undefined || v === '') return 'human';
  return isCategory(v) ? v : null;
}

export function createApi(): Hono {
  const api = new Hono();

  /**
   * What this server will take a time on, and under what rules. One fetch, so
   * the client never has to hardcode a limit that the server owns — a client
   * and a server disagreeing about the cap means a player's run is refused
   * after they rode it, which is the worst possible moment to find out.
   */
  api.get('/rules', (c) =>
    c.json({
      simRev: SIM_REV,
      specHash: OFFICIAL_SPEC_HASH,
      categories: CATEGORIES,
      topN: TOP_N,
      maxFrames: MAX_FRAMES,
      maxRunSeconds: MAX_RUN_SECONDS,
      maxBodyBytes: MAX_BODY_BYTES,
      queue: queueStats(),
      // Said here as well as in the README, because this is the payload a
      // future client author reads and they should not have to go looking.
      identity:
        'playerId and name are self-asserted by the client and are NOT authenticated. ' +
        'Re-simulation proves a time is real; nothing here proves whose it is.',
    }),
  );

  /** Every level with a board, keyed by the only identity that counts. */
  api.get('/levels', (c) =>
    c.json({
      simRev: SIM_REV,
      levels: allLevels().map((l) => {
        const board = readBoard(l.simHash);
        const counts: Record<string, number> = {};
        for (const cat of CATEGORIES) {
          counts[cat] = board ? Object.keys(sectionOf(board, SIM_REV, cat).best).length : 0;
        }
        return { id: l.id, name: l.name, simHash: l.simHash, apples: l.appleCount, entries: counts };
      }),
    }),
  );

  /**
   * One board.
   *
   *   ?rev=3        which physics. Defaults to the rev this build IS.
   *   ?category=    human | tas. Defaults to human.
   *   ?player=<id>  adds `you`, `rank` and — the one that matters — `above`.
   *   ?limit=       how many of the top to return.
   *
   * `above` is computed here rather than in the client because the client only
   * ever receives the top N and the entry just above an unranked player is,
   * necessarily, the one at the BOTTOM of the board. Sending the whole `best`
   * map instead would work and would also hand every client every player's
   * times on every level, which is a lot of bytes for one question.
   */
  api.get('/leaderboard/:simHash', (c) => {
    const simHash = c.req.param('simHash');
    if (!isHashId(simHash)) return c.json({ error: 'simHash must be 16 hex characters' }, 400);

    const category = categoryParam(c.req.query('category'));
    if (!category) return c.json({ error: `category must be one of ${CATEGORIES.join(', ')}` }, 400);

    const revRaw = c.req.query('rev');
    const rev = revRaw === undefined || revRaw === '' ? SIM_REV : Number(revRaw);
    if (!Number.isInteger(rev) || rev < 0 || rev > 1e6) return c.json({ error: 'rev must be an integer' }, 400);

    const limitRaw = c.req.query('limit');
    const limit = limitRaw === undefined ? TOP_N : Math.max(1, Math.min(TOP_N, Number(limitRaw) || TOP_N));

    const player = c.req.query('player');
    if (player !== undefined && !isPlayerId(player)) return c.json({ error: 'bad player id' }, 400);

    const level = levelBySimHash(simHash);
    const board = readBoard(simHash);
    const section = board ? sectionOf(board, rev, category) : null;
    const order = section ? ranked(section) : [];
    const you = section ? standing(section, player ?? null) : { you: null, rank: null, total: 0, above: null, best: null };

    // Which other revs hold times for this level, so the client can say "there
    // are eleven times on the rev-2 board" instead of showing an empty page and
    // letting somebody think their runs were deleted.
    const otherRevs: { rev: number; entries: number }[] = [];
    if (board) {
      for (const [key, byCat] of Object.entries(board.revs)) {
        const n = Number(key.replace(/^rev/, ''));
        if (!Number.isInteger(n) || n === rev) continue;
        const count = Object.keys(byCat[category]?.best ?? {}).length;
        if (count > 0) otherRevs.push({ rev: n, entries: count });
      }
      otherRevs.sort((a, b) => b.rev - a.rev);
    }

    return c.json({
      simHash,
      rev,
      liveRev: SIM_REV,
      category,
      levelId: level?.id ?? null,
      levelName: level?.name ?? board?.levelName ?? null,
      total: order.length,
      accepted: section?.accepted ?? 0,
      top: order.slice(0, limit),
      you: you.you,
      rank: you.rank,
      above: you.above,
      best: you.best,
      otherRevs,
      // The rev caveat travels WITH the data, so no client can render a board
      // and forget to say what it is a board of.
      note:
        rev === SIM_REV
          ? `live board, sim rev ${SIM_REV}. Through milestone 1 the rev bumps freely and the live board resets; ` +
            'old times are kept and labelled on their own rev, never deleted.'
          : `archived board for sim rev ${rev}. This build is rev ${SIM_REV}, so these times cannot be compared ` +
            'with the live board and no ghost from here can be shown.',
    });
  });

  /**
   * One replay, by content address. This is the ghost fetch.
   *
   * `?level=` when the caller knows it, which the game always does; without it
   * the store scans the per-level buckets, which is what `bin/board` needs.
   */
  api.get('/replays/:replayId', (c) => {
    const id = c.req.param('replayId');
    if (!isHashId(id)) return c.json({ error: 'replayId must be 16 hex characters' }, 400);
    const simHash = c.req.query('level');
    if (simHash !== undefined && !isHashId(simHash)) return c.json({ error: 'bad level hash' }, 400);

    const value = simHash ? readReplay(simHash, id) : findReplay(id)?.value;
    if (!value) return c.json({ error: `no replay ${id}` }, 404);
    // Immutable by construction — the id IS the hash of the content — so it can
    // be cached hard. A ghost fetched once is never fetched again.
    c.header('cache-control', 'public, max-age=31536000, immutable');
    return c.json(value);
  });

  /** One player's personal bests, across every level and rev. */
  api.get('/players/:playerId', (c) => {
    const id = c.req.param('playerId');
    if (!isPlayerId(id)) return c.json({ error: 'bad player id' }, 400);
    const p = readPlayer(id);
    if (!p) return c.json({ error: `no player ${id}` }, 404);
    const levels = allLevels();
    const named: Record<string, string> = {};
    for (const l of levels) named[l.simHash] = l.name;
    return c.json({ ...p, levelNames: named, liveRev: SIM_REV });
  });

  /**
   * Submit a run.
   *
   * VERIFY BEFORE PERSISTING: `submit` re-simulates the input stream and
   * confirms the outcome, the time and the apple count before a byte is
   * written. Everything it can refuse, and the status each refusal carries, is
   * in runs.ts beside the reasons.
   */
  api.post('/runs', async (c) => {
    // The size check happens before JSON.parse and before anything touches the
    // sim, because JSON.parse on an attacker-chosen 200 MB string IS the denial
    // of service — no amount of care further down helps once it has been read.
    const text = await readCapped(c.req.raw.body, MAX_BODY_BYTES);
    if (text === null) {
      return c.json(
        { ok: false, code: 'too-large', reason: `a submission may not exceed ${MAX_BODY_BYTES} bytes` },
        413,
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return c.json(
        { ok: false, code: 'bad-json', reason: e instanceof Error ? e.message : String(e) },
        400,
      );
    }

    const result = await submit(raw);
    if (!result.ok) return c.json(result, statusFor(result.code));
    return c.json({
      ...result,
      // Seconds beside ticks in every response: ticks are the truth and seconds
      // are what a person reads, and making the client divide by 512 is how one
      // of them eventually divides by 500.
      timeSeconds: ticksToSeconds(result.entry.timeTicks),
    });
  });

  return api;
}
