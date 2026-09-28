// app/src/ui/TagsField.tsx
// The field a list property (tags, or a declared `multiselect`) is edited in — typed like a
// frontmatter list, `planning, docs`, with the note editor's OWN completion popup under the value
// you are typing. No dropdown checklist, no filter box inside a popup: one line of text,
// suggestions as you type, Tab / Enter to take one.
//
// It is a single-line CodeMirror view so the popup is literally the editor's: the same
// `autocompletion()` wiring, row display (`completionDisplayConfig`), navigation keys
// (`completionNavKeymap`) and look (`completionTheme`) as the note editor and card editor. Only the
// completion SOURCE is this field's — it completes the value under the caret against the caller's
// `suggestions` (tag names, or a declared multiselect's options). The text/value logic is pure and
// lives in `tagsFieldText.ts`.
//
// Keys: typing a value opens the popup; ArrowUp/Down move; Tab (`accept-completion`,
// rebindable) or Enter takes the highlighted suggestion; Escape closes the popup — and, with no
// popup open, cancels (the keydown then bubbles, so a host modal closes too, like TextInput's
// Escape). Enter with no popup commits; so does leaving the field.
import {
    createEffect,
    onCleanup,
    onMount,
    type Component,
} from 'solid-js'
import {
    Decoration,
    EditorView,
    MatchDecorator,
    ViewPlugin,
    keymap,
    placeholder as cmPlaceholder,
    type DecorationSet,
    type ViewUpdate,
} from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
    acceptCompletion,
    autocompletion,
    completionStatus,
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
    /** A tag list: each value is drawn teal like ui/Tag while you type, and a leading `#` typed
     *  out of habit is dropped. Values are comma-separated either way. */
    tags?: boolean
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

// Every value of a tag list drawn exactly the way ui/Tag draws a tag — `#name`, teal, UI face — so
// a tag reads the same in the field as in the cell. The `#` is DRAWN (a ::before on the mark), not
// typed: the text stays `planning, docs`, which is what is saved. A value someone typed with its
// own `#` is not given a second one. A value is the run between commas, without its spaces.
const tagMark = Decoration.mark({ class: styles.tagToken })
const typedHashMark = Decoration.mark({ class: styles.tagTokenTypedHash })
const tagTokens = new MatchDecorator({
    regexp: /[^,\s](?:[^,]*[^,\s])?/g,
    decoration: m => (m[0].startsWith('#') ? typedHashMark : tagMark),
})
const tagTokenHighlight = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet
        constructor(view: EditorView) {
            this.decorations = tagTokens.createDeco(view)
        }
        update(u: ViewUpdate) {
            this.decorations = tagTokens.updateDeco(u, this.decorations)
        }
    },
    { decorations: v => v.decorations },
)

const TagsField: Component<TagsFieldProps> = props => {
    const tags = () => props.tags === true
    let host!: HTMLDivElement
    let view: EditorView | undefined
    // Every edit ends through ONE door — leaving the field. Enter blurs (commit); Escape marks the
    // edit cancelled, then blurs. The field may stay mounted afterwards (the card modal keeps every
    // field), so a later edit in the same field goes through the same door again.
    let cancelling = false
    let destroyed = false
    // Whether the person actually changed the text this edit. An edit left untouched ends as a
    // cancel — the text is NEVER re-parsed and written back, so merely opening and leaving the
    // field cannot rewrite the stored value.
    let dirty = false
    // The last list this field committed (or was handed). Escape reverts to THIS, not to
    // `props.value` — an owner may not feed a commit back in (the row editor keeps its row
    // static), and reverting past a commit would silently undo it on the next save.
    let committed = props.value
    // A click focuses the field AND places the caret where it landed — appending the separator on
    // that focus would leave the caret before it (typing then glues onto the last tag). So only a
    // keyboard/programmatic focus gets the ready-to-type separator.
    let pointerFocus = false
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
        if (cancelling || !dirty) {
            cancelling = false
            dirty = false
            setText(v, tagsToText(committed, false))
            props.onCancel()
            return
        }
        dirty = false
        const next = textToTags(v.state.doc.toString(), tags())
        committed = next
        // Tidy BEFORE reporting — the caller may unmount the field in onCommit.
        setText(v, tagsToText(next, false))
        props.onCommit(next)
    }

    // The completion source: the value under the caret, completed against `suggestions` minus
    // what the field already holds. It opens as soon as a value is being typed.
    function source(ctx: CompletionContext): CompletionResult | null {
        const before = ctx.state.sliceDoc(0, ctx.pos)
        const tok = tokenAtCaret(before)
        if (!ctx.explicit && tok.query === '') return null
        const others = textToTags(
            before.slice(0, tok.from) + ctx.state.sliceDoc(ctx.pos),
            tags(),
        )
        const ranked = rankSuggestions(props.suggestions(), tok.query, others)
        if (ranked.length === 0) return null
        return {
            from: tok.from,
            options: ranked.slice(0, 50).map(v => ({
                // A tag list's suggestions read `#name`, like every tag; the insert stays bare.
                label: tags() ? `#${v}` : v,
                apply: completionInsert(v),
            })),
            // Already ranked here — CodeMirror must not re-filter or re-sort.
            filter: false,
        }
    }

    onMount(() => {
        // An autofocused field opens ready to type (trailing separator, caret at the end); an
        // unfocused one reads finished, and gains the separator when it is focused.
        const initial = tagsToText(props.value, props.autofocus !== false)
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
                                              .replace(/\n+/g, ', '),
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
                    // Only a person's own edits (typing, deleting, pasting, taking a suggestion)
                    // make the edit dirty — the focus-time separator and value syncs do not.
                    EditorView.updateListener.of(u => {
                        if (
                            u.docChanged &&
                            u.transactions.some(
                                t =>
                                    t.isUserEvent('input') ||
                                    t.isUserEvent('delete') ||
                                    t.isUserEvent('undo') ||
                                    t.isUserEvent('redo'),
                            )
                        )
                            dirty = true
                    }),
                    EditorView.domEventHandlers({
                        mousedown: (_e, v) => {
                            // Only a click that FOCUSES the field — a click inside an already
                            // focused field would otherwise leave this set for the next focus.
                            if (!v.hasFocus) pointerFocus = true
                            return false
                        },
                        focus: (_e, v) => {
                            if (pointerFocus) {
                                pointerFocus = false
                                return false
                            }
                            const doc = v.state.doc.toString()
                            const next = withTrailingSeparator(doc)
                            if (next !== doc)
                                v.dispatch({
                                    changes: { from: doc.length, insert: next.slice(doc.length) },
                                    selection: { anchor: next.length },
                                })
                            return false
                        },
                        blur: (_e, v) => {
                            pointerFocus = false
                            onLeave(v)
                            return false
                        },
                    }),
                    fieldTheme,
                    ...(tags() ? [tagTokenHighlight] : []),
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
        committed = props.value
        const next = tagsToText(props.value, false)
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
            data-testid="tags-field"
        />
    )
}

export default TagsField
