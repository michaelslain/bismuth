// app/src/bases/flashcardsQueue.ts
// Pure review-queue logic for the flashcards view, split out from the component so
// it can be unit-tested headlessly without importing FlashcardsView (which pulls in
// lucide-solid icons and other Solid client-only code).
import type { Row } from "../../../core/src/bases/types";

/** A card's review direction. "rev" only appears for bidirectional decks. */
export type CardDir = "fwd" | "rev";

// A queue entry: the row, its stable row `index`, the direction being reviewed, and
// the due column that governs THIS direction's schedule. A bidirectional row yields
// two entries (fwd + rev) sharing one `index` but with distinct `dir` / `dueField`.
export type QueueItem = { r: Row; index: number; dir: CardDir; dueField: string };

/** Companion column for a forward field's reverse schedule: "due" -> "dueBack". */
export function backField(field: string): string {
  return field + "Back";
}

/**
 * Build the review queue from the base's rows.
 * - cram mode: ALL cards, order preserved (scheduling never changes).
 * - normal mode: only cards due today or earlier (null / empty / <= today).
 *
 * Each item keeps the card's stable row `index` so callers can track a card by
 * identity rather than its (mutable) position within the queue. When `bidirectional`
 * is set, every row contributes a forward (front→back) entry AND a reverse
 * (back→front) entry, each filtered by its OWN due column so the two directions
 * surface and schedule independently.
 */
export function buildQueue(
  rows: Row[],
  dueField: string,
  today: string,
  cram: boolean,
  bidirectional = false,
): QueueItem[] {
  const backDue = backField(dueField);
  const all: QueueItem[] = [];
  rows.forEach((r, index) => {
    all.push({ r, index, dir: "fwd", dueField });
    if (bidirectional) all.push({ r, index, dir: "rev", dueField: backDue });
  });
  if (cram) return all;
  return all.filter((it) => {
    const d = it.r.note[it.dueField];
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
