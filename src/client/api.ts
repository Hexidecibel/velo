// The client's side of the leaderboard wire.
//
// Everything here DEGRADES rather than fails. The server may be down, the dev
// server may be running without `bin/start` behind it, the device gate may have
// expired the session and be answering a redirect to auth.cush.rocks — and in
// every one of those cases the game must keep being a game. A leaderboard that
// can stop you riding is worse than no leaderboard.
//
// So each call returns a result object, never throws, and the board UI shows
// "offline" rather than an error dialog.
import type { Replay } from '@/sim/replay.ts';
import type { Appearance } from '@/shared/appearance.ts';

export type Category = 'human' | 'tas';

export interface BoardEntry {
  replayId: string;
  playerId: string;
  name: string;
  timeTicks: number;
  frames: number;
  simRev: number;
  specHash: string;
  bike: string;
  /**
   * What that player's bike looks like. Optional because every board row
   * written before today has none; `resolveAppearance` turns an absent one into
   * a stable derivation from the playerId rather than into the shipped default,
   * so an old board is still a board of different people.
   */
  appearance?: Appearance;
  category: Category;
  at: string;
}

export interface BoardPayload {
  simHash: string;
  rev: number;
  liveRev: number;
  category: Category;
  levelId: string | null;
  levelName: string | null;
  total: number;
  accepted: number;
  top: BoardEntry[];
  you: BoardEntry | null;
  rank: number | null;
  above: BoardEntry | null;
  best: BoardEntry | null;
  otherRevs: { rev: number; entries: number }[];
  note: string;
}

export interface SubmitOk {
  ok: true;
  replayId: string;
  levelName: string;
  entry: BoardEntry;
  placement: { pb: boolean; rank: number; total: number; previousTicks: number | null };
  standing: { you: BoardEntry | null; rank: number | null; total: number; above: BoardEntry | null; best: BoardEntry | null };
  verifyMs: number;
  timeSeconds: number;
}

export interface SubmitErr {
  ok: false;
  code: string;
  reason: string;
}

/**
 * `code` is the server's own `RejectCode` when it refused — see
 * src/server/runs.ts. It is carried separately from `error` rather than folded
 * into it because the results panel maps the code to plain words AND to what to
 * do about it, and matching on the prose would break the day somebody rewords a
 * refusal. It is absent for a network failure, which is what `offline` is for.
 */
export type ApiError = { ok: false; error: string; offline: boolean; code?: string };
export type ApiResult<T> = { ok: true; value: T } | ApiError;

const offline = (e: unknown): ApiError => ({
  ok: false,
  error: e instanceof Error ? e.message : String(e),
  offline: true,
});

/**
 * One fetch wrapper, and the `redirect: 'error'` is the interesting part: when
 * the cush-auth session has expired the gate answers a 302 to auth.cush.rocks,
 * and a fetch that follows it returns a login PAGE with status 200. Parsing
 * that as JSON produces "unexpected token '<'", which is the single most
 * misleading error message this app could show. Refusing to follow turns it
 * into an honest "the sign-in expired".
 */
async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, redirect: 'error', cache: 'no-store' });
  } catch (e) {
    return offline(e);
  }
  const text = await res.text().catch(() => '');
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      return {
        ok: false,
        error: `${path} answered ${res.status} with something that is not JSON — the device gate may have signed you out`,
        offline: true,
      };
    }
  }
  if (!res.ok) {
    const r = body as { reason?: string; error?: string; code?: string } | null;
    return {
      ok: false,
      error: r?.reason ?? r?.error ?? `${path} answered ${res.status}`,
      offline: false,
      ...(typeof r?.code === 'string' ? { code: r.code } : {}),
    };
  }
  return { ok: true, value: body as T };
}

export function fetchBoard(
  simHash: string,
  opts: { category: Category; playerId?: string; rev?: number; limit?: number },
): Promise<ApiResult<BoardPayload>> {
  const q = new URLSearchParams({ category: opts.category });
  if (opts.playerId) q.set('player', opts.playerId);
  if (opts.rev !== undefined) q.set('rev', String(opts.rev));
  if (opts.limit !== undefined) q.set('limit', String(opts.limit));
  return call<BoardPayload>(`/api/leaderboard/${simHash}?${q.toString()}`);
}

/**
 * A ghost's input stream. Immutable and content-addressed, so the response is
 * cached hard by the server and a ghost fetched once is never fetched again.
 */
export function fetchReplay(replayId: string, simHash: string): Promise<ApiResult<Replay>> {
  return call<Replay>(`/api/replays/${replayId}?level=${simHash}`);
}

export function submitRun(body: {
  playerId: string;
  name: string;
  /**
   * Sent on EVERY submission, not only the first, because the server refreshes
   * it in place exactly as it refreshes the name — repainting your bike has to
   * show on the rows you already hold, or repainting looks broken.
   */
  appearance: Appearance;
  category: Category;
  replay: unknown;
}): Promise<ApiResult<SubmitOk>> {
  return call<SubmitOk>('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * One player's record, as `/api/players/:id` returns it. Only the parts a claim
 * needs are typed: the name and the bike this device should adopt.
 */
export interface PlayerPayload {
  playerId: string;
  name: string;
  appearance?: Appearance;
  updatedAt: string;
}

/**
 * Who a playerId is, for the claim panel.
 *
 * 404s for a player who has never posted a run, which is an ordinary state and
 * not an error: the id is still perfectly claimable, it just has no name or
 * bike on the server yet. The caller degrades to showing the code.
 */
export function fetchPlayer(playerId: string): Promise<ApiResult<PlayerPayload>> {
  return call<PlayerPayload>(`/api/players/${playerId}`);
}

export interface Rules {
  simRev: number;
  specHash: string;
  categories: Category[];
  topN: number;
  maxFrames: number;
  maxRunSeconds: number;
  maxBodyBytes: number;
  identity: string;
}

export function fetchRules(): Promise<ApiResult<Rules>> {
  return call<Rules>('/api/rules');
}
