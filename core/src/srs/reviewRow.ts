import { schedule, DEFAULT_SRS, type SrsConfig } from "./scheduler";
import type { ReviewResponse } from "./types";
import { toNumber } from "../bases/values";

/** Which note columns carry this review's SM-2 scheduling state. Defaults to the
 *  forward triple; a bidirectional reverse review passes the `*Back` companions. */
export interface ScheduleFields {
  due: string;
  ease: string;
  interval: string;
}

const FORWARD_FIELDS: ScheduleFields = { due: "due", ease: "ease", interval: "interval" };

/**
 * Apply a flashcard review to a base row's scheduling columns (SM-2).
 * A row whose due column is empty/missing is treated as a new card. Returns a new
 * note object with the due / interval / ease columns advanced; all other fields are
 * preserved. `fields` selects which columns to read/write — pass the `*Back` triple
 * to schedule the reverse direction of a bidirectional card independently.
 */
export function applyReviewToRow(
  note: Record<string, unknown>,
  response: ReviewResponse,
  today: string,
  cfg: SrsConfig = DEFAULT_SRS,
  fields: ScheduleFields = FORWARD_FIELDS,
): Record<string, unknown> {
  const dueVal = note[fields.due];
  let prev = null;
  if (!(dueVal == null || dueVal === "")) {
    const intervalN = toNumber(note[fields.interval]);
    const easeN = toNumber(note[fields.ease]);
    prev = {
      due: dueVal as string,
      interval: Number.isFinite(intervalN) ? intervalN : 0,
      ease: Number.isFinite(easeN) ? easeN : 250,
    };
  }
  const next = schedule(prev, response, today, cfg);
  return { ...note, [fields.due]: next.due, [fields.interval]: next.interval, [fields.ease]: next.ease };
}
