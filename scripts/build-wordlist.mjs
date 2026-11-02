// Builds the word data the app ships with (run once on the Mac: npm run wordlist):
//
//   src/data/lemmas.json        form → base form, e.g. went → go, leaves → leave / leaf
//                               (second reading: the noun/adjective one, picked from context).
//                               Stored as suffix edits: "drop N letters, add the rest" —
//                               "feet": "3oot" (→ foot), "leaves": "2|3f" (→ leave | leaf), "0" = itself.
//   src/data/common-words.json  every form whose base form is among the 3000 most frequent
//                               English lemmas; these count as "easy" for excerpt difficulty
//
// Sources: SUBTLEX-US word frequencies, wink-lemmatizer + wink-lexicon part-of-speech tags.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const subtlex = require('subtlex-word-frequencies');
const lemmatizer = require('wink-lemmatizer');
const lexicon = require('wink-lexicon/src/lexicon.js');

const TOP_LEMMAS = 3000;

// Merge case variants. Words seen only capitalised (Phoebe, Paris) are names.
const counts = new Map();
const lowerSeen = new Set();
for (const { word, count } of subtlex) {
  const w = word.toLowerCase();
  if (!/^[a-z]+$/.test(w)) continue;
  if (word === w || word === 'I') lowerSeen.add(w);
  counts.set(w, (counts.get(w) ?? 0) + count);
}
for (const w of counts.keys()) if (!lowerSeen.has(w)) counts.delete(w);
// Contraction pieces (don|t, I|m, you|re) are not words on their own.
for (const w of ['s', 't', 'm', 're', 'll', 'd', 've', 'don', 'didn', 'doesn', 'isn', 'wasn', 'aren', 'couldn',
  'wouldn', 'shouldn', 'haven', 'hasn', 'weren', 'ain', 'gonna', 'wanna', 'gotta']) counts.delete(w);
for (const w of counts.keys()) if (w.length === 1 && w !== 'a' && w !== 'i') counts.delete(w);

const known = (w) => counts.has(w) || Object.hasOwn(lexicon, w);
const pick = (w, candidate) => (candidate && candidate !== w && known(candidate) ? candidate : w);

/** [main base form, other reading] — the other one only when it differs. */
function lemmas(w) {
  const tags = Object.hasOwn(lexicon, w) ? lexicon[w] : undefined;
  const verb = pick(w, lemmatizer.verb(w));
  const noun = pick(w, lemmatizer.noun(w));
  const adj = pick(w, lemmatizer.adjective(w));
  if (!tags) {
    // Not in the tagged lexicon: take the most frequent reading.
    const best = [verb, noun, adj].filter((c) => c !== w).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0];
    return [best ?? w];
  }
  const main = tags[0];
  const other = tags.slice(1);
  let first;
  if (main.startsWith('VB')) first = verb;
  else if (main === 'NNS' || main === 'NNPS') first = noun;
  else if (main === 'JJR' || main === 'JJS' || main === 'RBR' || main === 'RBS') first = adj;
  else first = w; // NN, JJ, RB…: the word is its own base form ("interesting", "feeling")
  let second;
  if (first !== w || main.startsWith('VB')) {
    if (other.some((t) => t === 'NNS')) second = noun;
    else if (other.some((t) => t === 'NN' || t === 'JJ')) second = w;
  }
  return second && second !== first ? [first, second] : [first];
}

const lemmaMap = Object.create(null);
const lemmaCount = new Map();
// Words that look inflected but are base forms ("interesting", "news") are listed too,
// so the app's fallback rules for unknown words never touch them.
const LOOKS_INFLECTED = /(s|ing|ed)$/;
for (const [w, n] of counts) {
  const ls = lemmas(w);
  if (ls[0] !== w || ls.length > 1 || LOOKS_INFLECTED.test(w)) lemmaMap[w] = ls;
  lemmaCount.set(ls[0], (lemmaCount.get(ls[0]) ?? 0) + n);
}

const top = new Set([...lemmaCount].sort((a, b) => b[1] - a[1]).slice(0, TOP_LEMMAS).map(([l]) => l));
const forms = new Set(top);
for (const w of counts.keys()) {
  const ls = lemmaMap[w] ?? [w];
  if (ls.some((l) => top.has(l))) forms.add(w);
}

const out = new URL('../src/data/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('common-words.json', out), JSON.stringify([...forms].sort()));
const edit = (w, l) => {
  let i = 0;
  while (i < w.length && i < l.length && w[i] === l[i]) i++;
  return `${w.length - i}${l.slice(i)}`;
};
const encoded = Object.fromEntries(Object.entries(lemmaMap).map(([w, ls]) => [w, ls.map((l) => edit(w, l)).join('|')]));
writeFileSync(new URL('lemmas.json', out), JSON.stringify(encoded));
console.log(`${top.size} top lemmas → ${forms.size} easy forms → src/data/common-words.json`);
console.log(`${Object.keys(lemmaMap).length} forms with a base form → src/data/lemmas.json`);
for (const w of ['went', 'running', 'interesting', 'leaves', 'saw', 'better', 'feeling', 'tired', 'children', 'was'])
  console.log(`  ${w} → ${(lemmaMap[w] ?? [w]).join(' / ')}`);
