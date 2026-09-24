// app/src/daemon/DaemonProcesses.tsx
// Presentational services panel — the "services" facet's panel (UI label "services"; the type
// underneath is still DaemonProcess/`processes/`). Same shape as DaemonCrons.tsx minus a
// schedule column and `[ run ]` (a background service has neither a cron expression nor a
// discrete "run it now" action) — see DaemonProcesses.module.css's `.list` for the narrower
// 4-column grid. `running` on DaemonProcess is always false (core exposes no per-process
// liveness file it can trust), so "live" here means enabled AND the daemon process itself is up
// (`daemonRunning`) — the same rule this file's own `toneFor` has always applied.
import { createSignal, For, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { DaemonProcess } from '../../../core/src/daemonGraph'
import { openContextMenu } from '../nativeMenu'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { TextButton } from '../ui/TextButton'
import DaemonSection from './DaemonSection'
import DaemonRow, { type DaemonRowTone } from './DaemonRow'
import styles from './DaemonProcesses.module.css'

export type DaemonProcessesProps = {
    processes: DaemonProcess[]
    daemonRunning: boolean
    onOpen: (file: string) => void
    onToggle: (name: string, enabled: boolean) => void
    onDelete: (name: string) => Promise<void>
    class?: string
}

function toneFor(process: DaemonProcess, daemonRunning: boolean): DaemonRowTone {
    if (!process.enabled) return 'off'
    return daemonRunning ? 'running' : 'idle'
}

function statusFor(process: DaemonProcess): string {
    return process.enabled ? 'on' : 'off'
}

function DaemonProcesses(props: DaemonProcessesProps) {
    const [menu, setMenu] = createSignal<{
        x: number
        y: number
        items: MenuItem[]
    } | null>(null)
    const [deletingName, setDeletingName] = createSignal<string | null>(null)
    const [busyName, setBusyName] = createSignal<string | null>(null)

    async function commitDelete(name: string): Promise<void> {
        setBusyName(name)
        try {
            await props.onDelete(name)
        } finally {
            setBusyName(null)
            setDeletingName(null)
        }
    }

    function menuItems(process: DaemonProcess): MenuItem[] {
        const toggle: MenuItem = process.enabled
            ? {
                  label: 'Disable',
                  icon: 'PowerOff',
                  onSelect: () => props.onToggle(process.name, false),
              }
            : {
                  label: 'Enable',
                  icon: 'Power',
                  onSelect: () => props.onToggle(process.name, true),
              }
        return [
            toggle,
            {
                label: 'Delete',
                icon: 'Trash2',
                danger: true,
                separatorBefore: true,
                onSelect: () => setDeletingName(process.name),
            },
        ]
    }

    const openMenu = (process: DaemonProcess, e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        openContextMenu(e.clientX, e.clientY, menuItems(process), setMenu)
    }

    const rowActions = (process: DaemonProcess) => {
        if (deletingName() !== process.name) return undefined
        const busy = busyName() === process.name
        return (
            <>
                <TextButton
                    danger
                    disabled={busy}
                    aria-busy={busy}
                    onClick={e => {
                        e.stopPropagation()
                        void commitDelete(process.name)
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
        <DaemonSection
            title="services"
            count={props.processes.length}
            empty="no services yet // ask the daemon"
            isEmpty={props.processes.length === 0}
            class={props.class}
        >
            <Show when={props.processes.length > 0}>
                <div
                    class={styles.list}
                    classList={{ [styles['with-actions']]: deletingName() !== null }}
                >
                    <For each={props.processes}>
                        {process => (
                            <DaemonRow
                                name={process.name}
                                tone={toneFor(process, props.daemonRunning)}
                                status={statusFor(process)}
                                dim={!process.enabled}
                                onOpen={() =>
                                    props.onOpen(
                                        `.daemon/processes/${process.file}.md`,
                                    )
                                }
                                onContextMenu={e => openMenu(process, e)}
                                actions={rowActions(process)}
                                confirming={deletingName() === process.name}
                            />
                        )}
                    </For>
                </div>
            </Show>
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
        </DaemonSection>
    )
}

export default DaemonProcesses
