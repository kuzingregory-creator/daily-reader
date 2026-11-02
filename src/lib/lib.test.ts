import { describe, expect, it } from 'vitest';
import { excerptEnd, excerptStart, SCENE_BREAK } from './excerpt';
import { pickBook, rotation } from './plan';
import { plainForm, unknownShare } from './words';
import { dayKey, prevDay, streak } from './day';

const para = (n: number) => Array.from({ length: n }, (_, i) => (i % 7 ? 'word' : 'Word')).join(' ') + '.';

function book(sizes: number[]) {
  const paragraphs = sizes.map((n) => (n === 0 ? SCENE_BREAK : para(n)));
  return { paragraphs, words: sizes };
}

describe('excerptEnd', () => {
  it('stops at the first paragraph end past 1200 words', () => {
    const b = book(Array(40).fill(100));
    expect(excerptEnd(b.paragraphs, b.words, new Set(), 0)).toBe(12);
  });

  it('prefers a chapter end within the slack', () => {
    const b = book(Array(40).fill(100));
    expect(excerptEnd(b.paragraphs, b.words, new Set([10]), 0)).toBe(10); // 1000 words
    expect(excerptEnd(b.paragraphs, b.words, new Set([17]), 0)).toBe(17); // 1700 words
    expect(excerptEnd(b.paragraphs, b.words, new Set([20]), 0)).toBe(12); // 2000: too far
  });

  it('prefers a scene break over a plain paragraph end', () => {
    const sizes = Array(40).fill(100);
    sizes[16] = 0;
    const b = book(sizes);
    expect(excerptEnd(b.paragraphs, b.words, new Set(), 0)).toBe(16);
  });

  it('does not leave a tiny tail', () => {
    const b = book(Array(14).fill(100));
    expect(excerptEnd(b.paragraphs, b.words, new Set(), 0)).toBe(14);
  });

  it('does not end right after a heading', () => {
    const b = book(Array(40).fill(100));
    b.paragraphs[11] = 'HOW TO BUILD A HABIT';
    b.words[11] = 5;
    expect(excerptEnd(b.paragraphs, b.words, new Set(), 0)).toBe(13);
  });

  it('copes with a giant paragraph', () => {
    const b = book([300, 5000, 300, 300, 300, 300]);
    expect(excerptEnd(b.paragraphs, b.words, new Set(), 0)).toBe(2);
  });

  it('skips a scene mark at the start', () => {
    expect(excerptStart([SCENE_BREAK, 'a'], 0)).toBe(1);
  });
});

describe('queue', () => {
  it('rotates after the last book', () => {
    expect(rotation(['a', 'b', 'c'], 'b')).toEqual(['c', 'a', 'b']);
    expect(rotation(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('lets a hard book step back once', () => {
    const c = [{ id: 'a', difficulty: 0.12 }, { id: 'b', difficulty: 0.05 }];
    const first = pickBook(c, []);
    expect(first.pick.id).toBe('b');
    expect(first.deferred).toEqual(['a']);
    const next = pickBook(c, first.deferred);
    expect(next.pick.id).toBe('a');
    expect(next.deferred).toEqual([]);
  });

  it('uses plain round robin when every book is hard', () => {
    const c = [{ id: 'a', difficulty: 0.2 }, { id: 'b', difficulty: 0.1 }];
    expect(pickBook(c, []).pick.id).toBe('a');
  });
});

describe('words', () => {
  it('strips contractions', () => {
    expect(plainForm('Don’t')).toBe('do');
    expect(plainForm("he's")).toBe('he');
    expect(plainForm('won’t')).toBe('will');
  });

  it('counts uncommon words, not names', () => {
    expect(unknownShare(['The house was big.'])).toBe(0);
    expect(unknownShare(['Then Shukhov ate his gruel.'])).toBeCloseTo(1 / 4);
  });
});

describe('days', () => {
  it('starts a new day at 3 a.m.', () => {
    expect(dayKey(new Date(2026, 10, 3, 1, 0))).toBe('2026-11-02');
    expect(dayKey(new Date(2026, 10, 3, 4, 0))).toBe('2026-11-03');
    expect(prevDay('2026-03-01')).toBe('2026-02-28');
  });

  it('counts a streak', () => {
    const done = new Set(['2026-11-01', '2026-11-02']);
    expect(streak(done, '2026-11-02')).toBe(2);
    expect(streak(done, '2026-11-03')).toBe(2);
    expect(streak(done, '2026-11-04')).toBe(0);
  });
});
