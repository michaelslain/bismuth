// Recurrence model + expansion, shared by the calendar view and migration.
// Ported from the former app/src/calendar/dates.ts (UI-only formatters stay in the app).

export type RecurrenceType = "daily" | "weekly" | "biweekly" | "monthly";

export interface Recurrence {
  type: RecurrenceType;
  daysOfWeek?: number[]; // 0–6, Sunday=0
  startDate: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  seriesId: string;
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

/** Add days to a "YYYY-MM-DD" string, returning a "YYYY-MM-DD" string. */
export function addDaysStr(dateStr: string, n: number): string {
  return toDateStr(addDays(new Date(dateStr + "T00:00:00"), n));
}

export function matchesRecurrence(r: Recurrence, dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00");
  const start = new Date(r.startDate + "T00:00:00");
  const dow = d.getDay();
  if (r.type === "daily") return true;
  if (r.type === "weekly") return r.daysOfWeek?.includes(dow) ?? dow === start.getDay();
  if (r.type === "biweekly") {
    const diffDays = Math.round((d.getTime() - start.getTime()) / 86400000);
    const matchesDow = r.daysOfWeek?.includes(dow) ?? dow === start.getDay();
    return matchesDow && Math.floor(diffDays / 7) % 2 === 0;
  }
  if (r.type === "monthly") return d.getDate() === start.getDate();
  return false;
}

/** Expand a recurrence rule into the matching date strings within [rangeStart, rangeEnd]. */
export function expandRecurrence(recurrence: Recurrence, rangeStart: string, rangeEnd: string): string[] {
  const dates: string[] = [];
  const start = new Date(recurrence.startDate + "T00:00:00");
  const end = recurrence.endDate ? new Date(recurrence.endDate + "T00:00:00") : new Date("2100-01-01");
  const rStart = new Date(rangeStart + "T00:00:00");
  const rEnd = new Date(rangeEnd + "T00:00:00");
  let cursor = new Date(start);
  while (cursor <= end && cursor <= rEnd) {
    if (cursor >= rStart && matchesRecurrence(recurrence, toDateStr(cursor))) dates.push(toDateStr(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/**
 * Split a recurrence at `splitDate`: the original truncated to the day before,
 * plus a fresh series starting at the split date (or null when split is past endDate).
 */
export function splitRecurrence(rec: Recurrence, splitDate: string): [Recurrence, Recurrence | null] {
  const before: Recurrence = { ...rec, endDate: addDaysStr(splitDate, -1) };
  const after: Recurrence | null =
    rec.endDate && rec.endDate < splitDate
      ? null
      : { ...rec, startDate: splitDate, seriesId: `${rec.seriesId}:${splitDate}` };
  return [before, after];
}
