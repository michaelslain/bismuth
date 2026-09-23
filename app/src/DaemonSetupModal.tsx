// app/src/DaemonSetupModal.tsx
// "Set up daemon" panel. Shows whether the daemon is installed + running
// (GET /daemon/install) and who owns it (GET /daemon/status), and offers a
// single "Set up / repair" button that runs the idempotent, ADOPT-ONLY
// installer (POST /daemon/setup). The daemon binary ships bundled with the app
// (core/src/daemonInstall.ts stages it at boot) — Set up/Update never download
// anything; they just (re-)register the launchd/systemd service pointing at
// that already-staged binary. Safe to run even when the daemon is already
// live (no clobber, no restart of a running service). Reuses the shared
// PromptModal + TextButton chrome, same as DaemonOwnerModal / FolderPrompt.
import { createSignal, onMount, Show } from 'solid-js'
import PromptModal from './ui/PromptModal'
import PromptHint from './ui/PromptHint'
import { TextButton } from './ui/TextButton'
import { api } from './api'
import { pushToast } from './Toast'
import type { InstallStatus, SetupResult } from '../../core/src/daemonInstall'
import type { Owner } from '../../core/src/daemon'

/** Human-friendly summary of a daemon setup/update result for the toast. */
function describeSetup(r: SetupResult): string {
    return r.ok
        ? 'Daemon service registered — it runs in the background'
        : `Daemon setup failed: ${r.error || 'unknown error'}`
}

export function DaemonSetupModal(props: { onClose: () => void }) {
    const [status, setStatus] = createSignal<InstallStatus | null>(null)
    const [owner, setOwner] = createSignal<Owner | null>(null)
    const [loading, setLoading] = createSignal(true)
    const [running, setRunning] = createSignal(false)
    const [busy, setBusy] = createSignal('')

    const refresh = async () => {
        // Both calls tolerate a daemon that has never run; installStatus never throws
        // server-side, and owner is null when unclaimed.
        const [install, daemon] = await Promise.allSettled([
            api.daemonInstall(),
            api.daemonStatus(),
        ])
        if (install.status === 'fulfilled') setStatus(install.value)
        if (daemon.status === 'fulfilled') setOwner(daemon.value.owner)
    }

    onMount(async () => {
        try {
            await refresh()
        } catch (e) {
            pushToast(`Couldn't load daemon status: ${(e as Error).message}`)
        } finally {
            setLoading(false)
        }
    })

    const setup = async () => {
        if (running()) return
        setRunning(true)
        setBusy('Registering the daemon service…')
        try {
            const result = await api.daemonSetup()
            pushToast(describeSetup(result))
            await refresh() // reflect the post-setup status in the panel
        } catch (e) {
            pushToast(`Daemon setup failed: ${(e as Error).message}`)
        } finally {
            setRunning(false)
            setBusy('')
        }
    }

    const update = async () => {
        if (running()) return
        setRunning(true)
        setBusy('Re-registering the daemon service…')
        try {
            const result = await api.daemonUpdate()
            pushToast(describeSetup(result))
            await refresh()
        } catch (e) {
            pushToast(`Daemon update failed: ${(e as Error).message}`)
        } finally {
            setRunning(false)
            setBusy('')
        }
    }

    const yn = (b: boolean | undefined) => (b ? 'yes' : 'no')

    return (
        <PromptModal
            onClose={props.onClose}
            title="Set up daemon"
            actions={
                <>
                    <TextButton onClick={props.onClose}>close</TextButton>
                    <TextButton
                        onClick={update}
                        disabled={loading() || running()}
                    >
                        {running() ? 'working…' : 'update'}
                    </TextButton>
                    <TextButton
                        primary
                        onClick={setup}
                        disabled={loading() || running()}
                    >
                        {running() ? 'working…' : 'set up / repair'}
                    </TextButton>
                </>
            }
        >
            <PromptHint>
                The daemon runs crons and the persistent bot session in the
                background.
                <strong> Set up</strong> is idempotent — it registers the
                background service for the daemon binary bundled with this app;
                if already installed, it adopts the existing install without
                changing anything.
                <strong> Update</strong> re-registers that service (the daemon
                binary itself updates with the app, not here).
            </PromptHint>
            <Show when={busy()}>
                <PromptHint>{busy()}</PromptHint>
            </Show>
            <Show
                when={!loading()}
                fallback={<PromptHint>Loading daemon status…</PromptHint>}
            >
                <PromptHint>
                    <div>Installed: {yn(status()?.installed)}</div>
                    <div>Running: {yn(status()?.running)}</div>
                    <div>
                        Owner:{' '}
                        {owner()
                            ? owner()!.ownerLabel || owner()!.ownerDeviceId
                            : 'unclaimed'}
                    </div>
                    <Show when={status()?.binPath}>
                        <div>Binary: {status()!.binPath}</div>
                    </Show>
                </PromptHint>
            </Show>
        </PromptModal>
    )
}
