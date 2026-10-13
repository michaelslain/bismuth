// app/src/daemon/DaemonLogRow.tsx
// One daemon log event: the mono `time  who  what  note  duration` line (activityLine.ts formats it;
// the note says why it ran, why it failed or what it reported),
// which is a button that unfolds the event's detail underneath — the second-precision time, kind,
// exact duration and cause (logDetail.ts), any detail text the daemon wrote (error output), and
// `[ only <name> ]` / `[ open ]` actions. Only the line toggles; clicks inside the detail never
// collapse it, so its text can be selected. The actions stop their click: `[ only … ]` unmounts
// itself before the click bubbles, and the log box (DaemonSection) opens the section on any click
// it cannot trace to an item still inside it.
import { Show } from 'solid-js'
import type { ActivityEvent } from '../../../core/src/daemonActivity'
import activityLine from './activityLine'
import { clockTime } from './logDays'
import { detailMeta } from './logDetail'
import PlainButton from '../ui/PlainButton'
import Text from '../ui/Text'
import { TextButton } from '../ui/TextButton'
import styles from './DaemonLogRow.module.css'

export type DaemonLogRowProps = {
    event: ActivityEvent
    now: Date
    /** Opened log: the time cell is a clock (`HH:MM`) under a day label. */
    clock?: boolean
    expanded: boolean
    onToggle: () => void
    /** Narrows the log to this event's owner. Omitted → no `[ only … ]` action. */
    onFilter?: () => void
    /** Opens this event's cron/service definition. Omitted → no `[ open ]` action. */
    onOpenDefinition?: () => void
    class?: string
}

function DaemonLogRow(props: DaemonLogRowProps) {
    const line = () => activityLine(props.event, props.now)
    const hasActions = () =>
        props.onFilter !== undefined || props.onOpenDefinition !== undefined

    return (
        <div
            class={`${styles.entry} ${props.class ?? ''}`}
            classList={{
                [styles['tone-fail']]: line().tone === 'fail',
                [styles['tone-live']]: line().tone === 'live',
                [styles['tone-ok']]: line().tone === 'ok',
            }}
            data-expanded={props.expanded ? '' : undefined}
            data-testid="daemon-log-row"
        >
            <PlainButton
                class={styles.line}
                aria-expanded={props.expanded}
                onClick={() => props.onToggle()}
            >
                <Text as="span" inherit class={styles.time}>
                    {props.clock ? clockTime(props.event.ts) : line().time}
                </Text>
                <Text as="span" inherit class={styles.who}>
                    {line().who}
                </Text>
                <Text as="span" inherit class={styles.what}>
                    {line().what}
                </Text>
                <Text
                    as="span"
                    inherit
                    class={styles.note}
                    classList={{ [styles['note-wrap']]: props.clock }}
                    title={line().note ?? undefined}
                >
                    {line().note ?? ''}
                </Text>
                <Text as="span" inherit class={styles.duration}>
                    {line().duration ?? ''}
                </Text>
            </PlainButton>
            <Show when={props.expanded}>
                <div class={styles.detail} data-testid="daemon-log-detail">
                    <Text as="span" size="micro" tone="muted">
                        {detailMeta(props.event)}
                    </Text>
                    <Show when={props.event.detail}>
                        {d => (
                            <Text as="span" size="micro" inherit class={styles.text}>
                                {d()}
                            </Text>
                        )}
                    </Show>
                    <Show when={hasActions()}>
                        <div class={styles.actions}>
                            <Show when={props.onFilter}>
                                {f => (
                                    <TextButton
                                        onClick={e => {
                                            e.stopPropagation()
                                            f()()
                                        }}
                                    >
                                        {`only ${props.event.name}`}
                                    </TextButton>
                                )}
                            </Show>
                            <Show when={props.onOpenDefinition}>
                                {o => (
                                    <TextButton
                                        onClick={e => {
                                            e.stopPropagation()
                                            o()()
                                        }}
                                    >
                                        open
                                    </TextButton>
                                )}
                            </Show>
                        </div>
                    </Show>
                </div>
            </Show>
        </div>
    )
}

export default DaemonLogRow
