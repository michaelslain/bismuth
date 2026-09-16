import { createEffect, onCleanup, onMount } from 'solid-js'
import {
    EditorView,
    keymap,
    drawSelection,
    placeholder,
} from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import {
    defaultKeymap,
    history,
    historyKeymap,
    indentMore,
    indentLess,
} from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { notePathFacet } from '../editor/tableState'
import { markdownEditingExtensions } from '../editor/cellEditorExtensions'
import type { NoteCandidate } from '../editor/wikilink'
import { settings } from '../settings'
import { api } from '../api'

// Theme: transparent, gutterless, prose-flow — so the field reads as rendered-yet-editable
// markdown (like the note editor's live-preview), not a boxed code editor. The host element owns
// the visible box (border/background/padding/min-height) via the caller's `class`. Font is
// `--prose-font`/`--prose-font-size` (like CardEditor and Editor.tsx) so it looks identical to
// the note editor's markdown; selection/caret tints mirror Editor.tsx so highlighting matches too.
const fieldTheme = EditorView.theme({
    '&': { backgroundColor: 'transparent', color: 'var(--fg)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
        fontFamily: 'var(--prose-font)',
        fontSize: 'var(--prose-font-size)',
        lineHeight: '1.55',
        overflow: 'visible',
    },
    '.cm-content': { caretColor: 'var(--fg)' },
    '.cm-line': { padding: '0' },
    '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--fg)',
        borderLeftWidth: '2px',
    },
    // The UI font stack (not the prose font the typed value uses) so the hint reads distinctly from real content.
    '.cm-placeholder': {
        color: 'var(--faint)',
        fontStyle: 'italic',
        fontFamily: 'var(--ui-font-stack)',
        fontSize: 'var(--fs-body)',
    },
    '.cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent)',
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
        {
            backgroundColor:
                'color-mix(in srgb, var(--accent) 38%, transparent)',
        },
})

export type MarkdownFieldProps = {
    value: string
    onInput: (value: string) => void
    placeholder?: string
    autofocus?: boolean
    class?: string
    /** Vault notes for `[[wikilink]]` completion — the SAME `NoteCandidate[]` shape
     *  (`{ label, path, folder? }`, `app/src/editor/wikilink.ts`) that `App.tsx`'s
     *  `noteCandidates` memo already produces for the note editor. Absent = no note candidates. */
    noteNames?: () => NoteCandidate[]
    /** Vault tag names for `#tag` completion (plain strings, as `App.tsx`'s `tagCandidates`).
     *  Absent = no tag candidates. */
    tagNames?: () => string[]
    /** The note path this field's text belongs to, for link resolution. Absent = null. */
    notePath?: string | null
}

/**
 * A standalone, always-live inline markdown editor bound to a plain string (`value` + `onInput`) —
 * runs the SAME shared markdown editing stack (`markdownEditingExtensions`,
 * `editor/cellEditorExtensions.ts`) as the note editor and the in-cell table editor: per-token
 * live preview, math, and vault `[[wikilink]]`/`#tag`/`:emoji:` autocomplete — with zero
 * vault/file coupling of its own. Unlike CardEditor it never touches the API for its own value:
 * the caller owns the value and persists it however it likes (`readNote` is wired to `api.read`
 * only because the shared heading-completion source needs it). Use for small markdown fields
 * (e.g. a calendar event's description) that should edit exactly like the rest of the app's
 * markdown, instead of a render-on-blur textarea.
 *
 * Deliberately lighter than the full note Editor in what it still omits: Harper spell/grammar,
 * `![[…]]` embeds, and click-to-navigate links. `noteNames`/`tagNames`/`notePath` are optional —
 * a caller that passes none simply gets empty candidate lists, so no wikilink/tag popup opens.
 * NOTE this is NOT otherwise the pre-shared-stack behaviour: every caller now also gets the `/`
 * insert menu, `:emoji:` completion, task-signifier completion, Enter list continuation, and
 * markdown with `IndentedCode` removed — and loses live preview + math when
 * `settings.editor.livePreview` is off, which this field used to ignore.
 */
function MarkdownField(props: MarkdownFieldProps) {
    let host!: HTMLDivElement
    let view: EditorView | undefined
    // True only while applying an external value→doc sync, so the updateListener doesn't echo that
    // programmatic change straight back out through onInput.
    let syncing = false

    onMount(() => {
        view = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: props.value,
                extensions: [
                    history(),
                    drawSelection(),
                    indentUnit.of('  '),
                    EditorState.tabSize.of(2),
                    // Tab indents/dedents list items (matches the note editor); the rest is the standard
                    // editing + history keymap.
                    keymap.of([
                        { key: 'Tab', run: indentMore, shift: indentLess },
                        ...defaultKeymap,
                        ...historyKeymap,
                    ]),
                    // livePreview (inside the shared stack) reads this facet for table/embed path
                    // resolution; props.notePath is the note this field's text belongs to, "" = none.
                    notePathFacet.of(props.notePath ?? ''),
                    // The SAME shared stack the note editor + table cells run (#15/#49): markdown
                    // language + code highlighting, Enter list continuation, vault wikilink/tag/emoji
                    // autocomplete + its popup, and — gated by settings.editor.livePreview — live
                    // preview + math. A caller that passes none of noteNames/tagNames/notePath gets
                    // empty candidate lists, i.e. today's behaviour with no completion popup.
                    ...markdownEditingExtensions({
                        completion: {
                            getNotes: () => props.noteNames?.() ?? [],
                            getTags: () => props.tagNames?.() ?? [],
                            getMemories: () => [],
                            getSchema: () => ({}),
                            getIconNames: () => [],
                            inFrontmatter: () => false,
                            readNote: p => api.read(p),
                        },
                        livePreview: settings.editor.livePreview,
                    }),
                    EditorView.lineWrapping,
                    fieldTheme,
                    ...(props.placeholder
                        ? [placeholder(props.placeholder)]
                        : []),
                    EditorView.updateListener.of(u => {
                        if (u.docChanged && !syncing)
                            props.onInput(u.state.doc.toString())
                    }),
                ],
            }),
        })
        if (props.autofocus) view.focus()
    })

    // Reflect an out-of-band `value` change (caller reset / swapped record) into the doc. Typing
    // flows value back through onInput, so this no-ops on self-originated edits (next === doc).
    createEffect(() => {
        const next = props.value
        if (!view || next === view.state.doc.toString()) return
        const sel = view.state.selection.main
        const len = next.length
        syncing = true
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: next },
            selection: {
                anchor: Math.min(sel.anchor, len),
                head: Math.min(sel.head, len),
            },
        })
        syncing = false
    })

    onCleanup(() => view?.destroy())

    return <div ref={host} class={props.class} />
}

export default MarkdownField
