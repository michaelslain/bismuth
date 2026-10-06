// The writes behind KanbanView, as one module: card drops, column add/rename/delete/reorder/colour,
// card add/rename/meta/delete. KanbanView keeps the signals (the optimistic overlay, the drag
// engine) and hands this module ACCESSORS to them, never values — a value captured at creation
// would be a first-render snapshot in Solid, and every write here reads the live state at call
// time. File writes go through rowWrites (commitRename / commitMeta / commitDelete / createRow /
// safeFilename); this module owns only what rowWrites cannot: Kanban's optimistic overlay, its
// per-write rollback bookkeeping and its Undo layer. No JSX imports, so it runs under `bun test`.
import type { Accessor, Setter } from 'solid-js'
import { stringify as yamlStringify } from 'yaml'
import type {
    BaseConfig,
    ResultGroup,
    Row,
    ViewResult,
} from '../../../core/src/bases/types'
import {
    placeholderFile,
    syntheticBaseFile,
} from '../../../core/src/bases/types'
import {
    declaredDefaults,
    propertyType,
} from '../../../core/src/bases/properties'
import { api } from '../api'
import { pushToast } from '../toastStore'
import { pushUndoToast } from '../undoToast'
import { parentOf } from '../fileTreeOps'
import { rowId } from './rowIdentity'
import { canWriteStoredRow, isStoredPlaceholder, storedNote } from './taskWrite'
import { writableKey } from './kanbanMeta'
import {
    groupUpdatesByPath,
    rollbackPending,
    writeStatus,
    rollbackRemoved,
} from './kanbanRollback'
import { appendOrder } from './kanbanOrder'
import {
    appendColumnKey,
    removeColumnKey,
    renameColumnKey,
    renamePropertyOption,
    reorderColumnKeys,
    withPropertyOption,
} from './kanbanColumnOrder'
import { markDeleted, unmarkDeleted, type DeletedMap } from './kanbanDelete'
import type { KanbanCardDrop } from './kanbanDrag'
import {
    commitDelete,
    commitMeta,
    commitRename,
    createRow,
    safeFilename,
} from './rowWrites'
import { clamp } from '../math'

// Frontmatter key used to persist manual within-column ordering.
export const ORDER_KEY = 'order'

// An optimistic move: the column key + order a just-dropped card should render at, before the
// backend write + refetch land. Keyed by rowId (see rowIdentity.ts).
/** `keyOnly`: clear once the card reaches `key`, whatever its stored order (a column rename
 *  moves cards without writing an order, so an order match would never come). */
export type PendingMove = { key: string; order: number; keyOnly?: boolean }

/** A just-created card shown at once in its column before the write's refetch brings the real
 *  row. `stored` is set only for an own-rows add (see KanbanView's resolve effect). */
export type PendingAdd = {
    row: Row
    col: string
    stored?: {
        priorSnapshots: Set<string>
        matchKey: string
        matchValue: unknown
    }
}

export type KanbanActionsDeps = {
    basePath: Accessor<string | undefined>
    config: Accessor<BaseConfig>
    result: Accessor<ViewResult>
    ownsRows: Accessor<boolean>
    /** Refetch the board. */
    onChange: () => void
    groupBy: Accessor<ViewResult['view']['groupBy']>
    groupColors: Accessor<Record<string, string>>
    titleCol: Accessor<string>
    editable: Accessor<boolean>
    /** The colour a column key gets with no override (status palette, else a stable hash). */
    autoColor: (key: string) => string
    columnKeys: Accessor<string[]>
    groupByKey: (key: string) => ResultGroup
    effOrder: (row: Row, group: ResultGroup) => number
    sortedRows: (group: ResultGroup) => Row[]
    /** The view's optimistic overlay signals. */
    overlay: {
        pending: Accessor<Record<string, PendingMove>>
        setPending: Setter<Record<string, PendingMove>>
        pendingAdds: Accessor<PendingAdd[]>
        setPendingAdds: Setter<PendingAdd[]>
        pendingColOrder: Accessor<string[] | null>
        setPendingColOrder: Setter<string[] | null>
        pendingRemovedCols: Accessor<Set<string>>
        setPendingRemovedCols: Setter<Set<string>>
        setDeletedIds: Setter<DeletedMap>
    }
    /** Lazy: the drag engine is built from this module's dropCard/reorderColumns, so it does
     *  not exist yet when the actions are created. */
    drag: () => {
        snapshotRects: () => void
        playFlip: () => void
        snapshotColRects: () => void
        playColFlip: () => void
    }
    closeColorPicker: () => void
    draft: Accessor<string>
    setDraft: (value: string) => void
}

/** The value `deletedIds`/`pruneDeleted` compare against for a row: a stored row's own content,
 *  `undefined` (id-only match) for a note row, whose id (its file path) is stable. */
export function deleteSnapshot(row: Row): string | undefined {
    return canWriteStoredRow(row) ? JSON.stringify(storedNote(row)) : undefined
}

