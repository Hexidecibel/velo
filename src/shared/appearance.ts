// What a player's bike and rider LOOK like — and nothing else.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE, stated where it is easiest to break:
// an `Appearance` is never, under any circumstance, part of `BikeSpec`.
//
// Collision is two wheels, three chassis circles and a head sphere, and every
// one of those numbers lives on `BikeSpec`, which is content-hashed into
// `specHash`. The server checks that hash to decide whether a time counts. So a
// colour that touched `BikeSpec` would mean REPAINTING YOUR BIKE REFUSES YOUR
// RUNS, with the same "this bike is not the shipped one" message that has
// already confused this user twice. Cosmetics therefore travel in their own
// structure, the sim never sees one, and `appearance.test.ts` asserts that
// changing every axis leaves `specHash` bit-identical.
//
// It is the same pattern as the level format's `style` block and the `provenance`
// block: presentation metadata, parallel to the thing that is hashed, never
// inside it.
//
// EVERY BIKE TYPE IS MECHANICALLY IDENTICAL. A chopper does not get a longer
// wheelbase and a motocrosser does not get more travel, because either would be
// a `specHash` change wearing a costume. "Looks heavier, handles the same" is
// the deal, it is what the user asked for in as many words — *nothing that will
// impact gameplay* — and it is asserted rather than promised.
//
// This module is SHARED: the client draws from it and the server validates
// against it. It therefore imports nothing, touches no DOM and reads no clock,
// for the same reason `src/sim` does not — the two halves must agree about what
// a legal appearance is, and one copy is how that stays true.

/** The axes. Adding one means adding it here, in `Appearance`, and in the art. */
export type AppearanceKey = 'bike' | 'paint' | 'helmet' | 'jacket' | 'scarf' | 'decal';

export interface Appearance {
  /** Which bike. Cosmetic silhouette only — same spec, same collision, always. */
  bike: string;
  /** The colourway. Curated, never a free colour wheel — see bikeart.ts. */
  paint: string;
  /** Helmet style. Decorates the head circle; never enlarges it. */
  helmet: string;
  /** The rider's jacket cut. */
  jacket: string;
  /** Scarf, or none. */
  scarf: string;
  /** Bodywork markings: a stripe, a number plate, chequers, or nothing. */
  decal: string;
}

export interface AppearanceOption {
  id: string;
  label: string;
  /** One short line for the picker. Says what it looks like, never what it does. */
  note: string;
}

export interface AppearanceAxis {
  key: AppearanceKey;
  label: string;
  note: string;
  options: readonly AppearanceOption[];
}

/**
 * THE BIKES.
 *
 * Six silhouettes that read as six different machines at play zoom, all of them
 * built on the identical `BikeSpec`. The differences are the frame outline, the
 * seat and tank profile, where the exhaust runs, how the wheels are treated and
 * what detail the fine tier adds — everything that says "a different bike" to an
 * eye and nothing at all to the physics.
 */
export const BIKES: readonly AppearanceOption[] = [
  { id: 'scrambler', label: 'scrambler', note: 'the shipped shape — humped tank, upswept tail, mid pipe' },
  { id: 'cafe', label: 'café racer', note: 'low teardrop tank, flat seat hump, straight slim pipe' },
  { id: 'moto', label: 'motocrosser', note: 'tall flat seat, big radiator shrouds, short high pipe' },
  { id: 'bobber', label: 'bobber', note: 'fat and low — deep tank, solo saddle, stubby shotgun pipe' },
  { id: 'mono', label: 'monocoque', note: 'one slab body, disc wheels, a vent where the pipe would be' },
  { id: 'trials', label: 'trials', note: 'skeletal — barely any bodywork, a seat pad, a pipe tucked high' },
];

/**
 * THE COLOURWAYS.
 *
 * Curated, and that is the guardrail rather than a shortage of ambition. Hand
 * someone a colour wheel and they will pick dark grey on a dark level, make
 * themselves invisible, and correctly report the game as unfair. Ten named
 * liveries, each of which is then pushed through a contrast floor against the
 * level's own palette on the way to the canvas (see `resolveBikeColors`), is
 * both more expressive in practice and arithmetically safe.
 */
