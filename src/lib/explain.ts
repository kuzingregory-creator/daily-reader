import type { PosHint } from './lemma';

/** A short explanation of a word in simple English. */
export interface Explanation {
  /** Headword as the dictionary has it. */
  word: string;
  phonetic?: string;
  senses: { pos: string; definition: string }[];
  example?: string;
  source: string;
}

export interface ExplainQuery {
  /** Base form ("run"), the form in the text ("running") and the guessed part of speech. */
  lemma: string;
  form: string;
  pos?: PosHint;
  /** The sentence from the book. Providers may use it (an AI one would); the free ones don't send it. */
  sentence?: string;
}

/**
 * Where explanations come from. Version 1: Free Dictionary API.
 * Version 2 can add an AI provider (B1-level explanation, a picture) behind the same interface.
 * `explain` resolves to null when the word is not found and throws when the network fails.
 */
export interface ExplanationProvider {
  id: string;
  explain(q: ExplainQuery): Promise<Explanation | null>;
}

export interface TranslationProvider {
  id: string;
  /** Russian translations, best first; null when there is none. */
  translate(text: string): Promise<string[] | null>;
}

export class NetworkError extends Error {}

/** Raw responses are cached by the caller; this is only the fetch. */
export type Fetcher = (url: string) => Promise<unknown>;

// ------------------------------------------------------------------ Free Dictionary API

interface FdEntry {
  word: string;
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[];
}

const USELESS = /^(plural|(simple )?past|present participle|past participle|third[- ]person|alternative|obsolete|archaic|misspelling|abbreviation|initialism|nonstandard|eye dialect|comparative|superlative|en dash)\b/i;

function cleanDefinition(d: string): string {
  return d.replace(/^\s*\([^)]*\)\s*/, '').replace(/\s+/g, ' ').trim();
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Picks 1–2 short, useful definitions: the part of speech from context first,
 * skipping stubs like "To run." or "Plural of leaf." Exported for tests.
 */
export function pickSenses(entries: FdEntry[], pos: PosHint, lemma: string): Explanation | null {
  const meanings = entries.flatMap((e) => e.meanings);
  if (!meanings.length) return null;
  const byPos = new Map<string, { definition: string; example?: string }[]>();
  for (const m of meanings) {
    const list = byPos.get(m.partOfSpeech) ?? [];
    for (const d of m.definitions) {
      const definition = cleanDefinition(d.definition);
      const n = wordCount(definition);
      if (n < 3 || n > 30 || definition.endsWith(':') || USELESS.test(definition)) continue;
      if (n === 3 && new RegExp(`\\b${lemma}\\b`, 'i').test(definition)) continue; // "To run."
      list.push({ definition, example: d.example });
    }
    if (list.length) byPos.set(m.partOfSpeech, list);
  }
  if (!byPos.size) return null;
  const order = [...byPos.keys()];
  const preferred = pos && byPos.has(pos) ? pos : order[0];
  // The first definitions are the most common ones; of the first three, take the two shortest
  // (looking further down brings up rare senses: "get up" → "to amass").
  const top = byPos.get(preferred)!.slice(0, 3);
  const chosen = [...top].sort((a, b) => a.definition.length - b.definition.length).slice(0, 2);
  chosen.sort((a, b) => top.indexOf(a) - top.indexOf(b));
  const example =
    chosen.find((d) => d.example && wordCount(d.example) <= 25)?.example ??
    top.find((d) => d.example && wordCount(d.example) <= 25)?.example;
  const entry = entries[0];
  return {
    word: entry.word,
    phonetic: entry.phonetic ?? entry.phonetics?.find((p) => p.text)?.text,
    senses: chosen.map((d) => ({ pos: preferred, definition: d.definition })),
    example,
    source: 'Free Dictionary',
  };
}

export function freeDictionary(fetchJson: Fetcher): ExplanationProvider {
  const lookup = async (word: string) =>
    (await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)) as FdEntry[] | null;
  return {
    id: 'freedict',
    async explain({ lemma, form, pos }) {
      let entries = await lookup(lemma);
      let result = entries && pickSenses(entries, pos, lemma);
      if (!result && form.toLowerCase() !== lemma) {
        entries = await lookup(form.toLowerCase());
        result = entries && pickSenses(entries, pos, form.toLowerCase());
      }
      return result ?? null;
    },
  };
}

// ------------------------------------------------------------------ MyMemory (translation)

interface MmResponse {
  responseStatus: number | string;
  responseData?: { translatedText?: string };
  matches?: { translation: string; quality?: number | string }[];
}

export function myMemory(fetchJson: Fetcher): TranslationProvider {
  return {
    id: 'mymemory',
    async translate(text) {
      const r = (await fetchJson(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ru`,
      )) as MmResponse | null;
      if (!r || Number(r.responseStatus) !== 200) return null;
      const seen = new Set<string>();
      const out: string[] = [];
      const add = (t?: string) => {
        const v = t?.trim().replace(/[.!]+$/, '');
        if (!v || !/[а-яё]/i.test(v)) return;
        const k = v.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          out.push(k === v.toLowerCase() && v === v.toUpperCase() ? k : v);
        }
      };
      add(r.responseData?.translatedText);
      for (const m of r.matches ?? []) if (Number(m.quality ?? 0) >= 50) add(m.translation);
      return out.length ? out.slice(0, 3) : null;
    },
  };
}

/** Fallback when no translation came back. */
export const googleTranslateUrl = (text: string) =>
  `https://translate.google.com/?sl=en&tl=ru&op=translate&text=${encodeURIComponent(text)}`;
