// Who you are, on a leaderboard that has no idea who you are.
//
// BE HONEST ABOUT WHAT THIS IS. No identity signal reaches this app. HAProxy
// adds only `X-Forwarded-*`, and the cush-auth device gate — which decides
// whether your browser gets through the front door at all — sets no identity
// header downstream. That was checked directly rather than assumed. So there is
// nothing for the server to trust, and inventing a login here would be
// inventing a password store for a game behind a device whitelist.
//
// What exists instead: a `playerId` generated once on this device and kept in
// localStorage, and a display name you choose. Both are submitted with a run.
//
// SO: re-simulation means a TIME cannot be faked — the server re-runs your
// input stream and derives the time itself, and no trajectory you could invent
// would survive that. But WHOSE time it is can be. Anyone who can reach the
// game can POST a verified run under any playerId and any name they like.
// Among a handful of device-gated friends that is fine and socially
// self-correcting, and saying so plainly is better than implying a guarantee
// that does not exist. The README says it there too.
//
// The proper fix, when it matters, is cush-auth passing an identity header
// downstream and this file reading it instead of minting one. That is the
// migration path; it is deliberately not built here.
//
// THE ID IS THE IDENTITY AND THE NAME IS NEVER A KEY. Every board entry, every
// personal best and every player file on the server keys on `playerId`; the
// name rides along for rendering. That is what makes renaming free, makes two
// people picking "hexi" a cosmetic clash rather than a merge of their times,
// and makes a real signup later a CLAIM on an existing id rather than a rewrite
// of every row.

const ID_KEY = 'velo.playerId';
const NAME_KEY = 'velo.playerName';

export interface Identity {
  playerId: string;
  /** Empty until the player has chosen one. Nothing is submitted before then. */
  name: string;
}

/**
 * Must match the server's `isPlayerId`: 8-32 of [0-9a-z]. Lowercase base36
 * rather than hex so 20 characters carry ~103 bits, and no character in it can
 * ever become a path separator on the server, where the id is a filename.
 */
function mintId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    // No crypto: a private-mode quirk or a very old browser. A weaker id is a
    // cosmetic problem here (ids are not secrets and authorise nothing), and
    // failing to boot the game over it would not be.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let s = '';
  for (const b of bytes) s += b.toString(36).padStart(2, '0');
  return s.replace(/[^0-9a-z]/g, '0').slice(0, 26);
}

export function isValidPlayerId(v: string): boolean {
  return /^[0-9a-z]{8,32}$/.test(v);
}

/** Same rules as the server's `cleanName`, so nothing is silently rewritten. */
export function cleanName(v: string): string {
  return v
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private window, blocked storage, quota. The id then lasts for this
    // session only and the board treats each visit as a new player — degraded,
    // not broken, and never a reason to fail to boot.
  }
}

/**
 * The id, minted on first run and never regenerated. It survives a name change
 * by construction: nothing derives it from the name, and `setName` below does
 * not touch it.
 */
export function loadIdentity(): Identity {
  let id = read(ID_KEY) ?? '';
  if (!isValidPlayerId(id)) {
    id = mintId();
    write(ID_KEY, id);
  }
  return { playerId: id, name: cleanName(read(NAME_KEY) ?? '') };
}

/** Returns the stored (cleaned) name, or '' if the input was all whitespace. */
export function setName(name: string): string {
  const clean = cleanName(name);
  write(NAME_KEY, clean);
  return clean;
}

export function hasName(id: Identity): boolean {
  return id.name.length > 0;
}