export const PAINTS: readonly AppearanceOption[] = [
  { id: 'ember', label: 'ember', note: 'hot orange over deep red' },
  { id: 'citrus', label: 'citrus', note: 'lemon and lime, loud' },
  { id: 'mint', label: 'mint', note: 'pale green with a coral seat' },
  { id: 'ice', label: 'ice', note: 'cyan over steel blue' },
  { id: 'orchid', label: 'orchid', note: 'violet and magenta' },
  { id: 'slate', label: 'slate', note: 'graphite with a yellow flash' },
  { id: 'sunset', label: 'sunset', note: 'peach into purple' },
  { id: 'lagoon', label: 'lagoon', note: 'teal and sand' },
  { id: 'bone', label: 'bone', note: 'off-white with a red stripe' },
  { id: 'acid', label: 'acid', note: 'chartreuse on black-cherry' },
];

/**
 * THE HELMETS.
 *
 * All four decorate the head circle FROM THE INSIDE — every one of them is drawn
 * under a clip on the death sphere at its true radius, so no helmet can make the
 * thing that kills you look bigger or smaller than it is. A generous-looking
 * helmet would be a lie about the kill volume, and the one kind of lie this
 * renderer is not allowed to tell.
 */
export const HELMETS: readonly AppearanceOption[] = [
  { id: 'visor', label: 'full face', note: 'the shipped look — one sweeping visor' },
  { id: 'goggles', label: 'goggles', note: 'open face, round lenses, a strap round the back' },
  { id: 'halfshell', label: 'half shell', note: 'a low brim and a band, face open' },
  { id: 'bucket', label: 'bucket', note: 'flat front, wide band, rivets' },
];

export const JACKETS: readonly AppearanceOption[] = [
  { id: 'bomber', label: 'bomber', note: 'the shipped cut — boxy, collared' },
  { id: 'racer', label: 'racer', note: 'tight, with a shoulder flash' },
  { id: 'vest', label: 'vest', note: 'sleeveless, open front' },
];

export const SCARVES: readonly AppearanceOption[] = [
  { id: 'trail', label: 'trailing', note: 'the shipped scarf, streaming behind' },
  { id: 'none', label: 'none', note: 'nothing round the neck' },
  { id: 'short', label: 'tucked', note: 'a short stub that barely flaps' },
];

/**
 * Bodywork markings. Every one is drawn CLIPPED TO THE BODY PATH, so a decal can
 * never add a millimetre to the bike's outline — the same discipline the helmets
 * get, for the same reason the muffler taught: a pipe that stuck out past the
 * rear tyre was the only part of the bike that did, and it read as wrong.
 */
export const DECALS: readonly AppearanceOption[] = [
  { id: 'none', label: 'plain', note: 'bare bodywork' },
  { id: 'stripe', label: 'stripe', note: 'one racing stripe along the tank' },
  { id: 'number', label: 'number', note: 'a competition plate with your number on it' },
  { id: 'checks', label: 'chequers', note: 'a chequered band across the flank' },
];

export const APPEARANCE_AXES: readonly AppearanceAxis[] = [
  { key: 'bike', label: 'bike', note: 'six silhouettes, one set of physics', options: BIKES },
  { key: 'paint', label: 'paint', note: 'lifted to clear the level it is ridden on', options: PAINTS },
  { key: 'helmet', label: 'helmet', note: 'drawn inside the death sphere, never around it', options: HELMETS },
  { key: 'jacket', label: 'jacket', note: '', options: JACKETS },
  { key: 'scarf', label: 'scarf', note: '', options: SCARVES },
  { key: 'decal', label: 'markings', note: 'clipped to the bodywork', options: DECALS },
];

/**
 * The shipped bike, exactly as it looked before any of this existed.
 *
 * Deliberately the FIRST option on every axis, so "default" and "the art that
 * was signed off" are the same thing and cannot drift apart.
 */
export const DEFAULT_APPEARANCE: Appearance = Object.freeze({
  bike: 'scrambler',
  paint: 'ember',
  helmet: 'visor',
  jacket: 'bomber',
  scarf: 'trail',
  decal: 'none',
});

const AXIS_BY_KEY: Record<AppearanceKey, readonly AppearanceOption[]> = {
  bike: BIKES,
  paint: PAINTS,
  helmet: HELMETS,
  jacket: JACKETS,
  scarf: SCARVES,
  decal: DECALS,
};

export const APPEARANCE_KEYS: readonly AppearanceKey[] = ['bike', 'paint', 'helmet', 'jacket', 'scarf', 'decal'];

