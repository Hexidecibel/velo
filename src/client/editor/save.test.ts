import { describe, expect, it } from 'vitest';
import { blankDoc, setMeta } from './doc.ts';
import { fetchAuthoringStatus, OFFLINE, saveVerdict } from './save.ts';
import type { AuthoringStatus } from './save.ts';

const online = (levels: AuthoringStatus['levels'] = []): AuthoringStatus => ({ enabled: true, root: '/repo', levels, note: '' });

describe('what the save button says', () => {
  it('writes straight to the repo when the endpoint is there', () => {
    const v = saveVerdict(online(), blankDoc('21-the-jump', 'The Jump'));
    expect(v).toMatchObject({ can: true, route: 'repo' });
    expect(v.label).toContain('levels/21-the-jump.json');
  });

  it('offers a download, and says what that costs, when it is not', () => {
    // Not pretending. A browser cannot write to the repo, and a save button
    // that looked like it had would cost somebody an afternoon.
    const v = saveVerdict(OFFLINE, blankDoc('21-the-jump', 'The Jump'));
    expect(v).toMatchObject({ can: true, route: 'download' });
    expect(v.note).toContain('downloads folder');
    expect(v.note).toContain('bin/dev');
  });

  it('refuses over a core level and says forking is the answer', () => {
    const v = saveVerdict(online([
      { id: '03-mind-your-head', name: '03', tier: null, locked: true, simHash: 'a', error: null },
    ]), blankDoc('03-mind-your-head', 'x'));
    expect(v.can).toBe(false);
    expect(v.note).toContain('forking');
  });

  it('overwrites your own draft, and says so', () => {
    const v = saveVerdict(online([
      { id: '21-the-jump', name: 'The Jump', tier: 'draft', locked: false, simHash: 'a', error: null },
    ]), blankDoc('21-the-jump', 'The Jump'));
    expect(v).toMatchObject({ can: true, route: 'repo' });
    expect(v.label).toContain('overwrite');
  });

  it('refuses an id that is not a filename, and a core tier', () => {
    expect(saveVerdict(online(), blankDoc('Not An Id', 'x')).can).toBe(false);
    expect(saveVerdict(online(), setMeta(blankDoc('ok-id', 'x'), { tier: 'core' })).can).toBe(false);
  });
});

describe('detecting the endpoint', () => {
  const fake = (impl: () => unknown): typeof fetch => (async () => impl()) as unknown as typeof fetch;

  it('takes yes for an answer', async () => {
    const s = await fetchAuthoringStatus(fake(() => ({ ok: true, json: () => ({ enabled: true, root: '/r', levels: [] }) })));
    expect(s.enabled).toBe(true);
    expect(s.root).toBe('/r');
  });

  it('treats every kind of no as the same no', async () => {
    // A 404, a 500, HTML from a static server, a dropped tunnel — all mean the
    // same thing to the author, and the fallback is always there.
    expect((await fetchAuthoringStatus(fake(() => ({ ok: false, status: 404, json: () => ({}) })))).enabled).toBe(false);
    expect((await fetchAuthoringStatus(fake(() => ({ ok: true, json: () => ({ enabled: false }) })))).enabled).toBe(false);
    expect((await fetchAuthoringStatus(fake(() => { throw new Error('offline'); }))).enabled).toBe(false);
    expect((await fetchAuthoringStatus(fake(() => ({ ok: true, json: () => { throw new Error('html'); } })))).enabled).toBe(false);
  });
});
