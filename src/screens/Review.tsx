import { useEffect, useState } from 'preact/hooks';
import type { Grade } from 'ts-fsrs';
import { useApp } from '../i18n';
import { dayEnd } from '../lib/day';
import { cloze, shortInterval, type CardRecord } from '../lib/review';
import { preview, rate, todaySession } from '../store/cards';
import { fillMissingExplanations, getWord, loadWords } from '../store/words';
import { Icon, go } from '../components/ui';
import { WordDetails } from '../components/WordDetails';

const GRADES: { grade: Grade; key: 'again' | 'hard_grade' | 'good' | 'easy' }[] = [
  { grade: 1, key: 'again' },
  { grade: 2, key: 'hard_grade' },
  { grade: 3, key: 'good' },
  { grade: 4, key: 'easy' },
];

export function ReviewScreen() {
  const { t, settings } = useApp();
  const [queue, setQueue] = useState<CardRecord[] | null>(null);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      await loadWords();
      fillMissingExplanations().catch(() => {});
      setQueue((await todaySession()).filter((c) => getWord(c.key)));
    })();
  }, []);

  const current = queue?.[0];
  const word = current && getWord(current.key);

  const answer = async (grade: Grade) => {
    if (!current || busy) return;
    setBusy(true);
    const next = await rate(current, grade);
    // Cards that come back within today (Again, learning steps) go to the end of the session.
    setQueue((q) => {
      const rest = q!.slice(1);
      return next.card.due.getTime() <= dayEnd() ? [...rest, next] : rest;
    });
    setDone((n) => n + 1);
    setShown(false);
    setBusy(false);
    scrollTo(0, 0);
  };

  // On the Mac: space shows the answer, 1–4 rate it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' && !shown) {
        e.preventDefault();
        setShown(true);
      } else if (shown && ['1', '2', '3', '4'].includes(e.key)) answer(Number(e.key) as Grade);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  if (!queue) return null;

  const header = (
    <header class="review-head">
      <button class="icon-btn" aria-label={t('back')} onClick={() => go('#/')}>
        <Icon name="back" />
      </button>
      <div class="review-count">{current ? t('cards_left', { n: queue.length }) : ''}</div>
      <span style={{ width: 44 }} />
    </header>
  );

  if (!current || !word) {
    return (
      <div class="review">
        {header}
        <section class="card done review-done">
          <div class="done-mark"><Icon name="check" size={28} /></div>
          <h2>{done ? t('review_done') : t('no_reviews')}</h2>
          {!!done && <p>{t('reviewed_n', { n: done })}</p>}
          <button class="primary big" onClick={() => go('#/')}>{t('today')}</button>
        </section>
      </div>
    );
  }

  const sentence = word.context?.sentence ?? '';
  const front = cloze(sentence, word.form, word.key);
  const due = shown ? preview(current) : null;
  const now = Date.now();

  return (
    <div class="review">
      {header}
      <div class="review-progress"><div style={{ width: `${(done / (done + queue.length)) * 100}%` }} /></div>

      <section class="flash" onClick={() => !shown && setShown(true)}>
        {front ? (
          <p class="cloze">
            {front.before}
            <span class={`blank ${shown ? 'filled' : ''}`}>{shown ? front.answer : front.blank}</span>
            {front.after}
          </p>
        ) : (
          <p class="cloze">{word.explanation?.senses[0]?.definition ?? word.key}</p>
        )}
        {word.context && <div class="muted small flash-src">{word.context.bookTitle}</div>}
        {shown && <WordDetails key={word.key} word={word} showSentence={!front} />}
      </section>

      <div class="answer-bar">
        {!shown ? (
          <button class="primary big wide" onClick={() => setShown(true)}>{t('show_answer')}</button>
        ) : (
          <div class="grades">
            {GRADES.map(({ grade, key }) => (
              <button key={grade} class={`grade grade-${key}`} disabled={busy} onClick={() => answer(grade)}>
                <span class="g-label">{t(key)}</span>
                <span class="g-when">{shortInterval(due![grade].getTime() - now, settings.lang)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
