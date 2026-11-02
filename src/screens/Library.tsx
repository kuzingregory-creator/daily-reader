import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../i18n';
import { HARD } from '../lib/plan';
import { deleteBook, getPositions, importBook, listBooks, loadBook, parseBookFile, savePosition } from '../store/books';
import { getQueue, getToday, setPinned } from '../store/today';
import type { BookMeta, Position } from '../types';
import { Icon, ProgressBar, Sheet, TabBar, go } from '../components/ui';

interface Row {
  meta: BookMeta;
  pos?: Position;
}

export function LibraryScreen() {
  const { t } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [pinned, setPinnedId] = useState<string>();
  const [todayId, setTodayId] = useState<string>();
  const [menu, setMenu] = useState<Row | null>(null);
  const [message, setMessage] = useState<string>('');
  const input = useRef<HTMLInputElement>(null);

  const load = async () => {
    // Planning today measures difficulty, so do it before reading the list.
    const today = await getToday();
    const [metas, pos, queue] = await Promise.all([listBooks(), getPositions(), getQueue()]);
    setRows(metas.map((meta) => ({ meta, pos: pos.get(meta.id) })));
    setPinnedId(queue.pinned);
    setTodayId(today.record.plan?.bookId);
  };
  useEffect(() => {
    load();
  }, []);

  async function importAll(items: { name: string; read: () => Promise<string> }[]) {
    const added: string[] = [];
    const errors: string[] = [];
    for (const item of items) {
      try {
        const { meta } = await importBook(parseBookFile(JSON.parse(await item.read())));
        added.push(meta.title);
      } catch (e) {
        errors.push(t('import_error', { name: item.name, error: e instanceof Error ? e.message : String(e) }));
      }
    }
    setMessage([added.length ? t('imported', { list: added.join(', ') }) : '', ...errors].filter(Boolean).join('\n'));
    load();
  }

  const onFiles = (e: Event) => {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    (e.target as HTMLInputElement).value = '';
    importAll(files.map((f) => ({ name: f.name, read: () => f.text() })));
  };

  const loadFromMac = async () => {
    const names: string[] = await (await fetch('/__dev/books')).json();
    importAll(names.map((n) => ({ name: n, read: () => fetch(`/books/${encodeURIComponent(n)}`).then((r) => r.text()) })));
  };

  return (
    <div class="screen">
      <header class="page-head row-head">
        <h1>{t('library')}</h1>
        <button class="primary small" onClick={() => input.current?.click()}>{t('import')}</button>
        <input ref={input} type="file" accept=".json,application/json" multiple hidden onChange={onFiles} />
      </header>

      {import.meta.env.DEV && (
        <button class="secondary dev" onClick={loadFromMac}>{t('import_dev')} (dev)</button>
      )}
      {message && <div class="toast" onClick={() => setMessage('')}>{message}</div>}

      {!rows.length && <p class="muted pad">{t('no_books_hint')}</p>}

      <ul class="books">
        {rows.map((row) => {
          const { meta, pos } = row;
          const percent = pos?.percent ?? 0;
          const finished = (pos?.para ?? 0) >= meta.paraCount;
          return (
            <li key={meta.id} class="book-row">
              <a class="book-main" href={`#/read/${meta.id}`}>
                <div class="title">{meta.title}</div>
                <div class="muted">{meta.author}</div>
                <ProgressBar value={percent} />
                <div class="meta-line small">
                  <span>{finished ? t('finished') : t('percent_read', { p: Math.round(percent * 100) })}</span>
                  <span>· {t('words_total', { n: meta.wordCount })}</span>
                  {meta.id === todayId && <span class="badge">{t('today')}</span>}
                  {meta.id === pinned && <span class="badge">{t('only_this')}</span>}
                  {(meta.difficulty ?? 0) > HARD && (
                    <span class="badge warn">{t('hard')} · {Math.round((meta.difficulty ?? 0) * 100)}%</span>
                  )}
                </div>
              </a>
              <button class="icon-btn" aria-label="More" onClick={() => setMenu(row)}>
                <Icon name="more" />
              </button>
            </li>
          );
        })}
      </ul>

      {menu && (
        <Sheet title={menu.meta.title} onClose={() => setMenu(null)}>
          <div class="actions">
            <button onClick={() => go(`#/read/${menu.meta.id}`)}>{t('read')}</button>
            <button
              onClick={async () => {
                await setPinned(pinned === menu.meta.id ? undefined : menu.meta.id);
                setMenu(null);
                load();
              }}
            >
              {pinned === menu.meta.id ? t('unpin') : t('pin')}
            </button>
            <button
              onClick={async () => {
                const book = await loadBook(menu.meta.id);
                if (book) await savePosition(book, 0, true);
                setMenu(null);
                load();
              }}
            >
              {t('from_start')}
            </button>
            <button
              class="danger"
              onClick={async () => {
                if (!confirm(t('delete_confirm', { title: menu.meta.title }))) return;
                await deleteBook(menu.meta.id);
                if (pinned === menu.meta.id) await setPinned(undefined);
                setMenu(null);
                load();
              }}
            >
              {t('delete')}
            </button>
            <button class="plain" onClick={() => setMenu(null)}>{t('cancel')}</button>
          </div>
        </Sheet>
      )}
      <TabBar active="library" />
    </div>
  );
}
