// Recurrence model + expansion, shared by the calendar view and migration.
// Ported from the former app/src/calendar/dates.ts (UI-only formatters stay in the app).

import { addDaysISO } from "../dates";

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

/** Number of days in the calendar month containing `d` (local). */
function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function matchesRecurrence(r: Recurrence, dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00");
  const start = new Date(r.startDate + "T00:00:00");
  const dow = d.getDay();
  if (r.type === "daily") return true;
  if (r.type === "weekly") return r.daysOfWeek?.includes(dow) ?? dow === start.getDay();
  if (r.type === "biweekly") {
    const diffDays = Math.round((d.getTime() - start.getTime()) / 86400000);
    // Dates before the series start never match (a negative diff would otherwise
    // pass the parity check, e.g. -0 % 2 === 0).
    if (diffDays < 0) return false;
    const matchesDow = r.daysOfWeek?.includes(dow) ?? dow === start.getDay();
    return matchesDow && Math.floor(diffDays / 7) % 2 === 0;
  }
  if (r.type === "monthly") {
    // Clamp the start day-of-month to the last day of the target month, so a
    // series on the 29th/30th/31st falls back to the month's last day instead
    // of silently skipping shorter months (e.g. 31st → Feb 28/29).
    const targetDay = Math.min(start.getDate(), daysInMonth(d));
    return d.getDate() === targetDay;
  }
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
  const before: Recurrence = { ...rec, endDate: addDaysISO(splitDate, -1) };
  const after: Recurrence | null =
    rec.endDate && rec.endDate < splitDate
      ? null
      : { ...rec, startDate: splitDate, seriesId: `${rec.seriesId}:${splitDate}` };
  return [before, after];
}
