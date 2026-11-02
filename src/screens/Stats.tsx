import { useEffect, useState } from 'preact/hooks';
import { db } from '../db';
import { useApp } from '../i18n';
import { dayKey, lastDays, streak } from '../lib/day';
import { isLearned } from '../lib/review';
import { allCards } from '../store/cards';
import { loadWords } from '../store/words';
import { TabBar } from '../components/ui';

interface Stats {
  streak: number;
  wordsRead: number;
  reviews: number;
  learning: number;
  learned: number;
  known: number;
  days: { day: string; words: number }[];
}

async function loadStats(): Promise<Stats> {
  const [days, words, cards] = await Promise.all([(await db()).getAll('days'), loadWords(), allCards()]);
  const byDay = new Map(days.map((d) => [d.day, d]));
  const learnedKeys = new Set(cards.filter((c) => isLearned(c.card)).map((c) => c.key));
  let learning = 0;
  let learned = 0;
  let known = 0;
  for (const w of words.values()) {
    if (w.status === 'known') known++;
    else if (learnedKeys.has(w.key)) learned++;
    else learning++;
  }
  return {
    streak: streak(new Set(days.filter((d) => d.done).map((d) => d.day)), dayKey()),
    wordsRead: days.reduce((n, d) => n + d.words, 0),
    reviews: days.reduce((n, d) => n + (d.reviews ?? 0), 0),
    learning,
    learned,
    known,
    days: lastDays(30).map((day) => ({ day, words: byDay.get(day)?.words ?? 0 })),
  };
}

export function StatsScreen() {
  const { t } = useApp();
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    loadStats().then(setS);
  }, []);

  return (
    <div class="screen">
      <header class="page-head">
        <h1>{t('stats')}</h1>
      </header>
      {s && (
        <>
          <section class="tiles">
            <Tile value={s.streak} label={t('st_streak')} />
            <Tile value={s.wordsRead} label={t('st_read')} />
            <Tile value={s.learning} label={t('st_learning')} />
            <Tile value={s.learned} label={t('st_learned')} />
            <Tile value={s.known} label={t('st_known')} />
            <Tile value={s.reviews} label={t('st_reviews')} />
          </section>
          <section class="card">
            <h2 class="chart-title">{t('st_chart')}</h2>
            <DayBars days={s.days} />
          </section>
        </>
      )}
      <TabBar active="stats" />
    </div>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div class="tile">
      <b>{new Intl.NumberFormat().format(value)}</b>
      <span>{label}</span>
    </div>
  );
}

/** Words read per day, last 30 days. One series, so no legend; tap a bar for its value. */
function DayBars({ days }: { days: { day: string; words: number }[] }) {
  const { t, settings } = useApp();
  const [active, setActive] = useState<number | null>(null);
  const W = 320;
  const H = 120;
  const top = 18;
  const max = Math.max(...days.map((d) => d.words), 1);
  const nice = niceMax(max);
  const slot = W / days.length;
  const bar = Math.max(3, slot - 2);
  const fmtDay = (key: string) =>
    new Intl.DateTimeFormat(settings.lang, { day: 'numeric', month: 'short' }).format(new Date(`${key}T12:00`));
  const shown = active ?? days.length - 1;

  return (
    <figure class="bars">
      <div class="bars-readout" aria-live="polite">
        <b>{new Intl.NumberFormat().format(days[shown].words)}</b> {t('words_on', { day: fmtDay(days[shown].day) })}
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={t('st_chart')}>
        <line x1="0" x2={W} y1={top} y2={top} class="grid" />
        <text x={W} y={top - 5} class="axis" text-anchor="end">{new Intl.NumberFormat().format(nice)}</text>
        <line x1="0" x2={W} y1={H} y2={H} class="baseline" />
        {days.map((d, i) => {
          const h = d.words ? Math.max(2, ((H - top) * d.words) / nice) : 0;
          const x = i * slot + (slot - bar) / 2;
          const r = Math.min(4, bar / 2, h);
          // Rounded top, square foot on the baseline.
          const path = h
            ? `M${x},${H}V${H - h + r}Q${x},${H - h} ${x + r},${H - h}H${x + bar - r}Q${x + bar},${H - h} ${x + bar},${H - h + r}V${H}Z`
            : '';
          return (
            <g key={d.day} onClick={() => setActive(i)} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              {path && <path d={path} class={i === shown ? 'bar on' : 'bar'} />}
            </g>
          );
        })}
        <text x="0" y={H + 14} class="axis">{fmtDay(days[0].day)}</text>
        <text x={W} y={H + 14} class="axis" text-anchor="end">{fmtDay(days[days.length - 1].day)}</text>
      </svg>
      <table class="sr-only">
        <tbody>
          {days.map((d) => (
            <tr key={d.day}><th>{d.day}</th><td>{d.words}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
