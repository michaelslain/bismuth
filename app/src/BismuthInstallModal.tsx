// app/src/BismuthInstallModal.tsx
// "Install Bismuth CLI + MCP" panel. Shows whether the machine-wide `bismuth` CLI is on
// PATH and the bismuth MCP is registered in the global Claude config (GET /bismuth/install),
// and offers a single button that runs the idempotent, version-gated installer
// (POST /bismuth/install) — a no-op when the bundled tools are already current. Mirrors
// DaemonSetupModal; reuses the shared FormModal + TextButton chrome.
import { createSignal, onMount, Show, For } from 'solid-js'
import FormModal from './ui/FormModal'
import ModalHeader from './ui/ModalHeader'
import ModalBody from './ui/ModalBody'
import ModalFooter from './ui/ModalFooter'
import SettingsGrid from './ui/SettingsGrid'
import SettingsField from './ui/SettingsField'
import Text from './ui/Text'
import { TextButton } from './ui/TextButton'
import InlineCode from './ui/InlineCode'
import { api } from './api'
import { pushToast } from './Toast'
import type { BismuthStatus } from '../../core/src/bismuthInstall'

function describeAction(action: string): string {
    switch (action) {
        case 'up-to-date':
            return 'Bismuth CLI + MCP already up to date'
        case 'installed':
            return 'Bismuth CLI + MCP installed'
        case 'updated':
            return 'Bismuth CLI + MCP updated'
        case 'skipped-no-src':
            return 'No bundled tools to install (dev build)'
        default:
            return `Bismuth install: ${action}`
    }
}

export function BismuthInstallModal(props: { onClose: () => void }) {
    const [status, setStatus] = createSignal<BismuthStatus | null>(null)
    const [warnings, setWarnings] = createSignal<string[]>([])
    const [loading, setLoading] = createSignal(true)
    const [running, setRunning] = createSignal(false)

    const refresh = async () => {
        setStatus(await api.bismuthInstallStatus())
    }

    onMount(async () => {
        try {
            await refresh()
        } catch (e) {
            pushToast(`Couldn't load install status: ${(e as Error).message}`)
        } finally {
            setLoading(false)
        }
    })

    const install = async () => {
        if (running()) return
        setRunning(true)
        try {
            const result = await api.bismuthInstall()
            pushToast(describeAction(result.action))
            setStatus(result.status)
            setWarnings(result.warnings)
        } catch (e) {
            pushToast(`Install failed: ${(e as Error).message}`)
        } finally {
            setRunning(false)
        }
    }

    const yn = (b: boolean | undefined) => (b ? 'yes' : 'no')

    return (
        <FormModal
            onClose={props.onClose}
            width={460}
            closeOnBackdrop={false}
            label="install bismuth cli + mcp"
        >
            <ModalHeader
                title="install bismuth cli + mcp"
                onClose={props.onClose}
            />
            <ModalBody>
                <Text size="ui" tone="faint">
                    installs the <InlineCode>bismuth</InlineCode> cli on your path and
                    registers the bismuth mcp in your global claude config, so
                    every terminal and claude session can use them —
                    idempotent, it only reinstalls when the bundled tools
                    change
                </Text>
                <Show
                    when={!loading()}
                    fallback={
                        <Text size="ui" tone="faint">
                            loading install status…
                        </Text>
                    }
                >
                    <SettingsGrid>
                        <SettingsField label="cli on path">
                            <Text as="span" size="ui">
                                {yn(status()?.cliLinked)}
                                {status()?.cliPath
                                    ? ` (${status()!.cliPath})`
                                    : ''}
                            </Text>
                        </SettingsField>
                        <SettingsField label="mcp registered">
                            <Text as="span" size="ui">
                                {yn(status()?.mcpRegistered)}
                            </Text>
                        </SettingsField>
                        <Show when={status()?.version}>
                            <SettingsField label="version">
                                <Text as="span" size="ui">
                                    {status()!.version}
                                </Text>
                            </SettingsField>
                        </Show>
                    </SettingsGrid>
                </Show>
                <Show when={warnings().length > 0}>
                    <For each={warnings()}>
                        {w => (
                            <Text as="div" size="ui" tone="faint">
                                ⚠ {w}
                            </Text>
                        )}
                    </For>
                </Show>
            </ModalBody>
            <ModalFooter>
                <TextButton onClick={props.onClose}>close</TextButton>
                <TextButton
                    primary
                    onClick={install}
                    disabled={loading() || running()}
                >
                    {running() ? 'working…' : 'install / update'}
                </TextButton>
            </ModalFooter>
        </FormModal>
    )
}
