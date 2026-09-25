import {
    createSignal,
    createEffect,
    untrack,
    For,
    Show,
    type JSX,
} from 'solid-js'
import type { Row, BaseConfig } from '../../../core/src/bases/types'
import { resolveProperty } from '../../../core/src/bases/query'
import {
    propertyType,
    coercePropertyValue,
} from '../../../core/src/bases/properties'
import { renderMarkdown } from './markdown'
import { renderCell, isTagColumn } from './renderValue'
import { formatNumberDisplay } from './numberFormat'
import { columnLabel } from './columnLabel'
import { metaVisible, titleOf, writableKey } from './kanbanMeta'
import { propertyEditKind, multiselectValues } from './propertyEdit'
import { propertyRegistry } from '../propertyRegistry'
import { isConfirmKey } from '../ui/widgetKeys'
import { CardEditModal } from './CardEditModal'
import ChipToggle from '../ui/ChipToggle'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import styles from './KanbanCard.module.css'
import EmptyValue from '../ui/EmptyValue'

/**
 * The face of a kanban card: a read-only title + the view's remaining `order:` properties
 * (`metaCols`) rendered as read-only chips (only the ones that ALREADY have a value — empties
 * are dropped from the compact card face, EXCEPT booleans, which always show). A tap anywhere on
 * the card opens a focused edit MODAL (CardEditModal): tapping the title focuses the title field,
 * tapping a specific property focuses THAT property's editor, tapping the body focuses the first
 * field. The modal lists EVERY declared property (empty or not) with a type-aware editor — the
 * `markdown`/`description` property using the SAME rich Milkdown surface notes use — so a NEW
 * card's empty `description` is finally editable there (the report this fixes).
 *
 * A tap opens the modal; a drag (pointer move past a few px) is left to the card's pointer-drag
 * (KanbanView.startCardDrag), so dragging a card between columns still works.
 */
