// app/src/bases/PropertyValueEditor.tsx
// The type-aware control a kanban meta chip swaps in on click (KanbanCard.tsx): a
// `Select` for an enum / known-values property, a `MultiSelect` (ui/MultiSelect.tsx) for
// a declared `multiselect` or a plain (undeclared) `tags` list — the latter `creatable`,
// a multiline textarea for a declared `markdown` property (#100), and a plain
// (text/number/date-typed) input otherwise. Boolean properties never reach this
// component — the caller toggles those directly via a `Chip`, so there is no boolean
// branch here.
//
// Commits on blur or Enter (markdown: Enter inserts a newline like any textarea — only
// blur/Escape leave it); Escape reverts the draft to the ORIGINAL value first, then
// blurs — so the no-op comparison in the caller's commit handler (KanbanCard's
// `commitMeta`) skips the write, matching the title/description editors' idiom above it
// in the same file. `multiselect`/`tags` are the kinds that stay open across several
// writes (each toggle is naturally multi-step) — see MultiSelect's own doc for how its
// `onChange` maps onto `{ keepOpen: true }` below.
//
// A `number` kind carries its declared format (`plain`/`unit`/`currency`/`percent`) +
// unit label — the edit box always shows/accepts the EDIT-space value (percent scales
// ×100; see numberFormat.ts's module doc for the storage convention), converted back to
// the canonical stored number on commit via `parseNumberEdit`.
import { Show, createSignal } from 'solid-js'
import Select from '../ui/Select'
import MultiSelect from '../ui/MultiSelect'
import type { PropertyEditKind } from './propertyEdit'
import {
    multiselectCommitValue,
    multiselectValues,
    selectOptionsWithCurrent,
} from './propertyEdit'
import { numberEditValue, parseNumberEdit } from './numberFormat'
import { isConfirmKey, isDismissKey } from '../ui/widgetKeys'
import TextInput from '../ui/TextInput'
import styles from './PropertyValueEditor.module.css'

/** Grow a textarea to fit its content (no scrollbar). Local to this file: KanbanCard.tsx once
 *  carried an identical copy, but its version was deleted along with the rest of the dead
 *  `kbDesc*` markup, so there is no longer a second copy for this one to be "duplicated from". */
function autoGrow(el: HTMLTextAreaElement): void {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
}

