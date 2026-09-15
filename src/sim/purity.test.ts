// The single most valuable test in the repo, and it has ZERO coupling to the
// physics constants — which is the whole point. Tuning churns `spec.ts` dozens
// of times a day and this file never moves.
//
// Replays must reproduce bit-identically in the browser and on the server, or
// server-side leaderboard verification is worthless. The hazard is narrow and
// specific: ECMA-262 specifies `Math.sqrt` as IEEE-754 correctly-rounded, but
// `sin`/`cos`/`tan`/`exp`/`pow`/`log`/`atan2`/`cbrt`/`hypot`/... are
// *implementation-approximated* and genuinely differ between V8, SpiderMonkey
// and JavaScriptCore. Plain float64 `+ - * /` are exactly specified and safe.
// So is `Math.imul` (integer) and the round-family (exactly specified).
//
// `**` gets banned too: Number::exponentiate is implementation-approximated for
// the same reason `Math.pow` is, and it is invisible in a grep for "Math.".
//
// Two complementary checks, because neither alone is sufficient:
//   1. a source scan, which catches a banned call on a code path no test
//      happens to reach;
//   2. a runtime trap, which catches an aliased or dynamically-looked-up call
//      (`const f = Math['s'+'in']`) that a source scan cannot see.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_SPEC } from './spec.ts';
import { parseLevel } from './level.ts';
import { createSim } from './sim.ts';
import { encodeInputs, verifyReplay, buildReplay } from './replay.ts';
import { SIM_REV } from './rev.ts';
import { IN_THROTTLE, IN_BRAKE, IN_LEAN_L, IN_LEAN_R, IN_FLIP } from './consts.ts';
import { TEST_LEVEL } from './testlevel.ts';

const SIM_DIR = fileURLToPath(new URL('.', import.meta.url));

/** Everything on `Math` that is exactly specified by ECMA-262. */
const ALLOWED_MATH = new Set([
  'sqrt', 'abs', 'min', 'max', 'floor', 'ceil', 'round', 'trunc', 'sign', 'imul',
]);

function simSources(): { file: string; text: string }[] {
  return readdirSync(SIM_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(join(SIM_DIR, f), 'utf8') }));
}

/**
 * Strip line comments, block comments and string/template literals so that the
 * prose in a header comment ("no Math.sin anywhere") does not fail its own
 * test. Deliberately simple: it does not need to be a real tokenizer, only
 * conservative enough that it never *hides* real code.
 */
function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

describe('sim source purity', () => {
  it('uses no Math.* function outside the exactly-specified set', () => {
    const offenders: string[] = [];
    for (const { file, text } of simSources()) {
      const code = stripCommentsAndStrings(text);
      for (const m of code.matchAll(/\bMath\s*\.\s*([A-Za-z0-9_$]+)/g)) {
        if (!ALLOWED_MATH.has(m[1])) offenders.push(`${file}: Math.${m[1]}`);
      }
      // A computed member access on Math defeats the scan above, so ban it.
      for (const _m of code.matchAll(/\bMath\s*\[/g)) {
        offenders.push(`${file}: computed Math[...] access`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('uses no ** operator (Number::exponentiate is implementation-approximated)', () => {
    const offenders: string[] = [];
    for (const { file, text } of simSources()) {
      const code = stripCommentsAndStrings(text);
      // `**` and `**=`. Nothing else in TS spells a bare double-asterisk.
      if (/\*\*/.test(code)) offenders.push(`${file}: ** operator`);
    }
    expect(offenders).toEqual([]);
  });

  it('declares no const enum (isolatedModules cannot erase one)', () => {
    const offenders: string[] = [];
    for (const { file, text } of simSources()) {
      const code = stripCommentsAndStrings(text);
      if (/\bconst\s+enum\b/.test(code)) offenders.push(`${file}: const enum`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('sim runtime purity', () => {
  it('runs a full replay with every banned Math.* and clock trapped', () => {
    const level = parseLevel(TEST_LEVEL);

    // A deliberately busy input stream: throttle, brake, both volt directions,
    // and flips, so the trap covers every branch the bike has.
    const masks: number[] = [];
    for (let f = 0; f < 600; f++) {
      let m = 0;
      if (f % 7 < 4) m |= IN_THROTTLE;
      if (f % 23 === 0) m |= IN_BRAKE;
      if (f % 11 < 3) m |= IN_LEAN_L;
      if (f % 17 < 3) m |= IN_LEAN_R;
      if (f % 53 === 0) m |= IN_FLIP;
      masks.push(m);
    }

    const mathDescriptors = new Map<string, PropertyDescriptor>();
    const banned = Object.getOwnPropertyNames(Math).filter(
      (k) => typeof (Math as unknown as Record<string, unknown>)[k] === 'function' && !ALLOWED_MATH.has(k),
    );
    const origDateNow = Date.now;
    const origPerfNow = globalThis.performance?.now;

    const tripped: string[] = [];
    const trap = (name: string) => () => {
      tripped.push(name);
      throw new Error(`sim called banned ${name}`);
    };

    try {
      for (const k of banned) {
        const d = Object.getOwnPropertyDescriptor(Math, k);
        if (d) mathDescriptors.set(k, d);
        Object.defineProperty(Math, k, { value: trap(`Math.${k}`), configurable: true, writable: true });
      }
      Date.now = trap('Date.now') as typeof Date.now;
      if (globalThis.performance) {
        globalThis.performance.now = trap('performance.now') as typeof performance.now;
      }

      // Record...
      const sim = createSim(level, DEFAULT_SPEC);
      const hashes: string[] = [];
      for (let f = 0; f < masks.length; f++) {
        sim.advance(masks[f]);
        if ((f + 1) % 64 === 0) hashes.push(sim.hash());
      }
      const replay = buildReplay({
        level,
        spec: DEFAULT_SPEC,
        masks,
        hashEvery: 64,
        hashes,
        state: sim.state,
      });

      // ...and verify, which is the path the server will one day run.
      const result = verifyReplay(level, DEFAULT_SPEC, replay);
      expect(result.ok, result.reason ?? '').toBe(true);
      expect(replay.simRev).toBe(SIM_REV);
      expect(encodeInputs(masks).length).toBeLessThan(masks.length * 4);
    } finally {
      for (const [k, d] of mathDescriptors) Object.defineProperty(Math, k, d);
      Date.now = origDateNow;
      if (globalThis.performance && origPerfNow) globalThis.performance.now = origPerfNow;
    }

    expect(tripped).toEqual([]);
  });
});
