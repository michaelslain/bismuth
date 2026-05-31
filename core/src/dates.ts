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
