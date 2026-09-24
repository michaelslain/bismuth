import { For, Index, Show } from 'solid-js'
import type { ViewResult, BaseConfig, Row } from '../../../core/src/bases/types'
import { resolveProperty } from '../../../core/src/bases/query'
import { renderValue, isTaskRow } from './renderValue'
import { groupColor } from '../ui/StatusDot'
import TaskRow from './TaskRow'
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
}) {
    const firstCol = (): string => props.result.columns[0] ?? 'file.name'
    const authorCol = (): string | undefined => props.result.columns[1]
    const rightCol = (): string | undefined => props.result.columns[2]

    const open = (row: Row) =>
        window.dispatchEvent(
            new CustomEvent('bismuth-open', { detail: row.file.path }),
        )

    const toggle = (row: Row, e: Event) => props.onToggle?.(row, e)
    const setStatus = (row: Row, e: MouseEvent) => props.onSetStatus?.(row, e)

    return (
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
                            <div
                                class={styles.lghead}
                                style={{ color: groupColor(group().key) }}
                            >
                                <Text as="span" inherit class={styles.dot} />
                                {group().key}
                                <Text
                                    as="span"
                                    size="inherit"
                                    tone="faint"
                                    weight="inherit"
                                >
                                    // {group().rows.length}
                                </Text>
                            </div>
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

                                const title = resolveProperty(firstCol(), row)
                                const author = authorCol()
                                    ? resolveProperty(authorCol()!, row)
                                    : null
                                return (
                                    <PlainButton
                                        class={styles.lrow}
                                        onClick={() => open(row)}
                                    >
                                        <Text
                                            as="span"
                                            inherit
                                            class={styles.ltextGlyph}
                                            aria-hidden="true"
                                        >
                                            ✎
                                        </Text>
                                        <Label fill>
                                            {title == null
                                                ? row.file.name
                                                : String(title)}
                                            <Show
                                                when={
                                                    author != null &&
                                                    typeof author !== 'object'
                                                }
                                            >
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
                                                {renderValue(rightCol()!, row)}
                                            </Text>
                                        </Show>
                                    </PlainButton>
                                )
                            }}
                        </For>
                    </div>
                )}
            </Index>
        </div>
    )
}
