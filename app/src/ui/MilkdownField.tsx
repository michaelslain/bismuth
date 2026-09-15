// app/src/ui/MilkdownField.tsx
// A standalone TRUE-WYSIWYG rich-text field bound to a plain markdown string (bold renders
// bold, lists/headings render as blocks, `[[wikilinks]]`/`#tags` become chips, no markdown
// symbols shown), with zero vault/file coupling. Unlike the CodeMirror `MarkdownField`
// (live-preview / per-token reveal), this is Milkdown WYSIWYG; use it where a markdown
// property should edit as true rich text (e.g. a kanban card's `description` —
// CardEditModal.tsx).
//
// The heavy Milkdown/ProseMirror bridge is code-split (dynamic import), so it stays out of app
// boot. The caller owns the value: `onChange` fires per edit with the whole document's
// markdown, `onBlur` fires when the editable loses focus — commit there. Chromeless: styling
// comes entirely from the caller's own module (e.g. CardEditModal.module.css's `.mdField`).
import { onCleanup, onMount } from 'solid-js'
import { settings } from '../settings'
import type {
    DocEditorHandle,
    createDocEditor as CreateDocEditorFn,
} from '../milkdown/milkdownEditor'

// Module-scoped so concurrent first mounts share one import.
let docModule: Promise<{ createDocEditor: typeof CreateDocEditorFn }> | null =
    null
function loadDocEditor(): Promise<{
    createDocEditor: typeof CreateDocEditorFn
}> {
    if (!docModule) docModule = import('../milkdown/milkdownEditor')
    return docModule
}

function MilkdownField(props: {
    /** Initial markdown. Treated as SEED-only — the field owns its buffer after mount, so an
     *  in-flight external change can't clobber a mid-edit caret. Pass a stable snapshot. */
    value: string
    /** Fired per edit with the whole document's serialized markdown. */
    onChange: (markdown: string) => void
    /** Fired when the editable loses focus (commit the draft here). */
    onBlur?: () => void
    /** Focus + place the caret at the end once the (async) surface mounts. */
    autofocus?: boolean
    /** Handed the live editor handle once the (async) surface mounts, and `null` on teardown —
     *  so a host can drive the surface imperatively (e.g. `insertMarkdown` for a dropped image).
     *  The handle is NOT available synchronously: the Milkdown chunk is code-split, so a host must
     *  tolerate a null handle for the first frames. */
    onReady?: (handle: DocEditorHandle | null) => void
    class?: string
}) {
    let root!: HTMLDivElement
    let handle: DocEditorHandle | null = null
    let disposed = false

    onMount(() => {
        void loadDocEditor().then(({ createDocEditor }) => {
            if (disposed) return
            return createDocEditor({
                root,
                value: props.value ?? '',
                spellcheck: settings.editor.spellcheck,
                onChange: md => props.onChange(md),
                onBlur: () => props.onBlur?.(),
            }).then(h => {
                if (disposed) {
                    h.destroy()
                    return
                }
                handle = h
                props.onReady?.(h)
                if (props.autofocus) h.focus('end')
            })
        })
    })

    onCleanup(() => {
        disposed = true
        props.onReady?.(null)
        handle?.destroy()
        handle = null
    })

    return <div ref={root} class={props.class} />
}

export default MilkdownField
