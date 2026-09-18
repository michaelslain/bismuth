import { For, Index, Show } from 'solid-js'
import type { ViewResult, BaseConfig, Row } from '../../../core/src/bases/types'
import { renderValue } from './renderValue'
import TaskRow from './TaskRow'
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
    return (
        <div class={styles.bullets}>
            {/* Index-keyed groups (see ListView): the inner reference-keyed row <For> is the only
          thing that diffs on a re-resolve, so no full-list remount flash on a task toggle. */}
            <Index each={props.result.groups}>
                {group => (
                    <div class={styles.bulletGroup}>
                        <Show when={group().key !== ''}>
                            <div class={styles.bulletGroupHead}>
                                {group().key}
                            </div>
                        </Show>
                        <ul class={styles.bulletList}>
                            <For each={group().rows}>
                                {row => (
                                    <li class={styles.bulletItem}>
                                        <Show
                                            when={isTasks()}
                                            fallback={renderValue(col(), row)}
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
    )
}
