import { db } from '../db';
import {
  freeDictionary,
  myMemory,
  NetworkError,
  type ExplainQuery,
  type Explanation,
  type ExplanationProvider,
  type TranslationProvider,
} from '../lib/explain';
import type { WordEntry, WordStatus } from '../types';
import { addCard, removeCard, syncCards } from './cards';

// ------------------------------------------------------------------ network with a local cache

/** A "not found" answer is asked again after a month: dictionaries grow. */
const NOT_FOUND_TTL = 30 * 24 * 3600_000;
const inflight = new Map<string, Promise<unknown>>();

/** GET JSON once per URL, ever. 404 → null (cached too). No network → NetworkError. */
async function cachedFetch(url: string): Promise<unknown> {
  const d = await db();
  const hit = await d.get('cache', url);
  if (hit && (hit.value !== null || Date.now() - hit.at < NOT_FOUND_TTL)) return hit.value;
  const running = inflight.get(url);
  if (running) return running;
  const job = (async () => {
    // The free APIs now and then fail one request (an error page without CORS headers looks
    // like "offline" to the browser), so try twice more before giving up.
    let res: Response | undefined;
    for (let attempt = 0; attempt < 3 && !res; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 500 * attempt));
      try {
        res = await fetch(url);
        if (res.status >= 500 || res.status === 429) res = attempt < 2 ? undefined : res;
      } catch {
        if (!navigator.onLine) break;
      }
    }
    if (!res) throw new NetworkError('offline');
    if (res.status === 404) {
      await d.put('cache', { key: url, value: null, at: Date.now() });
      return null;
    }
    if (!res.ok) throw new NetworkError(`HTTP ${res.status}`);
    const value = await res.json();
    await d.put('cache', { key: url, value, at: Date.now() });
    return value;
  })();
  inflight.set(url, job);
  try {
    return await job;
  } finally {
    inflight.delete(url);
  }
}

export const explanationProvider: ExplanationProvider = freeDictionary(cachedFetch);
export const translationProvider: TranslationProvider = myMemory(cachedFetch);

export const explain = (q: ExplainQuery): Promise<Explanation | null> => explanationProvider.explain(q);
export const translate = (text: string): Promise<string[] | null> => translationProvider.translate(text);

// ------------------------------------------------------------------ saved words

let words: Map<string, WordEntry> | undefined;
const listeners = new Set<() => void>();

let synced = false;

export async function loadWords(): Promise<Map<string, WordEntry>> {
  if (!words) {
    const all = await (await db()).getAll('words');
    words ??= new Map(all.map((w) => [w.key, w]));
  }
  if (!synced) {
    // Words saved before cards existed (or a card lost) get their card here.
    synced = true;
    await syncCards(learningKeys());
  }
  return words;
}

/** Re-render hook: called after any change to saved words. */
export function onWordsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getWord = (key: string) => words?.get(key);

/** Base forms marked "learn" — underlined in the text. */
export function learningKeys(): Set<string> {
  return new Set([...(words?.values() ?? [])].filter((w) => w.status === 'learning').map((w) => w.key));
}

/** Base forms marked "know" — they no longer count as rare words. */
export async function knownKeys(): Promise<Set<string>> {
  return new Set([...(await loadWords()).values()].filter((w) => w.status === 'known').map((w) => w.key));
}

async function put(entry: WordEntry) {
  await loadWords();
  words!.set(entry.key, entry);
  await (await db()).put('words', entry);
  listeners.forEach((fn) => fn());
}

export async function setStatus(
  base: Omit<WordEntry, 'status' | 'addedAt' | 'updatedAt'>,
  status: WordStatus,
): Promise<void> {
  const old = (await loadWords()).get(base.key);
  const now = Date.now();
  await put({
    ...old,
    ...base,
    // Keep the first sentence the word was learned from.
    context: old?.context ?? base.context,
    form: old?.context ? old.form : base.form,
    explanation: base.explanation !== undefined ? base.explanation : old?.explanation,
    translation: base.translation ?? old?.translation,
    status,
    addedAt: old?.addedAt ?? now,
    updatedAt: now,
  });
  if (status === 'learning') await addCard(base.key);
  else await removeCard(base.key);
}

export async function forget(key: string): Promise<void> {
  await loadWords();
  words!.delete(key);
  await (await db()).delete('words', key);
  await removeCard(key);
  listeners.forEach((fn) => fn());
}

/** Words saved offline get their explanation once the network is back. */
export async function fillMissingExplanations(): Promise<void> {
  for (const w of [...(await loadWords()).values()]) {
    if (w.explanation !== undefined) continue;
    try {
      const explanation = await explain({ lemma: w.key, form: w.form ?? w.key });
      await put({ ...w, explanation, updatedAt: Date.now() });
    } catch (e) {
      if (e instanceof NetworkError) return;
      throw e;
    }
  }
}
