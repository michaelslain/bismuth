import { todayISO } from '@bismuth/memory'

/**
 * Strip markdown code fences from a string (```json ... ``` or ``` ... ```).
 */
function stripFences(s: string): string {
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
 */
export function today(): string {
    return todayISO()
}
