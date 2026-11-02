/** A new day starts at 3 a.m., so reading after midnight still counts for "today". */
const CUTOFF_HOURS = 3;

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(date = new Date()): string {
  const d = new Date(date.getTime() - CUTOFF_HOURS * 3600_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** When the current day ends: the next 3 a.m. Cards due before then are due "today". */
export function dayEnd(date = new Date()): number {
  const [y, m, d] = dayKey(date).split('-').map(Number);
  return new Date(y, m - 1, d + 1, CUTOFF_HOURS).getTime();
}

/** The last `n` day keys, oldest first, ending today. */
export function lastDays(n: number, today = dayKey()): string[] {
  const out = [today];
  while (out.length < n) out.unshift(prevDay(out[0]));
  return out;
}

export function prevDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d - 1, 12);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Days in a row with finished reading, ending today (or yesterday, if today isn't done yet). */
export function streak(doneDays: Set<string>, today: string): number {
  let day = doneDays.has(today) ? today : prevDay(today);
  let n = 0;
  while (doneDays.has(day)) {
    n++;
    day = prevDay(day);
  }
  return n;
}
