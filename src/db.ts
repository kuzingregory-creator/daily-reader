import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CardRecord } from './lib/review';
import type { BookMeta, BookText, CacheEntry, DayRecord, Position, WordEntry } from './types';

interface ReaderDB extends DBSchema {
  books: { key: string; value: BookMeta };
  texts: { key: string; value: BookText };
  positions: { key: string; value: Position };
  days: { key: string; value: DayRecord };
  /** Small singletons: settings, queue. */
  kv: { key: string; value: unknown };
  /** Words and phrases marked "learn" or "know". */
  words: { key: string; value: WordEntry };
  /** Dictionary and translation responses: each word goes to the network once. */
  cache: { key: string; value: CacheEntry };
  /** FSRS review cards, one per word being learned. */
  cards: { key: string; value: CardRecord };
}

let conn: Promise<IDBPDatabase<ReaderDB>> | undefined;

export function db(): Promise<IDBPDatabase<ReaderDB>> {
  conn ??= openDB<ReaderDB>('daily-reader', 3, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('books', { keyPath: 'id' });
        d.createObjectStore('texts', { keyPath: 'id' });
        d.createObjectStore('positions', { keyPath: 'bookId' });
        d.createObjectStore('days', { keyPath: 'day' });
        d.createObjectStore('kv');
      }
      if (oldVersion < 2) {
        d.createObjectStore('words', { keyPath: 'key' });
        d.createObjectStore('cache', { keyPath: 'key' });
      }
      if (oldVersion < 3) {
        d.createObjectStore('cards', { keyPath: 'key' });
      }
    },
  });
  return conn;
}

export async function getKV<T>(key: string, fallback: T): Promise<T> {
  return ((await (await db()).get('kv', key)) as T | undefined) ?? fallback;
}

export async function setKV<T>(key: string, value: T): Promise<void> {
  await (await db()).put('kv', value, key);
}
