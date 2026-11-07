// app/src/editor/buttonBlock.ts
//
// The ```button embedded block: a fence of button definitions rendered INLINE as a live row of
// buttons (ButtonBlockView). Structure mirrors graphBlock.ts: the closed fence is replaced by a
// block widget; a double-click on the widget, or the caret moving into the fence, reveals the raw
// source for editing, and it collapses once the caret leaves. livePreview (blockRegions.ts) skips
// `button` fences so they are not ALSO rendered as code blocks. A `send` button opens the quick
// ask for this note at the fence and sends its text as the first message.
import {
    Decoration,
    type DecorationSet,
    EditorView,
    WidgetType,
} from '@codemirror/view'
import {
    Facet,
    StateEffect,
    StateField,
    type EditorState,
    type Extension,
} from '@codemirror/state'
import type { ButtonHost } from '../../../core/src/buttons/buttonTypes'
import { scanButtonFences } from '../../../core/src/buttons/buttonBlock'
import ButtonBlockView from '../buttons/ButtonBlockView'
import { openQuickAsk } from '../quickAsk/quickAskState'
import { locateBlockIndex } from './blockLocate'
import { blockHeightKey, estimateBlockHeight } from './blockHeights'
import { codeLineNumberTheme, numberedLine } from './codeLineNumbers'
import { disposeSolid, mountSolid } from './solidWidget'
import { notePathFacet } from './tableState'
import { inertButtonText } from '../bases/markdown'

export type ButtonRange = { from: number; to: number; body: string }

/** Who a view's button rows run for, when that is not the note at `notePathFacet` — a chat
 *  message: its `send` buttons become the chat's next message (`onSend`), and with no `onSend`
 *  (a message you wrote) the rows stay inert, so a fence you typed never runs. */
export type ButtonBlockHost = { host: ButtonHost; onSend?: (text: string) => void }
export const buttonHostFacet = Facet.define<
    ButtonBlockHost,
    ButtonBlockHost | null
>({ combine: values => values[0] ?? null })

/** All closed ```button fences in the document, in order (exclusive `to`). A fresh array on
 *  every call. */
export function buttonRanges(state: EditorState): ButtonRange[] {
    const text = state.doc.toString()
    if (text.indexOf('button') === -1) return []
    return scanButtonFences(text)
}

/** Index of the button fence at `pos` (a widget's `posAtDOM`), or -1. */
export function locateButtonBlock(
    ranges: ButtonRange[],
    pos: number,
): number {
    return locateBlockIndex(ranges, pos)
}

const toggleButtonSource = StateEffect.define<number>()

/** Indices of button blocks currently revealed as raw source. Added by a double-click or the caret
 *  entering the fence; removed once the caret leaves it. */
const revealedField = StateField.define<Set<number>>({
    create: () => new Set(),
    update(value, tr) {
        let next = value
        for (const e of tr.effects) {
            if (e.is(toggleButtonSource)) {
                next = new Set(next)
                if (next.has(e.value)) next.delete(e.value)
                else next.add(e.value)
            }
        }
        if (tr.selection || tr.docChanged) {
            const ranges = buttonRanges(tr.state)
            const head = tr.state.selection.main.head
            const kept = new Set<number>()
            next.forEach(i => {
                const r = ranges[i]
                if (r && head >= r.from && head <= r.to) kept.add(i)
            })
            // The caret moved strictly inside a collapsed fence (arrow keys, a click on its
            // source): reveal it.
            if (tr.selection && !tr.docChanged) {
                ranges.forEach((r, i) => {
                    if (head > r.from && head < r.to) kept.add(i)
                })
            }
            if (kept.size !== next.size || [...kept].some(i => !next.has(i)))
                next = kept
        }
        return next
    },
})

/** Document-order indices of the revealed button blocks (read-only, for tests and stories). */
export function revealedButtonBlocks(state: EditorState): ReadonlySet<number> {
    return state.field(revealedField)
}

class ButtonBlockWidget extends WidgetType {
    private view?: EditorView
    private dom?: HTMLElement

    constructor(
        readonly source: string,
        readonly notePath: string | null,
        readonly chatHost: ButtonBlockHost | null = null,
    ) {
        super()
    }

    private memoKey?: string
    get heightKey(): string {
        return (this.memoKey ??= blockHeightKey('button', this.source))
    }
    get estimatedHeight(): number {
        return estimateBlockHeight(this.heightKey)
    }

    eq(other: ButtonBlockWidget): boolean {
        return (
            other.source === this.source &&
            other.notePath === this.notePath &&
            other.chatHost === this.chatHost
        )
    }

