import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../i18n';
import { HARD } from '../lib/plan';
import { chapterAt, getPositions, listBooks } from '../store/books';
import { chooseBook, getToday, type Today } from '../store/today';
import { todaySession } from '../store/cards';
import { loadWords } from '../store/words';
import { dayKey } from '../lib/day';
import { backupReminder, saveBackup, snoozeReminder } from '../store/backup';
import type { BookMeta, Position } from '../types';
import { Icon, ProgressBar, Sheet, TabBar, go, minutes } from '../components/ui';

export function TodayScreen() {
  const { t, settings } = useApp();
  const [today, setToday] = useState<Today | null>(null);
  const [cards, setCards] = useState<{ left: number; reviewed: number; added: number } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [backupDays, setBackupDays] = useState<number | null>(null);

  const load = async () => {
    const words = await loadWords();
    const [t, session] = await Promise.all([getToday(), todaySession()]);
    const added = [...words.values()].filter((w) => w.status === 'learning' && dayKey(new Date(w.addedAt)) === t.day).length;
    setCards({ left: session.length, reviewed: t.record.reviews ?? 0, added });
    setToday(t);
    setBackupDays(await backupReminder());
  };
  useEffect(() => {
    load();
  }, []);

  const date = new Intl.DateTimeFormat(settings.lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <div class="screen">
      <header class="page-head">
        <div class="eyebrow">{date}</div>
        <h1>{t('today')}</h1>
        {!!today?.streak && <div class="streak">🔥 {t('streak', { n: today.streak })}</div>}
      </header>

      {backupDays !== null && (
        <section class="card banner">
          <p>{t('backup_reminder', { n: backupDays })}</p>
          <div class="banner-actions">
            <button class="primary small" onClick={async () => (await saveBackup()) === 'saved' && setBackupDays(null)}>
              {t('backup_now')}
            </button>
            <button class="plain-btn" onClick={async () => { await snoozeReminder(); setBackupDays(null); }}>{t('later')}</button>
          </div>
        </section>
      )}
      {cards && <ReviewBlock {...cards} />}
      {today && cards && <TodayBody today={today} added={cards.added} onChoose={() => setChoosing(true)} />}

      {choosing && today && (
        <ChooseBook
          current={today.record.plan?.bookId}
          onClose={() => setChoosing(false)}
          onPick={async (id) => {
            await chooseBook(id);
            setChoosing(false);
            load();
          }}
        />
      )}
      <TabBar active="today" />
    </div>
  );
}

/** Block 1: cards due today. Hidden when there is nothing to review. */
function ReviewBlock({ left, reviewed }: { left: number; reviewed: number }) {
  const { t } = useApp();
  if (!left && !reviewed) return null;
  if (!left) {
    return (
      <section class="card row-card">
        <span class="ok-dot"><Icon name="check" size={18} /></span>
        <span>{t('reviews_done_today', { n: reviewed })}</span>
      </section>
    );
  }
  return (
    <section class="card today-card">
      <div class="eyebrow">{t('review')}</div>
      <div class="meta-line">
        <span>{t('cards_min', { n: left, min: Math.max(1, Math.round(left / 6)) })}</span>
      </div>
      <button class="primary big" onClick={() => go('#/review')}>{t('start_review')}</button>
    </section>
  );
}

function TodayBody({ today, added, onChoose }: { today: Today; added: number; onChoose: () => void }) {
  const { t } = useApp();
  const { record, book, position } = today;

  if (!today.hasBooks) {
    return (
      <section class="card empty">
        <h2>{t('no_books')}</h2>
        <p>{t('no_books_hint')}</p>
        <button class="primary" onClick={() => go('#/library')}>{t('open_library')}</button>
      </section>
    );
  }
  if (!book || !record.plan) {
    return <section class="card empty"><p>{t('all_finished')}</p></section>;
  }

  const plan = record.plan;
  const words = book.cum[plan.end] - book.cum[plan.start];
  const at = Math.max(plan.start, Math.min(plan.end, position?.para ?? plan.start));
  const progress = words ? (book.cum[at] - book.cum[plan.start]) / words : 0;
  const hard = plan.difficulty > HARD;

  if (record.done) {
    return (
      <>
        <section class="card done">
          <div class="done-mark"><Icon name="check" size={28} /></div>
          <h2>{t('done_title')}</h2>
          <div class="summary">
            <div><b>{new Intl.NumberFormat().format(record.words)}</b><span>{t('sum_words')}</span></div>
            <div><b>{added}</b><span>{t('sum_new')}</span></div>
            <div><b>{today.streak}</b><span>{t('sum_streak')}</span></div>
          </div>
        </section>
        <section class="card">
          <div class="book-line">
            <div class="title">{book.meta.title}</div>
            <div class="muted">{t('percent_read', { p: Math.round((position?.percent ?? 0) * 100) })}</div>
          </div>
          <button class="primary" onClick={() => go(`#/read/${book.meta.id}`)}>{t('read_on')}</button>
        </section>
      </>
    );
  }

  return (
    <section class="card today-card">
      <div class="eyebrow">{t('todays_reading')}</div>
      <h2 class="book-title">{book.meta.title}</h2>
      <div class="muted">{book.meta.author}</div>
      <div class="chapter">{chapterAt(book, plan.start)}</div>
      <div class="meta-line">
        <span>{t('words_min', { words, min: minutes(words) })}</span>
        {hard && <span class="badge warn" title={t('uncommon', { p: Math.round(plan.difficulty * 100) })}>{t('hard')}</span>}
      </div>
      {progress > 0 && <ProgressBar value={progress} />}
      <button class="primary big" onClick={() => go('#/read/today')}>
        {progress > 0 ? t('continue') : t('start')}
      </button>
      <button class="secondary" onClick={onChoose}>{t('another_book')}</button>
    </section>
  );
}

function ChooseBook({ current, onPick, onClose }: { current?: string; onPick: (id: string) => void; onClose: () => void }) {
  const { t } = useApp();
  const [books, setBooks] = useState<{ meta: BookMeta; pos?: Position }[]>([]);
  useEffect(() => {
    Promise.all([listBooks(), getPositions()]).then(([metas, pos]) =>
      setBooks(metas.filter((m) => (pos.get(m.id)?.para ?? 0) < m.paraCount).map((meta) => ({ meta, pos: pos.get(meta.id) }))),
    );
  }, []);
  return (
    <Sheet title={t('choose_book')} onClose={onClose}>
      <div class="pick-list">
        {books.map(({ meta, pos }) => (
          <button key={meta.id} class={`pick ${meta.id === current ? 'on' : ''}`} onClick={() => onPick(meta.id)}>
            <span class="title">{meta.title}</span>
            <span class="muted">
              {t('percent_read', { p: Math.round((pos?.percent ?? 0) * 100) })}
              {meta.difficulty !== undefined && ` · ${t('uncommon', { p: Math.round(meta.difficulty * 100) })}`}
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
