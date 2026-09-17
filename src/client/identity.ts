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

import { appearanceFor, cloneAppearance, parseAppearance } from '@/shared/appearance.ts';
import type { Appearance } from '@/shared/appearance.ts';

const ID_KEY = 'velo.playerId';
const NAME_KEY = 'velo.playerName';
const LOOK_KEY = 'velo.appearance';
/**
 * The id this device had before it claimed another one.
 *
 * KEPT SO A CLAIM IS NOT DESTRUCTIVE. Adopting somebody's playerId is a
 * one-scan operation and the most likely mistake anybody makes with it is
 * scanning on the wrong device; without this, that mistake costs a player their
 * whole history and there is no way back, because the id was random and is now
 * gone. One extra key makes it an undo.
 */
const PREV_KEY = 'velo.playerId.previous';

export interface Identity {
  playerId: string;
  /** Empty until the player has chosen one. Nothing is submitted before then. */
  name: string;
  /**
   * What their bike looks like. SAME STATUS AS THE NAME, deliberately: chosen
   * on this device, keyed to the playerId, submitted alongside a run as
   * presentation metadata, and refreshed in place on the board when it changes.
   *
   * It is NOT part of `BikeSpec` and can never become part of it — see
   * `src/shared/appearance.ts`. A colour that reached the spec hash would mean
   * repainting your bike refused your runs.
   *
   * Unset means DERIVED FROM THE PLAYER ID rather than the one shipped default,
   * so a board full of people who have never opened the customiser is still a
   * board full of different people.
   */
  appearance: Appearance;
  /** False while `appearance` is the derived one rather than a chosen one. */
  chosenLook: boolean;
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
  const stored = read(LOOK_KEY);
  let chosen: unknown = null;
  if (stored !== null) {
    try {
      chosen = JSON.parse(stored);
    } catch {
      // Corrupt, or written by a build with another shape. A bad appearance is
      // never fatal — `parseAppearance` falls back per axis — but a bad JSON
      // blob is not even an appearance, so it is simply forgotten.
      chosen = null;
    }
  }
  return {
    playerId: id,
    name: cleanName(read(NAME_KEY) ?? ''),
    appearance: chosen ? parseAppearance(chosen) : appearanceFor(id),
    chosenLook: chosen !== null,
  };
}

/** Remember a chosen appearance. Returns the cleaned value that was stored. */
export function setAppearance(a: Appearance): Appearance {
  const clean = cloneAppearance(parseAppearance(a));
  write(LOOK_KEY, JSON.stringify(clean));
  return clean;
}

// --- being the same player on two devices ------------------------------------
//
// See src/shared/claim.ts for what this is and — more to the point — what it is
// not. It solves cross-device identity. It is not authentication, it does not
// pretend to be, and the honest note at the top of this file still stands in
// every word: re-simulation proves a time is real; nothing proves whose it is.
//
// WHAT HAPPENS TO THE ADOPTING DEVICE'S DATA, decided once and stated plainly
// because "it depends" is how somebody loses something:
//
//   * The playerId, the name and the appearance are REPLACED. That is what
//     claiming means — this device is now that person.
//   * The old playerId is KEPT under `PREV_KEY`, so the claim is reversible
//     with one click. Cheap, and it turns the worst mistake available here
//     (scanning on the wrong device) from permanent into a nuisance.
//   * LOCAL BEST TIMES ARE UNTOUCHED, and not because it was convenient: they
//     were never keyed to a player. `bests.rev<N>` is keyed by the level's
//     simHash alone — it is this BROWSER's record of what it has done, not this
//     PLAYER's — so there is nothing to merge and nothing to discard. Merging
//     them into the claimed player would be the dishonest option, since those
//     times were set by a different player record on the server and posting
//     them now would be inventing history.
//   * Nothing on the server moves. Board rows key on playerId and the id has not
//     changed; the new device simply starts posting under it.

/** Adopt another device's playerId. Returns the identity this device now has. */
export function adoptPlayerId(id: string, from: Identity): Identity {
  if (!isValidPlayerId(id)) return from;
  if (id === from.playerId) return from;
  write(PREV_KEY, from.playerId);
  write(ID_KEY, id);
  return { ...from, playerId: id };
}

/** The id this device had before its last claim, when there is one. */
export function previousPlayerId(): string | null {
  const v = read(PREV_KEY) ?? '';
  return isValidPlayerId(v) ? v : null;
}

/** Undo a claim. Returns the identity this device now has. */
export function restorePreviousPlayerId(from: Identity): Identity {
  const prev = previousPlayerId();
  if (!prev) return from;
  write(PREV_KEY, from.playerId);
  write(ID_KEY, prev);
  return { ...from, playerId: prev };
}

/**
 * Start over as a nobody: mint a fresh id.
 *
 * THIS IS THE ROTATION, AND IT IS WORTH BEING PRECISE ABOUT WHAT IT COSTS.
 * There is no server-side secret to rotate — the code IS the id — so rotating
 * means becoming a different player. Times already posted STAY on the board
 * under the old id; they are not deleted and they are not moved, they simply
 * stop being yours. The old id is kept under `PREV_KEY`, so this is reversible
 * too, which is the whole reason it is offered: showing a code on a stream is
 * then recoverable rather than permanent.
 */
export function rotatePlayerId(from: Identity): Identity {
  write(PREV_KEY, from.playerId);
  const id = mintId();
  write(ID_KEY, id);
  return { ...from, playerId: id };
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