export function PropertyValueEditor(props: {
    kind: PropertyEditKind
    value: unknown
    // `opts.keepOpen` (set by the multiselect/tags branch below, for its toggle writes)
    // tells the caller (KanbanCard's `commitMeta`) to persist the value WITHOUT closing the
    // editor — every other kind commits exactly once and always closes, so they simply
    // omit it.
    onCommit: (value: unknown, opts?: { keepOpen?: boolean }) => void
    onCancel: () => void
    // Whether the control grabs focus on mount. Defaults to true (the kanban chip swaps this
    // editor in already-focused). A multi-field form (CardEditModal) sets false and manages
    // focus itself, so several editors mounting at once don't all fight to steal focus.
    autofocus?: boolean
}) {
    const autofocus = () => props.autofocus !== false
    const toDraft = (): string => {
        const k = props.kind
        if (props.value == null) return ''
        if (k.kind === 'date')
            return String(props.value).slice(0, k.time ? 16 : 10)
        if (k.kind === 'number') {
            const n =
                typeof props.value === 'number'
                    ? props.value
                    : Number(props.value)
            return Number.isFinite(n)
                ? String(numberEditValue(n, k.format))
                : String(props.value)
        }
        return String(props.value)
    }
    const [draft, setDraft] = createSignal(toDraft())
    // Captured by the markdown textarea's ref so onInput's autoGrow can reach the raw
    // element — TextInput's onInput only hands back the string value.
    let markdownAreaEl: HTMLTextAreaElement | undefined

    function commit(): void {
        const k = props.kind
        const raw = draft().trim()
        if (k.kind === 'number') {
            if (raw === '') {
                props.onCommit(null)
                return
            }
            const n = parseNumberEdit(raw, k.format)
            // Unparseable input keeps the raw string rather than silently dropping the edit —
            // KanbanCard's commitMeta coerces through the declared type as a second pass.
            props.onCommit(n === null ? raw : n)
            return
        }
        props.onCommit(raw === '' ? null : raw)
    }

    // Narrow once so the branches below get typed `options` without an inline cast —
    // `props.kind` re-derefs on every read, which would otherwise lose the discriminated-
    // union narrowing inside JSX.
    const selectKind = () => (props.kind.kind === 'select' ? props.kind : null)
    // `multiselect` and `tags` share the exact same editor (ui/MultiSelect) and commit
    // shape — they differ only in whether an unmatched filter is `creatable`.
    const multiSelectKind = () => {
        const k = props.kind
        if (k.kind === 'multiselect')
            return { options: k.options, creatable: false }
        if (k.kind === 'tags') return { options: k.options, creatable: true }
        return null
    }

    // Legacy tolerance (#101): a stored value the base's `options:` list doesn't (or no
    // longer) declare must still show up as the CURRENT selection rather than silently
    // reading as "(clear)" — so a hand-edited or since-removed option is prepended to the
    // menu, still chosen, still one click from being replaced or cleared.
    const selectOptions = () => {
        const sk = selectKind()
        if (!sk) return []
        const current = props.value == null ? '' : String(props.value)
        const opts = selectOptionsWithCurrent(sk.options, current)
        return [
            { value: '', label: '(clear)' },
            ...opts.map(v => ({ value: v, label: v })),
        ]
    }

    return (
        <Show
            when={multiSelectKind()}
            fallback={
                <Show
                    when={selectKind()}
                    fallback={
                        <Show
                            when={props.kind.kind === 'markdown'}
                            fallback={
                                <TextInput
                                    class={styles.kbMetaInput}
                                    type={
                                        props.kind.kind === 'number'
                                            ? 'number'
                                            : props.kind.kind === 'date'
                                              ? props.kind.time
                                                  ? 'datetime-local'
                                                  : 'date'
                                              : 'text'
                                    }
                                    value={draft()}
                                    autofocus={autofocus()}
                                    // The attribute alone is honoured once per page: every
                                    // editor opened after the first mounted unfocused.
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
                                            // No dropdown of our own — revert and let the
                                            // keydown BUBBLE, so the modal's own Escape
                                            // listener (ui/Modal.tsx) sees it too and closes
                                            // the whole card, not just this field.
                                            setDraft(toDraft())
                                            e.currentTarget.blur()
                                        }
                                    }}
                                />
                            }
                        >
                            <TextInput
                                multiline
                                class={styles.kbMetaMarkdownArea}
                                value={draft()}
                                autofocus={autofocus()}
                                ref={el => {
                                    markdownAreaEl = el
                                    queueMicrotask(() => {
                                        if (autofocus()) el.focus()
                                        autoGrow(el)
                                    })
                                }}
                                onInput={v => {
                                    setDraft(v)
                                    if (markdownAreaEl) autoGrow(markdownAreaEl)
                                }}
                                onBlur={commit}
                                onKeyDown={e => {
                                    // Enter inserts a newline (multiline body) — only Escape/blur leave the editor.
                                    // No dropdown of our own — revert and let it bubble (see
                                    // the sibling text-input branch above).
                                    if (isDismissKey(e)) {
                                        setDraft(toDraft())
                                        e.currentTarget.blur()
                                    }
                                }}
                            />
                        </Show>
                    }
                >
                    <div class={styles.kbMetaSelect}>
                        <Select
                            value={
                                props.value == null ? '' : String(props.value)
                            }
                            options={selectOptions()}
                            onChange={v => props.onCommit(v === '' ? null : v)}
                            onDismiss={props.onCancel}
                            class={styles.kbMetaSelectTrigger}
                        />
                    </div>
                </Show>
            }
        >
            {mk => (
                <MultiSelect
                    value={multiselectValues(props.value)}
                    options={mk().options}
                    creatable={mk().creatable}
                    open
                    onChange={next =>
                        props.onCommit(multiselectCommitValue(next), {
                            keepOpen: true,
                        })
                    }
                    onClose={props.onCancel}
                />
            )}
        </Show>
    )
}
