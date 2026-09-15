// The bike's detail tiers must not strobe.
//
// Reported from play, not from a test: "why does the helmet/scarf disappear and
// show up?" A wheel is 0.25 m, so at the base camera of 62 px/m it is 15.5 px,
// and the first version cut fine detail at a hard `> 14`. That put the switch a
// pixel and a half from where the bike sits at rest, and since the camera zooms
// out with speed, ordinary riding crossed it several times a second.
//
// These tests are about the SHAPE of the switch, not the exact numbers: a tier
// boundary anywhere near a zoom the player actually rides at must latch, or it
// flickers. Move the thresholds freely; keep the hysteresis.
import { describe, it, expect, beforeEach } from 'vitest';
import { blobTier, fineTier, TIERS } from './artrender.ts';
import { DEFAULT_CAMERA } from './camera.ts';
import { DEFAULT_SPEC } from '@/sim/spec.ts';

/** Wheel radius in screen px at a given zoom, which is what the tiers switch on. */
const detailAt = (zoom: number): number => DEFAULT_SPEC.wheel.radius * zoom;

/** Settle the latch at a zoom far from any boundary. */
function settleFine(high: boolean): void {
  for (let i = 0; i < 4; i++) fineTier(high ? 400 : 0);
}
function settleBlob(low: boolean): void {
  for (let i = 0; i < 4; i++) blobTier(low ? 0 : 400);
}

describe('bike detail tiers', () => {
  beforeEach(() => {
    settleFine(true);
    settleBlob(false);
  });

  it('keeps fine detail across the whole ordinary riding range', () => {
    // The camera's floor is minZoom and the base framing is 62. Nothing in that
    // band may drop the helmet and scarf.
    for (let zoom = DEFAULT_CAMERA.minZoom; zoom <= DEFAULT_CAMERA.maxZoom; zoom += 0.5) {
      expect(fineTier(detailAt(zoom))).toBe(true);
    }
  });

  it('recovers fine detail at EVERY play zoom after an overview excursion', () => {
    // THE CASE THE FIRST VERSION OF THIS FILE MISSED, and the reason the user
    // reported the same bug twice. The old sweep above settled the latch ON, so
    // a dead band that straddled the play range happily kept it on and the
    // failure never arose. Arriving from OFF is what actually happens: hold TAB,
    // the latch drops at overview zoom, release, and ride.
    //
    // The invariant, stated plainly: NOTHING THE PLAYER CAN DO WHILE RIDING MAY
    // LEAVE THE RIDER WITHOUT A HELMET.
    for (let zoom = DEFAULT_CAMERA.minZoom; zoom <= DEFAULT_CAMERA.maxZoom; zoom += 0.5) {
      settleFine(false);
      expect(fineTier(detailAt(zoom)), `zoom ${zoom}`).toBe(true);
    }
  });

  it('keeps both dead bands entirely below the play range', () => {
    // The general rule, as a test rather than as a comment: a hysteresis band
    // that straddles the operating range is not a latch, it is a trap. If a
    // later change raises the readability floor or shrinks the wheel, this is
    // what says so.
    const playMin = DEFAULT_CAMERA.minZoom * DEFAULT_SPEC.wheel.radius;
    expect(TIERS.playMinPx).toBeCloseTo(playMin, 6);
    for (const t of [TIERS.fineOn, TIERS.fineOff, TIERS.blobOn, TIERS.blobOff]) {
      expect(t).toBeLessThan(playMin);
    }
    // And they are the right way round.
    expect(TIERS.fineOff).toBeLessThan(TIERS.fineOn);
    expect(TIERS.blobOn).toBeLessThan(TIERS.blobOff);
  });

  it('does not flicker when the camera dithers on a boundary', () => {
    // Drive the latch back and forth across each threshold by a hair and count
    // transitions. Without hysteresis this is one flip per sample.
    for (const t of [TIERS.fineOff, TIERS.fineOn]) {
      settleFine(true);
      let flips = 0;
      let prev = fineTier(t + 0.01);
      for (let i = 0; i < 200; i++) {
        const v = fineTier(t + (i % 2 === 0 ? -0.01 : 0.01));
        if (v !== prev) flips++;
        prev = v;
      }
      expect(flips).toBeLessThanOrEqual(1);
    }
  });

  it('still drops to the coarse tier when genuinely zoomed out', () => {
    // Overview reaches ~7 px/m, where the wheel is under 2 px and a faithful
    // miniature is mush. The blob tier has to engage there.
    settleBlob(false);
    expect(blobTier(detailAt(7))).toBe(true);
    // ...and it must not engage at play zoom, from either latch state.
    settleBlob(false);
    expect(blobTier(detailAt(DEFAULT_CAMERA.minZoom))).toBe(false);
    settleBlob(true);
    expect(blobTier(detailAt(DEFAULT_CAMERA.minZoom))).toBe(false);
  });

  it('is a true latch: inside the band the tier holds whatever it had', () => {
    // A value between the ON and OFF thresholds: the answer there depends on
    // history rather than on the value, which is the entire mechanism. It sits
    // BELOW the play range now, so the ambiguity is only ever reachable in the
    // overview.
    const mid = (TIERS.fineOn + TIERS.fineOff) / 2;
    settleFine(true);
    expect(fineTier(mid)).toBe(true);
    settleFine(false);
    expect(fineTier(mid)).toBe(false);
  });

  it('recovers fine detail after zooming back in', () => {
    settleFine(false);
    expect(fineTier(detailAt(62))).toBe(true);
  });
});
