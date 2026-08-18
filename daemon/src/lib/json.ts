/**
 * Strip markdown code fences from a string (```json ... ``` or ``` ... ```).
 */
export function stripFences(s: string): string {
    return s
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim()
}

/**
 * Parse a JSON response that may be wrapped in markdown fences.
 * Falls back to extracting with the given regex pattern if direct parse fails.
 * Returns null on total failure.
 */
export function parseJsonResponse<T>(
    response: string,
    fallbackRegex: RegExp,
): T | null {
    const cleaned = stripFences(response)

    try {
        return JSON.parse(cleaned) as T
    } catch {
        const match = cleaned.match(fallbackRegex)
        if (!match) return null
        try {
            return JSON.parse(match[0]) as T
        } catch {
            return null
        }
    }
}

/**
 * Get today's date as YYYY-MM-DD string, in LOCAL time.
 *
 * Local, not UTC: toISOString() would date a note by the UTC calendar day, so a dream/consolidation
 * run any evening west of Greenwich (e.g. 6pm PST) stamps TOMORROW's date on the memory it writes.
 * This matches the identical local-date today() in cli/src/args.ts, mcp/src/memory.ts and
 * relay/lib/memory.ts — the daemon was the lone UTC outlier.
 */
export function today(): string {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
