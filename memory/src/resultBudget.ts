// memory/src/resultBudget.ts
// Bound what an agent-facing search returns. A broad `recall` (one common word across a 135-note
// graph) returned every matching note whole, ~95k characters, which overflows a tool result and
// sends the agent to read it back from a file. Instead: rank the matches, return the best ones
// whole until the character budget is spent, and list the rest as one-line pointers the agent can
// open by path. `bismuth history` applies the same budget to its sessions.
import { noteDescription, type MemoryNote } from './graph'
import { buildRecallIndex, rankNotes } from './rank'

/** Characters of full results an agent-facing search returns before the rest become pointers. */
export const RESULT_BUDGET_CHARS = 9000

export interface NotePointer {
    name: string
    type: string
    description: string
}

const noteSize = (n: MemoryNote) =>
    n.content.length + n.name.length + JSON.stringify(n.frontmatter).length

/** Best match first: notes the ranker scores for the query's keywords, by score, then the rest
 *  (a filter-only query such as `type:person`) by most recently updated. */
export function orderMatches(notes: MemoryNote[], keywords: string[]): MemoryNote[] {
    const byUpdated = [...notes].sort((a, b) =>
        b.frontmatter.updated.localeCompare(a.frontmatter.updated),
    )
    if (!keywords.length || notes.length < 2) return byUpdated
    const ranked = rankNotes(buildRecallIndex(notes), { primary: keywords.join(' ') }, {
        limit: notes.length,
    })
    const first = ranked.map(r => r.note)
    const seen = new Set(first.map(n => n.name))
    return [...first, ...byUpdated.filter(n => !seen.has(n.name))]
}

/** Split ordered notes into the ones returned whole and pointers to the rest. The first note is
 *  always returned whole, its content cut at the budget when it alone exceeds it. */
export function budgetNotes(
    ordered: MemoryNote[],
    budget = RESULT_BUDGET_CHARS,
): { notes: MemoryNote[]; more: NotePointer[] } {
    const notes: MemoryNote[] = []
    const more: NotePointer[] = []
    let used = 0
    for (const n of ordered) {
        const size = noteSize(n)
        if (!notes.length) {
            notes.push(
                size > budget
                    ? { ...n, content: n.content.slice(0, budget) + '\n\n[… cut at the result budget]' }
                    : n,
            )
            used = Math.min(size, budget)
        } else if (!more.length && used + size <= budget) {
            notes.push(n)
            used += size
        } else {
            more.push({
                name: n.name,
                type: n.frontmatter.type,
                description: noteDescription(n).slice(0, 160),
            })
        }
    }
    return { notes, more }
}
