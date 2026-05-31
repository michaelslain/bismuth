// app/src/bases/flashcardsQueue.ts
// Pure review-queue logic for the flashcards view, split out from the component so
// it can be unit-tested headlessly without importing FlashcardsView (which pulls in
// lucide-solid icons and other Solid client-only code).
import type { Row } from "../../../core/src/bases/types";

export type QueueItem = { r: Row; index: number };

/**
 * Build the review queue from the base's rows.
 * - cram mode: ALL cards, order preserved (scheduling never changes).
 * - normal mode: only cards due today or earlier (null / empty / <= today).
 * Each item keeps the card's stable row `index` so callers can track a card by
 * identity rather than its (mutable) position within the queue.
 */
export function buildQueue(
  rows: Row[],
  dueField: string,
  today: string,
  cram: boolean,
): QueueItem[] {
  const all = rows.map((r, index) => ({ r, index }));
  if (cram) return all;
  return all.filter(({ r }) => {
    const d = r.note[dueField];
    return d == null || d === "" || String(d) <= today;
  });
}

/**
 * Decide the next queue position after grading the card at `pos`.
 *
 * In cram mode the queue never changes membership, so step strictly
 * front-to-back (pos + 1). In a persisted non-cram review, scheduling pushes the
 * graded card's due date forward so it drops out of the due-only queue on the
 * next refetch; the shorter queue then shifts the *next* card into the current
 * position, so we stay put (mirrors deleteCurrent). With no persistence the card
 * stays due, so we advance by position to avoid re-showing it forever.
 */
export function nextPosAfterGrade(pos: number, opts: { cram: boolean; persisted: boolean }): number {
  if (opts.cram) return pos + 1;
  return opts.persisted ? pos : pos + 1;
}
