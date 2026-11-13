import { getKV, setKV } from '../db';
import { addPersonalPhrases } from '../lib/phrases';

/**
 * Personal expression lists, e.g. collocations from a textbook. They are added like books
 * (Library → Add books, a .json file) and live only on this device (and in its backups).
 *
 *   { "type": "daily-reader-phrases", "title": "…", "phrases": ["heavy rain", "make a decision", …] }
 */
export interface PhraseList {
  type: 'daily-reader-phrases';
  title: string;
  phrases: string[];
}

export function isPhraseList(data: unknown): data is PhraseList {
  const d = data as PhraseList;
  return d?.type === 'daily-reader-phrases' && typeof d.title === 'string' && Array.isArray(d.phrases);
}

const KEY = 'phraseLists';

export async function phraseLists(): Promise<PhraseList[]> {
  return getKV<PhraseList[]>(KEY, []);
}

/** Puts every saved list into the expression finder. */
export async function loadMyPhrases(): Promise<void> {
  await addPersonalPhrases((await phraseLists()).flatMap((l) => l.phrases));
}

/** Saves a list (replacing one with the same title) and returns how many expressions it has. */
export async function importPhraseList(list: PhraseList): Promise<number> {
  const phrases = [...new Set(list.phrases.map((p) => p.trim().toLowerCase()).filter((p) => p.includes(' ')))];
  const lists = (await phraseLists()).filter((l) => l.title !== list.title);
  await setKV(KEY, [...lists, { type: 'daily-reader-phrases', title: list.title, phrases }]);
  await loadMyPhrases();
  return phrases.length;
}

export async function removePhraseList(title: string): Promise<void> {
  await setKV(KEY, (await phraseLists()).filter((l) => l.title !== title));
  await loadMyPhrases();
}
