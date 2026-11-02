import type { Explanation } from './lib/explain';

/** A book file made by tools/convert.py. */
export interface BookFile {
  title: string;
  author?: string;
  chapters: { title?: string; paragraphs: string[] }[];
}

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  /** Chapter titles with the index of their first paragraph. */
  chapters: { title: string; start: number }[];
  paraCount: number;
  wordCount: number;
  addedAt: number;
  /** Share of uncommon words in the next excerpt (0..1), measured when planning. */
  difficulty?: number;
}

/** All paragraphs of a book, chapters flattened. Paragraph index = position in the book. */
export interface BookText {
  id: string;
  paragraphs: string[];
}

export interface Position {
  bookId: string;
  /** First paragraph on screen: reading continues here. */
  para: number;
  /** Furthest paragraph reached; words are counted only past this point. */
  furthest: number;
  percent: number;
  updatedAt: number;
}

/** Today's excerpt: paragraphs [start, end) of one book. */
export interface Plan {
  bookId: string;
  start: number;
  end: number;
  difficulty: number;
  manual?: boolean;
}

export interface DayRecord {
  day: string;
  plan?: Plan;
  done: boolean;
  /** Words read that day, in any book. */
  words: number;
  /** Card reviews that day, and how many of them were new cards (limit 15). */
  reviews?: number;
  newSeen?: number;
}

/** Round-robin order of books. */
export interface Queue {
  order: string[];
  last?: string;
  pinned?: string;
  /** Hard books that already stepped back once in this round. */
  deferred: string[];
}

export type WordStatus = 'learning' | 'known';

export interface WordEntry {
  /** Base form ("run") or a phrase in lowercase ("give up"). */
  key: string;
  kind: 'word' | 'phrase';
  status: WordStatus;
  /** Where the word was met: the form as written and the whole sentence. */
  form?: string;
  context?: { sentence: string; bookId: string; bookTitle: string; para: number };
  /** Undefined: not looked up yet (offline); null: the dictionary has no entry. */
  explanation?: Explanation | null;
  translation?: string[];
  addedAt: number;
  updatedAt: number;
}

export interface CacheEntry {
  key: string;
  /** Parsed JSON, or null for "not found". */
  value: unknown;
  at: number;
}

export type Theme = 'sepia' | 'light' | 'dark';
export type Lang = 'en' | 'ru';

export interface Settings {
  theme: Theme;
  fontSize: number;
  lineHeight: number;
  lang: Lang;
}
