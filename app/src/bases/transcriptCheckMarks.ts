// transcriptCheckMarks.ts — CodeMirror pieces for the review checks on a transcript page: a wavy
// underline under each flagged line and a warning glyph after it, yellow for `unsure`, red for
// `garbled`. A check sits on the line whose text it names, so a line typed over loses its glyph at
// once. The glyph is a button; pressing it hands the check to the field's `onCheck` handler.
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import type { TranscriptCheck } from '../../../core/src/transcript'
import { placeChecks } from '../../../core/src/transcriptChecks'
import { iconMarkup } from '../icons/iconMarkup'
import iconSize from '../ui/iconSize'

/** What the glyph's tooltip and label say, per level. */
export const CHECK_WORDS: Record<TranscriptCheck['level'], string> = {
    unsure: 'not sure of this line',
    garbled: 'this line read badly',
}

export const setChecks = StateEffect.define<TranscriptCheck[]>()

const checksField = StateField.define<TranscriptCheck[]>({
    create: () => [],
    update(value, tr) {
        for (const e of tr.effects) if (e.is(setChecks)) value = e.value
        return value
    },
})

class CheckGlyph extends WidgetType {
    constructor(
        readonly check: TranscriptCheck,
        readonly lineNo: number,
    ) {
        super()
    }
    eq(other: CheckGlyph): boolean {
        return other.check.line === this.check.line && other.check.level === this.check.level && other.lineNo === this.lineNo
    }
    toDOM(): HTMLElement {
        const el = document.createElement('span')
        el.className = 'cm-tr-check'
        el.setAttribute('role', 'button')
        el.setAttribute('aria-label', CHECK_WORDS[this.check.level])
        el.dataset.tooltip = CHECK_WORDS[this.check.level]
        el.dataset.transcriptCheck = this.check.level
        el.dataset.checkLine = String(this.lineNo)
        el.innerHTML = iconMarkup('TriangleAlert', iconSize())
        return el
    }
    // The editor sees the press, so the field's mousedown handler can claim it before a caret moves.
    ignoreEvent(): boolean {
        return false
    }
}

function build(state: EditorView['state']): DecorationSet {
    const doc = state.doc
    const lines = doc.toString().split('\n')
    const b = new RangeSetBuilder<Decoration>()
    for (const { index, check } of placeChecks(lines, state.field(checksField))) {
        const line = doc.line(index + 1)
        b.add(line.from, line.from, Decoration.line({ class: `cm-tr-check-line cm-tr-check-${check.level}` }))
        b.add(line.to, line.to, Decoration.widget({ widget: new CheckGlyph(check, index + 1), side: 1 }))
    }
    return b.finish()
}

const decorations = EditorView.decorations.compute(['doc', checksField], build)

const theme = EditorView.baseTheme({
    '.cm-tr-check-line': { textDecorationLine: 'underline', textDecorationStyle: 'wavy', textUnderlineOffset: '3px' },
    '.cm-tr-check-unsure': { textDecorationColor: 'var(--warning)' },
    '.cm-tr-check-garbled': { textDecorationColor: 'var(--danger)' },
    '.cm-tr-check': {
        display: 'inline-flex',
        verticalAlign: 'middle',
        marginLeft: 'var(--sp-2)',
        cursor: 'pointer',
        borderRadius: 'var(--r-mark)',
    },
    '.cm-tr-check[data-transcript-check="unsure"]': { color: 'var(--warning)' },
    '.cm-tr-check[data-transcript-check="garbled"]': { color: 'var(--danger)' },
})

/** The checks layer: underline + glyph per placed check. `onCheck` gets the pressed glyph, the
 *  check and its 1-based line number. */
export function transcriptChecks(onCheck: (el: HTMLElement, check: TranscriptCheck, lineNo: number) => void): Extension {
    const open = (target: EventTarget | null, view: EditorView): boolean => {
        // data-* attributes are the runtime hook here: CodeMirror owns this DOM, not the tree.
        const el = target instanceof Element ? (target.closest('[data-transcript-check]') as HTMLElement | null) : null
        if (!el) return false
        const lineNo = Number(el.dataset.checkLine)
        const placed = placeChecks(view.state.doc.toString().split('\n'), view.state.field(checksField))
        const hit = placed.find(p => p.index + 1 === lineNo)
        if (!hit) return false
        onCheck(el, hit.check, lineNo)
        return true
    }
    return [
        checksField,
        decorations,
        theme,
        EditorView.domEventHandlers({
            mousedown: (e, view) => {
                if (!open(e.target, view)) return false
                e.preventDefault()
                return true
            },
        }),
    ]
}

/** Select the whole text of line `lineNo` (1-based) and focus the field, so typing replaces it. */
export function selectLine(view: EditorView, lineNo: number): void {
    if (lineNo < 1 || lineNo > view.state.doc.lines) return
    const line = view.state.doc.line(lineNo)
    view.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true })
    view.focus()
}
