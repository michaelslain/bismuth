// app/src/snippetLead.ts
// Shorten the text BEFORE a search match so the match lands early in a snippet row.
// SearchResultRows clamps each snippet to two lines; core/src/search.ts sends up to 80 chars of
// lead-in, which at the switcher's width pushes the match onto line two or past the clamp. Keep
// the tail nearest the match, cut on a word boundary, and mark the cut with an ellipsis.

/** Longest lead-in kept before a match, in characters. */
export const SNIPPET_LEAD_MAX = 32

export function snippetLead(before: string, max = SNIPPET_LEAD_MAX): string {
    const trimmed = before.replace(/^\s+/, '')
    if (trimmed.length <= max) return trimmed
    const tail = trimmed.slice(-max)
    const space = tail.indexOf(' ')
    const cut = space >= 0 && space < tail.length - 1 ? tail.slice(space + 1) : tail
    return `…${cut}`
}
