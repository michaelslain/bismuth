import { schedule } from "./scheduler";
import type { ReviewResponse, SrsConfig } from "./types";

/**
 * Apply a flashcard review to a base row's scheduling columns (SM-2).
 * A row with `due == null` is treated as a new card. `cfg` is the deck's SRS settings.
 * Returns a new note object with `due` / `interval` / `ease` advanced; other fields preserved.
 */
export function applyReviewToRow(
  note: Record<string, unknown>,
  response: ReviewResponse,
  today: string,
  cfg?: SrsConfig,
): Record<string, unknown> {
  const prev =
    note.due == null || note.due === ""
      ? null
      : {
          due: note.due as string,
          interval: (note.interval as number) ?? 0,
          ease: (note.ease as number) ?? cfg?.baseEase ?? 250,
        };
  const next = schedule(prev, response, today, cfg);
  return { ...note, due: next.due, interval: next.interval, ease: next.ease };
}
