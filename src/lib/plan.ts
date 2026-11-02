/** Uncommon-word share above which a book counts as hard today. */
export const HARD = 0.08;

/** Queue order starting right after the book read last time (round robin). */
export function rotation(order: string[], last?: string): string[] {
  const i = last ? order.indexOf(last) : -1;
  return [...order.slice(i + 1), ...order.slice(0, i + 1)];
}

export interface Candidate {
  id: string;
  difficulty: number;
}

/**
 * Picks today's book from candidates in rotation order. A hard book steps back once:
 * it is skipped today (and remembered in `deferred`), and taken on its next turn.
 * If every book is hard, there is nothing to step back for: plain round robin.
 */
export function pickBook(candidates: Candidate[], deferred: string[]): { pick: Candidate; deferred: string[] } {
  const skipped: string[] = [];
  let pick = candidates.find((c) => {
    if (c.difficulty <= HARD || deferred.includes(c.id)) return true;
    skipped.push(c.id);
    return false;
  });
  if (!pick) return { pick: candidates[0], deferred: deferred.filter((id) => id !== candidates[0].id) };
  return { pick, deferred: [...deferred.filter((id) => id !== pick!.id), ...skipped] };
}
