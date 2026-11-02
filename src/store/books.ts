import { db } from '../db';
import { dayKey } from '../lib/day';
import { countWords } from '../lib/words';
import type { BookFile, BookMeta, Position } from '../types';

export interface LoadedBook {
  meta: BookMeta;
  paragraphs: string[];
  /** Words per paragraph and running total: cum[i] = words before paragraph i. */
  words: number[];
  cum: number[];
  chapterStarts: Set<number>;
}

const cache = new Map<string, LoadedBook>();

export async function listBooks(): Promise<BookMeta[]> {
  const books = await (await db()).getAll('books');
  return books.sort((a, b) => a.addedAt - b.addedAt);
}

export async function loadBook(id: string): Promise<LoadedBook | undefined> {
  const hit = cache.get(id);
  if (hit) return hit;
  const d = await db();
  const [meta, text] = await Promise.all([d.get('books', id), d.get('texts', id)]);
  if (!meta || !text) return undefined;
  const words = text.paragraphs.map(countWords);
  const cum = [0];
  for (const w of words) cum.push(cum[cum.length - 1] + w);
  const book = { meta, paragraphs: text.paragraphs, words, cum, chapterStarts: new Set(meta.chapters.map((c) => c.start)) };
  cache.set(id, book);
  return book;
}

/** Chapter that paragraph `i` belongs to. */
export function chapterAt(book: LoadedBook, i: number): string {
  let title = '';
  for (const c of book.meta.chapters) {
    if (c.start > i) break;
    title = c.title;
  }
  return title;
}

// ------------------------------------------------------------------ import

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function bookId(title: string, author: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${slug || 'book'}-${hash(`${title}|${author}`)}`;
}

export function parseBookFile(data: unknown): BookFile {
  const b = data as BookFile;
  if (!b || typeof b.title !== 'string' || !Array.isArray(b.chapters)) {
    throw new Error('not a book file (needs "title" and "chapters")');
  }
  for (const c of b.chapters) {
    if (!Array.isArray(c?.paragraphs) || c.paragraphs.some((p) => typeof p !== 'string')) {
      throw new Error('every chapter needs "paragraphs": a list of strings');
    }
  }
  if (!b.chapters.some((c) => c.paragraphs.length)) throw new Error('the book has no text');
  return b;
}

/** Saves a book. Importing the same book again replaces its text but keeps the reading place. */
export async function importBook(file: BookFile): Promise<{ meta: BookMeta; replaced: boolean }> {
  const author = file.author?.trim() ?? '';
  const id = bookId(file.title.trim(), author);
  const paragraphs: string[] = [];
  const chapters: BookMeta['chapters'] = [];
  file.chapters.forEach((c, i) => {
    if (!c.paragraphs.length) return;
    chapters.push({ title: c.title?.trim() || `Chapter ${i + 1}`, start: paragraphs.length });
    paragraphs.push(...c.paragraphs);
  });
  const d = await db();
  const old = await d.get('books', id);
  const meta: BookMeta = {
    id,
    title: file.title.trim(),
    author,
    chapters,
    paraCount: paragraphs.length,
    wordCount: paragraphs.reduce((n, p) => n + countWords(p), 0),
    addedAt: old?.addedAt ?? Date.now(),
  };
  const tx = d.transaction(['books', 'texts', 'positions'], 'readwrite');
  await tx.objectStore('books').put(meta);
  await tx.objectStore('texts').put({ id, paragraphs });
  const pos = await tx.objectStore('positions').get(id);
  if (pos && pos.para > paragraphs.length) await tx.objectStore('positions').put({ ...pos, para: 0 });
  await tx.done;
  cache.delete(id);
  return { meta, replaced: !!old };
}

export async function deleteBook(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['books', 'texts', 'positions'], 'readwrite');
  await Promise.all([
    tx.objectStore('books').delete(id),
    tx.objectStore('texts').delete(id),
    tx.objectStore('positions').delete(id),
    tx.done,
  ]);
  cache.delete(id);
}

export async function saveDifficulty(id: string, difficulty: number): Promise<void> {
  const d = await db();
  const meta = await d.get('books', id);
  if (meta) await d.put('books', { ...meta, difficulty });
}

// ------------------------------------------------------------------ reading place

const emptyPosition = (bookId: string): Position => ({ bookId, para: 0, furthest: 0, percent: 0, updatedAt: 0 });

export async function getPosition(id: string): Promise<Position> {
  return (await (await db()).get('positions', id)) ?? emptyPosition(id);
}

export async function getPositions(): Promise<Map<string, Position>> {
  const all = await (await db()).getAll('positions');
  return new Map(all.map((p) => [p.bookId, p]));
}

/** Faster than this is skimming, not reading: such scrolling adds no words to the stats. */
const MAX_WORDS_PER_MINUTE = 400;
const SKIM_ALLOWANCE = 300;

/**
 * Remembers the reading place. Moving past the furthest point counts those words as read
 * today — unless it is a jump (contents, "start again") or skimming, which reads nothing.
 */
export async function savePosition(book: LoadedBook, para: number, jump = false): Promise<void> {
  const n = book.paragraphs.length;
  para = Math.max(0, Math.min(n, para));
  const d = await db();
  const tx = d.transaction(['positions', 'days'], 'readwrite');
  const positions = tx.objectStore('positions');
  const pos = (await positions.get(book.meta.id)) ?? emptyPosition(book.meta.id);
  let read = 0;
  if (para > pos.furthest) {
    read = book.cum[para] - book.cum[pos.furthest];
    const minutes = (Date.now() - pos.updatedAt) / 60_000;
    if (jump || read > SKIM_ALLOWANCE + minutes * MAX_WORDS_PER_MINUTE) read = 0;
    pos.furthest = para;
  }
  pos.para = para;
  pos.percent = book.cum[n] ? book.cum[para] / book.cum[n] : 0;
  pos.updatedAt = Date.now();
  await positions.put(pos);
  if (read > 0) {
    const days = tx.objectStore('days');
    const day = dayKey();
    const rec = (await days.get(day)) ?? { day, done: false, words: 0 };
    rec.words += read;
    await days.put(rec);
  }
  await tx.done;
}
