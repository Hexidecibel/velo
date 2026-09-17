// Being the same player on two devices.
//
// THE PROBLEM, AND IT IS EXACTLY ONE PROBLEM. Identity is a `playerId` minted
// once and kept in ONE browser's localStorage. Touch controls shipped, so the
// moment somebody picks up their phone they are a different person: new id, no
// times, and — now that a bike can be chosen — not even the same bike. A name
// is cheap to retype. A livery is not, and a leaderboard history is not at all.
//
// So this solves CROSS-DEVICE IDENTITY and nothing else. It is not
// authentication and must never be described as one. Re-simulation on the
// server proves a TIME is real; nothing anywhere proves whose it is, and a
// claim code does not change that by one bit.
//
// WHY A BARE playerId IS AN HONEST THING TO PUT IN A QR CODE. The id is not a
// secret and never has been: every leaderboard row the API returns carries the
// playerId of the person who set it, so anyone who can open the board can
// already read everyone's. A claim code therefore gives away nothing that the
// leaderboard does not already publish. What it does do is let another device
// become you with one scan — which is the entire point, and is worth saying out
// loud in the UI rather than implying.
//
// The one-way door here was closed on day one and this walks through it rather
// than around it: everything keys on the opaque `playerId`, and `PlayerFile`
// already carries an unused `claimedBy`. When real accounts arrive they CLAIM
// an existing playerId and every row that references it transfers untouched.

export const CLAIM_PARAM = 'claim';

/**
 * Must match the client's `isValidPlayerId` and the server's `isPlayerId`: 8-32
 * of [0-9a-z]. Stated a third time here rather than imported, because this
 * module is shared and importing the client's copy would drag the DOM into the
 * server — and `claim.test.ts` asserts all three agree, which is the part that
 * actually keeps them honest.
 */
export function isPlayerId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-z]{8,32}$/.test(v);
}

/**
 * The URL to put in the QR.
 *
 * Absolute, and pointed at the game's own origin, because the phone has to land
 * on the game — and, before that, get past the cush-auth device gate. A relative
 * link in a QR code is not a link at all.
 */
export function claimUrl(origin: string, playerId: string): string {
  if (!isPlayerId(playerId)) throw new Error(`claimUrl: ${JSON.stringify(playerId)} is not a player id`);
  const u = new URL(origin);
  u.search = '';
  u.hash = '';
  u.pathname = '/';
  u.searchParams.set(CLAIM_PARAM, playerId);
  return u.toString();
}

/**
 * The playerId a URL is claiming, or null.
 *
 * Tolerant of everything except a malformed id: a URL that is not a claim at
 * all, a claim for something that is not a player id, and a URL that does not
 * parse all answer null rather than throwing on the boot path.
 */
export function parseClaim(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const v = u.searchParams.get(CLAIM_PARAM);
  return isPlayerId(v) ? v : null;
}

/**
 * The same id, grouped for a human to read out or type in.
 *
 * THE FALLBACK THAT ALWAYS WORKS. Cameras fail, QR readers vary, a phone can be
 * across the room, and a code somebody can type is the thing that still gets
 * them there. Four-character groups because that is what every code anybody has
 * ever had to read off a screen uses, and for the same reason: it is where the
 * eye can hold its place.
 */
export function claimCode(playerId: string): string {
  return (playerId.match(/.{1,4}/g) ?? []).join(' ');
}

/**
 * A typed code back into a playerId.
 *
 * Forgiving about everything that is not information: spaces, dashes, case, and
 * a pasted whole URL — because somebody handed the link rather than the code
 * will paste the link, and refusing it would be a puzzle rather than an error.
 */
export function parseClaimCode(typed: string): string | null {
  const asUrl = parseClaim(typed.trim());
  if (asUrl) return asUrl;
  const cleaned = typed.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return isPlayerId(cleaned) ? cleaned : null;
}
