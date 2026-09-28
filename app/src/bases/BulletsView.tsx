import { For, Index, Show } from 'solid-js'
import type { ViewResult, BaseConfig, Row } from '../../../core/src/bases/types'
import { renderTitle } from './renderValue'
import TaskRow from './TaskRow'
import PlainButton from '../ui/PlainButton'
import { canWriteStoredRow } from './taskWrite'
import { useRowEditor } from './useRowEditor'
import GroupHeader from '../ui/GroupHeader'
import EmptyState from '../ui/EmptyState'
import styles from './BulletsView.module.css'

/**
 * Plain markdown-style bullet list: one <li> per row (the first column, rendered as a
 * clickable link), grouped under each group key as a heading. No table chrome, no
 * column header, no per-row icons — reads like the note's own `- item` prose. Used for
 * reading-quote lists where the table UI is overkill.
 *
 * In tasks mode the <li> body becomes <TaskRow> instead — the same checkbox, description and
 * field chips every other row view renders — so "tasks mode" means one thing regardless of
 * the view KIND. Normal-mode rendering is untouched.
 */
export function BulletsView(props: {
    result: ViewResult
    config: BaseConfig
    // See ListView for why the mode and the write seam arrive as props rather than being
    // re-derived here: BaseView owns the one pair of handlers that knows both origins.
    mode?: 'normal' | 'tasks'
    onToggle?: (row: Row, e: Event) => void
    onSetStatus?: (row: Row, e: MouseEvent) => void
    /** The base file, so a bullet can open the row/property editor — same gate as
     *  TableView's/ListView's. */
    basePath?: string
    /** Refetch after a row edit/delete lands — BaseView's `refetchAll`. */
    onChange?: () => void
}) {
    const col = (): string => props.result.columns[0] ?? 'file.name'
    // TASKS MODE IS A DECLARATION, NOT A SHAPE. This branches on `props.mode`, never on
    // `isTaskRow(row, mode)` — that helper ALSO returns true for a row merely SHAPED like a
    // task, which is right for ListView (it has rendered task lines off the shape since long
    // before this mode existed) and wrong here: an existing `source: tasks` base with no
    // `mode:` key would silently stop being this view kind at all.
    const isTasks = () => props.mode === 'tasks'
    const toggle = (row: Row, e: Event) => props.onToggle?.(row, e)
    const setStatus = (row: Row, e: MouseEvent) => props.onSetStatus?.(row, e)
    const editor = useRowEditor({
        config: () => props.config,
        view: () => props.result.view,
        columns: () => props.result.columns,
        onChanged: () => props.onChange?.(),
    })
    const rowEditable = (row: Row) => !!props.basePath && editor.editable(row)
    const openEditor = (row: Row) => editor.open(row)
    const empty = () => props.result.groups.every(g => g.rows.length === 0)
    return (
        <Show
            when={!empty()}
            fallback={
                <EmptyState title="no rows">
                    nothing in this view matches its filters
                </EmptyState>
            }
        >
            <div class={styles.bullets}>
                {/* Index-keyed groups (see ListView): the inner reference-keyed row <For> is the only
          thing that diffs on a re-resolve, so no full-list remount flash on a task toggle. */}
                <Index each={props.result.groups}>
                    {group => (
                        <div class={styles.bulletGroup}>
                            <Show when={group().key !== ''}>
                                <GroupHeader
                                    class={styles.bulletGroupHead}
                                    label={group().key}
                                    count={group().rows.length}
                                />
                            </Show>
                            <ul class={styles.bulletList}>
                                <For each={group().rows}>
                                    {row => (
                                        <li
                                            class={styles.bulletItem}
                                            onContextMenu={e => {
                                                if (!rowEditable(row)) return
                                                e.preventDefault()
                                                e.stopPropagation()
                                                openEditor(row)
                                            }}
                                        >
                                            <Show
                                                when={isTasks()}
                                                fallback={
                                                    <div
                                                        class={
                                                            styles.bulletRowWrap
                                                        }
                                                    >
                                                        <Show
                                                            when={
                                                                rowEditable(
                                                                    row,
                                                                ) &&
                                                                canWriteStoredRow(
                                                                    row,
                                                                )
                                                            }
                                                            fallback={renderTitle(
                                                                col(),
                                                                row,
                                                            )}
                                                        >
                                                            <PlainButton
                                                                class={
                                                                    styles.bulletBtn
                                                                }
                                                                onClick={() =>
                                                                    openEditor(
                                                                        row,
                                                                    )
                                                                }
                                                            >
                                                                {renderTitle(
                                                                    col(),
                                                                    row,
                                                                )}
                                                            </PlainButton>
                                                        </Show>
                                                    </div>
                                                }
                                            >
                                                <TaskRow
                                                    row={row}
                                                    variant="card"
                                                    onToggle={toggle}
                                                    onSetStatus={setStatus}
                                                />
                                            </Show>
                                        </li>
                                    )}
                                </For>
                            </ul>
                        </div>
                    )}
                </Index>
            </div>
        </Show>
    )
}
