// The about page, asserted without a browser.
//
// There is no jsdom in this repo, so what is testable here is what the page
// DECIDES rather than what it draws — which is the same split chooser.ts,
// results.ts and legendart.ts already make, and it is not a consolation prize.
// Three of the four things that could go quietly wrong on this page are
// decisions:
//
//   1. THE FIGURE COULD STOP AGREEING WITH ITS OWN CAPTION. The two strips are
//      drawn by multiplying a fraction by a measured width, and the percentage
//      printed on each strip is a separate string. Change one, and the picture
//      lies about itself in a way no test of the drawing would catch and no
//      screenshot would look wrong.
//   2. A MEASURED NUMBER COULD DRIFT. Every number on this page came off a
//      pixel ruler and is sourced in docs/elma-levels-observed.md. "6.6" is one
//      careless tidy away from "7", and the page would still read fine.
//   3. THE COPY COULD ACQUIRE MARKUP. Nothing on this page goes through
//      innerHTML; the emphasis is parsed into runs and built out of elements.
//      A `<b>` pasted into the copy would therefore appear on screen as four
//      literal characters — and that is the SAFE failure, which is exactly why
//      it should be caught here rather than discovered there.
import { describe, it, expect } from 'vitest';
import {
  RIDE_ASPECT, SCALE, SCALE_MIN_PX, SCALE_PAD, STRIP_FLOOR_PX, SECTIONS, STATS,
  inline, scaleBox, stripHeight,
} from './about.ts';
import type { Block } from './about.ts';

const blocks = (): Block[] => SECTIONS.flatMap((s) => [...s.blocks]);
const prose = (): string[] => [
  ...blocks().flatMap((b) => (b.kind === 'p' || b.kind === 'pull' ? [b.text]
    : b.kind === 'labelled' ? b.items.map((i) => i.text) : [])),
  ...STATS.map((s) => s.text),
  SCALE.text,
];

describe('the drawn comparison', () => {
  it('draws the fraction it prints, on both sides', () => {
    // THE INVARIANT THIS PAGE RESTS ON. "17 %" beside a bike that is 12 % of
    // the strip is worse than no picture at all, because a reader believes the
    // picture. The percentage in the caption is parsed back out and checked
    // against the number the drawing is actually scaled by.
    for (const side of [SCALE.a, SCALE.b]) {
      const printed = Number(side.value.replace('%', '')) / 100;
      expect(printed).toBeCloseTo(side.frac, 12);
    }
  });

  it('is the measurement from the observation doc, not a tidied version of it', () => {
    expect(SCALE.a.value).toBe('17%');
    expect(SCALE.b.value).toBe('6.6%');
    // Their bike is about 2.6x ours on screen, which is the whole argument of
    // the section. If this ratio ever reads as "about the same", the numbers
    // have been edited into agreement with each other and away from the ruler.
    expect(SCALE.a.frac / SCALE.b.frac).toBeGreaterThan(2.4);
  });

  it('asks for a box the bike fills, not one it rattles around in', () => {
    // poseUrl pads by SCALE_PAD, so a strip that wants the BIKE to be `frac`
    // wide has to ask for a box that much bigger. Asserted as the round trip:
    // the drawn extent comes back out at the fraction that was asked for.
    const stripW = 600;
    for (const frac of [SCALE.a.frac, SCALE.b.frac]) {
      const box = scaleBox(stripW, frac);
      expect(box.w / SCALE_PAD / stripW).toBeCloseTo(frac, 2);
    }
  });

  it('never collapses the small bike into a smudge, and never inflates it', () => {
    // A 320 px portrait phone gives the strip ~290 px; 6.6 % of that is 19 px
    // of bike. The floor catches the sizes below that — and when it bites it
    // makes the comparison UNDERSTATE the difference, which is the only
    // direction a figure making an argument is allowed to be wrong in.
    for (const stripW of [180, 240, 290, 380, 620, 1200]) {
      const a = scaleBox(stripW, SCALE.a.frac);
      const b = scaleBox(stripW, SCALE.b.frac);
      expect(b.w).toBeGreaterThanOrEqual(SCALE_MIN_PX);
      expect(a.w).toBeGreaterThan(b.w);
      // 2 % of slack for the rounding to whole pixels on both sides, which is
      // the only way the drawn ratio is allowed to exceed the measured one.
      expect(a.w / b.w).toBeLessThanOrEqual((SCALE.a.frac / SCALE.b.frac) * 1.02);
      // The box is the bike's own proportions, so the WIDTH is the axis
      // `poseUrl` binds on — and the width is what the percentage is about.
      expect(a.h).toBe(Math.ceil(a.w / RIDE_ASPECT));
    }
  });

  it('takes the bike\'s proportions from the spec rather than guessing them', () => {
    // The first version assumed a square box, which put a quarter of the image
    // above the bike's head and cropped it out of every strip on a short
    // viewport. This is the same bounding box poseUrl frames on.
    expect(RIDE_ASPECT).toBeGreaterThan(1);
    expect(RIDE_ASPECT).toBeLessThan(2);
  });

  it('makes the strip tall enough for the bike it is about to be handed', () => {
    // THE BUG THIS EXISTS FOR: a height pinned in CSS and a width that came
    // from the viewport, which crop each other at exactly the sizes nobody
    // tests by hand. Every strip is now measured, and the big bike plus the
    // terrain band under it has to fit inside what comes back.
    for (const stripW of [240, 290, 360, 430, 560, 640, 900]) {
      const h = stripHeight(stripW);
      const ink = scaleBox(stripW, SCALE.a.frac).h / SCALE_PAD;
      expect(ink + STRIP_FLOOR_PX).toBeLessThanOrEqual(h);
      // And not so tall that the figure is mostly sky: two of these stacked
      // must still leave room to read on a 348 px landscape phone.
      expect(h).toBeLessThan(stripW * 0.35);
    }
  });
});

