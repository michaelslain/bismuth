import { openNote } from '../ui/openNote'
import {
    createSignal,
    createEffect,
    untrack,
    For,
    Show,
} from 'solid-js'
import type { Row, BaseConfig } from '../../../core/src/bases/types'
import { resolveProperty } from '../../../core/src/bases/query'
import { propertyType } from '../../../core/src/bases/properties'
import { isTagColumn } from './columnKinds'
import { columnLabel } from './columnLabel'
import { metaVisible, titleOf, writableKey } from './kanbanMeta'
import { canWriteStoredRow } from './taskWrite'
import { propertyEditKind } from './propertyEdit'
import { propertyRegistry } from '../propertyRegistry'
import { isActivateKey } from '../ui/widgetKeys'
import { CardEditModal } from './CardEditModal'
import ChipToggle from '../ui/ChipToggle'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import styles from './KanbanCard.module.css'
import PropertyDisplay from './PropertyDisplay'
import {
    applyOverrides,
    bareKey,
    coerceMeta,
    reconcileOverrides,
    withOverride,
    type Overrides,
} from './kanbanOverrides'

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
    /** Resolves to the row's note path AFTER the rename lands (or the unchanged path when
     *  nothing moved) — `[open note]` waits on this instead of racing a stale pre-rename path. */
    onRename: (newTitle: string) => Promise<string | undefined>
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
    // `[open note]` must not race a pending rename (see `commitRename`) — tracked as a promise
    // chain, same idiom as `openRowEditor.tsx`'s `notePath`.
    let notePath: Promise<string> = Promise.resolve(props.row.file.path)
    createEffect(() => {
        const t = titleOf(props.row, props.titleCol)
        if (untrack(edit) === null) setTitle(t)
    })

    // Optimistic echo of just-committed meta values so the card face shows the new value instantly
    // rather than waiting for the write's refetch. Same idiom as `title` above, generalized to a map
    // since any of several meta properties may be edited (via the modal).
    const [overrides, setOverrides] = createSignal<Overrides>({})
    createEffect(() => {
        const row = props.row // track: re-run when a fresh row lands (refetch)
        untrack(() => {
            const cur = overrides()
            const next = reconcileOverrides(cur, row)
            if (next !== cur) setOverrides(next)
        })
    })
    // The row as it should currently DISPLAY: `props.row` with any not-yet-confirmed meta
    // overrides applied.
    const displayRow = (): Row => applyOverrides(props.row, overrides())

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
    // A task-line row's `file` is the containing NOTE, not the task (a `source: tasks` board
    // can reach `KanbanCard` without declaring `mode: tasks`) — opening the shared row editor
    // for one would title itself with the note, rename the whole file, and let `delete` trash
    // it. See TableView/BulletsView/CardsView's same guard.
    const taskLine = () => typeof props.row.note.line === 'number'
    function openEdit(target?: string): void {
        if (!props.editable || taskLine()) return
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
    /** Rename from the modal's title field — optimistic mirror + persist (KanbanView.renameCard).
     *  Tracks the resolved note path in `notePath` so a `[open note]` click racing this rename
     *  waits on the real destination instead of dispatching a stale pre-rename path. */
    function commitRename(next: string): void {
        const t = next.trim()
        if (t && t !== titleOf(props.row, props.titleCol)) {
            setTitle(t)
            notePath = props.onRename(t).then(p => p ?? props.row.file.path)
        }
    }
    /** Persist a meta value the modal's type-aware editor produced, with an optimistic echo. `null`
     *  clears the key. When the base declares the property's type, coerce through it first (#100). */
    function commitMeta(id: string, value: unknown): void {
        if (writableKey(id) === null) return
        const current =
            (props.row.note as Record<string, unknown>)[bareKey(id)] ?? null
        const next = coerceMeta(props.config, id, value)
        if (JSON.stringify(next) === JSON.stringify(current)) return // unchanged — no write
        setOverrides(prev => withOverride(prev, id, next))
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
    // Keyboard path for the same whole-card open — Enter/Space (`isActivateKey`), the card face's
    // own activation gesture under the WAI-ARIA button pattern (role="button"). Acts like a
    // bare-body tap (no `data-edit-target` to resolve), so it opens the modal on the first field.
    // Separate from `onDown`/`onUp` so the pointer drag-vs-tap threshold logic is untouched.
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.target !== e.currentTarget) return
        if (!props.editable) return
        if (!isActivateKey(e)) return
        e.preventDefault()
        openEdit()
    }
    // Right-click opens the same edit modal a tap does — a whole-card affordance, not tied to
    // whichever element sits under the pointer, so no `data-edit-target` resolution here (opens
    // on the first field, same as a bare-body tap). No drag to guard against: a contextmenu event
    // never follows a pointer-drag gesture, but preventDefault still suppresses the native menu
    // and stopPropagation keeps KanbanView's own row-level context menu from also firing.
    const onContextMenu = (e: MouseEvent) => {
        if (!props.editable) return
        e.preventDefault()
        e.stopPropagation()
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
            onContextMenu={onContextMenu}
        >
            <Text
                as="div"
                inherit
                class={styles.kbCardTitle}
                classList={{ [styles.kbEditable]: props.editable }}
                data-edit-target={props.titleCol}
                title={props.editable ? 'Click to edit card' : undefined}
            >
                <Text as="span" inherit register="prose">
                    {title()}
                </Text>
            </Text>

            <Show when={visibleMeta().length > 0}>
                {/* Suppress native anchor drag on meta links — it would hijack the card's pointer-drag
            (a native link-drag fires pointercancel, tearing the card drag down mid-gesture). */}
                <Text
                    as="div"
                    inherit
                    class={styles.kbMeta}
                    classList={{ [styles.kbMetaHideLabels]: props.hideLabels }}
                    onDragStart={(e: DragEvent) => e.preventDefault()}
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
                            // The boolean stays a ChipToggle (its own control look); every other
                            // read-only value is the shared, type-aware PropertyDisplay (#100).
                            const display = () =>
                                kind().kind === 'boolean' ? (
                                    <ChipToggle selected={value() === true}>
                                        <Icon
                                            value={
                                                value() === true ? 'Check' : 'Square'
                                            }
                                        />
                                        {value() === true ? 'Yes' : 'No'}
                                    </ChipToggle>
                                ) : (
                                    <PropertyDisplay
                                        {...{ id }}
                                        row={displayRow()}
                                        config={props.config}
                                        markdown={kind().kind === 'markdown'}
                                        dense
                                    />
                                )
                            // A row with no key spans the full grid width (acceptance 7-9):
                            // tags (self-describing) and a markdown body always; every OTHER
                            // row once `hideLabels` (#105) drops the key column too.
                            const noKey = () =>
                                isTagColumn(id) || kind().kind === 'markdown'
                            return (
                                <Text
                                    as="div"
                                    inherit
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
                                </Text>
                            )
                        }}
                    </For>
                </Text>
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
                        onSetMeta={commitMeta}
                        onDelete={commitDelete}
                        onClose={closeEdit}
                        onOpenNote={
                            canWriteStoredRow(props.row)
                                ? undefined
                                : () =>
                                      void notePath.then(path =>
                                          openNote(path),
                                      )
                        }
                    />
                )}
            </Show>
        </div>
    )
}
