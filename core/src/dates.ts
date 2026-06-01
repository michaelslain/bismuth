/** Date utilities for ISO 8601 string manipulation (YYYY-MM-DD format). */

/**
 * Format a Date as YYYY-MM-DD using its LOCAL y/m/d components.
 * Kept consistent with the calendar/recurrence date math, which builds
 * dates with `new Date(str + "T00:00:00")` (local) and reads local getters.
 */
export function todayISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Add days to an ISO date string, returning a new ISO date string.
 * Anchors at LOCAL midnight so it stays consistent with todayISO().
 * @param iso - Date string in YYYY-MM-DD format
 * @param n - Number of days to add (can be negative)
 * @returns ISO date string in YYYY-MM-DD format
 */
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return todayISO(d);
}

export type Bin = "day" | "week" | "month";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Snap an ISO date to the start of its day / ISO-week (Monday) / month. */
export function binKey(iso: string, bin: Bin): string {
  const day = iso.slice(0, 10);
  if (bin === "day") return day;
  if (bin === "month") return day.slice(0, 7) + "-01";
  // week: snap back to Monday
  const d = new Date(day + "T00:00:00");
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  return addDaysISO(day, -dow);
}

/** Human label for a bin key. */
export function binLabel(key: string, bin: Bin): string {
  const day = key.slice(0, 10);
  const d = new Date(day + "T00:00:00");
  if (bin === "month") return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  // day and week both label by date — week keys are always the Monday produced by binKey.
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
