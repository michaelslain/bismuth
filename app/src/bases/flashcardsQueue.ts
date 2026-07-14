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
 * The session's fixed progress denominator — the number the header shows the
 * graded count OUT OF. Captured ONCE at session start (see FlashcardsView) and
 * then frozen, so nothing that happens DURING review can move it. This is the fix
 * for the reported "total card count changes between cram mode and normal studying,
 * and sometimes the card count goes up randomly".
 *
 * Semantics (deterministic for a given deck + mode):
 * - cram: EVERY card in the deck. The cram queue never changes membership (cram
 *   writes no scheduling and triggers no refetch), so the total is just `queueLen`
 *   and is independent of how many have been graded.
 * - normal: only the cards DUE when the session began. A persisted review's
 *   due-only queue SHRINKS as graded cards schedule out (their due date is pushed
 *   past today), so the original due count is reconstructed as
 *   `already-graded + still-queued`. Anchoring on that also yields the correct
 *   starting total when RESUMING mid-session (restored tally + remaining queue).
 *
 * The previous code computed `graded + queueLen` LIVE on every render for ALL
 * modes. In cram (and any non-persisted review) the queue length is constant while
 * `graded` climbs, so the displayed total grew by one per grade; in persisted
 * normal mode it flickered up by one during each post-grade refetch. Freezing the
 * anchored value removes both the growth and the flicker while keeping the intended
 * cram-vs-normal difference (all cards vs due cards).
 */
export function progressTotal(queueLen: number, graded: number, cram: boolean): number {
  return cram ? queueLen : graded + queueLen;
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

/**
 * Whether a grade action may fire right now — the single-advance lock.
 *
 * A grade is valid only when the answer is REVEALED and no prior grade is still
 * settling (`grading` = its async row-write / refetch in flight). The view used
 * to guard on `revealed` alone, cleared synchronously at the start of grade();
 * but grade() then `await`s the row write, and during that gap the user could
 * re-reveal the SAME card and press again — grading it twice (the reported
 * "sometimes pressing a flashcard skips it twice"). Gating on the in-flight
 * `grading` flag as well guarantees exactly one advance per grade.
 */
export function canGrade(state: { revealed: boolean; grading: boolean }): boolean {
  return state.revealed && !state.grading;
}

/**
 * Ephemeral per-deck review-session state, preserved across a tab
 * unmount→remount (switching AWAY from the flashcards tab and back) so returning
 * resumes where the user left off instead of resetting to card 1 with a zeroed
 * tally. `pos` is the cram-mode queue offset (a persisted review stays at 0 as
 * cards drop out); the three counts are the per-grade tally. Lives only for the
 * app session (module scope) — never written to disk.
 */
export interface SessionState {
  cram: boolean;
  pos: number;
  good: number;
  hard: number;
  easy: number;
}

/** A fresh, zeroed session (first open of a deck, or one with no saved state). */
export function emptySession(): SessionState {
  return { cram: false, pos: 0, good: 0, hard: 0, easy: 0 };
}

// Session store, keyed by the deck's base path. Module scope so it survives a
// FlashcardsView unmount (tab switch) but not a full app reload — matching the
// noteCache / RowCache pattern of in-memory, SSE-lived caches.
const sessions = new Map<string, SessionState>();

/** Read the saved session for `key` (a deck's base path), or a fresh zeroed one.
 *  Returns a COPY so the caller's signal writes don't mutate the stored record. */
export function loadSession(key: string | undefined): SessionState {
  const saved = key ? sessions.get(key) : undefined;
  return saved ? { ...saved } : emptySession();
}

/** Persist the session for `key`. A missing key is a no-op — an unsaved deck
 *  (e.g. an embedded query with no base path) has nothing to resume. */
export function saveSession(key: string | undefined, state: SessionState): void {
  if (!key) return;
  sessions.set(key, { ...state });
}

/** Drop a deck's saved session. Exposed for tests / explicit resets. */
export function clearSession(key: string | undefined): void {
  if (key) sessions.delete(key);
}
