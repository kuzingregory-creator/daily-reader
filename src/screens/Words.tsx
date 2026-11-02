import { useEffect, useMemo, useState } from 'preact/hooks';
import { State } from 'ts-fsrs';
import { useApp } from '../i18n';
import { isLearned, shortInterval, type CardRecord } from '../lib/review';
import { allCards } from '../store/cards';
import { forget, loadWords, onWordsChange, setStatus } from '../store/words';
import type { WordEntry } from '../types';
import { Sheet, TabBar } from '../components/ui';
import { WordDetails } from '../components/WordDetails';

type Filter = 'all' | 'learning' | 'learned' | 'known';

interface Row {
  word: WordEntry;
  card?: CardRecord;
  status: Exclude<Filter, 'all'>;
}

export function WordsScreen() {
  const { t, settings } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Row | null>(null);

  const load = async () => {
    const [words, cards] = await Promise.all([loadWords(), allCards()]);
    const byKey = new Map(cards.map((c) => [c.key, c]));
    const list = [...words.values()].map((word): Row => {
      const card = byKey.get(word.key);
      const status = word.status === 'known' ? 'known' : card && isLearned(card.card) ? 'learned' : 'learning';
      return { word, card, status };
    });
    setRows(list.sort((a, b) => b.word.addedAt - a.word.addedAt));
  };
  useEffect(() => {
    load();
    return onWordsChange(load);
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (filter === 'all' || r.status === filter) &&
        (!q || r.word.key.includes(q) || r.word.form?.toLowerCase().includes(q) ||
          r.word.translation?.some((x) => x.toLowerCase().includes(q))),
    );
  }, [rows, query, filter]);

  const counts = { all: rows.length, learning: 0, learned: 0, known: 0 };
  for (const r of rows) counts[r.status]++;
  const filters: Filter[] = ['all', 'learning', 'learned', 'known'];
  const label = { all: t('f_all'), learning: t('f_learning'), learned: t('f_learned'), known: t('f_known') };

  const next = (card?: CardRecord) => {
    if (!card) return '';
    if (card.card.state === State.New) return t('card_new');
    const ms = card.card.due.getTime() - Date.now();
    return ms <= 0 ? t('due_now') : t('due_in', { when: shortInterval(ms, settings.lang) });
  };

  return (
    <div class="screen">
      <header class="page-head">
        <h1>{t('words')}</h1>
      </header>
      <input
        class="search"
        type="search"
        placeholder={t('search')}
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
      />
      <div class="chips">
        {filters.map((f) => (
          <button key={f} class={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
            {label[f]} {counts[f]}
          </button>
        ))}
      </div>

      {!rows.length && <p class="muted pad">{t('no_words')}</p>}
      <ul class="word-list">
        {shown.map((r) => (
          <li key={r.word.key}>
            <button class="word-row" onClick={() => setOpen(r)}>
              <span class="wr-main">
                <span class="wr-word">{r.word.key}</span>
                <span class="wr-def">{r.word.explanation?.senses[0]?.definition ?? r.word.context?.sentence ?? ''}</span>
              </span>
              <span class="wr-side">
                <span class={`badge ${r.status === 'learning' ? '' : 'good'}`}>{label[r.status]}</span>
                <span class="muted small">{next(r.card)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {open && <WordSheet row={open} onClose={() => setOpen(null)} />}
      <TabBar active="words" />
    </div>
  );
}

function WordSheet({ row, onClose }: { row: Row; onClose: () => void }) {
  const { t } = useApp();
  const { word } = row;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => word.explanation?.senses.map((s) => s.definition).join('\n') ?? '');

  const saveEdit = async () => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const pos = word.explanation?.senses[0]?.pos ?? '';
    await setStatus(
      {
        ...word,
        explanation: {
          word: word.key,
          phonetic: word.explanation?.phonetic,
          example: word.explanation?.example,
          senses: lines.map((definition) => ({ pos, definition })),
          source: 'edited',
        },
      },
      word.status,
    );
    onClose();
  };

  return (
    <Sheet onClose={onClose}>
      {editing ? (
        <div class="edit">
          <label class="row-label" for="def">{t('edit_explanation')}</label>
          <textarea id="def" rows={5} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
          <div class="actions">
            <button class="primary" onClick={saveEdit}>{t('save')}</button>
            <button class="plain" onClick={() => setEditing(false)}>{t('cancel')}</button>
          </div>
        </div>
      ) : (
        <>
          <WordDetails word={word} />
          <div class="actions">
            <button onClick={() => setEditing(true)}>{t('edit_explanation')}</button>
            {word.status === 'learning' ? (
              <button onClick={async () => { await setStatus(word, 'known'); onClose(); }}>{t('mark_known')}</button>
            ) : (
              <button onClick={async () => { await setStatus(word, 'learning'); onClose(); }}>{t('learn_again')}</button>
            )}
            <button
              class="danger"
              onClick={async () => {
                if (!confirm(t('delete_word', { word: word.key }))) return;
                await forget(word.key);
                onClose();
              }}
            >
              {t('delete')}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
