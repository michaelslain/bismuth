/** Date utilities for ISO 8601 string manipulation (YYYY-MM-DD format). */

/**
 * Format a Date as YYYY-MM-DD (UTC date portion).
 * @param d - Date to format (defaults to current date)
 * @returns ISO date string
 */
export function todayISO(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Add days to an ISO date string, returning a new ISO date string (UTC-safe).
 * @param iso - Date string in YYYY-MM-DD format
 * @param n - Number of days to add (can be negative)
 * @returns ISO date string in YYYY-MM-DD format
 */
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
