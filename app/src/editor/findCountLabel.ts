// app/src/editor/findCountLabel.ts
// The find bar's count readout, shared by the note find bar (editor/findPanel.ts) and the code/text
// preview's (preview/CodeFindBar.tsx via PreviewView.tsx). Pure, no framework imports.

/** The count readout's words, whether they read in the danger tone, and a muted hint after them.
 *  `ai` is the passages shown (`total` 0 when none); `asked` once the query went to the ai. Pure. */
export function findCountLabel(
    ai: { total: number; current: number } | null,
    literal: { query: string; total: number; current: number },
    canAsk: boolean,
    asked = false,
): { text: string; danger: boolean; hint?: string } {
    if (ai && ai.total > 0) return { text: `ai ${ai.current}/${ai.total}`, danger: false }
    if (!literal.query) return { text: '', danger: false }
    if (literal.total === 0) {
        if (!canAsk) return { text: 'No results', danger: true }
        // asked already: the answer row below the bar is the readout, so no hint
        return asked ? { text: 'no results', danger: true } : { text: 'no results', danger: true, hint: '↵ ask' }
    }
    return { text: `${literal.current || '–'}/${literal.total}`, danger: false }
}
