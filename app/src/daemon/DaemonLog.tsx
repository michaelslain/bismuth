// app/src/daemon/DaemonLog.tsx
// The daemon page's activity log panel: one mono row per event (`time  who  what  duration`),
// newest first as `events` already arrives (api.daemonLogs()). Formatting is entirely
// activityLine.ts's job — this component only renders what that returns. `limit` row-caps the
// list (newest-first order is unchanged) behind a `+N more // show` line; the log no longer
// scrolls on its own — the whole right column has one scroll.
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { ActivityEvent } from '../../../core/src/daemonActivity'
import activityLine from './activityLine'
import DaemonSection from './DaemonSection'
import DaemonMoreLine from './DaemonMoreLine'
import Text from '../ui/Text'
import type { RowLimit } from './daemonRowBudget'
import styles from './DaemonLog.module.css'

export type DaemonLogProps = {
    events: ActivityEvent[]
    limit?: RowLimit
    class?: string
}

function DaemonLog(props: DaemonLogProps) {
    const now = () => new Date()
    const [expanded, setExpanded] = createSignal(false)
    const limited = createMemo(
        () => props.limit !== undefined && props.events.length > props.limit,
    )
    const shown = createMemo(() =>
        props.limit === undefined || expanded()
            ? props.events
            : props.events.slice(0, props.limit),
    )
    return (
        <DaemonSection
            title="log"
            empty="nothing logged yet"
            isEmpty={props.events.length === 0}
            class={props.class}
        >
            <For each={shown()}>
                {e => {
                    const line = activityLine(e, now())
                    return (
                        <div
                            class={styles['log-row']}
                            classList={{
                                [styles['tone-fail']]: line.tone === 'fail',
                                [styles['tone-live']]: line.tone === 'live',
                                [styles['tone-quiet']]:
                                    line.tone === 'quiet',
                                [styles['tone-ok']]: line.tone === 'ok',
                            }}
                        >
                            <Text
                                as="span"
                                inherit
                                class={styles['log-time']}
                            >
                                {line.time}
                            </Text>
                            <Text
                                as="span"
                                inherit
                                class={styles['log-who']}
                            >
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
                            <Text
                                as="span"
                                inherit
                                class={styles['log-duration']}
                            >
                                {line.duration ?? ''}
                            </Text>
                        </div>
                    )
                }}
            </For>
            <Show when={limited()}>
                <DaemonMoreLine
                    label={
                        expanded()
                            ? `all ${props.events.length}`
                            : `+${props.events.length - (props.limit as number)} more`
                    }
                    open={expanded()}
                    onToggle={() => setExpanded(v => !v)}
                />
            </Show>
        </DaemonSection>
    )
}

export default DaemonLog