export function createKanbanActions(deps: KanbanActionsDeps) {
    const o = deps.overlay
    // Paths minted this session, so two quick adds don't collide before a refetch lands.
    const created = new Set<string>()
    // Monotonic sentinel for a stored-row optimistic placeholder's `Row.index` — always
    // negative, so its rowId (`${path}#${index}`) can never collide with a real appended
    // row's (always >= 0). The real index is unknowable client-side (see matchedStoredRowId).
    let nextStoredPendingIndex = -1

    /** Roll `pendingColOrder` back to `prevOrder`, but only-if-still-mine: another column action
     * (reorder/rename/delete) may have written a newer order during this call's await, and an
     * unconditional restore would clobber that action's own in-flight state. Used by
     * addColumn/renameColumn/deleteColumn's catch blocks. */
    function rollbackColOrder(
        keys: string[],
        prevOrder: string[] | null,
    ): void {
        o.setPendingColOrder(cur => (cur === keys ? prevOrder : cur))
    }

    // Commit a card drop (called by the drag engine on pointerup, with the drag state it read).
    async function dropCard(drop: KanbanCardDrop): Promise<void> {
        const id = drop.id
        const insertAt = drop.insertAt
        const targetKey = drop.targetKey
        const from = drop.from
        if (!id || targetKey === null) return
        const gb = deps.groupBy()
        if (!gb) return
        const statusKey = writableKey(gb.property)
        const group = deps.groupByKey(targetKey)
        const dragged =
            deps
                .result()
                .groups.flatMap(g => g.rows)
                .find(r => rowId(r) === id) ??
            o.pendingAdds().find(a => rowId(a.row) === id)?.row
        if (!dragged) return
        // A placeholder card is inert until its add resolves — dragging it writes nothing.
        // Checked FIRST, before any optimistic state: the row's write-back handle (a negative
        // index) does not name a real server slot yet, so ordering it now would be racing the
        // add's own eventual index.
        if (isStoredPlaceholder(dragged)) return

        // Target column's new integer ordering — explicit orders for every card keep the sort stable
        // (a fractional-only scheme drifts). Applied OPTIMISTICALLY (see the clear-effect above).
        const others = deps.sortedRows(group).filter(r => rowId(r) !== id)
        const i = clamp(insertAt, 0, others.length)
        const newList = [...others.slice(0, i), dragged, ...others.slice(i)]
        deps.drag().snapshotRects()
        o.setPending(prev => {
            const next = { ...prev }
            newList.forEach((r, k) => {
                next[rowId(r)] = { key: targetKey, order: k }
            })
            return next
        })
        requestAnimationFrame(deps.drag().playFlip)

        // Two boards, two write APIs. A NOTE board writes frontmatter keys on N different
        // files, which is what `setProperties` batches. An OWN-ROWS board writes N rows of
        // ONE file, which is what `rowUpdateMany` batches — and `setProperty(row.file.path,
        // …)` there would write the key onto the BASE's frontmatter instead of onto the row,
        // silently corrupting the board's own config. The discriminator is the row's write-back
        // handle, exactly as it is for a task tick: `canWriteStoredRow`, never "this looks like
        // an own-rows base".
        //
        // `storedNote(r)` and not `r.note`: the view is holding NORMALIZED rows, and
        // `serializeRows` does not strip. Writing `r.note` back would bake all seven
        // computed task columns into the user's file as stale stored data.
        if (canWriteStoredRow(dragged)) {
            // The row's OWN file, not deps.basePath(): a `source:` base's rows carry
            // `syntheticBaseFile(<that base's path>)`, so deps.basePath() would silently write
            // this board's own file instead of the board it actually sources from.
            // Placeholder SIBLINGS (another pending add sharing this column, dragged around
            // only in the optimistic `pending` overlay above) are left out here — they have no
            // real server index yet, so writing one into a batch by its negative `r.index!`
            // would either 400 or, worse, collide with whatever real index the add eventually
            // resolves to. Their order stays whatever the `pending` overlay says until their
            // own add lands; only rows the server already knows about get written.
            const items = newList
                .filter(r => !isStoredPlaceholder(r))
                .map((r, k) => ({
                    path: r.file.path,
                    index: r.index!,
                    note: {
                        ...storedNote(r),
                        ...(statusKey !== null &&
                        r === dragged &&
                        from !== targetKey
                            ? { [statusKey]: targetKey }
                            : {}),
                        [ORDER_KEY]: k,
                    },
                }))
            for (const [path, group] of groupUpdatesByPath(items))
                await api.rowUpdateMany(
                    path,
                    group.map(g => ({ index: g.index, note: g.note })),
                )
            return
        }

        // ONE batched request → ONE invalidation → ONE refetch (separate writes stormed the view). The
        // status change + the dragged card's order + the reindex of shifted siblings are all folded in.
        const writes: Array<{ path: string; key: string; value: unknown }> = []
        if (statusKey !== null && from !== targetKey)
            writes.push({
                path: dragged.file.path,
                key: statusKey,
                value: targetKey,
            })
        writes.push({ path: dragged.file.path, key: ORDER_KEY, value: i })
        for (let k = 0; k < newList.length; k++) {
            const row = newList[k]
            if (rowId(row) === id) continue
            if ((row.note as Record<string, unknown>)[ORDER_KEY] !== k)
                writes.push({ path: row.file.path, key: ORDER_KEY, value: k })
        }
        await api.setProperties(writes)
    }

    // ── Card rename / meta / delete: the file writes are rowWrites'; the optimistic hide is ours. ──
    // A placeholder is not yet a row the server knows about — `canWriteStoredRow` is false for it
    // (negative index), which would fall through to a note-file write on the BASE's own file.
    // Bail before either branch.
    async function renameCard(
        row: Row,
        newTitle: string,
    ): Promise<string | undefined> {
        if (isStoredPlaceholder(row)) return row.file.path
        // A note row's target path is de-duplicated against the board's own notes, so a
        // collision gets a ` 2` suffix instead of failing the move.
        const t = newTitle.trim()
        let title = t
        if (t && !canWriteStoredRow(row) && t !== row.file.name) {
            const dir = parentOf(row.file.path)
            const desired = `${dir ? dir + '/' : ''}${safeFilename(t)}.md`
            if (desired !== row.file.path) {
                const target = dedupe(desired, takenPaths())
                title = target
                    .slice(target.lastIndexOf('/') + 1)
                    .replace(/\.md$/, '')
            }
        }
        return commitRename(row, deps.result().view, title, deps.onChange)
    }

    async function setMetaProperty(
        row: Row,
        id: string,
        value: unknown,
    ): Promise<void> {
        if (writableKey(id) === null) return
        if (isStoredPlaceholder(row)) return
        await commitMeta(row, id, value)
    }

    /** Hide the card at once (FLIP the survivors up), then delete through rowWrites. Its
     *  `onChanged` fires once when the delete lands and once more when the toast's Undo lands,
     *  so the second call drops the optimistic hide; no call at all means the delete failed
     *  (commitDelete already toasted), so the hide is reverted. */
    async function deleteCard(row: Row): Promise<void> {
        if (!deps.editable()) return
        if (isStoredPlaceholder(row)) return
        const id = rowId(row)
        deps.drag().snapshotRects()
        o.setDeletedIds(prev => markDeleted(prev, id, deleteSnapshot(row)))
        requestAnimationFrame(deps.drag().playFlip)
        let landed = 0
        const titleKey = writableKey(deps.titleCol())
        const title = String(
            (titleKey ? storedNote(row)[titleKey] : undefined) ?? 'card',
        )
        await commitDelete(
            row,
            () => {
                landed++
                if (landed > 1) o.setDeletedIds(prev => unmarkDeleted(prev, id))
            },
            title,
        )
        if (landed === 0) o.setDeletedIds(prev => unmarkDeleted(prev, id))
    }

    // ── Column reorder — persist the full visible key order to `columns` (groupOrder). ──
    async function reorderColumns(
        from: string,
        over: string,
        after: boolean,
    ): Promise<void> {
        const basePath = deps.basePath()
        if (!basePath || from === over) return
        const keys = reorderColumnKeys(deps.columnKeys(), from, over, after)
        // Optimistic: reorder instantly (FLIP the columns) so they don't snap back during the write's
        // refetch. The single `columns` write's SSE drives one refetch; the clear-effect then drops the
        // overlay (no props.onChange — a second refetch is unnecessary).
        deps.drag().snapshotColRects()
        o.setPendingColOrder(keys)
        requestAnimationFrame(deps.drag().playColFlip)
        await api.setProperty(basePath, 'columns', keys)
    }

    // The exact declared name (as it appears in `properties:`) that `propertyType` matched for
    // `property` — mirrors ITS OWN [name, bare, note.<bare>] lookup order (properties.ts) so
    // `withPropertyOption` edits the SAME entry `propertyType` just read the type off of.
    function declaredPropertyName(property: string): string | null {
        const declared = deps.config().properties
        if (!declared) return null
        const bare = property.startsWith('note.') ? property.slice(5) : property
        for (const candidate of [property, bare, `note.${bare}`])
            if (declared[candidate]) return candidate
        return null
    }

    // The base's declared `properties:` reconstructed in the FLAT list-YAML shape
    // (`{name, type, options?, ...}`) `normalizeProperties` reads back — the shape
    // `withPropertyOption` edits and `api.setProperty(basePath, 'properties', ...)` writes.
    // `deps.config().properties` already carries every field the flat form has (parsed by
    // `normalizePropertyDef`), so this round-trips losslessly at the level the engine models —
    // the same reconstruction `basePropertiesForm.ts`'s save path performs from its rows.
    function declaredPropertiesRaw(): unknown[] {
        const names = deps.config().declaredProperties
        const defs = deps.config().properties
        if (!names || !defs) return []
        return names.map(name => {
            const def = defs[name]
            const out: Record<string, unknown> = { name }
            if (def?.displayName !== undefined)
                out.displayName = def.displayName
            if (def?.hidden) out.hidden = true
            if (def?.type) {
                out.type = def.type.kind
                if (def.type.options) out.options = def.type.options
                if (def.type.number) out.number = def.type.number
                if (def.type.unit) out.unit = def.type.unit
                if (def.type.expr) out.expr = def.type.expr
            }
            if (def?.default !== undefined) out.default = def.default
            return out
        })
    }

    // ── Add column — pin a new, empty column at the end of `columns`. ──
    // Only rendered when `canAdd()` (editable + a writable groupBy) — see the trailing
    // <KanbanAddColumn> below. If the groupBy property is declared select/multiselect, the new
    // column's value is ALSO appended to that declaration's `options` so a future card dropped
    // into it (or picked from a select editor) matches the same vocabulary the column shows.
    async function addColumn(name: string): Promise<void> {
        const basePath = deps.basePath()
        if (!basePath) return
        const keys = appendColumnKey(deps.columnKeys(), name)
        if (keys === null) return
        // Optimistic, like reorderColumns: the column appears instantly (empty), settling once
        // the `columns` write's SSE-driven refetch lands. Rolled back on a failed write below —
        // otherwise deps.columnKeys() keeps rendering a phantom column with no server group forever.
        const trimmedName = name.trim()
        const prevOrder = o.pendingColOrder()
        // Captured BEFORE the rollback below clears it — this is the only place that still
        // knows the re-add was covering a pending removal, and the catch needs it to restore
        // that removal if the `columns` write never lands (mirrors renameColumn's catch).
        const targetWasRemoved = o.pendingRemovedCols().has(trimmedName)
        // Whether the `columns` write below has landed — a failure before it lands means the
        // add never happened server-side, so a removal it was covering must come back.
        let columnsLanded = false
        o.setPendingColOrder(keys)
        // A column removed then re-added inside the refetch window is still in
        // pendingRemovedCols (its own removal write's refetch hasn't landed yet), and
        // deps.columnKeys() filters every removed key out — without deleting it here the re-added
        // column would stay invisible until the OLD removal's refetch happens to clear it.
        o.setPendingRemovedCols(prev => rollbackRemoved(prev, trimmedName))
        try {
            await api.setProperty(basePath, 'columns',
                keys,
            )
            columnsLanded = true
            const gb = deps.groupBy()
            if (!gb) return
            const t = propertyType(deps.config(), gb.property)
            if (t?.kind !== 'select' && t?.kind !== 'multiselect') return
            const declName = declaredPropertyName(gb.property)
            if (!declName) return
            const updated = withPropertyOption(
                declaredPropertiesRaw(),
                declName,
                name.trim(),
            )
            if (updated) await api.setProperty(basePath, 'properties', updated)
        } catch (e) {
            // Only-if-still-mine: another column action (reorder/rename/delete) may have
            // written a newer `pendingColOrder` during this await — restoring `prevOrder`
            // unconditionally would clobber that action's own in-flight state.
            rollbackColOrder(keys, prevOrder)
            // Mirrors renameColumn's catch: this call cleared `trimmedName` out of
            // pendingRemovedCols optimistically (to un-hide the re-added column). If the
            // `columns` write never landed, the add never happened server-side — the removal
            // it was covering is still real, so put it back, or the column that was just
            // deleted reappears (hidden nowhere) until a stale refetch happens to reconcile it.
            // Once `columnsLanded`, the column genuinely exists again and must stay un-hidden.
            o.setPendingRemovedCols(prev =>
                targetWasRemoved && !columnsLanded
                    ? new Set(prev).add(trimmedName)
                    : prev,
            )
            pushToast(`Add column failed: ${(e as Error).message}`)
        }
    }

    // ── Column rename — rewrites `columns`, moves any `groupColors` override, renames a
    // declared select/multiselect option, and moves every card in the column in one batched
    // write. ──
    async function renameColumn(from: string, to: string): Promise<void> {
        const basePath = deps.basePath()
        if (!basePath) return
        const keys = renameColumnKey(deps.columnKeys(), from, to)
        if (keys === null) return
        const trimmed = to.trim()

        // Not writable (file./formula./this. groupBy) — bail before any optimistic state.
        // The header's `[✎]` rename action is gated on `canAdd()` (editable + writable groupBy),
        // but keep this belt-and-braces: without it, the `columns` write below would still
        // rename the pinned column while every card's status write is skipped (statusKey
        // null), leaving an empty new column pinned alongside the untouched old one on reload.
        const gb = deps.groupBy()
        const statusKey = gb ? writableKey(gb.property) : null
        if (statusKey === null) return

        // A view `limit` caps every group's rows (`query.ts`'s `applyLimit`), so
        // `deps.groupByKey(from).rows` can be a TRUNCATED set — renaming would move only the
        // visible cards and strand the hidden ones under the old key forever. Refuse before
        // any optimistic state.
        if (typeof deps.result().view.limit === 'number') {
            pushToast('rename unavailable // this view has a limit')
            return
        }

        // The cards to move, captured BEFORE the optimistic overlay below empties `from` — and
        // excluding stored-row PLACEHOLDERS (a negative `index`, an optimistic add not yet
        // resolved to a real row): sending one to the server as a rename target 400s, and the
        // rollback would then fire after `columns` already landed.
        const movedRows = deps
            .groupByKey(from)
            .rows.filter(r => !isStoredPlaceholder(r))

        // Optimistic, like reorderColumns/addColumn: the renamed column shows instantly, the old
        // key is hidden (deps.columnKeys() would otherwise re-append it while the server still reports
        // it) and its cards render under the new key through the card overlay. All rolled back on
        // any failed write below — a partial rename otherwise leaves the column showing its new
        // name while the server still has the old one, permanently out of sync.
        // Whether `from` was ALREADY hidden before this call — if so, this call didn't add it
        // and must not remove it on rollback (some other in-flight action owns that removal).
        const alreadyRemoved = o.pendingRemovedCols().has(from)
        const targetWasRemoved = o.pendingRemovedCols().has(trimmed)
        const prevOrder = o.pendingColOrder()
        // The exact entries THIS call is about to write into `pending`, so a rollback can undo
        // only these (by `===` identity) rather than clobbering an overlay entry another
        // action wrote during this call's await.
        const writtenPending: Record<string, PendingMove> = {}
        movedRows.forEach((r, k) => {
            const o = (r.note as Record<string, unknown>)[ORDER_KEY]
            writtenPending[rowId(r)] = {
                key: trimmed,
                order: typeof o === 'number' ? o : k,
                keyOnly: true,
            }
        })
        // Whether the `columns` write below has landed — once it has, the column itself is
        // already renamed server-side, so a failure afterward is a PARTIAL failure: the overlays
        // still roll back, but the toast says `partially applied`, `deps.onChange()` refetches
        // the server's already-renamed state, and `trimmed`'s prior removal is not restored.
        let columnsLanded = false
        o.setPendingColOrder(keys)
        o.setPendingRemovedCols(prev =>
            rollbackRemoved(prev, trimmed).add(from),
        )
        o.setPending(prev => ({ ...prev, ...writtenPending }))
        try {
            await api.setProperty(basePath, 'columns', keys)
            columnsLanded = true

            // Move a color override from the old key to the new one, if it had one. When there
            // was none, a rename-carried color counts as an override ONLY when it has to: the
            // auto color hashes the KEY, so leaving `groupColors` untouched would silently
            // recolor the column via a hash-of-`trimmed` slot instead of keeping `from`'s — but
            // when the new key happens to auto-color the same as the old one, writing an
            // override would show a plain rename as a custom color the user never chose. Skip
            // the write entirely when `groupColors` would come out unchanged either way.
            const colors = deps.groupColors()
            const next = { ...colors }
            let colorsChanged = false
            if (colors[from] !== undefined) {
                next[trimmed] = next[from]!
                delete next[from]
                colorsChanged = true
            } else if (deps.autoColor(trimmed) !== deps.autoColor(from)) {
                next[trimmed] = deps.autoColor(from)
                colorsChanged = true
            }
            if (colorsChanged)
                await api.setProperty(basePath, 'groupColors', next)

            // Declared select/multiselect option rename — mirrors addColumn's append.
            const t = gb ? propertyType(deps.config(), gb.property) : null
            if (gb && (t?.kind === 'select' || t?.kind === 'multiselect')) {
                const declName = declaredPropertyName(gb.property)
                if (declName) {
                    const updated = renamePropertyOption(
                        declaredPropertiesRaw(),
                        declName,
                        from,
                        trimmed,
                    )
                    if (updated)
                        await api.setProperty(basePath, 'properties', updated)
                }
            }

            // Move every card currently in the renamed column — ONE batched write per write
            // TARGET (a file path), same two-target split as dropCard/setMetaProperty
            // (`canWriteStoredRow`). statusKey is non-null here — guarded at the top of the
            // function. A stored row's write target is ITS OWN `file.path` (a `source:` base's
            // rows carry `syntheticBaseFile(<that base's path>)` — never `basePath`
            // blindly, which would land on the wrong base for a `source:` board), so the
            // updates are grouped by path and issued one `rowUpdateMany` call per path — one
            // call total for an own-rows board, where every row shares the same path.
            await writeStatus(movedRows, statusKey, trimmed)
            deps.onChange()
        } catch (e) {
            rollbackColOrder(keys, prevOrder)
            o.setPendingRemovedCols(prev => {
                const s = rollbackRemoved(prev, alreadyRemoved ? null : from)
                return targetWasRemoved && !columnsLanded
                    ? new Set(s).add(trimmed)
                    : s
            })
            o.setPending(prev => rollbackPending(prev, writtenPending))
            if (columnsLanded) {
                deps.onChange()
                pushToast(
                    `Rename column partially applied: ${(e as Error).message}`,
                )
            } else {
                pushToast(`Rename column failed: ${(e as Error).message}`)
            }
        }
    }

    // ── Column delete — the header's `[🗑]` now shows on EVERY column, not only an empty one.
    // An empty column deletes exactly as before: drop the key from `columns` (+ any
    // `groupColors` override). A non-empty column ALSO clears the grouping value off every one
    // of its cards first — same batched-write shape as renameColumn's card move, just targeting
    // '' (the no-value/"(empty)" lane) instead of a new name — so the cards survive, landing
    // wherever a card with no value already renders, and offers an Undo that re-adds the column
    // and puts each card's value back. ──
    async function deleteColumn(key: string): Promise<void> {
        const basePath = deps.basePath()
        if (!basePath) return
        // Cards to clear, captured BEFORE the optimistic overlay below hides `key` — excluding
        // stored-row PLACEHOLDERS (an optimistic add not yet resolved to a real row), same
        // exclusion renameColumn applies to `movedRows`.
        const cardRows = deps
            .groupByKey(key)
            .rows.filter(r => !isStoredPlaceholder(r))
        let statusKey: string | null = null
        if (cardRows.length > 0) {
            const gb = deps.groupBy()
            statusKey = gb ? writableKey(gb.property) : null
            // Not writable (file./formula./this. groupBy) — bail before any optimistic state.
            // The header's `[🗑]` is gated on `canAdd()` (editable + writable groupBy), but keep
            // this belt-and-braces, mirroring renameColumn.
            if (statusKey === null) return
            // A view `limit` truncates `deps.groupByKey(key).rows` — clearing would move only the
            // visible cards and strand the rest under a column that no longer exists.
            if (typeof deps.result().view.limit === 'number') {
                pushToast('delete unavailable // this view has a limit')
                return
            }
        }
        // Captured for Undo: where the column sat and its colour override, both removed below.
        const prevKeys = deps.columnKeys()
        const prevIndex = prevKeys.indexOf(key)
        const prevColor = deps.groupColors()[key]
        const keys = removeColumnKey(deps.columnKeys(), key)
        const alreadyRemoved = o.pendingRemovedCols().has(key)
        const prevOrder = o.pendingColOrder()
        const writtenPending: Record<string, PendingMove> = {}
        cardRows.forEach((r, k) => {
            writtenPending[rowId(r)] = { key: '', order: k, keyOnly: true }
        })
        let columnsLanded = false
        // Optimistic, like add/rename: the column disappears instantly (its cards' overlay moves
        // them into the '' lane in the same tick). Both rolled back on a failed write — otherwise
        // the column vanishes from the UI for good even though the server still has it, or worse,
        // deps.columnKeys() keeps hiding a key the server never lost.
        o.setPendingColOrder(keys)
        o.setPendingRemovedCols(prev => new Set(prev).add(key))
        if (cardRows.length > 0)
            o.setPending(prev => ({ ...prev, ...writtenPending }))
        try {
            await api.setProperty(basePath, 'columns', keys)
            columnsLanded = true
            const colors = deps.groupColors()
            if (colors[key] !== undefined) {
                const next = { ...colors }
                delete next[key]
                if (Object.keys(next).length === 0)
                    await api.deleteProperty(basePath, 'groupColors')
                else
                    await api.setProperty(basePath, 'groupColors',
                        next,
                    )
            }
            if (cardRows.length > 0 && statusKey !== null) {
                // The cards lose the grouping key entirely (they fall into the no-value lane) —
                // never an empty string, which a declared `select` would read as invalid.
                await writeStatus(cardRows, statusKey, undefined)
            }
            deps.onChange()
            if (cardRows.length > 0 && statusKey !== null) {
                const movedStatusKey = statusKey
                pushUndoToast(
                    `deleted column ${key === '' ? '(empty)' : key}`,
                    () =>
                        undoDeleteColumn(
                            key,
                            movedStatusKey,
                            cardRows,
                            prevIndex,
                            prevKeys,
                            prevColor,
                        ),
                )
            }
        } catch (e) {
            rollbackColOrder(keys, prevOrder)
            o.setPendingRemovedCols(prev =>
                rollbackRemoved(prev, alreadyRemoved ? null : key),
            )
            if (cardRows.length > 0)
                o.setPending(prev => rollbackPending(prev, writtenPending))
            if (columnsLanded) {
                deps.onChange()
                pushToast(
                    `Delete column partially applied: ${(e as Error).message}`,
                )
                return
            }
            pushToast(`Delete column failed: ${(e as Error).message}`)
        }
    }

    /** Undo for a non-empty column's delete: put the column back WHERE it was (with its colour
     *  override), and give each cleared card its grouping value back — re-reading every card as
     *  it is NOW, so an edit made between the delete and the Undo survives. A card that has since
     *  been given some other value, or has gone, is left alone. */
    async function undoDeleteColumn(
        key: string,
        statusKey: string,
        cardRows: Row[],
        prevIndex: number,
        prevKeys: string[],
        prevColor: string | undefined,
    ): Promise<void> {
        const basePath = deps.basePath()
        if (!basePath) return
        // The delete's own optimistic hide must not outlive the Undo (if the Undo lands before
        // the delete's refetch, the column would otherwise stay hidden until a remount).
        o.setPendingRemovedCols(prev => {
            const next = new Set(prev)
            next.delete(key)
            return next
        })
        const current = new Map(
            deps
                .result()
                .groups.flatMap(g => g.rows)
                .map(r => [rowId(r), r]),
        )
        const stillCleared = (r: Row | undefined): r is Row =>
            !!r && ((r.note as Record<string, unknown>)[statusKey] ?? '') === ''
        // Failures propagate to pushUndoToast, which toasts `undo failed`.
        {
            // The delete moved the cards into the '' no-value lane; that lane is only a real
            // column if it was one before.
            const cols = deps
                .columnKeys()
                .filter(k => k !== key && (k !== '' || prevKeys.includes('')))
            const at =
                prevIndex < 0 ? cols.length : Math.min(prevIndex, cols.length)
            await api.setProperty(basePath, 'columns', [
                ...cols.slice(0, at),
                key,
                ...cols.slice(at),
            ])
            if (prevColor !== undefined)
                await api.setProperty(basePath, 'groupColors', {
                    ...deps.groupColors(),
                    [key]: prevColor,
                })
            const live = cardRows
                .map(r => current.get(rowId(r)))
                .filter(stillCleared)
            await writeStatus(live, statusKey, key)
            deps.onChange()
        }
    }

    // ── Column color — persist/clear an override in `groupColors`. ──
    async function setColColor(
        key: string,
        color: string | null,
    ): Promise<void> {
        const basePath = deps.basePath()
        if (!basePath) return
        deps.closeColorPicker()
        const next = { ...deps.groupColors() }
        if (color === null) delete next[key]
        else next[key] = color
        if (Object.keys(next).length === 0)
            await api.deleteProperty(basePath, 'groupColors')
        else await api.setProperty(basePath, 'groupColors', next)
        deps.onChange()
    }

    // ── Add card — create a note in the board's folder with the column's status set. ──
    function boardFolder(): string {
        const first = deps.result().groups.flatMap(g => g.rows)[0]
        if (first) return parentOf(first.file.path)
        return deps.basePath()?.replace(/\.md$/, '') ?? ''
    }
    // Frontmatter shared by EVERY existing card (e.g. `board`, or a `tags` array the base filters
    // on) — copied onto new cards so they keep matching the base's source/filter. Compared by value
    // (JSON) so array/object fields count as equal across notes, and carried through as-is (the YAML
    // serializer handles arrays/objects). Excludes only the status/order keys — `description` is no
    // longer special-cased (#103), so a fresh card only "inherits" one when every existing card
    // happens to share the identical text (the normal constProps rule for any property).
    function constProps(exclude: Set<string>): Record<string, unknown> {
        const rows = deps.result().groups.flatMap(g => g.rows)
        if (rows.length === 0) return {}
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(rows[0].note)) {
            if (exclude.has(k) || v == null) continue
            const s = JSON.stringify(v)
            if (
                rows.every(
                    r =>
                        JSON.stringify(
                            (r.note as Record<string, unknown>)[k],
                        ) === s,
                )
            )
                out[k] = v
        }
        return out
    }

    const takenPaths = (): Set<string> =>
        new Set([
            ...deps
                .result()
                .groups.flatMap(g => g.rows)
                .map(r => r.file.path),
            ...created,
        ])
    // Resolve a non-colliding path against the board's own notes + this session's fresh adds. (A
    // same-named note the board's FILTER hides isn't covered — but for the common folder-scoped
    // board every note is a visible row, and there's no reliable client-side disk-existence probe:
    // /file and /meta both 200 for missing paths.)
    function dedupe(desired: string, taken: Set<string>): string {
        if (!taken.has(desired)) return desired
        const stem = desired.replace(/\.md$/, '')
        for (let n = 2; ; n++) {
            const cand = `${stem} ${n}.md`
            if (!taken.has(cand)) return cand
        }
    }
    async function addCard(colKey: string): Promise<void> {
        const title = deps.draft().trim()
        const gb = deps.groupBy()
        const statusKey = gb ? writableKey(gb.property) : null
        if (!title || !statusKey) return

        // Use an existing card's actual (typed) status value for this column when there is one, so a
        // numeric/boolean groupBy writes the same type as its siblings (a stringified key would fail
        // a numeric filter / type-aware sort). Fall back to the string key for an empty column.
        const sibling = deps.result().groups.find(g => g.key === colKey)
            ?.rows[0]
        const statusValue = sibling
            ? (sibling.note as Record<string, unknown>)[statusKey]
            : colKey

        // Pin the new card to the BOTTOM of its column with an explicit `order` strictly after every
        // current sort key (#93). Without it the card rendered at the bottom optimistically, then
        // teleported into the middle once the refetch landed: the real row's indexOf fallback
        // interleaved with the siblings' explicit drag-written orders. Computed over the DISPLAYED
        // group (effOrder), so back-to-back adds stack in insertion order — each sees the previous
        // optimistic card's order. (appendOrder is pure + unit-tested in kanbanOrder.test.ts.)
        const grp = deps.groupByKey(colKey)
        const orderVal = appendOrder(grp.rows.map(r => deps.effOrder(r, grp)))

        // The title column's writable key. On a normal (file-backed) board `deps.titleCol()` is
        // `'file.name'`, a computed pseudo-property with no writable key, so this stays a
        // no-op there. On a `deps.ownsRows()` (stored-row) board `deps.titleCol()` is
        // `storedTitleColumn`'s pick — always writable — so the composer's typed title lands
        // under that key below, same as every other property here.
        const titleKey = writableKey(deps.titleCol())
        const exclude = new Set([statusKey, ORDER_KEY])
        if (titleKey) exclude.add(titleKey)

        // Declared property defaults (list-form `properties:`) seed first; frontmatter shared by
        // every existing card overrides them (a new card must keep matching the base's filter),
        // the clicked column's status value wins, and the appended `order` pins it to the bottom.
        const front: Record<string, unknown> = {
            ...declaredDefaults(deps.config(), exclude),
            ...constProps(exclude),
            [statusKey]: statusValue ?? colKey,
            [ORDER_KEY]: orderVal,
            ...(titleKey ? { [titleKey]: title } : {}),
        }

        // The board owns its rows (no `source:`): a new card is a ROW in the base file's own
        // body, not a note file — same split as `dropCard`/`setMetaProperty` (`canWriteStoredRow`,
        // never "this looks like an own-rows base"). The optimistic placeholder must NOT claim a
        // file path (there is no note being created): it shares the base's own synthetic file,
        // same as every other stored row (`rowIdentity.ts`), so `rowId` addresses it consistently.
        //
        // Its `index` is a negative sentinel, NOT a guess at the row's real position — the
        // server appends to the base file's raw row array (rowOps.ts), which this view's
        // filtered/grouped `deps.result()` cannot predict (a `filters:` block, or any row this
        // view drops, throws a positional guess off). `matchedStoredRowId` (the resolve effect
        // above) finds the real row once it lands, by "new since this add + carries the
        // written value" instead of by index.
        if (deps.ownsRows()) {
            const basePath = deps.basePath()
            if (!basePath) return
            // Content-keyed, not id-keyed — see `matchedStoredRowId`'s doc for why an id set
            // breaks under a delete landing between this add and its resolve.
            const priorSnapshots = new Set(
                deps
                    .result()
                    .groups.flatMap(g => g.rows)
                    .map(r => JSON.stringify(storedNote(r))),
            )
            const optimistic: Row = {
                file: syntheticBaseFile(basePath),
                note: { ...front },
                formula: {},
                index: nextStoredPendingIndex--,
            }
            deps.setDraft('')
            o.setPendingAdds(prev => [
                ...prev,
                {
                    row: optimistic,
                    col: colKey,
                    stored: {
                        priorSnapshots,
                        matchKey: statusKey,
                        matchValue: statusValue ?? colKey,
                    },
                },
            ])
            try {
                await createRow({
                    config: deps.config(),
                    basePath,
                    ownsRows: true,
                    note: front,
                })
            } catch (e) {
                // Drop exactly this call's placeholder (matched by its own optimistic index —
                // never "the last pendingAdds entry", which could belong to a different add
                // that raced in during this await) so a failed add never leaves a permanent
                // ghost card.
                o.setPendingAdds(prev =>
                    prev.filter(a => a.row.index !== optimistic.index),
                )
                pushToast(`Add card failed: ${(e as Error).message}`)
            }
            return
        }

        const folder = boardFolder()
        const content = `---\n${yamlStringify(front)}---\n`
        const path = dedupe(
            `${folder ? folder + '/' : ''}${safeFilename(title)}.md`,
            takenPaths(),
        )
        const name = safeFilename(title)

        // Show the card OPTIMISTICALLY so it appears the instant you hit Enter — then just write the
        // file. No deps.onChange(): a PUT /file doesn't bump the version, so an eager refetch would
        // read stale rows; the file-watcher's debounced SSE refetch brings the real row and the
        // clear-effect drops the optimistic one (path-keyed → the card never blinks). Not gated on the
        // write being in flight: draft is cleared synchronously (a double-Enter no-ops on the empty
        // title) and `created` de-collides paths, so rapid successive adds each land instead of the
        // next Enter being silently dropped while the previous PUT round-trips (#93). No await-return
        // that would bounce the active tab — the file-watcher SSE, not a tab switch, brings the row in.
        const optimistic: Row = {
            file: placeholderFile(name, path),
            note: { ...front },
            formula: {},
        }
        created.add(path)
        deps.setDraft('')
        o.setPendingAdds(prev => [...prev, { row: optimistic, col: colKey }])
        await api.write(path, content)
    }
    return {
        dropCard,
        reorderColumns,
        addColumn,
        renameColumn,
        deleteColumn,
        setColColor,
        renameCard,
        setMetaProperty,
        deleteCard,
        addCard,
    }
}
