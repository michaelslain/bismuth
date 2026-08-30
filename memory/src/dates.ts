/**
 * Shared local-date helper for the daemon/mcp side (the workspaces that depend on
 * @bismuth/memory but not @bismuth/core). Mirrors core/src/dates.ts's todayISO exactly.
 *
 * Local, not UTC: toISOString() would date a note by the UTC calendar day, so a dream/
 * consolidation run any evening west of Greenwich (e.g. 6pm PST) stamps TOMORROW's date on
 * the memory it writes.
 */
export function todayISO(d: Date = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
