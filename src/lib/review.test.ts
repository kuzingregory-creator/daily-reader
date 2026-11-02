import { describe, expect, it } from 'vitest';
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';
import { buildSession, cloze, NEW_PER_DAY, shortInterval, type CardRecord } from './review';

describe('cloze', () => {
  it('blanks the word as written, keeping the first letter', () => {
    const c = cloze('Reveille was sounded, as always, at 5 A.M.', 'sounded', 'sound')!;
    expect(c.before).toBe('Reveille was ');
    expect(c.after).toBe(', as always, at 5 A.M.');
    expect(c.blank).toBe('s______');
    expect(c.answer).toBe('sounded');
  });

  it('matches case-insensitively and whole words only', () => {
    expect(cloze('Sound travels.', 'sound')!.answer).toBe('Sound');
    expect(cloze('The soundtrack was loud.', 'sound')).toBeNull();
  });

  it('handles phrases and curly apostrophes', () => {
    expect(cloze('He gave   up at last.', 'gave up')!.after).toBe(' at last.');
    expect(cloze('I don’t know.', "don't")!.answer).toBe('don’t');
  });

  it('falls back to the next form', () => {
    expect(cloze('The leaf fell.', 'leaves', 'leaf')!.answer).toBe('leaf');
  });
});

describe('session', () => {
  const now = new Date('2026-11-02T08:00:00');
  const f = fsrs();
  const make = (key: string, createdAt: number): CardRecord => ({ key, card: createEmptyCard(now), createdAt });

  it('puts due cards first and limits new cards to 15 a day', () => {
    const fresh = Array.from({ length: 20 }, (_, i) => make(`new${i}`, i));
    const started = { ...make('old', 0), card: f.next(createEmptyCard(now), now, Rating.Good).card };
    const end = new Date('2026-11-03T03:00:00').getTime();
    const s = buildSession([...fresh, started], 0, end);
    expect(s[0].key).toBe('old');
    expect(s.length).toBe(1 + NEW_PER_DAY);
    expect(buildSession(fresh, 12, end).length).toBe(3);
    expect(buildSession(fresh, 15, end).length).toBe(0);
  });

  it('leaves cards due after today for later', () => {
    const later = { ...make('later', 0), card: f.next(createEmptyCard(now), now, Rating.Easy).card };
    expect(buildSession([later], 0, new Date('2026-11-03T03:00:00').getTime())).toEqual([]);
  });
});

describe('intervals', () => {
  it('formats short labels', () => {
    expect(shortInterval(60_000)).toBe('1m');
    expect(shortInterval(10 * 60_000)).toBe('10m');
    expect(shortInterval(3 * 86400_000)).toBe('3d');
    expect(shortInterval(3 * 86400_000, 'ru')).toBe('3д');
    expect(shortInterval(90 * 86400_000)).toBe('3mo');
  });
});
