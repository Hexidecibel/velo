// A player's bike, small, beside their name.
//
// WHY THIS IS THE FEATURE AND NOT A GARNISH. A leaderboard row is a rank, a
// name and a number, and three of those are the same for everybody. The board
// has real material it was not using — measured difficulty, the gap to the row
// above, the apple order, a full replay — and the one thing it had nothing to
// show at all was the PEOPLE. An avatar costs nothing extra here because it is
// the same drawing code at a small scale: `drawBikePortrait` is `drawBike` on a
// synthetic standing pose, so an avatar cannot drift from the bike it is a
// picture of.
//
// THE RULES THAT KEEP IT OFF THE HOT PATH, copied from thumbs.ts because they
// are the same rules and were learned the same way:
//
//   * Nothing renders until a panel asks for one.
//   * Results are cached for the session, keyed by the appearance AND the
//     palette, because a livery is solved against the level it is drawn on and
//     the same bike is a different picture on a different level.
//   * `drawBikePortrait` draws at tier 'fine', which does not touch the shared
//     detail latches. An avatar must never be able to change what the player's
//     own bike is drawn at — that is precisely the shimmer the latches exist to
//     prevent, and forty little bikes driving them would be a spectacular way
//     to reintroduce it.
import { cloneSpec } from '@/sim/spec.ts';
import type { BikeSpec } from '@/sim/spec.ts';
import type { Appearance } from '@/shared/appearance.ts';
import { APPEARANCE_KEYS } from '@/shared/appearance.ts';
import { drawBikePortrait, portraitExtent } from './artrender.ts';
import { makeLook } from './art/bikeart.ts';
import type { Palette } from './art/palette.ts';
import { BOOT_PRESET } from './presets.ts';

/** CSS pixels. Sized to sit on one leaderboard row without changing its height. */
export const AVATAR_W = 46;
export const AVATAR_H = 26;

/**
 * Rendered at 2x and scaled down by CSS. The bike is ink outlines a few pixels
 * wide and they alias badly at this size; the extra pass is one small canvas
 * per distinct livery per session.
 */
const SUPERSAMPLE = 2;

/**
 * Portraits are drawn on the SHIPPED bike, never the player's tuned one — the
 * same call thumbs.ts makes, and for the same reason. An avatar is a picture of
 * somebody's livery, and it must not change because a slider moved.
 */
const SPEC: BikeSpec = cloneSpec(BOOT_PRESET.spec);

/** Session cache: palette -> appearance key -> data URL. */
const cache = new WeakMap<Palette, Map<string, string>>();

function keyOf(a: Appearance, plate: string): string {
  return APPEARANCE_KEYS.map((k) => a[k]).join('|') + '|' + plate;
}

/**
 * A data URL of one bike. Synchronous, cached, and safe to call from a render
 * that rebuilds a panel wholesale — which every panel in this game does.
 *
 * Returns '' when there is no 2d context to be had, which is a real state in a
 * headless or memory-pressured browser and must degrade to "no picture" rather
 * than to a thrown exception inside a leaderboard.
 */
export function avatarUrl(app: Appearance, P: Palette, playerId?: string | null): string {
  const look = makeLook(app, P, playerId);
  const key = keyOf(app, look.plate);
  let byKey = cache.get(P);
  if (!byKey) {
    byKey = new Map();
    cache.set(P, byKey);
  }
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;

  const c = document.createElement('canvas');
  c.width = AVATAR_W * SUPERSAMPLE;
  c.height = AVATAR_H * SUPERSAMPLE;
  const ctx = c.getContext('2d');
  if (!ctx) return '';

  const ext = portraitExtent(SPEC);
  // Fit the whole bike with a little air, and take the TIGHTER of the two axes
  // so nothing is ever cropped — an avatar with the rider's head cut off would
  // be a picture of the wrong thing.
  const pad = 1.08;
  const zoom = Math.min(c.width / (ext.w * pad), c.height / (ext.h * pad));

  ctx.save();
  ctx.translate(c.width / 2, c.height / 2);
  ctx.scale(zoom, -zoom);
  ctx.translate(0, -ext.cy);
  drawBikePortrait(ctx, SPEC, P, look, zoom);
  ctx.restore();

  const url = c.toDataURL('image/png');
  byKey.set(key, url);
  return url;
}

/**
 * An `<img>` ready to drop into a row. Alt text is empty on purpose: the name
 * is right beside it and a screen reader reading "Hexi's bike" after "Hexi" is
 * noise.
 */
export function avatarImg(app: Appearance, P: Palette, playerId?: string | null): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'avatar';
  img.width = AVATAR_W;
  img.height = AVATAR_H;
  img.alt = '';
  const url = avatarUrl(app, P, playerId);
  if (url) img.src = url;
  return img;
}
