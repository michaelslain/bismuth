// app/src/daemon/DaemonLog.tsx
// The daemon page's activity log panel: one DaemonLogRow per event, newest first as `events`
// already arrives (api.daemonLogs()). A row's line unfolds its detail (one open at a time, kept
// open across re-polls by logDetail.ts's `eventKey`); from there the row acts on the log file the
// event lives in: `[ open ]` it, `[ copy path ]`, or `[ delete ]` the entry. `limit` row-caps the
// list behind a `+N more` line that opens the section; `variant="full"` shows every row grouped
// under day labels (logDays.ts).
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { ActivityEvent } from '../../../core/src/daemonActivity'
import DaemonSection from './DaemonSection'
import DaemonMoreLine from './DaemonMoreLine'
import DaemonLogRow from './DaemonLogRow'
import Text from '../ui/Text'
import { groupByDay } from './logDays'
import { eventKey, logPath } from './logDetail'
import type { RowLimit } from './daemonRowBudget'
import styles from './DaemonLog.module.css'

export type DaemonLogProps = {
    /** 'box' (default): the capped list inside its DaemonSection box. 'full': every row, no box
     *  of its own — the opened section's DaemonTakeover supplies the heading. */
    variant?: 'box' | 'full'
    /** Opens this section full screen — the box heading, its open button and its more-line call it. */
    onOpenSection?: () => void
    events: ActivityEvent[]
    limit?: RowLimit
    /** Opens a vault path — here an event's log file. Omitted → no `[ open ]`. */
    onOpen?: (path: string) => void
    /** Copies an event's log file path (vault-relative). Omitted → no `[ copy path ]`. */
    onCopyPath?: (path: string) => void
    /** Removes one event from its log file. Omitted → no `[ delete ]`. */
    onDelete?: (e: ActivityEvent) => Promise<void>
    class?: string
}

function DaemonLog(props: DaemonLogProps) {
    const now = () => new Date()
    const [openKey, setOpenKey] = createSignal<string | null>(null)

    const visible = () => props.events
    const limited = createMemo(
        () => props.limit !== undefined && visible().length > props.limit,
    )
    const shown = createMemo(() =>
        props.limit === undefined
            ? visible()
            : visible().slice(0, props.limit),
    )
    const days = createMemo(() => groupByDay(visible(), now()))

    const row = (e: ActivityEvent, clock = false) => {
        const key = eventKey(e)
        const path = logPath(e)
        return (
            <DaemonLogRow
                event={e}
                now={now()}
                clock={clock}
                expanded={openKey() === key}
                onToggle={() => setOpenKey(k => (k === key ? null : key))}
                onOpenLog={
                    path && props.onOpen ? () => props.onOpen!(path) : undefined
                }
                onCopyPath={
                    path && props.onCopyPath
                        ? () => props.onCopyPath!(path)
                        : undefined
                }
                onDelete={
                    path && props.onDelete ? () => props.onDelete!(e) : undefined
                }
            />
        )
    }

    return (
        <Show
            when={props.variant === 'full'}
            fallback={
                <DaemonSection
                    title="log"
                    empty="nothing logged yet"
                    isEmpty={props.events.length === 0}
                    onOpen={props.onOpenSection}
                    class={props.class}
                >
                    <For each={shown()}>{e => row(e)}</For>
                    <Show when={limited()}>
                        <DaemonMoreLine
                            label={`+${visible().length - (props.limit as number)} more`}
                            onOpen={() => props.onOpenSection?.()}
                        />
                    </Show>
                </DaemonSection>
            }
        >
            <div
                data-testid="daemon-log-full"
                class={`${styles['log-full']} ${props.class ?? ''}`}
            >
                <Show
                    when={visible().length > 0}
                    fallback={<Text tone="muted">nothing logged yet</Text>}
                >
                    <For each={days()}>
                        {d => (
                            <>
                                <Text
                                    size="micro"
                                    tone="muted"
                                    class={styles['log-day']}
                                >
                                    {d.label}
                                </Text>
                                <For each={d.events}>{e => row(e, true)}</For>
                            </>
                        )}
                    </For>
                </Show>
            </div>
        </Show>
    )
}

export default DaemonLog
