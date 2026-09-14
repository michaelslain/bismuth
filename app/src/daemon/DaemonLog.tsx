// app/src/daemon/DaemonLog.tsx
// The daemon page's activity log panel: one mono row per event (`time  who  what  duration`),
// newest first as `events` already arrives (api.daemonLogs()). Formatting is entirely
// activityLine.ts's job — this component only renders what that returns.
import { For, Show } from 'solid-js'
import type { ActivityEvent } from '../../../core/src/daemonActivity'
import activityLine from './activityLine'
import DaemonPanel from './DaemonPanel'
import EmptyState from '../ui/EmptyState'
import styles from './DaemonLog.module.css'

export type DaemonLogProps = {
    events: ActivityEvent[]
    class?: string
}

function DaemonLog(props: DaemonLogProps) {
    const now = () => new Date()
    return (
        <DaemonPanel
            title="log"
            count={props.events.length}
            class={props.class}
        >
            <Show
                when={props.events.length > 0}
                fallback={<EmptyState>nothing logged yet</EmptyState>}
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
                                    [styles['tone-quiet']]: line.tone === 'quiet',
                                    [styles['tone-ok']]: line.tone === 'ok',
                                }}
                            >
                                <span class={styles['log-time']}>
                                    {line.time}
                                </span>
                                <span class={styles['log-who']}>
                                    {line.who}
                                </span>
                                <span
                                    class={styles['log-what']}
                                    title={line.what}
                                >
                                    {line.what}
                                </span>
                                <span class={styles['log-duration']}>
                                    {line.duration ?? ''}
                                </span>
                            </div>
                        )
                    }}
                </For>
            </Show>
        </DaemonPanel>
    )
}

export default DaemonLog
