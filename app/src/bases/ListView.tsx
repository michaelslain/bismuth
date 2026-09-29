import { For, Index, Show } from 'solid-js'
import type { JSX } from 'solid-js'
import type { ViewResult, BaseConfig, Row } from '../../../core/src/bases/types'
import { resolveProperty } from '../../../core/src/bases/query'
import { renderCell } from './renderValue'
import { isTaskRow } from './columnKinds'
import { titleOf } from './kanbanMeta'
import { useRowEditor } from './useRowEditor'
import TaskRow from './TaskRow'
import GroupHeader from '../ui/GroupHeader'
import EmptyState from '../ui/EmptyState'
import NoteLink from '../ui/NoteLink'
import Label from '../ui/Label'
import Text from '../ui/Text'
import PlainButton from '../ui/PlainButton'
import styles from './ListView.module.css'

export function ListView(props: {
    result: ViewResult
    config: BaseConfig
    // The view's mode (core/src/bases/types.ts's viewMode()). In tasks mode every row is a
    // task by declaration; in normal mode a row still qualifies by shape if it came from a
    // `source: tasks` query. Defaults to normal so a caller that has not been threaded yet
    // keeps exactly its current behaviour.
    mode?: 'normal' | 'tasks'
    // The write seam, defined ONCE in BaseView and passed down: it is the half that has to
    // know whether the row came from a note's checkbox line or from a base's own row table,
    // and every row view needs the identical pair. Optional because a story (or an embedded
    // read-only surface) may render rows with no destination to write to — the box then
    // renders and does nothing, which is the same degraded state a row with no write handle
    // gets from `canWriteStoredRow`.
    onToggle?: (row: Row, e: Event) => void
    onSetStatus?: (row: Row, e: MouseEvent) => void
    /** The base file, so a row can open the row/property editor — same gate as TableView's. */
    basePath?: string
    /** Refetch after a row edit/delete lands — BaseView's `refetchAll`. */
    onChange?: () => void
}) {
    const firstCol = (): string => props.result.columns[0] ?? 'file.name'
    const authorCol = (): string | undefined => props.result.columns[1]
    const rightCol = (): string | undefined => props.result.columns[2]

    const editor = useRowEditor({
        config: () => props.config,
        view: () => props.result.view,
        columns: () => props.result.columns,
        onChanged: () => props.onChange?.(),
    })
    const rowEditable = (row: Row) => !!props.basePath && editor.editable(row)
    // A row STORED in a base's own body has no note to open (its `file` is the base itself).
    const linkable = (row: Row) => !Number.isInteger(row.index)
    const empty = () => props.result.groups.every(g => g.rows.length === 0)

    /** The row's contents: title (+ faint author) and the right-hand meta column. Shared by the
     *  editable row (a button that opens the editor) and the plain row (whose title is a NoteLink
     *  — an anchor may not nest inside a button, so the two containers differ, the body does not). */
    const rowBody = (row: Row): JSX.Element => {
        const author = authorCol() ? resolveProperty(authorCol()!, row) : null
        return (
            <>
                <Label fill>
                    <Show
                        when={!rowEditable(row) && linkable(row)}
                        fallback={titleOf(row, firstCol())}
                    >
                        <NoteLink path={row.file.path} tone="title">
                            {titleOf(row, firstCol())}
                        </NoteLink>
                    </Show>
                    <Show when={author != null && typeof author !== 'object'}>
                        <Text
                            as="span"
                            size="inherit"
                            tone="faint"
                            weight="inherit"
                        >
                            {' '}
                            — {String(author)}
                        </Text>
                    </Show>
                </Label>
                <Show when={rightCol()}>
                    <Text
                        as="span"
                        size="inherit"
                        tone="muted"
                        weight="inherit"
                        class={styles.lrowRight}
                    >
                        {renderCell(rightCol()!, row, false, props.config)}
                    </Text>
                </Show>
            </>
        )
    }

    const toggle = (row: Row, e: Event) => props.onToggle?.(row, e)
    const setStatus = (row: Row, e: MouseEvent) => props.onSetStatus?.(row, e)

    return (
        <Show
            when={!empty()}
            fallback={
                <EmptyState title="no rows">
                    nothing in this view matches its filters
                </EmptyState>
            }
        >
            <div class={styles.list}>
                {/* Groups are index-keyed (Index, not For): a re-resolve mints a new group OBJECT
          whenever its row set changes (toggle/add/remove), and a reference-keyed <For> would
          dispose+remount the whole group subtree — discarding every row identity reconcileRows
          preserved (the "whole list reloads" flash). Index keeps the group's DOM mounted and
          hands a reactive `group()` accessor, so only the inner reference-keyed <For> over the
          rows diffs — and just the changed row repaints. */}
                <Index each={props.result.groups}>
                    {group => (
                        <div class={styles.lgroup}>
                            <Show when={group().key !== ''}>
                                <GroupHeader
                                    class={styles.lghead}
                                    label={group().key}
                                    count={group().rows.length}
                                />
                            </Show>
                            <For each={group().rows}>
                                {row => {
                                    // Task rows render as a native checkbox line (see TaskRow).
                                    if (isTaskRow(row, props.mode ?? 'normal'))
                                        return (
                                            <TaskRow
                                                row={row}
                                                onToggle={toggle}
                                                onSetStatus={setStatus}
                                            />
                                        )

                                    return (
                                        <Show
                                            when={rowEditable(row)}
                                            fallback={
                                                <div class={styles.lrow}>
                                                    {rowBody(row)}
                                                </div>
                                            }
                                        >
                                            <PlainButton
                                                class={styles.lrow}
                                                onClick={() => editor.open(row)}
                                                onContextMenu={e => {
                                                    e.preventDefault()
                                                    e.stopPropagation()
                                                    editor.open(row)
                                                }}
                                            >
                                                {rowBody(row)}
                                            </PlainButton>
                                        </Show>
                                    )
                                }}
                            </For>
                        </div>
                    )}
                </Index>
            </div>
        </Show>
    )
}
