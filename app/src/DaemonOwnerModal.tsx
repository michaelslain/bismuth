// app/src/DaemonOwnerModal.tsx
// Pick which device owns the daemon. Lists every heartbeating device
// (from GET /daemon/devices), marks the current owner and this machine, and on
// confirm writes owner.json via POST /daemon/owner (the single source of truth —
// Bismuth does NOT store the owner as a setting). Reuses the shared FormModal +
// Select chrome (same as FolderPrompt / the calendar dialogs).
import { createSignal, onMount, Show } from 'solid-js'
import FormModal from './ui/FormModal'
import ModalHeader from './ui/ModalHeader'
import ModalBody from './ui/ModalBody'
import ModalFooter from './ui/ModalFooter'
import SettingsField from './ui/SettingsField'
import Text from './ui/Text'
import Select from './ui/Select'
import { TextButton } from './ui/TextButton'
import { api } from './api'
import { pushToast } from './Toast'
import type { DeviceEntry } from '../../core/src/daemon'
import { relTimeISO } from './relTime'

export function DaemonOwnerModal(props: { onClose: () => void }) {
    const [devices, setDevices] = createSignal<DeviceEntry[]>([])
    const [selected, setSelected] = createSignal<string>('')
    const [loading, setLoading] = createSignal(true)
    const [saving, setSaving] = createSignal(false)

    onMount(async () => {
        try {
            const { devices, ownerDeviceId } = await api.daemonDevices()
            setDevices(devices)
            // Default the picker to the current owner, else this device, else the first.
            const me = devices.find(d => d.isThis)?.deviceId
            setSelected(ownerDeviceId ?? me ?? devices[0]?.deviceId ?? '')
        } catch (e) {
            pushToast(`Couldn't load devices: ${(e as Error).message}`)
        } finally {
            setLoading(false)
        }
    })

    // A short suffix marking owner / this device, shown in the dropdown label.
    const tagFor = (d: DeviceEntry): string => {
        const tags: string[] = []
        if (d.isOwner) tags.push('owner')
        if (d.isThis) tags.push('this device')
        return tags.length ? ` (${tags.join(', ')})` : ''
    }

    const options = () =>
        devices().map(d => ({
            value: d.deviceId,
            label: `${d.label || d.deviceId}${tagFor(d)} // ${relTimeISO(d.lastSeenISO)}`,
        }))

    const submit = async () => {
        const id = selected()
        if (!id || saving()) return
        setSaving(true)
        try {
            const owner = await api.setDaemonOwner(id)
            pushToast(
                `Daemon owner set to ${owner.ownerLabel || owner.ownerDeviceId}`,
            )
            props.onClose()
        } catch (e) {
            pushToast(`Set owner failed: ${(e as Error).message}`)
        } finally {
            setSaving(false)
        }
    }

    return (
        <FormModal
            onClose={props.onClose}
            width={460}
            closeOnBackdrop={false}
            label="set daemon owner device"
        >
            <ModalHeader
                title="set daemon owner device"
                onClose={props.onClose}
            />
            <ModalBody>
                <Text size="ui" tone="faint">
                    the owner device runs the daemon (crons + the persistent bot
                    session) — other devices idle but stay selectable
                </Text>
                <Show
                    when={!loading()}
                    fallback={
                        <Text size="ui" tone="faint">
                            loading devices…
                        </Text>
                    }
                >
                    <Show
                        when={devices().length > 0}
                        fallback={
                            <Text size="ui" tone="faint">
                                no devices have checked in yet — start the daemon,
                                then reopen this
                            </Text>
                        }
                    >
                        <SettingsField label="owner">
                            <Select
                                value={selected()}
                                options={options()}
                                onChange={setSelected}
                            />
                        </SettingsField>
                    </Show>
                </Show>
            </ModalBody>
            <ModalFooter>
                <TextButton onClick={props.onClose}>cancel</TextButton>
                <TextButton
                    primary
                    onClick={submit}
                    disabled={
                        loading() ||
                        saving() ||
                        devices().length === 0 ||
                        selected() === ''
                    }
                >
                    set owner
                </TextButton>
            </ModalFooter>
        </FormModal>
    )
}