/** Every legal id on one axis. */
export function optionsFor(key: AppearanceKey): readonly AppearanceOption[] {
  return AXIS_BY_KEY[key];
}

export function isOption(key: AppearanceKey, id: unknown): boolean {
  return typeof id === 'string' && AXIS_BY_KEY[key].some((o) => o.id === id);
}

export function labelFor(key: AppearanceKey, id: string): string {
  return AXIS_BY_KEY[key].find((o) => o.id === id)?.label ?? id;
}

/**
 * Validate an arbitrary object into an Appearance, PER AXIS AND NEVER FATALLY.
 *
 * The opposite posture to `parseSpec`, and the difference is the whole point. A
 * bad spec is rejected because one NaN poisons the sim within a tick. A bad
 * appearance is a hint about a colour: an id this build has never heard of means
 * a newer client picked a livery we do not ship, and the correct answer is to
 * draw the default bike rather than to refuse the run, drop the board row, or
 * fail to load. Exactly the rule `levelPalette` already follows for a malformed
 * `style.colors` override — a cosmetic hint must never be able to break
 * anything.
 */
export function parseAppearance(raw: unknown): Appearance {
  const out: Appearance = { ...DEFAULT_APPEARANCE };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  for (const k of APPEARANCE_KEYS) {
    if (isOption(k, r[k])) out[k] = r[k] as string;
  }
  return out;
}

/** True when two appearances would draw the same bike. */
export function appearanceEqual(a: Appearance, b: Appearance): boolean {
  return APPEARANCE_KEYS.every((k) => a[k] === b[k]);
}

export function cloneAppearance(a: Appearance): Appearance {
  return { bike: a.bike, paint: a.paint, helmet: a.helmet, jacket: a.jacket, scarf: a.scarf, decal: a.decal };
}

/** "café racer in ice" — one line for a ghost caption or a tooltip. */
export function appearanceLabel(a: Appearance): string {
  return `${labelFor('bike', a.bike)} in ${labelFor('paint', a.paint)}`;
}

// --- somebody who has never chosen -------------------------------------------
//
// THE BOARD IS SUPPOSED TO BE A PLACE WITH PEOPLE IN IT, and it is one before
// anybody opens the customiser. Every run recorded before today carries no
// appearance, and the pilot and solver files in `replays/` never will — so an
// unset appearance is DERIVED from the playerId rather than collapsed onto one
// default. Same argument as `derivePalette`: twenty levels sharing one palette
// read as twenty screenshots of the same room, and twenty ghosts sharing one
// livery read as one person who rode everything.
//
// Deterministic, so a given player looks the same on every machine and on every
// reload, and stable, so the person you raced yesterday is recognisable today.

/** FNV-1a over the string. Small, dependency-free, and good enough for a hue. */
function hashOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * A stable appearance for a player who has not chosen one.
 *
 * The axes are drawn from INDEPENDENT bits of the hash rather than from one
 * counter, so two players whose ids happen to be adjacent do not come out as
 * the same bike in the next colour along.
 */
export function appearanceFor(playerId: string): Appearance {
  const h = hashOf(`velo:appearance:${playerId}`);
  const g = hashOf(`velo:appearance2:${playerId}`);
  const pick = (opts: readonly AppearanceOption[], n: number): string => opts[n % opts.length].id;
  return {
    bike: pick(BIKES, h & 0xff),
    paint: pick(PAINTS, (h >>> 8) & 0xff),
    helmet: pick(HELMETS, (h >>> 16) & 0xff),
    jacket: pick(JACKETS, (h >>> 24) & 0xff),
    scarf: pick(SCARVES, g & 0xff),
    decal: pick(DECALS, (g >>> 8) & 0xff),
  };
}

/**
 * What to draw for somebody, given whatever is known about them.
 *
 * ONE resolution order, in one function, because the hazard the user named is
 * two code paths disagreeing and putting half a crowd in the wrong livery:
 *
 *   1. what they chose, if it travelled with the thing we are drawing;
 *   2. otherwise the stable derivation from their playerId;
 *   3. otherwise the shipped bike.
 */
export function resolveAppearance(
  carried: unknown,
  playerId: string | null | undefined,
): Appearance {
  if (carried && typeof carried === 'object' && !Array.isArray(carried)) return parseAppearance(carried);
  if (playerId) return appearanceFor(playerId);
  return { ...DEFAULT_APPEARANCE };
}
