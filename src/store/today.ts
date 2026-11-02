import { db, getKV, setKV } from '../db';
import { dayKey, streak } from '../lib/day';
import { excerptEnd, excerptStart } from '../lib/excerpt';
import { pickBook, rotation, type Candidate } from '../lib/plan';
import { unknownShare } from '../lib/words';
import { lemmaReadings, loadLemmas } from '../lib/lemma';
import { knownKeys } from './words';
import type { DayRecord, Plan, Position, Queue } from '../types';
import { getPositions, listBooks, loadBook, saveDifficulty, savePosition, type LoadedBook } from './books';

export interface Today {
  day: string;
  record: DayRecord;
  book?: LoadedBook;
  position?: Position;
  streak: number;
  hasBooks: boolean;
}

export async function getQueue(): Promise<Queue> {
  return getKV<Queue>('queue', { order: [], deferred: [] });
}

export async function setPinned(id: string | undefined): Promise<void> {
  await setKV('queue', { ...(await getQueue()), pinned: id });
}

/** Today's excerpt for a book that continues at `from`. */
export function excerptFor(
  book: LoadedBook,
  from: number,
  isKnown?: (form: string) => boolean,
): { start: number; end: number; difficulty: number } {
  const start = excerptStart(book.paragraphs, from);
  const end = excerptEnd(book.paragraphs, book.words, book.chapterStarts, start);
  return { start, end, difficulty: unknownShare(book.paragraphs.slice(start, end), isKnown) };
}

/** Words marked "know" don't count as rare, in any form. */
async function knownTest(): Promise<(form: string) => boolean> {
  const [known] = await Promise.all([knownKeys(), loadLemmas()]);
  return (form) => known.size > 0 && lemmaReadings(form).some((l) => known.has(l));
}

/** Chooses today's book (or the one asked for) and cuts its excerpt. */
async function makePlan(bookId?: string): Promise<Plan | undefined> {
  const metas = await listBooks();
  const positions = await getPositions();
  const queue = await getQueue();
  const ids = new Set(metas.map((m) => m.id));
  queue.order = [...queue.order.filter((id) => ids.has(id)), ...metas.map((m) => m.id).filter((id) => !queue.order.includes(id))];
  queue.deferred = queue.deferred.filter((id) => ids.has(id));

  const unfinished = (id: string) => (positions.get(id)?.para ?? 0) < (metas.find((m) => m.id === id)?.paraCount ?? 0);
  const pinned = queue.pinned && ids.has(queue.pinned) && unfinished(queue.pinned) ? queue.pinned : undefined;
  const pool = (bookId ? [bookId] : pinned ? [pinned] : rotation(queue.order, queue.last)).filter(unfinished);
  if (!pool.length) return undefined;

  const isKnown = await knownTest();
  const plans = new Map<string, Plan>();
  const candidates: Candidate[] = [];
  for (const id of pool) {
    const book = await loadBook(id);
    if (!book) continue;
    const ex = excerptFor(book, positions.get(id)?.para ?? 0, isKnown);
    plans.set(id, { bookId: id, ...ex, manual: !!bookId });
    candidates.push({ id, difficulty: ex.difficulty });
    await saveDifficulty(id, ex.difficulty);
  }
  if (!candidates.length) return undefined;
  const { pick, deferred } = bookId ? { pick: candidates[0], deferred: queue.deferred } : pickBook(candidates, queue.deferred);
  await setKV('queue', { ...queue, last: pick.id, deferred });
  return plans.get(pick.id);
}

async function doneDays(): Promise<Set<string>> {
  const all = await (await db()).getAll('days');
  return new Set(all.filter((d) => d.done).map((d) => d.day));
}

export async function getToday(): Promise<Today> {
  const d = await db();
  const day = dayKey();
  const record: DayRecord = (await d.get('days', day)) ?? { day, done: false, words: 0 };
  let book = record.plan && (await loadBook(record.plan.bookId));
  if (!book && !record.done) {
    record.plan = await makePlan();
    book = record.plan && (await loadBook(record.plan.bookId));
    await d.put('days', record);
  }
  const position = book && (await d.get('positions', book.meta.id));
  // Read past the excerpt some other way (e.g. from the library): today is done.
  if (record.plan && position && !record.done && position.furthest >= record.plan.end) {
    record.done = true;
    await d.put('days', record);
  }
  const hasBooks = (await d.count('books')) > 0;
  return { day, record, book: book || undefined, position, streak: streak(await doneDays(), day), hasBooks };
}

/** Swaps today's excerpt for another book. */
export async function chooseBook(bookId: string): Promise<void> {
  const d = await db();
  const day = dayKey();
  const record: DayRecord = (await d.get('days', day)) ?? { day, done: false, words: 0 };
  record.plan = await makePlan(bookId);
  record.done = false;
  await d.put('days', record);
}

export async function finishToday(): Promise<void> {
  const t = await getToday();
  if (!t.record.plan || !t.book) return;
  await savePosition(t.book, t.record.plan.end);
  const d = await db();
  const record = (await d.get('days', t.day))!;
  record.done = true;
  await d.put('days', record);
}
