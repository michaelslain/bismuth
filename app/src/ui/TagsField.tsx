// app/src/ui/TagsField.tsx
// The field a `tags` (or declared `multiselect`) property is edited in — typed like a note's
// frontmatter `tags:` line, with the note editor's OWN completion popup under the word you are
// typing. No dropdown checklist, no filter box inside a popup: one line of text, suggestions as
// you type, Tab / Enter to take one.
//
// It is a single-line CodeMirror view so the popup is literally the editor's: the same
// `autocompletion()` wiring, row display (`completionDisplayConfig`), navigation keys
// (`completionNavKeymap`) and look (`completionTheme`) as the note editor and card editor. Only the
// completion SOURCE is this field's — it completes the token under the caret against the caller's
// `suggestions` (tag names, or a declared multiselect's options). The text/value logic is pure and
// lives in `tagsFieldText.ts`.
//
// Keys: typing a word (or `#`) opens the popup; ArrowUp/Down move; Tab (`accept-completion`,
// rebindable) or Enter takes the highlighted suggestion; Escape closes the popup — and, with no
// popup open, cancels (the keydown then bubbles, so a host modal closes too, like TextInput's
// Escape). Enter with no popup commits; so does leaving the field.
import {
    createEffect,
    onCleanup,
    onMount,
    type Component,
} from 'solid-js'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
    acceptCompletion,
    autocompletion,
    completionStatus,
    startCompletion,
    type CompletionContext,
    type CompletionResult,
} from '@codemirror/autocomplete'
import {
    completionDisplayConfig,
    completionNavKeymap,
    completionTheme,
} from '../editor/completionDisplay'
import { buildSettingsKeymap } from '../editor/settingsKeymap'
import FormControl from './FormControl'
import { isDismissKey } from './widgetKeys'
import {
    completionInsert,
    rankSuggestions,
    tagsToText,
    textToTags,
    tokenAtCaret,
    withTrailingSeparator,
} from './tagsFieldText'
import styles from './TagsField.module.css'

export type TagsFieldProps = {
    /** The current values (bare — no `#`). */
    value: string[]
    /** Every value the popup may suggest, best first (bare names). Read per keystroke. */
    suggestions: () => string[]
    /** Tags spelling: `#alpha #beta`, whitespace-separated. Off = `A, B` comma-separated (a
     *  declared multiselect whose options may contain spaces). Default on. */
    hash?: boolean
    /** Fired with the parsed list each time an edit ends (Enter, or leaving the field). */
    onCommit: (next: string[]) => void
    /** Fired when Escape ends the edit without saving. */
    onCancel: () => void
    /** Focus the field (caret at the end) on mount. Default true. */
    autofocus?: boolean
    placeholder?: string
    class?: string
}

// The field's own editor look: transparent, no padding, the UI font at the control size, tag
// tokens in the read-only cell's teal. The underline + focus rule come from FormControl.
const fieldTheme = EditorView.theme({
    '&': { backgroundColor: 'transparent', color: 'var(--fg)', height: '100%' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
        fontFamily: 'var(--ui-font-stack)',
        fontSize: 'inherit',
        lineHeight: 'inherit',
        overflow: 'hidden',
        alignItems: 'center',
    },
    '.cm-content': { padding: '0', caretColor: 'var(--fg)' },
    '.cm-line': { padding: '0' },
    '.cm-placeholder': { color: 'var(--faint)' },
})

