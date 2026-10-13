// app/src/daemon/DaemonLogRow.tsx
// One daemon log event: the mono `time  who  what  note  duration` line (activityLine.ts formats it;
// the note says why it ran, why it failed or what it reported),
// which is a button that unfolds the event's detail underneath — the second-precision time, kind,
// exact duration and cause (logDetail.ts), the log file the event lives in, any detail text the
// daemon wrote (error output), and actions on that log: `[ open ]` the file, `[ copy path ]`, and
// `[ delete ]` this entry, which asks `[ delete ] [ cancel ]` first. Only the line toggles; clicks
// inside the detail never collapse it, so its text can be selected. The actions stop their click:
// the log box (DaemonSection) opens the section on any click it cannot trace to an item still
// inside it, and the confirm swap unmounts the button that was clicked.
import { createSignal, Show } from 'solid-js'
import type { ActivityEvent } from '../../../core/src/daemonActivity'
import activityLine from './activityLine'
import { clockTime } from './logDays'
import { detailMeta, logPath } from './logDetail'
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
    /** Opens the log file this event lives in. Omitted → no `[ open ]`. */
    onOpenLog?: () => void
    /** Copies that log file's path. Omitted → no `[ copy path ]`. */
    onCopyPath?: () => void
    /** Removes this event from its log file; the row stays in its confirm state until it settles.
     *  Omitted → no `[ delete ]`. */
    onDelete?: () => Promise<void>
    class?: string
}

function DaemonLogRow(props: DaemonLogRowProps) {
    const line = () => activityLine(props.event, props.now)
    const path = () => logPath(props.event)
    const hasActions = () =>
        props.onOpenLog !== undefined ||
        props.onCopyPath !== undefined ||
        props.onDelete !== undefined
    const [confirming, setConfirming] = createSignal(false)
    const [busy, setBusy] = createSignal(false)
    const commitDelete = async () => {
        setBusy(true)
        try {
            await props.onDelete?.()
        } finally {
            setBusy(false)
            setConfirming(false)
        }
    }

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
                    <Show when={path()}>
                        {p => (
                            <Text as="span" size="micro" tone="muted" class={styles.path}>
                                {p()}
                            </Text>
                        )}
                    </Show>
                    <Show when={props.event.detail}>
                        {d => (
                            <Text as="span" size="micro" inherit class={styles.text}>
                                {d()}
                            </Text>
                        )}
                    </Show>
                    <Show when={hasActions()}>
                        <div class={styles.actions}>
                            <Show
                                when={!confirming()}
                                fallback={
                                    <>
                                        <TextButton
                                            danger
                                            disabled={busy()}
                                            aria-busy={busy()}
                                            onClick={e => {
                                                e.stopPropagation()
                                                void commitDelete()
                                            }}
                                        >
                                            {busy() ? '…' : 'delete'}
                                        </TextButton>
                                        <TextButton
                                            disabled={busy()}
                                            onClick={e => {
                                                e.stopPropagation()
                                                setConfirming(false)
                                            }}
                                        >
                                            cancel
                                        </TextButton>
                                    </>
                                }
                            >
                                <Show when={props.onOpenLog}>
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
                                <Show when={props.onCopyPath}>
                                    {c => (
                                        <TextButton
                                            onClick={e => {
                                                e.stopPropagation()
                                                c()()
                                            }}
                                        >
                                            copy path
                                        </TextButton>
                                    )}
                                </Show>
                                <Show when={props.onDelete}>
                                    <TextButton
                                        danger="hover"
                                        onClick={e => {
                                            e.stopPropagation()
                                            setConfirming(true)
                                        }}
                                    >
                                        delete
                                    </TextButton>
                                </Show>
                            </Show>
                        </div>
                    </Show>
                </div>
            </Show>
        </div>
    )
}

export default DaemonLogRow
