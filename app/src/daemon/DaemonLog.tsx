// app/src/daemon/DaemonLog.tsx
// The daemon page's activity log panel: one mono row per event (`time  who  what  duration`),
// newest first as `events` already arrives (api.daemonLogs()). Formatting is entirely
// activityLine.ts's job — this component only renders what that returns. `limit` row-caps the
// list (newest-first order is unchanged) behind a `+N more` line that opens the section; `variant="full"`
// shows every row grouped under day labels (logDays.ts).
import { createMemo, For, Show } from 'solid-js'
import type { ActivityEvent } from '../../../core/src/daemonActivity'
import activityLine from './activityLine'
import DaemonSection from './DaemonSection'
import DaemonMoreLine from './DaemonMoreLine'
import Text from '../ui/Text'
import { clockTime, groupByDay } from './logDays'
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
    class?: string
}

function DaemonLog(props: DaemonLogProps) {
    const now = () => new Date()
    const limited = createMemo(
        () => props.limit !== undefined && props.events.length > props.limit,
    )
    const shown = createMemo(() =>
        props.limit === undefined
            ? props.events
            : props.events.slice(0, props.limit),
    )
    const days = createMemo(() => groupByDay(props.events, now()))

    const row = (e: ActivityEvent, clock = false) => {
        const line = activityLine(e, now())
        return (
            <div
                class={styles['log-row']}
                classList={{
                    [styles['tone-fail']]: line.tone === 'fail',
                    [styles['tone-live']]: line.tone === 'live',
                    [styles['tone-ok']]: line.tone === 'ok',
                }}
            >
                <Text as="span" inherit class={styles['log-time']}>
                    {clock ? clockTime(e.ts) : line.time}
                </Text>
                <Text as="span" inherit class={styles['log-who']}>
                    {line.who}
                </Text>
                <Text
                    as="span"
                    inherit
                    class={styles['log-what']}
                    title={line.what}
                >
                    {line.what}
                </Text>
                <Text as="span" inherit class={styles['log-duration']}>
                    {line.duration ?? ''}
                </Text>
            </div>
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
                            label={`+${props.events.length - (props.limit as number)} more`}
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
                    when={props.events.length > 0}
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
