import {
    createSignal,
    createMemo,
    createResource,
    createEffect,
    For,
} from 'solid-js'
import { showCalendarSettings } from '../state'
import { api } from '../../api'
import Select from '../../ui/Select'
import { TextButton } from '../../ui/TextButton'
import { IconTextButton } from '../../ui/IconTextButton'
import ModalHeader from '../../ui/ModalHeader'
import ModalFooter from '../../ui/ModalFooter'
import FormModal from '../../ui/FormModal'
import ModalBody from '../../ui/ModalBody'
import SettingsSection from '../../ui/SettingsSection'
import SettingsGrid from '../../ui/SettingsGrid'
import SettingsField from '../../ui/SettingsField'
import { GcalSyncPanel } from './GcalSyncPanel'

// Each calendar field binds to a note column. Keys match the base view-config keys
// (parse.ts reads these top-level keys into the default view).
interface FieldDef {
    key: string
    role: string
    def: string
    req?: boolean
    hint: string
}
const FIELDS: FieldDef[] = [
    {
        key: 'dateField',
        role: 'date',
        def: 'date',
        req: true,
        hint: 'which day each event lands on. required.',
    },
    {
        key: 'startTimeField',
        role: 'start-time',
        def: 'startTime',
        hint: 'when the event begins (week / day views).',
    },
    {
        key: 'endTimeField',
        role: 'end-time',
        def: 'endTime',
        hint: 'when the event ends — sets the block height.',
    },
    {
        key: 'recurrenceField',
        role: 'recurrence',
        def: 'recurrence',
        hint: 'holds the repeat rule (daily, weekly, …).',
    },
    {
        key: 'categoryField',
        role: 'category',
        def: 'category',
        hint: 'drives the colour each event is drawn in.',
    },
]
// Columns always offered, unioned with whatever the note's events actually use.
const STD_COLS = [
    'date',
    'startTime',
    'endTime',
    'recurrence',
    'category',
    'title',
    'location',
    'link',
]

export function CalendarSettings(props: {
    basePath: string
    onChange?: () => void
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
        const view = parsed()?.config.views[0] as
            Record<string, unknown> | undefined
        if (!view) return
        const seed: Record<string, string> = {}
        for (const f of FIELDS) {
            const v = view[f.key]
            seed[f.key] =
                typeof v === 'string'
                    ? v
                    : f.req
                      ? f.def
                      : v === ''
                        ? ''
                        : f.def
        }
        setMap(seed)
    })

    const columns = createMemo(() => {
        const found = new Set<string>(STD_COLS)
        for (const r of parsed()?.rows ?? [])
            for (const k of Object.keys(r.note ?? {}))
                if (k !== 'id') found.add(k)
        return [...found]
    })

    const reset = () =>
        setMap(Object.fromEntries(FIELDS.map(f => [f.key, f.def])))

    const optionsFor = (optional: boolean) => [
        ...(optional ? [{ value: '', label: 'not set' }] : []),
        ...columns().map(c => ({ value: c, label: c })),
    ]

    async function save(): Promise<void> {
        const m = map()
        for (const f of FIELDS)
            await api.setProperty(props.basePath, f.key, m[f.key] ?? '')
        props.onChange?.()
        close()
    }

    return (
        <FormModal onClose={close} label="calendar settings">
            <ModalHeader title="calendar settings" onClose={close} />

            <ModalBody>
                <SettingsSection>column mapping</SettingsSection>
                <SettingsGrid>
                    <For each={FIELDS}>
                        {f => (
                            <SettingsField
                                label={f.role}
                                badge={f.req ? 'required' : 'optional'}
                                hint={f.hint}
                            >
                                <Select
                                    value={map()[f.key] ?? ''}
                                    options={optionsFor(!f.req)}
                                    placeholder="not set"
                                    onChange={c =>
                                        setMap(m => ({ ...m, [f.key]: c }))
                                    }
                                />
                            </SettingsField>
                        )}
                    </For>
                </SettingsGrid>

                <GcalSyncPanel basePath={props.basePath} />
            </ModalBody>

            <ModalFooter
                leading={
                    <IconTextButton
                        icon="RotateCcw"
                        iconSize={13}
                        onClick={reset}
                    >
                        reset
                    </IconTextButton>
                }
            >
                <TextButton onClick={close}>
                    cancel
                </TextButton>
                <IconTextButton
                    icon="Check"
                    primary
                    onClick={save}
                >
                    save
                </IconTextButton>
            </ModalFooter>
        </FormModal>
    )
}