describe('the measured numbers', () => {
  it('quotes the same value in the display as in the sentence', () => {
    // The number is hoisted out of the prose AND left in it. They are two
    // strings, so they can disagree; here they are made to agree.
    for (const s of STATS) {
      const bare = (v: string): string => v.replace(/[^\d.]/g, '');
      expect(s.text).toContain(bare(s.a.value));
      expect(s.text).toContain(bare(s.b.value));
    }
  });

  it('is exactly what the pixel rulers said', () => {
    expect(STATS.map((s) => [s.a.value, s.b.value])).toEqual([
      ['9.8 m', '25.8 m'],
      ['0.7', '1.8'],
      ['87 m', '428 m'],
    ]);
  });

  it('names what a bare number is counted in', () => {
    // 9.8 m and 87 m carry their unit; 0.7 and 1.8 do not, and a naked pair of
    // decimals on a card is a pair of decimals about nothing.
    for (const s of STATS) {
      const bare = !/[a-z%]/.test(s.a.value);
      expect(bare ? typeof s.unit : 'undefined').toBe(bare ? 'string' : 'undefined');
    }
  });

  it('invents no numbers beyond the ones that were measured', () => {
    // Every numeral anywhere on the page, against the list of numerals the
    // approved copy contains. A new one appearing here is a new claim about
    // the world, and this page is not allowed to make one.
    const allowed = new Set([
      '40', '17', '6.6', '9.8', '25.8', '0.7', '1.8', '87', '1', '428', '14',
      '100', '2000', '1997',
    ]);
    const seen = new Set<string>();
    for (const s of [...prose(), ...STATS.flatMap((x) => [x.a.value, x.b.value])]) {
      for (const m of s.match(/\d+(?:\.\d+)?/g) ?? []) seen.add(m);
    }
    expect([...seen].filter((n) => !allowed.has(n))).toEqual([]);
  });
});

describe('the copy', () => {
  it('is the five sections the user approved, in order', () => {
    expect(SECTIONS.map((s) => s.title)).toEqual([
      'where this came from',
      'then we took it apart',
      'what we took, and what we didn\'t',
      'what\'s ours',
      'and',
    ]);
  });

  it('adds no headings of its own', () => {
    // The brief was explicit: ship the copy close to as-written, do not add
    // headings it does not have. A section is a title and blocks; there is no
    // second level for one to appear at, and this asserts that nobody adds one
    // by smuggling a bold line in as a pull quote.
    for (const b of blocks()) {
      if (b.kind !== 'pull') continue;
      expect(b.text.endsWith('.')).toBe(true);
    }
  });

  it('carries no markup, anywhere', () => {
    // Everything reaches the document through textContent or as a run built
    // out of a real element. Angle brackets and entities in the source would
    // render as literal characters — safe, and wrong.
    for (const s of prose()) {
      expect(s).not.toMatch(/[<>]/);
      expect(s).not.toMatch(/&[a-z]+;/);
    }
  });

  it('has no empty or whitespace-only block', () => {
    for (const s of prose()) expect(s.trim().length).toBeGreaterThan(0);
    for (const s of SECTIONS) expect(s.blocks.length).toBeGreaterThan(0);
  });

  it('keeps the user\'s lowercase', () => {
    // It is lowercase on purpose and a polished rewrite is the named failure.
    // Only the two proper names in the credit are allowed a capital, and they
    // do not have one either — so nothing on this page starts a sentence with
    // one, and a "tidied" paragraph shows up here.
    for (const s of prose()) expect(s[0]).toBe(s[0].toLowerCase());
    for (const t of SECTIONS.map((s) => s.title)) expect(t).toBe(t.toLowerCase());
  });
});

describe('inline emphasis', () => {
  it('reads plain text as one plain run', () => {
    expect(inline('just words')).toEqual([{ text: 'just words', tag: '' }]);
  });

  it('reads single and double markers as em and strong', () => {
    expect(inline('a *b* c **d** e')).toEqual([
      { text: 'a ', tag: '' },
      { text: 'b', tag: 'em' },
      { text: ' c ', tag: '' },
      { text: 'd', tag: 'strong' },
      { text: ' e', tag: '' },
    ]);
  });

  it('leaves an unclosed marker alone rather than eating the paragraph', () => {
    // A typo in the copy should look like a stray asterisk, not like half a
    // section going italic.
    expect(inline('one * two')).toEqual([{ text: 'one * two', tag: '' }]);
    expect(inline('**')).toEqual([{ text: '**', tag: '' }]);
  });

  it('round-trips the real copy back to the real copy', () => {
    // The strongest statement available without a DOM: whatever the parser
    // does to the approved text, reassembling the runs gives the approved text
    // back with only the markers gone. Nothing is dropped, nothing is reordered
    // and no character is invented.
    for (const s of prose()) {
      expect(inline(s).map((r) => r.text).join('')).toBe(s.replace(/\*/g, ''));
    }
  });

  it('closes every marker in the copy', () => {
    for (const s of prose()) {
      expect(inline(s).some((r) => r.tag !== '') || !s.includes('*')).toBe(true);
    }
  });
});
