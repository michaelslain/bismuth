// app/src/daemon/DaemonLog.tsx
// The daemon page's activity log panel: one DaemonLogRow per event, newest first as `events`
// already arrives (api.daemonLogs()). A row's line unfolds its detail (one open at a time, kept
// open across re-polls by logDetail.ts's `eventKey`); from there `[ only <name> ]` narrows the log
// to that cron or service — a `only <name> // [ clear ]` line heads the list while it is narrowed
// — and `[ open ]` opens the owner's definition. `limit` row-caps the list behind a `+N more` line
// that opens the section; `variant="full"` shows every row grouped under day labels (logDays.ts).
//
// The filter is controlled when the host passes `filter` + `onFilter` (it then refetches by name
// and carries the filter between the box and the opened section); otherwise it is local.
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { ActivityEvent } from '../../../core/src/daemonActivity'
import DaemonSection from './DaemonSection'
import DaemonMoreLine from './DaemonMoreLine'
import DaemonLogRow from './DaemonLogRow'
import Text from '../ui/Text'
import { TextButton } from '../ui/TextButton'
import { groupByDay } from './logDays'
import { eventKey, filterEvents } from './logDetail'
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
    /** The cron/service name the log is narrowed to (controlled), or null for everything. */
    filter?: string | null
    onFilter?: (name: string | null) => void
    /** The vault path of an event's cron/service definition, or undefined when it has none
     *  (a daemon/session event, or a definition since deleted). Omitted → no `[ open ]`. */
    definitionFor?: (e: ActivityEvent) => string | undefined
    onOpen?: (path: string) => void
    class?: string
}

function DaemonLog(props: DaemonLogProps) {
    const now = () => new Date()
    const [localFilter, setLocalFilter] = createSignal<string | null>(null)
    const filter = () =>
        props.filter !== undefined ? props.filter : localFilter()
    const setFilter = (name: string | null) => {
        setOpenKey(null)
        if (props.onFilter) props.onFilter(name)
        else setLocalFilter(name)
    }
    const [openKey, setOpenKey] = createSignal<string | null>(null)

    const visible = createMemo(() => filterEvents(props.events, filter()))
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
        const path = () => props.definitionFor?.(e)
        return (
            <DaemonLogRow
                event={e}
                now={now()}
                clock={clock}
                expanded={openKey() === key}
                onToggle={() => setOpenKey(k => (k === key ? null : key))}
                onFilter={
                    e.name && filter() !== e.name
                        ? () => setFilter(e.name)
                        : undefined
                }
                onOpenDefinition={
                    path() && props.onOpen
                        ? () => props.onOpen!(path()!)
                        : undefined
                }
            />
        )
    }

    const filterLine = () => (
        <Show when={filter()}>
            {name => (
                <div class={styles['log-filter']} data-testid="daemon-log-filter">
                    <Text as="span" size="micro" tone="muted">
                        {`only ${name()} //`}
                    </Text>
                    <TextButton
                        onClick={e => {
                            e.stopPropagation()
                            setFilter(null)
                        }}
                    >
                        clear
                    </TextButton>
                </div>
            )}
        </Show>
    )
    const emptyText = () =>
        filter() ? `nothing logged for ${filter()}` : 'nothing logged yet'

    return (
        <Show
            when={props.variant === 'full'}
            fallback={
                <DaemonSection
                    title="log"
                    empty="nothing logged yet"
                    isEmpty={props.events.length === 0 && !filter()}
                    onOpen={props.onOpenSection}
                    class={props.class}
                >
                    {filterLine()}
                    <Show
                        when={visible().length > 0}
                        fallback={
                            <Show when={filter()}>
                                <Text tone="muted" class={styles['log-empty']}>
                                    {emptyText()}
                                </Text>
                            </Show>
                        }
                    >
                        <For each={shown()}>{e => row(e)}</For>
                    </Show>
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
                {filterLine()}
                <Show
                    when={visible().length > 0}
                    fallback={<Text tone="muted">{emptyText()}</Text>}
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
