import { Show, createEffect, createSignal, onCleanup, onMount, type Component, type JSX } from 'solid-js'
import { Compartment, EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { markdownEditingExtensions } from '../editor/cellEditorExtensions'
import { settingsKeymapCompartment } from '../editor/settingsKeymap'
import { notePathFacet } from '../editor/tableState'
import { cursor } from '../editor/cursorTheme'
import { settings } from '../settings'
import { api } from '../api'
import Text from '../ui/Text'
import IconButton from '../ui/IconButton'
import type { TranscriptCheck } from '../../../core/src/transcript'
import { selectLine, setChecks, transcriptChecks } from './transcriptCheckMarks'
import CheckPopover from './CheckPopover'
import { setFlash, toggleMark, transcriptMarks } from './transcriptMarks'
import styles from './TranscriptPage.module.css'

export type TranscriptPageHandle = {
    selection(): string
    /** wraps the selection in ==…== (or unwraps a selection inside one); no-op on an empty selection */
    toggleMark(): void
    /** puts the caret at the first occurrence of `text` (whole text when omitted) and scrolls it into view, tinted briefly */
    reveal(text?: string): void
    focus(): void
}

export type TranscriptPageProps = {
    /** divider label: `page 3`, or in a book spanning files `<file name> // page 3`; omitted = no divider (an image) */
    label?: string
    text: string
    /** the status cell at the divider's right end (Task 5's PageStatus), or nothing */
    status?: JSX.Element
    /** saves this page's text; called debounced (≤ 600 ms after typing stops) and on blur, never with unchanged text */
    onSave: (text: string) => void
    /** the field's view, for Task 6: selection, caret placement, ==mark== wrap */
    ref?: (handle: TranscriptPageHandle) => void
    fontFamily?: string
    /** text size as a multiple of the prose size */
    textScale?: number
    placeholder?: string
    readOnly?: boolean
    onContextMenu?: (e: MouseEvent, selection: string) => void
    onSelect?: (selection: string) => void
    /** lines flagged for review: a glyph after each (yellow unsure, red garbled); an empty `line`
     *  flags the whole page, shown in the divider */
    checks?: TranscriptCheck[]
    /** the reader pressed `[ looks right ]` on a check (its `line`, '' for the whole page) */
    onApprove?: (line: string) => void
    /** the scan strip a flagged line came from, for its popup */
    crop?: (line: string) => JSX.Element | undefined
    /** a divider row only, no editor: a page off the window, so a blank reads as loading */
    pending?: boolean
    className?: string
}

const SAVE_DELAY_MS = 500
const FLASH_MS = 1200

// Prose flow like MarkdownField's: transparent, gutterless, the page's own font and scale.
const fieldTheme = EditorView.theme({
    '&': { backgroundColor: 'transparent', color: 'var(--fg)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
        fontFamily: 'var(--transcript-font, var(--prose-font))',
        fontSize: 'calc(var(--prose-font-size) * var(--transcript-scale, 1))',
        lineHeight: '1.55',
        overflow: 'visible',
    },
    '.cm-content': { padding: 'var(--sp-3) 0' },
    '.cm-line': { padding: '0' },
    '.cm-placeholder': {
        color: 'var(--text-muted)',
        fontStyle: 'italic',
        fontFamily: 'var(--ui-font-stack)',
        fontSize: 'var(--fs-body)',
    },
    '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--selection)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--selection)' },
})

/** One page's text, rendered and editable like a note: the shared markdown stack (live preview,
 *  math, tables) under a divider row. Saves its text a beat after typing stops and on blur, and only
 *  when the user changed it. */
