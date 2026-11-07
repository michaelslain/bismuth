// app/src/ui/NoteProse.tsx — NoteProse.module.css is the ONLY importer.
// Markdown shown exactly as a note shows it, read-only: a CodeMirror view running the note editor's
// own reading stack — live preview, math, code blocks, tables, the `button` fence, embeds, task
// folds and the heading / list fold triangles — fed a string instead of a file. A chat message
// renders through this, so every rule a note's markdown follows (spacing, fold triangles at every
// list depth, links) is the note's, not a copy of it.
//
// Read-only: no caret, so live preview never reveals raw markup. `text` may change (a reply
// streaming in); an append is dispatched as an insert, anything else as a whole replace, and the
// fold state (keyed by block text, see editor/foldBlocks.ts) carries across both.
import {
    createEffect,
    createSignal,
    onCleanup,
    onMount,
    Show,
    type Component,
} from 'solid-js'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import { markdownEditingExtensions } from '../editor/cellEditorExtensions'
import { foldBlocks } from '../editor/foldBlocks'
import { taskFold } from '../editor/taskFold'
import {
    buttonBlock,
    buttonHostFacet,
    type ButtonBlockHost,
} from '../editor/buttonBlock'
import { embedBlock } from '../editor/embedBlock'
import { noteLinkClicks } from '../editor/linkClicks'
import { fitContentTheme, noteProseTheme } from '../editor/noteProseTheme'
import { noteNamesFacet } from '../editor/tableState'
import type { NoteCandidate } from '../editor/wikilink'
import type { MemoryCandidate } from '../../../core/src/memoryRef'
import styles from './NoteProse.module.css'

export type NoteProseProps = {
    /** Markdown source. */
    text: string
    /** Where right-click fold locks for this text are kept (foldBlocks' per-path store): a stable
     *  name for the text, such as `chat:<id>:<turn>`. */
    foldKey: string
    /** Vault notes a `[[wikilink]]` resolves against. Absent = links open by their typed name. */
    noteNames?: () => NoteCandidate[]
    /** Memory notes a `~slug` resolves against. */
    memoryNames?: () => MemoryCandidate[]
    /** Who `button` fences run for (a chat), instead of a note. */
    buttons?: ButtonBlockHost
    /** Mount the view only once it comes within about a screen of the viewport, and show the plain
     *  text at the same face and row until then. For a long list of these (a chat transcript):
     *  every CodeMirror view reads the page selection as it starts, which forces a layout of the
     *  whole page, so mounting hundreds at once costs time that grows with the page. Once mounted
     *  a view stays mounted, so its folds survive scrolling away. */
    lazy?: boolean
    class?: string
}

const none = () => []

/** The nearest ancestor that scrolls vertically, or null (the window). */
function scrollParent(el: HTMLElement): Element | null {
    for (let n = el.parentElement; n; n = n.parentElement) {
        const y = getComputedStyle(n).overflowY
        if (y === 'auto' || y === 'scroll') return n
    }
    return null
}

const NoteProse: Component<NoteProseProps> = props => {
    let host!: HTMLDivElement
    // The view's own element: the placeholder beside it is Solid's, and Solid clears an element
    // whose only child it removes, which would take CodeMirror's DOM with it.
    let editor!: HTMLDivElement
    const [view, setView] = createSignal<EditorView>()

    const mount = () => {
        const noteNames = () => (props.noteNames ?? none)()
        const memoryNames = () => (props.memoryNames ?? none)()
        setView(
            new EditorView({
                parent: editor,
                state: EditorState.create({
                    doc: props.text,
                    extensions: [
                        EditorView.editable.of(false),
                        EditorState.readOnly.of(true),
                        EditorView.lineWrapping,
                        indentUnit.of('    '),
                        EditorState.tabSize.of(4),
                        noteProseTheme,
                        fitContentTheme,
                        ...markdownEditingExtensions({
                            completion: {
                                getNotes: noteNames,
                                getMemories: memoryNames,
                                getTags: none,
                                getSchema: () => ({}),
                                getIconNames: none,
                                inFrontmatter: () => false,
                                readNote: async () => '',
                            },
                            livePreview: true,
                        }),
                        buttonBlock(),
                        ...(props.buttons
                            ? [buttonHostFacet.of(props.buttons)]
                            : []),
                        embedBlock(noteNames),
                        noteNamesFacet.of(noteNames),
                        taskFold(),
                        foldBlocks(() => props.foldKey, 'markdown'),
                        noteLinkClicks({ noteNames, memoryNames }),
                    ],
                }),
            }),
        )
    }

    onMount(() => {
        if (!props.lazy) return mount()
        const seen = new IntersectionObserver(
            entries => {
                if (!entries.some(e => e.isIntersecting)) return
                seen.disconnect()
                mount()
            },
            // Measured against the nearest scroller (the transcript), not the window: an element
            // scrolled out of an inner scroller is clipped there, and the window's margin would
            // never reach it.
            { root: scrollParent(host), rootMargin: '100% 0px' },
        )
        seen.observe(host)
        onCleanup(() => seen.disconnect())
    })

    // A reply streams in by appending: insert only the new tail so the view keeps its folds and
    // measured widgets; any other change replaces the whole document.
    createEffect(() => {
        const next = props.text
        const v = view()
        if (!v) return
        const cur = v.state.doc.toString()
        if (next === cur) return
        v.dispatch({
            changes: next.startsWith(cur)
                ? { from: cur.length, insert: next.slice(cur.length) }
                : { from: 0, to: cur.length, insert: next },
        })
    })

    onCleanup(() => view()?.destroy())

    return (
        <div
            ref={host}
            class={`${styles.prose} ${props.class ?? ''}`}
            data-note-prose
        >
            <Show when={!view()}>
                <div class={styles.pending}>{props.text}</div>
            </Show>
            <div ref={editor} />
        </div>
    )
}

export default NoteProse
