// app/src/daemon/DaemonServices.tsx
// Moved off app/src/DaemonList.tsx (deleted — that component rendered these same rows over
// GraphNode inside the graph's daemon-mode legend card, which no longer exists). Rewritten over
// the plain DaemonCron/DaemonProcess shapes (core/src/daemonGraph.ts) the daemon page's own
// GET /daemon/snapshot returns, rendered as two <DaemonPanel>s: "crons" and "services". Right-
// click keeps the shared <ContextMenu> (Run now / Enable / Disable); a row click opens its
// definition note.
import { For, Show, createSignal, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { DaemonCron, DaemonProcess } from '../../../core/src/daemonGraph'
import { openContextMenu } from '../nativeMenu'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { api } from '../api'
import { pushToast } from '../Toast'
import { relTimeISO } from '../relTime'
import Label from '../ui/Label'
import EmptyState from '../ui/EmptyState'
import Text from '../ui/Text'
import PlainButton from '../ui/PlainButton'
import DaemonPanel, { daemonPanelEmptyClass } from './DaemonPanel'
import cronFrequency from './cronFrequency'
import { cronStatus, type CronStatusKey } from './cronStatus'
import styles from './DaemonServices.module.css'

export type DaemonServicesProps = {
    crons: DaemonCron[]
    processes: DaemonProcess[]
    /** Whether the machine daemon process itself is running (`snapshot.daemon.running`). Defaults
     *  to true so existing stories/callers keep their prior look. An enabled process's dot only
     *  glows accent when this is true — otherwise the daemon isn't actually running it, no matter
     *  how the process definition is configured. */
    daemonRunning?: boolean
    onOpen: (path: string) => void
    onChanged: () => void
    /** Pack both panels to their rows (capped at half the column) instead of splitting it. */
    packToContent?: boolean
    class?: string
}

const STATUS_DOT: Record<CronStatusKey, string> = {
    running: 'var(--accent)',
    failed: 'var(--danger)',
    idle: 'var(--faint)',
    disabled: 'var(--faint)',
}

function cronStatusLabel(cron: DaemonCron): string {
    if (!cron.enabled) return 'off'
    if (cron.running) return 'running'
    if (cron.lastFired) return relTimeISO(cron.lastFired.timestamp)
    return 'never'
}

/** Shared row shell — the click/context-menu wiring, the status dot, and a fill Label are
 *  identical between a cron row and a process row; only the dot color/glow and the trailing
 *  content differ. A real `<button>` (no nested interactive content here — neither `extra` nor
 *  `status` ever renders one), so the row is keyboard-focusable/-activatable for free where it
 *  used to be mouse-only; `.daemon-row` itself keeps the full-width/left-aligned/flex layout it
 *  always had (PlainButton's own reset carries zero specificity — see PlainButton.module.css). */
function DaemonRow(props: {
    label: string
    dotColor: string
    glow: boolean
    faded: boolean
    onClick: () => void
    onContextMenu: (e: MouseEvent) => void
    extra?: JSX.Element
    status: JSX.Element
}) {
    return (
        <PlainButton
            class={styles['daemon-row']}
            onClick={props.onClick}
            onContextMenu={props.onContextMenu}
            style={{ opacity: props.faded ? 0.45 : 1 }}
        >
            <Text
                as="span"
                size="inherit"
                tone="inherit"
                weight="inherit"
                class={styles['daemon-row-dot']}
                classList={{ [styles.glow]: props.glow }}
                style={{ color: props.dotColor }}
            />
            <Label fill tone="default">
                {props.label}
            </Label>
            {props.extra}
            {props.status}
        </PlainButton>
    )
}

function CronRow(props: {
    cron: DaemonCron
    onOpen: (path: string) => void
    onMenu: (cron: DaemonCron, e: MouseEvent) => void
}) {
    const status = () => cronStatus(props.cron)
    const freq = () => {
        // A file-change cron has no cron expression to summarize — show what it watches instead.
        if (props.cron.on === 'file-change')
            return props.cron.watch
                ? `on change: ${props.cron.watch}`
                : 'on change'
        return props.cron.schedule ? cronFrequency(props.cron.schedule) : ''
    }
    return (
        <DaemonRow
            label={props.cron.name}
            dotColor={STATUS_DOT[status()]}
            glow={status() === 'running'}
            faded={status() === 'disabled'}
            onClick={() => props.onOpen(`.daemon/crons/${props.cron.file}.md`)}
            onContextMenu={e => props.onMenu(props.cron, e)}
            extra={
                <Show when={freq()}>
                    <Text
                        as="span"
                        size="inherit"
                        tone="inherit"
                        weight="inherit"
                        class={styles['daemon-row-freq']}
                    >
                        {freq()}
                    </Text>
                </Show>
            }
            status={
                <Text
                    as="span"
                    size="inherit"
                    tone="inherit"
                    weight="inherit"
                    class={styles['daemon-row-status']}
                    classList={{
                        [styles['tone-accent']]: status() === 'running',
                        [styles['tone-danger']]: status() === 'failed',
                    }}
                >
                    {cronStatusLabel(props.cron)}
                </Text>
            }
        />
    )
}

function ProcessRow(props: {
    process: DaemonProcess
    daemonRunning: boolean
    onOpen: (path: string) => void
    onMenu: (process: DaemonProcess, e: MouseEvent) => void
}) {
    const enabled = () => props.process.enabled
    // Enabled only says the process is CONFIGURED to run — the accent glow should say it actually
    // IS running, which requires the daemon itself to be up too (see DaemonServicesProps.daemonRunning).
    const live = () => enabled() && props.daemonRunning
    return (
        <DaemonRow
            label={props.process.name}
            dotColor={live() ? 'var(--accent)' : 'var(--faint)'}
            glow={live()}
            faded={!enabled()}
            onClick={() =>
                props.onOpen(`.daemon/processes/${props.process.file}.md`)
            }
            onContextMenu={e => props.onMenu(props.process, e)}
            status={
                <Text
                    as="span"
                    size="inherit"
                    tone="inherit"
                    weight="inherit"
                    class={styles['daemon-row-status']}
                    classList={{ [styles['tone-accent']]: enabled() }}
                >
                    {enabled() ? 'on' : 'off'}
                </Text>
            }
        />
    )
}

function DaemonServices(props: DaemonServicesProps) {
    const [menu, setMenu] = createSignal<{
        x: number
        y: number
        items: MenuItem[]
    } | null>(null)

    async function toggleCron(cron: DaemonCron) {
        const verb = cron.enabled ? 'Disabled' : 'Enabled'
        const res = await api.setCronEnabled(cron.name, !cron.enabled)
        if (res.ok) {
            pushToast(`${verb} ${cron.name}`)
            props.onChanged()
        } else {
            pushToast(
                `Couldn't ${cron.enabled ? 'disable' : 'enable'} ${cron.name}`,
            )
        }
    }

    async function toggleProcess(process: DaemonProcess) {
        const verb = process.enabled ? 'Disabled' : 'Enabled'
        const res = await api.setProcessEnabled(process.name, !process.enabled)
        if (res.ok) {
            pushToast(`${verb} ${process.name}`)
            props.onChanged()
        } else {
            pushToast(
                `Couldn't ${process.enabled ? 'disable' : 'enable'} ${process.name}`,
            )
        }
    }

    async function runNow(cron: DaemonCron) {
        const res = await api.runCron(cron.name)
        if (res.ok) {
            pushToast(`Triggered ${cron.name}`)
            // The daemon fires it on its next poll (~5s); nudge a refresh so the row's
            // "running" state shows up shortly after.
            setTimeout(() => props.onChanged(), 600)
        } else {
            pushToast(`Couldn't run ${cron.name}`)
        }
    }

    function cronMenuItems(cron: DaemonCron): MenuItem[] {
        const toggle: MenuItem = cron.enabled
            ? {
                  label: 'Disable',
                  icon: 'PowerOff',
                  onSelect: () => void toggleCron(cron),
              }
            : {
                  label: 'Enable',
                  icon: 'Power',
                  onSelect: () => void toggleCron(cron),
              }
        return [
            {
                label: 'Run now',
                icon: 'Play',
                // The daemon ignores a run trigger for an already-running job.
                disabled: cron.running,
                onSelect: () => void runNow(cron),
            },
            { ...toggle, separatorBefore: true },
        ]
    }

    function processMenuItems(process: DaemonProcess): MenuItem[] {
        const toggle: MenuItem = process.enabled
            ? {
                  label: 'Disable',
                  icon: 'PowerOff',
                  onSelect: () => void toggleProcess(process),
              }
            : {
                  label: 'Enable',
                  icon: 'Power',
                  onSelect: () => void toggleProcess(process),
              }
        return [toggle]
    }

    const openCronMenu = (cron: DaemonCron, e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        openContextMenu(e.clientX, e.clientY, cronMenuItems(cron), setMenu)
    }

    const openProcessMenu = (process: DaemonProcess, e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        openContextMenu(
            e.clientX,
            e.clientY,
            processMenuItems(process),
            setMenu,
        )
    }

    return (
        <div class={`${styles['daemon-services']} ${props.class ?? ''}`}>
            <DaemonPanel
                packToContent={props.packToContent}
                title="crons"
                count={props.crons.length}
            >
                <Show
                    when={props.crons.length > 0}
                    fallback={<EmptyState blockClass={daemonPanelEmptyClass}>no crons</EmptyState>}
                >
                    <For each={props.crons}>
                        {cron => (
                            <CronRow
                                cron={cron}
                                onOpen={props.onOpen}
                                onMenu={openCronMenu}
                            />
                        )}
                    </For>
                </Show>
            </DaemonPanel>
            <DaemonPanel
                packToContent={props.packToContent}
                title="services"
                count={props.processes.length}
            >
                <Show
                    when={props.processes.length > 0}
                    fallback={<EmptyState blockClass={daemonPanelEmptyClass}>no background services</EmptyState>}
                >
                    <For each={props.processes}>
                        {process => (
                            <ProcessRow
                                process={process}
                                daemonRunning={props.daemonRunning ?? true}
                                onOpen={props.onOpen}
                                onMenu={openProcessMenu}
                            />
                        )}
                    </For>
                </Show>
            </DaemonPanel>
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
        </div>
    )
}

export default DaemonServices
