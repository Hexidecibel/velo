// The claim round trip: encode, decode, adopt, and land on the same player.
//
// That is the whole contract, and it is worth stating what it is NOT. It is not
// authentication and nothing here proves anything about who is holding the
// code — the server has never been able to do that and this does not change it.
// What these tests hold is narrower and checkable: a code made on one device
// resolves to the same opaque `playerId` on another, and everything that is not
// a valid id is refused rather than adopted.
import { describe, it, expect } from 'vitest';
import { CLAIM_PARAM, claimCode, claimUrl, isPlayerId, parseClaim, parseClaimCode } from './claim.ts';
import { cleanName, isValidPlayerId } from '@/client/identity.ts';
import { isPlayerId as serverIsPlayerId } from '@/server/store.ts';

const ID = 'k3jf83nd8sl2mfk1';

describe('one definition of a player id, in three places', () => {
  it('the shared, client and server validators agree', () => {
    // They are written out three times on purpose — importing the client's copy
    // into the server would drag the DOM across the boundary — so this is what
    // stops them drifting. A disagreement here is a claim that works on one
    // side and 400s on the other.
    const cases = [
      ID, 'aaaaaaaa', 'a'.repeat(32),
      'short', 'a'.repeat(33), 'HasUpper1234', 'has-dash1234', 'has space12', '', 'id.with.dots',
    ];
    for (const c of cases) {
      expect(isPlayerId(c), c).toBe(isValidPlayerId(c));
      expect(isPlayerId(c), c).toBe(serverIsPlayerId(c));
    }
  });

  it('refuses anything that is not a string', () => {
    for (const v of [null, undefined, 42, {}, []]) expect(isPlayerId(v)).toBe(false);
  });
});

describe('the claim URL', () => {
  it('round-trips: encode on one device, decode on another, same player', () => {
    // THE ASSERTION THE WHOLE FEATURE IS FOR. The phone never sees the desktop's
    // localStorage; all it gets is this string.
    const url = claimUrl('https://velo.cush.rocks', ID);
    expect(url).toContain(`${CLAIM_PARAM}=${ID}`);
    expect(parseClaim(url)).toBe(ID);
  });

  it('points at the game root, whatever the origin was carrying', () => {
    // The desktop may be sitting on `/?level=07-the-chimney` with a hash. The
    // phone must land on the game, not on a URL that happens to mean something
    // else as well.
    const url = claimUrl('https://velo.cush.rocks/some/where?level=07#frag', ID);
    expect(url).toBe(`https://velo.cush.rocks/?${CLAIM_PARAM}=${ID}`);
    expect(parseClaim(url)).toBe(ID);
  });

  it('works on a dev server and on a tunnel', () => {
    for (const origin of ['http://127.0.0.1:5173', 'https://velo.tunnel.cush.rocks']) {
      expect(parseClaim(claimUrl(origin, ID))).toBe(ID);
    }
  });

  it('refuses to build a URL for something that is not a player id', () => {
    expect(() => claimUrl('https://velo.cush.rocks', 'nope')).toThrow(/player id/);
  });

  it('is null for a URL that is not a claim, rather than throwing on the boot path', () => {
    expect(parseClaim('https://velo.cush.rocks/')).toBe(null);
    expect(parseClaim('https://velo.cush.rocks/?level=01-first-light')).toBe(null);
    expect(parseClaim(`https://velo.cush.rocks/?${CLAIM_PARAM}=NOPE`)).toBe(null);
    expect(parseClaim(`https://velo.cush.rocks/?${CLAIM_PARAM}=`)).toBe(null);
    expect(parseClaim('not a url at all')).toBe(null);
    expect(parseClaim('')).toBe(null);
  });
});

describe('the typed fallback', () => {
  it('groups for reading and parses back to the same id', () => {
    // Cameras fail and readers vary. A code somebody can read out across a room
    // is what still gets them there, so it has to survive the way people
    // actually retype things.
    const code = claimCode(ID);
    expect(code).toContain(' ');
    expect(parseClaimCode(code)).toBe(ID);
  });

  it('forgives everything that is not information', () => {
    for (const typed of [
      ID,
      claimCode(ID),
      claimCode(ID).toUpperCase(),
      `  ${claimCode(ID)}  `,
      ID.match(/.{1,4}/g)!.join('-'),
      ID.match(/.{1,4}/g)!.join('_'),
      claimUrl('https://velo.cush.rocks', ID),
    ]) {
      expect(parseClaimCode(typed), typed).toBe(ID);
    }
  });

  it('refuses a typo rather than adopting a neighbour', () => {
    // Silently adopting the wrong id would be far worse than refusing: the
    // device would start posting somebody else's runs under a stranger.
    expect(parseClaimCode('')).toBe(null);
    expect(parseClaimCode('k3jf')).toBe(null);
    expect(parseClaimCode('k3jf 83nd 8sl2 mfk!')).toBe(null);
    expect(parseClaimCode('https://velo.cush.rocks/')).toBe(null);
  });

  it('a name is not a claim code and vice versa', () => {
    // `cleanName` will happily accept "k3jf83nd8sl2mfk1" as a display name. The
    // two live next to each other in the same panel, so it is worth asserting
    // they are read by different functions and neither is a fallback for the
    // other.
    expect(cleanName('Hexi')).toBe('Hexi');
    expect(parseClaimCode('Hexi')).toBe(null);
  });
});