const TagsField: Component<TagsFieldProps> = props => {
    const hash = () => props.hash !== false
    let host!: HTMLDivElement
    let view: EditorView | undefined
    // Every edit ends through ONE door — leaving the field. Enter blurs (commit); Escape marks the
    // edit cancelled, then blurs. The field may stay mounted afterwards (the card modal keeps every
    // field), so a later edit in the same field goes through the same door again.
    let cancelling = false
    let destroyed = false
    // Whether the completion popup was open when the current keydown arrived — read after
    // CodeMirror handled it, to tell "Escape closed the popup" from "Escape cancels the edit".
    let popupWasOpen = false

    // Replace the whole text (no history entry — a reset, not an edit).
    function setText(v: EditorView, text: string): void {
        if (text !== v.state.doc.toString())
            v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
    }

    function onLeave(v: EditorView): void {
        if (destroyed) return
        if (cancelling) {
            cancelling = false
            setText(v, tagsToText(props.value, hash(), false))
            props.onCancel()
            return
        }
        const next = textToTags(v.state.doc.toString(), hash())
        // Tidy BEFORE reporting — the caller may unmount the field in onCommit.
        setText(v, tagsToText(next, hash(), false))
        props.onCommit(next)
    }

    // The completion source: the token under the caret, completed against `suggestions` minus
    // what the field already holds. It opens as soon as a word (or a bare `#`) is typed.
    function source(ctx: CompletionContext): CompletionResult | null {
        const before = ctx.state.sliceDoc(0, ctx.pos)
        const tok = tokenAtCaret(before, hash())
        const typedHash = hash() && before.slice(tok.from).startsWith('#')
        if (!ctx.explicit && tok.query === '' && !typedHash) return null
        const others = textToTags(
            before.slice(0, tok.from) + ctx.state.sliceDoc(ctx.pos),
            hash(),
        )
        const ranked = rankSuggestions(props.suggestions(), tok.query, others)
        if (ranked.length === 0) return null
        return {
            from: tok.from,
            options: ranked.slice(0, 50).map(v => ({
                label: hash() ? `#${v}` : v,
                apply: completionInsert(v, hash()),
            })),
            // Already ranked here — CodeMirror must not re-filter or re-sort.
            filter: false,
        }
    }

    onMount(() => {
        // An autofocused field opens ready to type (trailing separator, caret at the end); an
        // unfocused one reads finished, and gains the separator when it is focused.
        const initial = tagsToText(props.value, hash(), props.autofocus !== false)
        view = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: initial,
                selection: { anchor: initial.length },
                extensions: [
                    history(),
                    // One line: a pasted newline becomes a separator, never a second line.
                    EditorState.transactionFilter.of(tr =>
                        tr.docChanged && tr.newDoc.lines > 1
                            ? [
                                  tr,
                                  {
                                      changes: {
                                          from: 0,
                                          to: tr.newDoc.length,
                                          insert: tr.newDoc
                                              .toString()
                                              .replace(/\n+/g, hash() ? ' ' : ', '),
                                      },
                                      sequential: true,
                                  },
                              ]
                            : tr,
                    ),
                    autocompletion({
                        ...completionDisplayConfig,
                        defaultKeymap: false, // completionNavKeymap below — see its doc comment
                        override: [source],
                    }),
                    completionNavKeymap,
                    completionTheme,
                    // Tab (rebindable) takes the highlighted suggestion; Enter/Escape end the edit
                    // when no popup is open (completionNavKeymap, at a higher precedence, owns them
                    // while one is).
                    buildSettingsKeymap([
                        { id: 'accept-completion', run: acceptCompletion },
                        {
                            id: 'ui-confirm',
                            run: v => (v.contentDOM.blur(), true),
                        },
                        {
                            id: 'ui-dismiss',
                            run: v => {
                                cancelling = true
                                v.contentDOM.blur()
                                return true
                            },
                        },
                    ]),
                    keymap.of([...defaultKeymap, ...historyKeymap]),
                    // `#` is not a word character, so CodeMirror's typing trigger misses it — open
                    // the popup the moment one is typed (the note editor does the same for `[[`).
                    EditorView.updateListener.of(u => {
                        if (!u.docChanged || !hash()) return
                        if (!u.transactions.some(t => t.isUserEvent('input.type'))) return
                        const pos = u.state.selection.main.head
                        if (u.state.sliceDoc(pos - 1, pos) === '#')
                            queueMicrotask(() => view && startCompletion(view))
                    }),
                    EditorView.domEventHandlers({
                        focus: (_e, v) => {
                            const doc = v.state.doc.toString()
                            const next = withTrailingSeparator(doc, hash())
                            if (next !== doc)
                                v.dispatch({
                                    changes: { from: doc.length, insert: next.slice(doc.length) },
                                    selection: { anchor: next.length },
                                })
                            return false
                        },
                        blur: (_e, v) => {
                            onLeave(v)
                            return false
                        },
                    }),
                    fieldTheme,
                    ...(props.placeholder ? [cmPlaceholder(props.placeholder)] : []),
                ],
            }),
        })
        if (props.autofocus !== false) view.focus()

        // Escape that only closed the popup must not also close a host modal (ui/Modal listens
        // for a bubbling Escape on window). A cancelling Escape still bubbles, like TextInput's.
        const capture = () => {
            popupWasOpen = !!view && completionStatus(view.state) !== null
        }
        const bubble = (e: KeyboardEvent) => {
            if (isDismissKey(e) && popupWasOpen) e.stopPropagation()
        }
        host.addEventListener('keydown', capture, true)
        host.addEventListener('keydown', bubble)
        onCleanup(() => {
            host.removeEventListener('keydown', capture, true)
            host.removeEventListener('keydown', bubble)
        })
    })

    // A value swapped in from outside while the field is idle (a refetch) replaces the text; the
    // user's own typing never round-trips through `value`, so it is never clobbered.
    createEffect(() => {
        const next = tagsToText(props.value, hash(), false)
        if (!view || view.hasFocus || next === view.state.doc.toString()) return
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
    })

    onCleanup(() => {
        destroyed = true
        view?.destroy()
    })

    return (
        <FormControl
            as="div"
            ref={host}
            class={`${styles.field} ${props.class ?? ''}`}
            data-tags-field=""
        />
    )
}

export default TagsField
