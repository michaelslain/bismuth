// Display-only hiding of a note's YAML frontmatter, for buffers whose frontmatter belongs to a
// machine (a daemon page). The text stays in the document and is saved untouched; the range is
// replaced by nothing and made atomic so the cursor steps over it.
import { EditorState, Transaction, RangeSetBuilder, StateField, Prec, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { extractFrontmatterBoundary, frontmatterBodyRange } from './frontmatterUtils'

export function hiddenFrontmatterRange(doc: string): { from: number; to: number } | null {
    if (!extractFrontmatterBoundary(doc)) return null
    const body = frontmatterBodyRange(doc)
    return body.from > 0 ? { from: 0, to: body.from } : null
}

function build(state: EditorState): DecorationSet {
    const r = hiddenFrontmatterRange(state.doc.toString())
    const b = new RangeSetBuilder<Decoration>()
    if (r) b.add(r.from, r.to, Decoration.replace({ block: true }))
    return b.finish()
}

const field = StateField.define<DecorationSet>({
    create: build,
    update: (deco, tr) => (tr.docChanged ? build(tr.state) : deco),
    provide: f => [
        EditorView.decorations.from(f),
        EditorView.atomicRanges.of(view => view.state.field(f)),
    ],
})

export function hideFrontmatter(): Extension {
    // Highest precedence so live preview's own frontmatter widget never paints over the gap.
    return [Prec.highest(field), guard]
}

// atomicRanges only moves the cursor; deleteBy skips atomic ranges for its target, so Backspace at
// the first visible char would delete the whole hidden block. Reject user input/delete that
// touches the hidden range (daemon-owned frontmatter must save byte-identical).
// changeFilter only trims the overlapping part (and lets an insert at 0 through), so reject the
// whole transaction instead. Any change starting before the body (fromA < r.to) touches the hidden
// block; an insert AT r.to (first visible char) is allowed.
export const guard = EditorState.transactionFilter.of(tr => {
    if (!tr.docChanged || tr.annotation(Transaction.userEvent) === undefined) return tr
    const r = hiddenFrontmatterRange(tr.startState.doc.toString())
    if (!r) return tr
    let hits = false
    tr.changes.iterChangedRanges(fromA => {
        if (fromA < r.to) hits = true
    })
    return hits ? [] : tr
})
