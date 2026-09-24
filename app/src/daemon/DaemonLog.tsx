// app/src/daemon/DaemonLog.tsx
// The daemon page's activity log panel: one mono row per event (`time  who  what  duration`),
// newest first as `events` already arrives (api.daemonLogs()). Formatting is entirely
// activityLine.ts's job — this component only renders what that returns.
import { For } from 'solid-js'
import type { ActivityEvent } from '../../../core/src/daemonActivity'
import activityLine from './activityLine'
import DaemonSection from './DaemonSection'
import Text from '../ui/Text'
import styles from './DaemonLog.module.css'

export type DaemonLogProps = {
    events: ActivityEvent[]
    class?: string
}

function DaemonLog(props: DaemonLogProps) {
    const now = () => new Date()
    return (
        <DaemonSection
            title="log"
            empty="nothing logged yet"
            isEmpty={props.events.length === 0}
            fill
            class={props.class}
        >
            <For each={props.events}>
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
                                size="inherit"
                                tone="inherit"
                                weight="inherit"
                                class={styles['log-time']}
                            >
                                {line.time}
                            </Text>
                            <Text
                                as="span"
                                size="inherit"
                                tone="inherit"
                                weight="inherit"
                                class={styles['log-who']}
                            >
                                {line.who}
                            </Text>
                            <Text
                                as="span"
                                size="inherit"
                                tone="inherit"
                                weight="inherit"
                                class={styles['log-what']}
                                title={line.what}
                            >
                                {line.what}
                            </Text>
                            <Text
                                as="span"
                                size="inherit"
                                tone="inherit"
                                weight="inherit"
                                class={styles['log-duration']}
                            >
                                {line.duration ?? ''}
                            </Text>
                        </div>
                    )
                }}
            </For>
        </DaemonSection>
    )
}

export default DaemonLog
