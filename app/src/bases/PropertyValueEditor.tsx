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
// A `number` kind carries its declared format (`plain`/`unit`/`currency`/`percent`) +
// unit label — the edit box always shows/accepts the EDIT-space value (percent scales
// ×100; see numberFormat.ts's module doc for the storage convention), converted back to
// the canonical stored number on commit via `parseNumberEdit`.
import { Show, createSignal, onMount } from 'solid-js'
import Select from '../ui/Select'
import TagsField from '../ui/TagsField'
import type { PropertyEditKind } from './propertyEdit'
import {
    multiselectCommitValue,
    multiselectValues,
    selectOptionsWithCurrent,
} from './propertyEdit'
import { numberEditValue, parseNumberEdit } from './numberFormat'
import { isConfirmKey, isDismissKey } from '../ui/widgetKeys'
import TextInput from '../ui/TextInput'
import Text from '../ui/Text'
import { api } from '../api'
import { mergeTagOptions, vaultTagNames } from './tagSuggestions'
import styles from './PropertyValueEditor.module.css'

/** Grow a textarea to fit its content (no scrollbar). Local to this file: KanbanCard.tsx once
 *  carried an identical copy, but its version was deleted along with the rest of the dead
 *  `kbDesc*` markup, so there is no longer a second copy for this one to be "duplicated from". */
// The vault's tag names as of the last fetch, shared by every tags editor — a field suggests the
// last-known set at once, then the refreshed set once its own fetch lands (suggestions are read
// per keystroke).
let lastVaultTags: string[] = []
// One graph fetch shared by every tags field for 30s — opening cell after cell must not
// re-download the whole vault graph each time just to read its tag names.
let vaultTagsFetch: { at: number; tags: Promise<string[]> } | null = null
function fetchVaultTags(): Promise<string[]> {
    if (!vaultTagsFetch || Date.now() - vaultTagsFetch.at > 30_000)
        vaultTagsFetch = {
            at: Date.now(),
            tags: api.graph().then(vaultTagNames),
        }
    return vaultTagsFetch.tags
}
/** Forget the cached vault tags — for a story that swaps in its own fake graph. */
export function resetVaultTagsCache(): void {
    vaultTagsFetch = null
    lastVaultTags = []
}

function autoGrow(el: HTMLTextAreaElement): void {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
}

export function PropertyValueEditor(props: {
    kind: PropertyEditKind
    value: unknown
    // Every kind commits exactly once, when its edit ends.
    onCommit: (value: unknown) => void
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
    // A `tags` editor suggests every tag in the vault — the SAME source the note editor's `#tag`
    // and frontmatter `tags:` completion read (the graph's `tag` nodes; App.tsx's
    // `tagCandidates`) — after this column's and this row's own values (`kind.options`).
    const [vaultTags, setVaultTags] = createSignal(lastVaultTags)
    onMount(() => {
        if (props.kind.kind !== 'tags' || !props.kind.tag) return
        fetchVaultTags()
            .then(tags => {
                lastVaultTags = tags
                setVaultTags(tags)
            })
            .catch(() => {
                vaultTagsFetch = null
                // offline / no graph yet — the column's own values still stand
            })
    })
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
    // `multiselect` and `tags` share one editor (ui/TagsField) and commit shape: a comma-separated
    // line. A tag column's field is drawn in the tag look and suggests the column's values then
    // the vault's; any other list suggests its own column's values; a declared `multiselect`
    // suggests only its options — a typed value outside them is still kept (legacy tolerance).
    const listKind = () => {
        const k = props.kind
        if (k.kind === 'multiselect') return { options: k.options, tag: false }
        if (k.kind === 'tags')
            return {
                options: mergeTagOptions(k.options, k.tag ? vaultTags() : []),
                tag: k.tag,
            }
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

    // A `readonly` value (a list of numbers/links, or a comma inside a comma-separated value) has
    // no editor that can round-trip it — shown as-is, never committed, so opening it is harmless.
    const readonlyText = (): string => {
        const show = (v: unknown): string =>
            v && typeof v === 'object'
                ? String(
                      (v as { display?: unknown; path?: unknown }).display ??
                          (v as { path?: unknown }).path ??
                          JSON.stringify(v),
                  )
                : String(v)
        const v = props.value
        return v == null ? '' : Array.isArray(v) ? v.map(show).join(', ') : show(v)
    }

    return (
        <Show
            when={props.kind.kind !== 'readonly'}
            fallback={
                <Text
                    as="span"
                    tone="muted"
                    title="Not editable here — edit this property in the note"
                >
                    {readonlyText()}
                </Text>
            }
        >
            <Show
                when={listKind()}
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
                {lk => (
                    <TagsField
                        value={multiselectValues(props.value)}
                        suggestions={() => lk().options}
                        tags={lk().tag}
                        autofocus={autofocus()}
                        onCommit={next => props.onCommit(multiselectCommitValue(next))}
                        onCancel={props.onCancel}
                    />
                )}
            </Show>
        </Show>
    )
}
