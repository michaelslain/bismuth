// app/src/chat/chatHistorySnippet.ts — pure, no framework imports.
// A search hit's excerpt arrives centered on the match (core's `chatSnippet`, ±60 chars), but a
// history row shows it on ONE ellipsised line — so at any realistic width the match, sitting in the
// middle, is exactly the part cut off. `snippetFromMatch` re-windows the excerpt so the match starts
// a few characters in, which keeps it visible however narrow the row is.

/** The first whitespace-separated query term that occurs in `snippet` (case-insensitive), as its
 *  index in the snippet, or -1 when none does. */
function matchIndex(snippet: string, query: string): number {
    const lower = snippet.toLowerCase()
    for (const term of query.toLowerCase().split(/\s+/)) {
        if (!term) continue
        const at = lower.indexOf(term)
        if (at >= 0) return at
    }
    return -1
}

/** `snippet` trimmed to start `lead` characters before the match, with a leading `…` when it cut
 *  anything. Unchanged when the query is blank, nothing matches, or the match is already near the
 *  start. */
export function snippetFromMatch(snippet: string, query: string, lead = 12): string {
    const at = matchIndex(snippet, query)
    if (at <= lead) return snippet
    // start on a word boundary when one falls before the match, so the line does not open mid-word
    let from = at - lead
    const space = snippet.indexOf(' ', from)
    if (space >= 0 && space < at) from = space + 1
    return `…${snippet.slice(from).trimStart()}`
}
