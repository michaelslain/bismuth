import type { Row, Recurrence } from "./types";
import { expandRecurrence } from "./recurrence";

export interface Occurrence {
  index: number; // index of the source row in the base table
  date: string; // "YYYY-MM-DD" occurrence date
}

export interface CalendarFields {
  dateField: string;
  recurrenceField: string;
}

/**
 * Expand base rows into calendar occurrences within [rangeStart, rangeEnd].
 * A row with a parseable recurrence cell (a JSON rule, or an object) yields one
 * occurrence per recurring date; otherwise a row appears once if its date is in range.
 * Each occurrence keeps the source row's table index for write-back.
 */
export function occurrencesInRange(
  rows: Row[],
  fields: CalendarFields,
  rangeStart: string,
  rangeEnd: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  rows.forEach((r, index) => {
    const recRaw = r.note[fields.recurrenceField];
    const rec = parseRecurrence(recRaw);
    if (rec) {
      for (const date of expandRecurrence(rec, rangeStart, rangeEnd)) out.push({ index, date });
      return;
    }
    const date = r.note[fields.dateField];
    if (typeof date === "string" && date >= rangeStart && date <= rangeEnd) out.push({ index, date });
  });
  return out;
}

function parseRecurrence(raw: unknown): Recurrence | null {
  if (!raw) return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (obj && typeof obj === "object" && typeof (obj as Recurrence).type === "string" && (obj as Recurrence).startDate) {
    return obj as Recurrence;
  }
  return null;
}