const TranscriptPage: Component<TranscriptPageProps> = props => {
    let host!: HTMLDivElement
    let view: EditorView | undefined
    let syncing = false
    // What the parent last told us or we last saved: a save equal to it is not sent.
    let known = props.text
    let dirty = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let flashTimer: ReturnType<typeof setTimeout> | undefined
    const editable = new Compartment()
    // The open check popup: the glyph it hangs from, the check, and its 1-based line (0 = whole page).
    const [open, setOpen] = createSignal<{ el: HTMLElement; check: TranscriptCheck; lineNo: number }>()
    let pageGlyph: HTMLElement | undefined
    const pageCheck = () => (props.text.trim() === '' ? props.checks?.find(c => c.line === '') : undefined)
    const hint = new Compartment()

    const flush = () => {
        if (timer) clearTimeout(timer)
        timer = undefined
        if (!view || !dirty) return
        dirty = false
        const next = view.state.doc.toString()
        if (next === known) return
        known = next
        props.onSave(next)
    }
    const queue = () => {
        dirty = true
        if (timer) clearTimeout(timer)
        timer = setTimeout(flush, SAVE_DELAY_MS)
    }
    const selection = () => {
        if (!view) return ''
        const r = view.state.selection.main
        return view.state.sliceDoc(r.from, r.to)
    }

    const fieldKeymap = settingsKeymapCompartment([
        { id: 'indent', run: indentMore },
        { id: 'outdent', run: indentLess },
    ])
    const lock = (ro: boolean | undefined) => [EditorState.readOnly.of(!!ro), EditorView.editable.of(!ro)]

    onMount(() => {
        if (props.pending) return
        view = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: props.text,
                extensions: [
                    history(),
                    cursor,
                    indentUnit.of('  '),
                    EditorState.tabSize.of(2),
                    fieldKeymap.extension,
                    keymap.of([...defaultKeymap, ...historyKeymap]),
                    notePathFacet.of(''),
                    ...markdownEditingExtensions({
                        completion: {
                            getNotes: () => [],
                            getTags: () => [],
                            getMemories: () => [],
                            getSchema: () => ({}),
                            getIconNames: () => [],
                            inFrontmatter: () => false,
                            readNote: p => api.read(p),
                        },
                        livePreview: settings.editor.livePreview,
                    }),
                    transcriptMarks,
                    transcriptChecks((el, check, lineNo) => setOpen({ el, check, lineNo })),
                    EditorView.lineWrapping,
                    fieldTheme,
                    editable.of(lock(props.readOnly)),
                    hint.of(placeholder(props.placeholder ?? 'no text yet')),
                    EditorView.updateListener.of(u => {
                        if (u.docChanged && !syncing) queue()
                        if (u.selectionSet || u.docChanged) props.onSelect?.(selection())
                    }),
                    EditorView.domEventHandlers({
                        blur: () => {
                            flush()
                        },
                        contextmenu: e => {
                            props.onContextMenu?.(e, selection())
                        },
                    }),
                ],
            }),
        })
        fieldKeymap.attach(view)
        view.dispatch({ effects: setChecks.of(props.checks ?? []) })
        props.ref?.({
            selection,
            toggleMark: () => {
                if (view) toggleMark(view)
            },
            reveal: text => {
                if (!view) return
                const doc = view.state.doc.toString()
                const at = text ? doc.indexOf(text) : 0
                if (at < 0) return
                const to = at + (text ? text.length : doc.length)
                view.dispatch({
                    selection: { anchor: at },
                    effects: [setFlash.of({ from: at, to }), EditorView.scrollIntoView(at, { y: 'center' })],
                })
                view.focus()
                if (flashTimer) clearTimeout(flashTimer)
                flashTimer = setTimeout(() => view?.dispatch({ effects: setFlash.of(null) }), FLASH_MS)
            },
            focus: () => view?.focus(),
        })
    })

    // Reflect a text change from outside (a redo, a reload) into the doc, unless the reader has typed
    // something not yet saved: their text wins until it saves.
    createEffect(() => {
        const next = props.text
        if (!view || dirty || next === view.state.doc.toString()) return
        known = next
        const sel = view.state.selection.main
        syncing = true
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: next },
            annotations: Transaction.addToHistory.of(false),
            selection: { anchor: Math.min(sel.anchor, next.length), head: Math.min(sel.head, next.length) },
        })
        syncing = false
    })
    createEffect(() => {
        const checks = props.checks ?? []
        view?.dispatch({ effects: setChecks.of(checks) })
        // a popup over a check that went away (approved, retyped, reloaded) closes with it
        const cur = open()
        if (cur && cur.lineNo > 0 && !checks.some(c => c.line === cur.check.line && c.level === cur.check.level)) setOpen(undefined)
    })
    createEffect(() => {
        const ro = props.readOnly
        const ph = props.placeholder ?? 'no text yet'
        view?.dispatch({ effects: [editable.reconfigure(lock(ro)), hint.reconfigure(placeholder(ph))] })
    })

    onCleanup(() => {
        flush()
        if (flashTimer) clearTimeout(flashTimer)
        view?.destroy()
        view = undefined
    })

    return (
        <div
            class={`${styles.page} ${props.className ?? ''}`.trim()}
            style={{
                '--transcript-font': props.fontFamily,
                '--transcript-scale': props.textScale !== undefined ? String(props.textScale) : undefined,
            } as JSX.CSSProperties}
        >
            <Show when={props.label !== undefined || pageCheck()}>
                <div class={styles.divider}>
                    <div class={styles.lead}>
                        <Text as="span" size="ui" tone="muted">
                            {props.label}
                        </Text>
                        <Show when={pageCheck()}>
                            {check => (
                                <div ref={el => (pageGlyph = el)} class={styles['page-check']} data-page-check={check().level}>
                                    <IconButton
                                        icon="TriangleAlert"
                                        danger
                                        label="no text was read from this page"
                                        onClick={() => setOpen({ el: pageGlyph!, check: check(), lineNo: 0 })}
                                    />
                                </div>
                            )}
                        </Show>
                    </div>
                    <div class={styles.status}>{props.status}</div>
                </div>
            </Show>
            <Show when={!props.pending}>
                <div ref={host} class={styles.field} />
            </Show>
            <CheckPopover
                open={!!open()}
                anchor={() => open()?.el}
                check={open()?.check}
                crop={open() ? props.crop?.(open()!.check.line) : undefined}
                onDismiss={() => setOpen(undefined)}
                onApprove={() => {
                    const cur = open()
                    setOpen(undefined)
                    if (cur) props.onApprove?.(cur.check.line)
                }}
                onRetype={() => {
                    const cur = open()
                    setOpen(undefined)
                    if (!cur || !view) return
                    if (cur.lineNo > 0) selectLine(view, cur.lineNo)
                    else view.focus()
                }}
            />
        </div>
    )
}

export default TranscriptPage
