// transcriptMarks.ts — CodeMirror pieces for `==mark==` spans in a transcript page: the tint, the
// toggle the highlight button runs, and the brief flash `reveal` draws. The note editor has no
// `==mark==` rendering of its own, so the transcript field adds it here.
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { EditorSelection, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'

const MARK = /==([^=\n](?:[^\n]*?[^=\n])?)==/g

type Span = { from: number; to: number }

/** The `==…==` spans on one line, as absolute document ranges including the delimiters. */
function marksOnLine(text: string, base: number): Span[] {
    const out: Span[] = []
    MARK.lastIndex = 0
    for (let m = MARK.exec(text); m; m = MARK.exec(text)) out.push({ from: base + m.index, to: base + m.index + m[0].length })
    return out
}

const tint = Decoration.mark({ class: 'cm-tr-mark' })
const dim = Decoration.mark({ class: 'cm-tr-mark-edge' })
const hide = Decoration.replace({})

function build(view: EditorView): DecorationSet {
    const b = new RangeSetBuilder<Decoration>()
    const sel = view.state.selection.main
    let last = -1
    for (const r of view.visibleRanges) {
        let pos = Math.max(r.from, last + 1)
        while (pos <= r.to) {
            const line = view.state.doc.lineAt(pos)
            for (const s of marksOnLine(line.text, line.from)) {
                const touched = sel.from <= s.to && sel.to >= s.from
                if (touched) {
                    b.add(s.from, s.from + 2, dim)
                    b.add(s.from + 2, s.to - 2, tint)
                    b.add(s.to - 2, s.to, dim)
                } else {
                    b.add(s.from, s.from + 2, hide)
                    b.add(s.from + 2, s.to - 2, tint)
                    b.add(s.to - 2, s.to, hide)
                }
            }
            last = line.to
            pos = line.to + 1
        }
    }
    return b.finish()
}

const markPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet
        constructor(view: EditorView) {
            this.decorations = build(view)
        }
        update(u: ViewUpdate) {
            if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = build(u.view)
        }
    },
    { decorations: v => v.decorations },
)

const markTheme = EditorView.baseTheme({
    '.cm-tr-mark': {
        backgroundColor: 'color-mix(in srgb, var(--warning) 35%, transparent)',
        borderRadius: 'var(--r-mark)',
    },
    '.cm-tr-mark-edge': { color: 'var(--text-muted)' },
})

export const setFlash = StateEffect.define<Span | null>()
const flashField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
        value = value.map(tr.changes)
        for (const e of tr.effects) {
            if (!e.is(setFlash)) continue
            value = e.value && e.value.to > e.value.from ? Decoration.set([Decoration.mark({ class: 'cm-tr-flash' }).range(e.value.from, e.value.to)]) : Decoration.none
        }
        return value
    },
    provide: f => EditorView.decorations.from(f),
})
const flashTheme = EditorView.baseTheme({
    '.cm-tr-flash': { backgroundColor: 'var(--selection)', borderRadius: 'var(--r-mark)' },
})

/** Tint for `==marks==` plus the field `reveal` flashes through. */
export const transcriptMarks: Extension = [markPlugin, markTheme, flashField, flashTheme]

/** Wraps the selection in `==…==`; unwraps when the selection sits inside a mark or is one. No-op on
 *  an empty selection. Returns whether it changed anything. */
export function toggleMark(view: EditorView): boolean {
    const sel = view.state.selection.main
    if (sel.empty) return false
    const doc = view.state.doc
    const line = doc.lineAt(sel.from)
    const same = doc.lineAt(sel.to).number === line.number
    if (same) {
        const hit = marksOnLine(line.text, line.from).find(s => sel.from >= s.from && sel.to <= s.to)
        if (hit) {
            const inner = doc.sliceString(hit.from + 2, hit.to - 2)
            view.dispatch({
                changes: { from: hit.from, to: hit.to, insert: inner },
                selection: EditorSelection.range(hit.from, hit.from + inner.length),
                userEvent: 'input',
            })
            return true
        }
    }
    const text = doc.sliceString(sel.from, sel.to)
    view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: `==${text}==` },
        selection: EditorSelection.range(sel.from + 2, sel.to + 2),
        userEvent: 'input',
    })
    return true
}
