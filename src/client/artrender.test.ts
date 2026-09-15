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
import { blobTier, fineTier } from './artrender.ts';

/** Wheel radius in screen px at a given zoom, which is what the tiers switch on. */
const detailAt = (zoom: number): number => 0.25 * zoom;

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
    // The camera's floor is 38 px/m and the base framing is 62. Nothing in that
    // band may drop the helmet and scarf.
    for (let zoom = 38; zoom <= 110; zoom += 0.5) {
      expect(fineTier(detailAt(zoom))).toBe(true);
    }
  });

  it('does not flicker when the camera dithers on a boundary', () => {
    // Drive the latch back and forth across each threshold by a hair and count
    // transitions. Without hysteresis this is one flip per sample.
    for (const t of [8, 12]) {
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
    // ...and it must not engage at play zoom.
    settleBlob(false);
    expect(blobTier(detailAt(38))).toBe(false);
  });

  it('is a true latch: inside the band the tier holds whatever it had', () => {
    // 10 px sits between the ON (12) and OFF (8) thresholds, so the answer there
    // depends on history rather than on the value. That is the entire mechanism.
    settleFine(true);
    expect(fineTier(10)).toBe(true);
    settleFine(false);
    expect(fineTier(10)).toBe(false);
  });

  it('recovers fine detail after zooming back in', () => {
    settleFine(false);
    expect(fineTier(detailAt(62))).toBe(true);
  });
});
