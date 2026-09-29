import {
    createSignal,
    createMemo,
    createResource,
    createEffect,
    Show,
} from 'solid-js'
import {
    FIELDS,
    seedColumnMap,
    defaultColumnMap,
    columnVocabulary,
} from '../calendarColumnMap'
import { withBusy } from '../withBusy'
import { showCalendarSettings } from '../state'
import { api } from '../../api'
import { TextButton } from '../../ui/TextButton'
import { IconTextButton } from '../../ui/IconTextButton'
import ModalHeader from '../../ui/ModalHeader'
import ModalFooter from '../../ui/ModalFooter'
import FormModal from '../../ui/FormModal'
import ModalBody from '../../ui/ModalBody'
import CalendarColumnMapping from './CalendarColumnMapping'
import { GcalSyncPanel } from './GcalSyncPanel'

export function CalendarSettings(props: {
    basePath: string
    onChange?: () => void
    /** Closes this modal and opens the base's generic settings panel. */
    onOpenBaseSettings?: () => void
}) {
    const close = () => (showCalendarSettings.value = false)
    const [parsed] = createResource(
        () => props.basePath,
        p => api.base(p),
    )

    // local edit map: field key -> column (seeded from the base config, defaulting to
    // the conventional column name when the file hasn't bound it explicitly).
    const [map, setMap] = createSignal<Record<string, string>>({})

    createEffect(() => {
        const view = parsed()?.config.view as
            | Record<string, unknown>
            | undefined
        if (!view) return
        setMap(seedColumnMap(view))
    })

    const columns = createMemo(() => columnVocabulary(parsed()?.rows ?? []))

    const reset = () => setMap(defaultColumnMap())

    const [busy, setBusy] = createSignal(false)

    // Closes only on success: a failed write toasts and leaves the modal (and the edits) open.
    async function save(): Promise<void> {
        const ok = await withBusy(
            { get: busy, set: setBusy },
            'Could not save calendar settings',
            async () => {
                const m = map()
                for (const f of FIELDS)
                    await api.setProperty(props.basePath, f.key, m[f.key] ?? '')
                props.onChange?.()
            },
        )
        if (ok) close()
    }

    const openBaseSettings = () => {
        close()
        props.onOpenBaseSettings?.()
    }

    return (
        <FormModal onClose={close} label="calendar settings">
            <ModalHeader title="calendar settings" onClose={close} />

            <ModalBody>
                <CalendarColumnMapping
                    values={map()}
                    columns={columns()}
                    onChange={(key, c) => setMap(m => ({ ...m, [key]: c }))}
                />

                <GcalSyncPanel basePath={props.basePath} />
            </ModalBody>

            <ModalFooter
                leading={
                    <>
                        <IconTextButton
                            icon="rotate-ccw"
                            onClick={reset}
                        >
                            reset
                        </IconTextButton>
                        <Show when={props.onOpenBaseSettings}>
                            <TextButton onClick={openBaseSettings}>
                                base settings
                            </TextButton>
                        </Show>
                    </>
                }
            >
                <TextButton onClick={close}>
                    cancel
                </TextButton>
                <IconTextButton
                    icon="check"
                    primary
                    disabled={busy()}
                    onClick={save}
                >
                    save
                </IconTextButton>
            </ModalFooter>
        </FormModal>
    )
}
