// Builds src/data/phrases.json from scripts/data/phrases.tsv (made by fetch-phrases.py):
// fixed expressions from Wiktionary (CC BY-SA 4.0), split into verb phrases — which may be
// separated around a particle ("turn the light off") — and everything else.
//
//   npm run phrases
import { readFileSync, writeFileSync } from 'node:fs';

const rows = readFileSync(new URL('data/phrases.tsv', import.meta.url), 'utf8').trim().split('\n');
const verb = [];
const other = [];
for (const row of rows) {
  const [text, pos] = row.split('\t');
  const phrase = text.toLowerCase().replace(/’/g, "'");
  (pos === 'verb' ? verb : other).push(phrase);
}
writeFileSync(new URL('../src/data/phrases.json', import.meta.url), JSON.stringify({ verb, other }));
console.log(`${verb.length} verb phrases + ${other.length} other expressions → src/data/phrases.json`);
