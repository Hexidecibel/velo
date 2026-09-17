// What the HUD toggle is allowed to hide, in plain node.
//
// The failure this guards against is specific and has already happened once in
// this project's history: a bike that is not the shipped one rides perfectly,
// finishes perfectly, and is then silently refused by the leaderboard. The HUD
// said so; hiding the HUD must not stop it saying so.
import { describe, expect, it } from 'vitest';
import { hasPersistentWarning, persistentBadges } from './hudmode.ts';
import type { HudWarnState } from './hudmode.ts';

function state(over: Partial<HudWarnState> = {}): HudWarnState {
  return { tuned: false, heldFields: 0, droppedPaths: [], liveTuneError: null, ...over };
}

describe('persistentBadges', () => {
  it('shows nothing at all on a shipped bike with no live tune', () => {
    // This IS the feature: play it straight up and the screen is the game.
    expect(persistentBadges(state())).toEqual([]);
    expect(hasPersistentWarning(state())).toBe(false);
  });

  it('keeps the tuned-spec notice, and says what it costs you', () => {
    const b = persistentBadges(state({ tuned: true }));
    expect(b).toHaveLength(1);
    expect(b[0].tone).toBe('warn');
    expect(b[0].text).toContain('not as shipped');
    expect(b[0].text).toContain('will not post');
  });

  it('treats a field held by bin/spec as the same warning — it is the same refusal', () => {
    const b = persistentBadges(state({ heldFields: 2 }));
    expect(b).toHaveLength(1);
    expect(b[0].text).toContain('2 field(s) held');
    expect(b[0].text).toContain('will not post');
  });

  it('says both when both are true, in one badge rather than two', () => {
    const b = persistentBadges(state({ tuned: true, heldFields: 1 }));
    expect(b).toHaveLength(1);
    expect(b[0].text).toContain('tuned');
    expect(b[0].text).toContain('1 field(s) held');
  });

  it('keeps the dropped-paths warning and names the fields', () => {
    const b = persistentBadges(state({ droppedPaths: ['rider.wobble'] }));
    expect(b).toHaveLength(1);
    expect(b[0].tone).toBe('bad');
    expect(b[0].text).toContain('rider.wobble');
    expect(b[0].text).toContain('NOT applied');
  });

  it('clips a long dropped list rather than growing a badge into a wall', () => {
    const b = persistentBadges(state({ droppedPaths: ['a.b', 'c.d', 'e.f', 'g.h'] }));
    expect(b[0].text).toContain('a.b, c.d +2 more');
    expect(b[0].text.length).toBeLessThan(120);
  });

  it('surfaces a live-tune read failure, which is otherwise invisible', () => {
    const b = persistentBadges(state({ liveTuneError: 'data/spec.json: unexpected token' }));
    expect(b.map((x) => x.tone)).toEqual(['bad']);
  });

  it('reports every warning at once rather than only the first', () => {
    const b = persistentBadges(state({ tuned: true, droppedPaths: ['x.y'], liveTuneError: 'boom' }));
    expect(b).toHaveLength(3);
    expect(hasPersistentWarning(state({ tuned: true }))).toBe(true);
  });

  it('is silent about everything the readout carries that is only telemetry', () => {
    // Speed, spin, contacts, zoom, fps, worst frame, recorded frames, the rev
    // line, the ghost and montage captions: none of them are warnings, and none
    // of them get a badge. If one ever does, it belongs in the readout instead.
    const b = persistentBadges(state());
    expect(b).toEqual([]);
  });
});
