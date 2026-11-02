import { createEmptyCard, fsrs, generatorParameters, State, type Grade } from 'ts-fsrs';
import { db } from '../db';
import { dayEnd, dayKey } from '../lib/day';
import { buildSession, type CardRecord } from '../lib/review';
import type { DayRecord } from '../types';

/** FSRS with default parameters; fuzz spreads reviews so cards learned together don't clump. */
const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export async function allCards(): Promise<CardRecord[]> {
  return (await db()).getAll('cards');
}

export async function getCard(key: string): Promise<CardRecord | undefined> {
  return (await db()).get('cards', key);
}

/** A word marked "learn" gets a new card (kept if it already has one). */
export async function addCard(key: string): Promise<void> {
  const d = await db();
  if (await d.get('cards', key)) return;
  await d.put('cards', { key, card: createEmptyCard(new Date()), createdAt: Date.now() });
}

export async function removeCard(key: string): Promise<void> {
  await (await db()).delete('cards', key);
}

/** Keeps cards in step with words: one card per word being learned, none for the rest. */
export async function syncCards(learning: Set<string>): Promise<void> {
  const d = await db();
  const keys = new Set(await d.getAllKeys('cards'));
  for (const key of learning) if (!keys.has(key)) await addCard(key);
  for (const key of keys) if (!learning.has(key)) await removeCard(key);
}

async function today(): Promise<DayRecord> {
  const day = dayKey();
  return (await (await db()).get('days', day)) ?? { day, done: false, words: 0 };
}

export async function todaySession(): Promise<CardRecord[]> {
  return buildSession(await allCards(), (await today()).newSeen ?? 0, dayEnd());
}

/** When each rating would bring the card back. */
export function preview(rec: CardRecord, now = new Date()): Record<Grade, Date> {
  const r = scheduler.repeat(rec.card, now);
  return { 1: r[1].card.due, 2: r[2].card.due, 3: r[3].card.due, 4: r[4].card.due };
}

export async function rate(rec: CardRecord, grade: Grade, now = new Date()): Promise<CardRecord> {
  const wasNew = rec.card.state === State.New;
  const next: CardRecord = { ...rec, card: scheduler.next(rec.card, now, grade).card };
  const d = await db();
  const tx = d.transaction(['cards', 'days'], 'readwrite');
  await tx.objectStore('cards').put(next);
  const day = dayKey(now);
  const rec2 = (await tx.objectStore('days').get(day)) ?? { day, done: false, words: 0 };
  rec2.reviews = (rec2.reviews ?? 0) + 1;
  if (wasNew) rec2.newSeen = (rec2.newSeen ?? 0) + 1;
  await tx.objectStore('days').put(rec2);
  await tx.done;
  return next;
}
