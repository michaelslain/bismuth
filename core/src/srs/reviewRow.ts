import { schedule } from "./scheduler";
import type { ReviewResponse } from "./types";

/**
 * Apply a flashcard review to a base row's scheduling columns (SM-2).
 * A row with `due == null` is treated as a new card. Returns a new note object
 * with `due` / `interval` / `ease` advanced; all other fields are preserved.
 */
export function applyReviewToRow(
  note: Record<string, unknown>,
  response: ReviewResponse,
  today: string,
): Record<string, unknown> {
  const prev =
    note.due == null || note.due === ""
      ? null
      : {
          due: note.due as string,
          interval: (note.interval as number) ?? 0,
          ease: (note.ease as number) ?? 250,
        };
  const next = schedule(prev, response, today);
  return { ...note, due: next.due, interval: next.interval, ease: next.ease };
}
