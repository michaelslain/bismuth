// app/src/daemon/DaemonCrons.tsx
// Presentational crons panel — the "crons" facet's panel. Takes data + callbacks only (no
// `api`/`pushToast`/store imports — the host wires those, same seam DaemonInbox/DaemonProcesses
// already use). Status/tone derivation lives in cronStatus.ts now (`cronTone`, moved out of this
// file so it's unit-testable without mounting Solid): the enabled/running/failed/idle base key,
// failedResult.ts (via cronStatus) for the killed-counts-as-failed unification, cronFrequency.ts
// for the schedule string, relTimeISO for ages — refined into the row-per-tone/labelled-status
// text the redesign asks for ('ok 4m ago', 'failed 2h ago', not colour alone). `statusFor` stays
// here — it's the human-readable text, not the tone. The dot only glows 'running' while the
// daemon PROCESS itself is up (`daemonRunning`) — a cron can't really be live if the machine
// daemon is down; if its stale `running` flag survived a daemon restart, `cronTone` falls back to
// whatever it last actually did (failed/ok/idle) instead of a bare `idle`.
import { createMemo, createSignal, For, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { DaemonCron } from '../../../core/src/daemonGraph'
import { ContextMenu, type MenuItem } from '../ui/ContextMenu'
import { relTimeISO } from '../relTime'
import { TextButton } from '../ui/TextButton'
import Text from '../ui/Text'
import DaemonSection from './DaemonSection'
import DaemonRow from './DaemonRow'
import DaemonMoreLine from './DaemonMoreLine'
import { cronTone } from './cronStatus'
import cronFrequency from './cronFrequency'
import { cronNeedsAttention, attentionFirst } from './daemonAttention'
import type { RowLimit } from './daemonRowBudget'
import styles from './DaemonCrons.module.css'

export type DaemonCronsProps = {
    /** 'box' (default): the capped list inside its DaemonSection box. 'full': every row, no box
     *  of its own — the opened section's DaemonTakeover supplies the heading. */
    variant?: 'box' | 'full'
    /** Opens this section full screen — the box heading, its open button and its more-line call it. */
    onOpenSection?: () => void
    crons: DaemonCron[]
    daemonRunning: boolean
    onOpen: (file: string) => void
    onRun: (name: string) => void
    onToggle: (name: string, enabled: boolean) => void
    onDelete: (name: string) => Promise<void>
    limit?: RowLimit
    class?: string
}

function statusFor(cron: DaemonCron, daemonRunning: boolean): string {
    const tone = cronTone(cron, daemonRunning)
    if (tone === 'off') return 'off'
    if (tone === 'running') return 'running'
    if (tone === 'failed')
        return `failed ${relTimeISO(cron.lastFired!.timestamp)}`
    if (tone === 'ok') return `ok ${relTimeISO(cron.lastFired!.timestamp)}`
    return 'never'
}

/** A file-change cron has no cron expression to summarize — show what it watches instead. */
function metaFor(cron: DaemonCron): string {
    if (cron.on === 'file-change')
        return cron.watch ? `on change: ${cron.watch}` : 'on change'
    return cron.schedule ? cronFrequency(cron.schedule) : ''
}

function DaemonCrons(props: DaemonCronsProps) {
    const [menu, setMenu] = createSignal<{
        x: number
        y: number
        items: MenuItem[]
    } | null>(null)
    const [deletingName, setDeletingName] = createSignal<string | null>(null)
    const [busyName, setBusyName] = createSignal<string | null>(null)
    const full = () => props.variant === 'full'
    const sorted = createMemo(() =>
        attentionFirst(props.crons, c => cronNeedsAttention(c, props.daemonRunning)),
    )
    const limited = createMemo(
        () => !full() && props.limit !== undefined && sorted().length > props.limit,
    )
    const shown = createMemo(() =>
        full() || props.limit === undefined
            ? sorted()
            : sorted().slice(0, props.limit),
    )

    async function commitDelete(name: string): Promise<void> {
        setBusyName(name)
        try {
            await props.onDelete(name)
        } finally {
            setBusyName(null)
            setDeletingName(null)
        }
    }

    function menuItems(cron: DaemonCron): MenuItem[] {
        const toggle: MenuItem = cron.enabled
            ? {
                  label: 'Disable',
                  icon: 'PowerOff',
                  onSelect: () => props.onToggle(cron.name, false),
              }
            : {
                  label: 'Enable',
                  icon: 'Power',
                  onSelect: () => props.onToggle(cron.name, true),
              }
        return [
            {
                label: 'Run now',
                icon: 'Play',
                disabled: cron.running,
                onSelect: () => props.onRun(cron.name),
            },
            { ...toggle, separatorBefore: true },
            {
                label: 'Delete',
                icon: 'Trash2',
                danger: true,
                disabled: cron.running,
                separatorBefore: true,
                onSelect: () => setDeletingName(cron.name),
            },
        ]
    }

    const openMenu = (cron: DaemonCron, e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY, items: menuItems(cron) })
    }

    const rowActions = (cron: DaemonCron) => {
        if (deletingName() === cron.name) {
            const busy = busyName() === cron.name
            return (
                <>
                    <TextButton
                        danger
                        disabled={busy}
                        aria-busy={busy}
                        onClick={e => {
                            e.stopPropagation()
                            void commitDelete(cron.name)
                        }}
                    >
                        {busy ? '…' : 'delete'}
                    </TextButton>
                    <TextButton
                        disabled={busy}
                        onClick={e => {
                            e.stopPropagation()
                            setDeletingName(null)
                        }}
                    >
                        cancel
                    </TextButton>
                </>
            )
        }
        return (
            <TextButton
                disabled={cron.running}
                onClick={e => {
                    e.stopPropagation()
                    props.onRun(cron.name)
                }}
            >
                run
            </TextButton>
        )
    }

    const listEl = () => (
        <div
            class={styles.cronsList}
            data-variant={props.variant}
            data-testid={full() ? 'daemon-crons-full' : undefined}
        >
            <For each={shown()}>
                {cron => (
                    <DaemonRow
                        name={cron.name}
                        tone={cronTone(cron, props.daemonRunning)}
                        status={statusFor(cron, props.daemonRunning)}
                        meta={metaFor(cron)}
                        dim={!cron.enabled}
                        onOpen={() =>
                            props.onOpen(
                                `.daemon/crons/${cron.file}.md`,
                            )
                        }
                        onContextMenu={e => openMenu(cron, e)}
                        actions={rowActions(cron)}
                        confirming={deletingName() === cron.name}
                    />
                )}
            </For>
        </div>
    )
    const menuEl = () => (
        <Show when={menu()}>
            {m => (
                <Portal>
                    <ContextMenu
                        x={m().x}
                        y={m().y}
                        items={m().items}
                        onClose={() => setMenu(null)}
                    />
                </Portal>
            )}
        </Show>
    )

    return (
        <Show
            when={!full()}
            fallback={
                <>
                    <Show
                        when={props.crons.length > 0}
                        fallback={
                            <Text
                                tone="muted"
                                data-testid="daemon-crons-full-empty"
                            >
                                no crons yet // ask the daemon
                            </Text>
                        }
                    >
                        {listEl()}
                    </Show>
                    {menuEl()}
                </>
            }
        >
            <DaemonSection
                title="crons"
                count={props.crons.length}
                empty="no crons yet // ask the daemon"
                isEmpty={props.crons.length === 0}
                onOpen={props.onOpenSection}
                class={props.class}
            >
                <Show when={props.crons.length > 0}>
                    {listEl()}
                    <Show when={limited()}>
                        <DaemonMoreLine
                            label={`+${sorted().length - (props.limit as number)} more`}
                            onOpen={props.onOpenSection}
                        />
                    </Show>
                </Show>
                {menuEl()}
            </DaemonSection>
        </Show>
    )
}

export default DaemonCrons
