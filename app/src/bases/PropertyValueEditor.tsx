// app/src/bases/PropertyValueEditor.tsx
// The type-aware control a kanban meta chip swaps in on click (KanbanCard.tsx): a
// `Select` for an enum / known-values property, a `TagsField` (ui/TagsField.tsx — one line of
// text with the note editor's completion popup, typed like a frontmatter `tags:` line) for a
// plain (undeclared) `tags` list or a declared `multiselect`, a multiline textarea for a declared `markdown` property (#100), and a plain
// (text/number/date-typed) input otherwise. Boolean properties never reach this
// component — the caller toggles those directly via a `Chip`, so there is no boolean
// branch here.
//
// Commits on blur or Enter (markdown: Enter inserts a newline like any textarea — only
// blur/Escape leave it); Escape reverts the draft to the ORIGINAL value first, then
// blurs — so the no-op comparison in the caller's commit handler (KanbanCard's
// `commitMeta`) skips the write, matching the title/description editors' idiom above it
// in the same file. `multiselect`/`tags` commit once too — the parsed list, on Enter or blur.
//
// A `date` kind uses DateFieldEditor (the same picker the card modal uses), not a native date input.
//
// The branches live in their own components (ListValue, SelectValue, MarkdownArea,
// DateFieldEditor, ReadonlyValue); this file owns the draft and the commit for the plain
// text/number input and dispatches by kind.
//
// A `number` kind carries its declared format (`plain`/`unit`/`currency`/`percent`) +
// unit label — the edit box always shows/accepts the EDIT-space value (percent scales
// ×100; see numberFormat.ts's module doc for the storage convention), converted back to
// the canonical stored number on commit via `parseNumberEdit`.
import { Match, Switch, createSignal, type Component } from 'solid-js'
import type { PropertyEditKind } from './propertyEdit'
import { draftCommitValue, propertyDraft } from './propertyEdit'
import { isConfirmKey, isDismissKey } from '../ui/widgetKeys'
import TextInput from '../ui/TextInput'
import DateFieldEditor from './DateFieldEditor'
import ListValue, { resetVaultTagsCache } from './ListValue'
import MarkdownArea from './MarkdownArea'
import ReadonlyValue from './ReadonlyValue'
import SelectValue from './SelectValue'
import styles from './PropertyValueEditor.module.css'

export { resetVaultTagsCache }

export type PropertyValueEditorProps = {
    kind: PropertyEditKind
    value: unknown
    // Every kind commits exactly once, when its edit ends.
    onCommit: (value: unknown) => void
    onCancel: () => void
    // Whether the control grabs focus on mount. Defaults to true (the kanban chip swaps this
    // editor in already-focused). A multi-field form (CardEditModal) sets false and manages
    // focus itself, so several editors mounting at once don't all fight to steal focus.
    autofocus?: boolean
    /** Editing in place where the value is shown (a table cell): a tags field drops its chrome
     *  and takes the host's font, so the value looks the same being edited as at rest. */
    inline?: boolean
}

/** `props.kind` narrowed to one variant, or undefined — re-read per call so the discriminated
 *  union narrows without an inline cast inside JSX. */
function narrow<K extends PropertyEditKind['kind']>(
    kind: PropertyEditKind,
    k: K,
): Extract<PropertyEditKind, { kind: K }> | undefined {
    return kind.kind === k
        ? (kind as Extract<PropertyEditKind, { kind: K }>)
        : undefined
}

export const PropertyValueEditor: Component<PropertyValueEditorProps> = props => {
    const autofocus = () => props.autofocus !== false
    const toDraft = (): string => propertyDraft(props.kind, props.value)
    const [draft, setDraft] = createSignal(toDraft())
    const commit = (): void =>
        props.onCommit(draftCommitValue(props.kind, draft()))
    // `multiselect` and `tags` share one editor (ListValue) and commit shape.
    const listKind = () => narrow(props.kind, 'multiselect') ?? narrow(props.kind, 'tags')

    return (
        <Switch
            fallback={
                <TextInput
                    class={styles.kbMetaInput}
                    type={props.kind.kind === 'number' ? 'number' : 'text'}
                    value={draft()}
                    autofocus={autofocus()}
                    // The attribute alone is honoured once per page: every editor opened after
                    // the first mounted unfocused.
                    ref={el =>
                        queueMicrotask(() => {
                            if (autofocus()) el.focus()
                        })
                    }
                    onInput={setDraft}
                    onBlur={commit}
                    onKeyDown={e => {
                        if (isConfirmKey(e)) {
                            e.preventDefault()
                            e.currentTarget.blur()
                        } else if (isDismissKey(e)) {
                            // No dropdown of our own — revert and let the keydown BUBBLE, so the
                            // modal's own Escape listener (ui/Modal.tsx) sees it too and closes
                            // the whole card, not just this field.
                            setDraft(toDraft())
                            e.currentTarget.blur()
                        }
                    }}
                />
            }
        >
            <Match when={props.kind.kind === 'readonly'}>
                <ReadonlyValue value={props.value} />
            </Match>
            <Match when={listKind()}>
                {kind => (
                    <ListValue
                        kind={kind()}
                        value={props.value}
                        autofocus={autofocus()}
                        inline={props.inline}
                        onCommit={props.onCommit}
                        onCancel={props.onCancel}
                    />
                )}
            </Match>
            <Match when={narrow(props.kind, 'select')}>
                {kind => (
                    <SelectValue
                        options={kind().options}
                        value={props.value}
                        onCommit={props.onCommit}
                        onCancel={props.onCancel}
                    />
                )}
            </Match>
            <Match when={props.kind.kind === 'markdown'}>
                <MarkdownArea
                    value={draft()}
                    autofocus={autofocus()}
                    onInput={setDraft}
                    onBlur={commit}
                    onRevert={() => setDraft(toDraft())}
                />
            </Match>
            <Match when={narrow(props.kind, 'date')}>
                {kind => (
                    <DateFieldEditor
                        time={kind().time}
                        className={styles.kbMetaDate}
                        value={props.value}
                        onCommit={props.onCommit}
                        onDismiss={props.onCancel}
                        openOnMount={autofocus()}
                    />
                )}
            </Match>
        </Switch>
    )
}