    /** This block's current range and index, located by DOM position (robust to edits above). */
    private locate(): { range: ButtonRange; index: number } | null {
        const view = this.view,
            dom = this.dom
        if (!view || !dom) return null
        let pos: number
        try {
            pos = view.posAtDOM(dom)
        } catch {
            return null
        }
        const ranges = buttonRanges(view.state)
        const index = locateButtonBlock(ranges, pos)
        return index < 0 ? null : { range: ranges[index]!, index }
    }

    private reveal = () => {
        const view = this.view
        const loc = this.locate()
        if (!view || !loc) return
        view.dispatch({
            effects: toggleButtonSource.of(loc.index),
            selection: { anchor: loc.range.from + loc.range.body.length },
        })
        view.focus()
    }

    private send = (text: string) => {
        const view = this.view
        const loc = this.locate()
        if (!view || !loc) return
        openQuickAsk(
            {
                kind: 'caret',
                view,
                pos: loc.range.from,
                notePath: this.notePath,
                key: this.notePath,
            },
            { send: text },
        )
    }

    toDOM(view: EditorView): HTMLElement {
        this.view = view
        const container = document.createElement('div')
        container.className = 'bismuth-button-block'
        container.dataset.buttonBlock = ''
        this.dom = container
        // A double-click on empty space in the row reveals the source; one on a button is a press.
        container.addEventListener('dblclick', e => {
            if ((e.target as HTMLElement).closest('button')) return
            this.reveal()
        })
        const chat = this.chatHost
        const host: ButtonHost = chat?.host ?? {
            kind: 'note',
            path: this.notePath ?? '',
        }
        const body = this.source
        if (chat && !chat.onSend) {
            // Inert: the row's labels, nothing to press (a fence in a message you wrote).
            container.textContent = inertButtonText(body)
            return container
        }
        const onSend = chat ? chat.onSend : this.send
        mountSolid(container, () => ButtonBlockView({ host, body, onSend }))
        return container
    }

    destroy(dom: HTMLElement): void {
        disposeSolid(dom)
    }

    ignoreEvent(): boolean {
        return true
    }
}

const buttonSourceLine = Decoration.line({ class: 'cm-buttonblock-body' })

function buildDecorations(state: EditorState): DecorationSet {
    const revealed = state.field(revealedField)
    const doc = state.doc
    const notePath = state.facet(notePathFacet)
    const chatHost = state.facet(buttonHostFacet)
    const deco: ReturnType<Decoration['range']>[] = []
    buttonRanges(state).forEach((r, i) => {
        if (revealed.has(i)) {
            const openLine = doc.lineAt(r.from).number
            const closeLine = doc.lineAt(r.to).number
            for (let ln = openLine; ln <= closeLine; ln++) {
                const line = doc.line(ln)
                const isBody = ln > openLine && ln < closeLine
                deco.push(
                    (isBody
                        ? numberedLine('cm-buttonblock-body', ln - openLine)
                        : buttonSourceLine
                    ).range(line.from),
                )
            }
        } else {
            deco.push(
                Decoration.replace({
                    widget: new ButtonBlockWidget(r.body, notePath, chatHost),
                    block: true,
                }).range(r.from, r.to),
            )
        }
    })
    return Decoration.set(deco, true)
}

const buttonTheme = EditorView.theme({
    '.cm-buttonblock-body': {
        fontFamily: 'var(--ui-font-stack)',
        fontSize: 'var(--code-font-size)',
    },
    // Left inset = CodeMirror's .cm-line padding (6px), so the row starts on the note text column.
    '.bismuth-button-block': { padding: '4px 0 4px 6px' },
})

// Clicks outside a revealed block collapse it (a click into the rendered widget moves no caret).
const collapseOnClickOutside = EditorView.domEventHandlers({
    mousedown(e, view) {
        const revealed = view.state.field(revealedField)
        if (!revealed.size) return false
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        const ranges = buttonRanges(view.state)
        const toClose: number[] = []
        revealed.forEach(i => {
            const r = ranges[i]
            if (!r || pos == null || pos < r.from || pos > r.to) toClose.push(i)
        })
        if (toClose.length)
            view.dispatch({ effects: toClose.map(i => toggleButtonSource.of(i)) })
        return false
    },
})

/** The ```button embedded-block extension. */
export function buttonBlock(): Extension {
    const decoField = StateField.define<DecorationSet>({
        create: state => buildDecorations(state),
        update(value, tr) {
            const revChanged =
                tr.startState.field(revealedField) !==
                tr.state.field(revealedField)
            if (tr.docChanged || revChanged) return buildDecorations(tr.state)
            return value.map(tr.changes)
        },
        provide: f => EditorView.decorations.from(f),
    })
    return [
        revealedField,
        collapseOnClickOutside,
        buttonTheme,
        codeLineNumberTheme,
        decoField,
    ]
}
