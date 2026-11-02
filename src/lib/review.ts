import { State, type Card } from 'ts-fsrs';

export const NEW_PER_DAY = 15;
/** A card counts as learned once its interval reaches three weeks. */
export const LEARNED_DAYS = 21;

export interface CardRecord {
  /** Same key as the word: base form or phrase. */
  key: string;
  card: Card;
  createdAt: number;
}

export const isLearned = (c: Card) => c.state === State.Review && c.scheduled_days >= LEARNED_DAYS;

/**
 * Today's review session: every started card due before the day ends (soonest first),
 * then new cards, oldest first, up to the daily limit.
 */
export function buildSession(cards: CardRecord[], newSeenToday: number, dayEnd: number): CardRecord[] {
  const due = cards
    .filter((c) => c.card.state !== State.New && c.card.due.getTime() <= dayEnd)
    .sort((a, b) => a.card.due.getTime() - b.card.due.getTime());
  const fresh = cards
    .filter((c) => c.card.state === State.New)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, Math.max(0, NEW_PER_DAY - newSeenToday));
  return [...due, ...fresh];
}

export interface Cloze {
  before: string;
  after: string;
  /** "r______": first letter, then one underscore per remaining letter (at most 8). */
  blank: string;
  answer: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The sentence with the word blanked out, or null if the word is not in it. */
export function cloze(sentence: string, ...forms: (string | undefined)[]): Cloze | null {
  for (const form of forms) {
    if (!form) continue;
    const pattern = escape(form).replace(/['’]/g, "['’]").replace(/\s+/g, '\\s+');
    const m = new RegExp(`(^|[^A-Za-z])(${pattern})(?![A-Za-z])`, 'i').exec(sentence);
    if (!m) continue;
    const start = m.index + m[1].length;
    const answer = m[2];
    const letters = answer.replace(/[^A-Za-z]/g, '');
    return {
      before: sentence.slice(0, start),
      after: sentence.slice(start + answer.length),
      blank: answer[0] + '_'.repeat(Math.min(8, Math.max(2, letters.length - 1))),
      answer,
    };
  }
  return null;
}

/** "1m", "10m", "3h", "4d", "2mo", "1y" — the next interval for a rating button. */
export function shortInterval(ms: number, lang: 'en' | 'ru' = 'en'): string {
  const u = lang === 'ru' ? { m: 'мин', h: 'ч', d: 'д', mo: 'мес', y: 'г' } : { m: 'm', h: 'h', d: 'd', mo: 'mo', y: 'y' };
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min}${u.m}`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}${u.h}`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d}${u.d}`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}${u.mo}`;
  return `${Math.round(d / 365)}${u.y}`;
}