export function KanbanCard(props: {
    row: Row
    titleCol: string
    metaCols: string[]
    config: BaseConfig
    editable: boolean
    /** Whether the title field and DELETE button render at all. A stored row (one held in a
     *  base's own body, no note file behind it) is now writable by INDEX rather than by path —
     *  `KanbanView`'s `renameCard`/`deleteCard` address it via `api.rowUpdate`/`api.rowDelete`,
     *  same as a real note's `api.move`/`api.del` — so every row `KanbanView` passes down is
     *  rename/delete-capable and this stays `true`. Kept as an escape hatch (default `true`)
     *  rather than removed outright, for a future row shape that genuinely has neither a file
     *  nor a write-back index. */
    hasFileIdentity?: boolean
    /** #105: the kanban view's `hideLabels` toggle — when true, meta rows show only the
     *  value, no label caption above it. Tag rows already skip the label regardless. */
    hideLabels?: boolean
    onEditingChange: (editing: boolean) => void
    onRename: (newTitle: string) => void
    onSetMeta: (id: string, value: unknown) => void
    /** Delete this card's note (trash + undo toast) — the SOLE delete affordance for a kanban card,
     *  offered as a control inside the edit modal (no separate right-click menu). */
    onDelete: () => void
    /** Every OTHER row's raw value for a property id, across the whole board — feeds the
     *  modal editor's "select from known values" fallback. */
    siblingValues: (id: string) => unknown[]
}) {
    // Local mirror so a commit paints instantly without waiting for a refetch. Re-seed from the row
    // when the ROW's own values change (a refetch landed), NOT while the modal is open — read
    // untracked so an optimistic commit doesn't get clobbered back to stale `props.row` before the
    // server round-trips.
    const [title, setTitle] = createSignal(titleOf(props.row, props.titleCol))
    const [edit, setEdit] = createSignal<{ target?: string } | null>(null)
    createEffect(() => {
        const t = titleOf(props.row, props.titleCol)
        if (untrack(edit) === null) setTitle(t)
    })

    // Optimistic echo of just-committed meta values so the card face shows the new value instantly
    // rather than waiting for the write's refetch. Same idiom as `title` above, generalized to a map
    // since any of several meta properties may be edited (via the modal).
    const [overrides, setOverrides] = createSignal<Record<string, unknown>>({})
    createEffect(() => {
        const row = props.row // track: re-run when a fresh row lands (refetch)
        untrack(() => {
            const cur = overrides()
            const ids = Object.keys(cur)
            if (ids.length === 0) return
            let changed = false
            const next = { ...cur }
            for (const id of ids) {
                const bare = id.startsWith('note.') ? id.slice(5) : id
                const live = (row.note as Record<string, unknown>)[bare] ?? null
                if (JSON.stringify(live) === JSON.stringify(cur[id] ?? null)) {
                    delete next[id]
                    changed = true
                }
            }
            if (changed) setOverrides(next)
        })
    })
    // The row as it should currently DISPLAY: `props.row` with any not-yet-confirmed meta
    // overrides applied. `resolveProperty`'s bare/`note.`-namespaced lookups both read
    // `row.note`, so patching that object covers every id shape a meta column can use.
    const displayRow = (): Row => {
        const ov = overrides()
        const ids = Object.keys(ov)
        if (ids.length === 0) return props.row
        const note = { ...props.row.note } as Record<string, unknown>
        for (const id of ids) {
            const bare = id.startsWith('note.') ? id.slice(5) : id
            note[bare] = ov[id]
        }
        return { ...props.row, note }
    }

    // Meta columns that actually have a value on THIS row — empties render nothing at all on the
    // compact card face (the MODAL lists every declared property, empty or not), EXCEPT a
    // declared/runtime-boolean property, which always shows (see `metaVisible`).
    const visibleMeta = () =>
        props.metaCols.filter(id =>
            metaVisible(
                id,
                resolveProperty(id, displayRow()),
                propertyRegistry(),
            ),
        )

    // ── Edit modal ────────────────────────────────────────────────────────────────────────
    function openEdit(target?: string): void {
        if (!props.editable) return
        setEdit({ target })
        props.onEditingChange(true)
    }
    function closeEdit(): void {
        setEdit(null)
        props.onEditingChange(false)
    }
    /** Delete from the modal, then close it (the card is gone — nothing left to edit). */
    function commitDelete(): void {
        closeEdit()
        props.onDelete()
    }
    /** Rename from the modal's title field — optimistic mirror + persist (KanbanView.renameCard). */
    function commitRename(next: string): void {
        const t = next.trim()
        if (t && t !== titleOf(props.row, props.titleCol)) {
            setTitle(t)
            props.onRename(t)
        }
    }
    /** Persist a meta value the modal's type-aware editor produced, with an optimistic echo. `null`
     *  clears the key. When the base declares the property's type, coerce through it first (#100).
     *  `opts` (multiselect's add/remove keepOpen) is irrelevant now the editor lives in a modal —
     *  kept in the signature so the modal can pass PropertyValueEditor's onCommit through unchanged. */
    function commitMeta(
        id: string,
        value: unknown,
        _opts?: { keepOpen?: boolean },
    ): void {
        if (writableKey(id) === null) return
        const bare = id.startsWith('note.') ? id.slice(5) : id
        const current =
            (props.row.note as Record<string, unknown>)[bare] ?? null
        const t = propertyType(props.config, id)
        const next = (t ? coercePropertyValue(t, value) : value) ?? null
        if (JSON.stringify(next) === JSON.stringify(current)) return // unchanged — no write
        setOverrides(prev => ({ ...prev, [id]: next }))
        props.onSetMeta(id, next)
    }

    // ── Tap-to-edit (not drag) ──────────────────────────────────────────────────────────────
    // The card is `draggable` (KanbanView's pointer-drag), and a small pointer move is a drag, not a
    // tap. Detect the tap ourselves (pointer-up within a few px of pointer-down) and open the modal,
    // targeting whichever element carries `data-edit-target` under the cursor (title / a property id;
    // the bare card body → first field). Anything past the threshold is left to the card's drag.
    let downX = 0
    let downY = 0
    const onDown = (e: PointerEvent) => {
        downX = e.clientX
        downY = e.clientY
    }
    const tapped = (e: PointerEvent) =>
        Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) < 6
    const onUp = (e: PointerEvent) => {
        if (!props.editable || !tapped(e)) return
        const el = (e.target as HTMLElement | null)?.closest?.(
            '[data-edit-target]',
        ) as HTMLElement | null
        openEdit(el?.dataset.editTarget)
    }
    // Keyboard path for the same whole-card open — ui-confirm (rebindable, default Enter) plus a
    // hardcoded Space, the card face's own activation gesture under the WAI-ARIA button pattern
    // (role="button"), same treatment as daemon/DaemonRow.tsx. Acts like a bare-body tap (no
    // `data-edit-target` under a pointer to resolve), so it opens the modal on the first field,
    // same as `openEdit()` with no argument. Left entirely separate from `onDown`/`onUp` so the
    // pointer-based drag-vs-tap threshold logic above is untouched.
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.target !== e.currentTarget) return
        if (!props.editable) return
        if (!isConfirmKey(e) && e.key !== ' ') return
        e.preventDefault()
        openEdit()
    }

    return (
        <div
            class={styles.kbCardFace}
            classList={{ [styles.kbFaceEditable]: props.editable }}
            tabIndex={props.editable ? 0 : undefined}
            role={props.editable ? 'button' : undefined}
            aria-label={props.editable ? `Edit ${title()}` : undefined}
            onPointerDown={onDown}
            onPointerUp={onUp}
            onKeyDown={onKeyDown}
        >
            <div
                class={styles.kbCardTitle}
                classList={{ [styles.kbEditable]: props.editable }}
                data-edit-target={props.titleCol}
                title={props.editable ? 'Click to edit card' : undefined}
            >
                <Text as="span" inherit register="prose">
                    {title()}
                </Text>
            </div>

            <Show when={visibleMeta().length > 0}>
                {/* Suppress native anchor drag on meta links — it would hijack the card's pointer-drag
            (a native link-drag fires pointercancel, tearing the card drag down mid-gesture). */}
                <div
                    class={styles.kbMeta}
                    classList={{ [styles.kbMetaHideLabels]: props.hideLabels }}
                    onDragStart={e => e.preventDefault()}
                >
                    <For each={visibleMeta()}>
                        {id => {
                            const value = () =>
                                resolveProperty(id, displayRow())
                            const declType = () =>
                                propertyType(props.config, id)
                            const kind = () =>
                                propertyEditKind(
                                    id,
                                    value(),
                                    propertyRegistry(),
                                    props.siblingValues(id),
                                    declType(),
                                )
                            // Type-aware read-only display (#100): a declared `markdown` property renders as
                            // block markdown; a declared `number` through its format; a `multiselect`/`boolean`
                            // as chips. Everything else keeps the heuristic renderCell (status dots, tags, …).
                            const display = (): JSX.Element => {
                                const k = kind()
                                if (k.kind === 'markdown') {
                                    const v = value()
                                    return (
                                        <Text
                                            as="div"
                                            register="prose"
                                            size="body"
                                            tone="muted"
                                            class={styles.kbMetaMarkdown}
                                            innerHTML={renderMarkdown(
                                                v == null ? '' : String(v),
                                            )}
                                        />
                                    )
                                }
                                if (k.kind === 'number') {
                                    const v = value()
                                    if (typeof v === 'number')
                                        return (
                                            <Text
                                                as="span"
                                                inherit
                                            >
                                                {formatNumberDisplay(
                                                    v,
                                                    k.format,
                                                    k.unit,
                                                )}
                                            </Text>
                                        )
                                }
                                if (k.kind === 'boolean') {
                                    const on = value() === true
                                    return (
                                        <Text
                                            as="span"
                                            inherit
                                            class={styles.kbMetaBoolChip}
                                        >
                                            <ChipToggle selected={on}>
                                                <Icon
                                                    value={on ? 'Check' : 'Square'}
                                                />
                                                {on ? 'Yes' : 'No'}
                                            </ChipToggle>
                                        </Text>
                                    )
                                }
                                if (k.kind === 'multiselect') {
                                    const vals = multiselectValues(value())
                                    if (vals.length === 0)
                                        return (
                                            <EmptyValue />
                                        )
                                    return (
                                        <Text
                                            as="span"
                                            inherit
                                            class={
                                                styles.kbMetaMultiselectDisplay
                                            }
                                        >
                                            <For each={vals}>
                                                {t => <ChipToggle selected>{t}</ChipToggle>}
                                            </For>
                                        </Text>
                                    )
                                }
                                return renderCell(id, displayRow(), true)
                            }
                            // A row with no key spans the full grid width (acceptance 7-9):
                            // tags (self-describing) and a markdown body always; every OTHER
                            // row once `hideLabels` (#105) drops the key column too.
                            const noKey = () =>
                                isTagColumn(id) || kind().kind === 'markdown'
                            return (
                                <div
                                    class={styles.kbMetaItem}
                                    data-edit-target={id}
                                >
                                    <Show
                                        when={!noKey() && !props.hideLabels}
                                    >
                                        <Text
                                            as="span"
                                            inherit
                                            class={styles.kbMetaLabel}
                                        >
                                            {columnLabel(id, props.config)}
                                        </Text>
                                    </Show>
                                    <Text
                                        as="span"
                                        inherit
                                        class={styles.kbMetaValueWrap}
                                        classList={{
                                            [styles.kbMetaClickable]:
                                                props.editable,
                                            [styles.kbMetaSpan]:
                                                noKey() || props.hideLabels,
                                        }}
                                        title={
                                            props.editable
                                                ? 'Click to edit'
                                                : undefined
                                        }
                                    >
                                        {display()}
                                    </Text>
                                </div>
                            )
                        }}
                    </For>
                </div>
            </Show>

            <Show when={edit()}>
                {e => (
                    <CardEditModal
                        row={displayRow()}
                        titleCol={props.titleCol}
                        metaCols={props.metaCols}
                        config={props.config}
                        focusTarget={e().target}
                        siblingValues={props.siblingValues}
                        hasFileIdentity={props.hasFileIdentity}
                        onRename={commitRename}
                        onSetMeta={(id, v, opts) => commitMeta(id, v, opts)}
                        onDelete={commitDelete}
                        onClose={closeEdit}
                    />
                )}
            </Show>
        </div>
    )
}
