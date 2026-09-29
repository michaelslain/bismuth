// app/src/calendar/components/GcalSyncPanel.tsx
// The "Google Calendar sync" section of a calendar's settings modal (CalendarSettings).
// PER-CALENDAR: the on/off toggle + the target Google calendar id are stored on THIS
// calendar base's own frontmatter (googleCalendarSync / googleCalendarId, via setProperty),
// so a vault can have several calendars each synced with a different Google calendar. The
// account connection + conflict policy + cadence are connection-level (shared), read from the
// backend (~/.bismuth/gcal) and the global `googleCalendar` settings respectively.
import { createEffect, createResource, createSignal, Show } from 'solid-js'
import { settings, setSettings } from '../../settings'
import { api, summarizeSync } from '../../api'
import Select from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { IconTextButton } from '../../ui/IconTextButton'
import InlineCode from '../../ui/InlineCode'
import SettingsSection from '../../ui/SettingsSection'
import SettingsField from '../../ui/SettingsField'
import SettingsHint from '../../ui/SettingsHint'
import ToggleList from '../../ui/ToggleList'
import ToggleRow from '../../ui/ToggleRow'
import { pushToast } from '../../Toast'
import { withBusy } from '../withBusy'
import { isConfirmKey } from '../../ui/widgetKeys'
import GcalConnectPrompt from './GcalConnectPrompt'
import GcalStatusRow from './GcalStatusRow'
import { GcalConnectModal } from '../../GcalConnectModal'
import styles from './GcalSyncPanel.module.css'

const POLICIES = [
    { value: 'bismuthWins', label: 'this calendar wins' },
    { value: 'lastWriteWins', label: 'most recent edit wins' },
    { value: 'googleWins', label: 'google wins' },
]

type GcalView = { googleCalendarSync?: boolean; googleCalendarId?: string }

export function GcalSyncPanel(props: { basePath: string }) {
    const [status, { refetch }] = createResource(() => api.gcalStatus())
    // This base's parsed config → its per-calendar sync linkage.
    const [parsed, { refetch: refetchBase }] = createResource(
        () => props.basePath,
        p => api.base(p),
    )
    const [showConnect, setShowConnect] = createSignal(false)
    const [busy, setBusy] = createSignal(false)

    const view = (): GcalView =>
        (parsed()?.config.views?.[0] as GcalView | undefined) ?? {}
    const syncedHere = () => Boolean(view().googleCalendarSync)
    const gc = () => settings.googleCalendar

    // The Google calendar id field, seeded from (and re-seeded on external change to) the base.
    const [calId, setCalId] = createSignal('primary')
    createEffect(() => {
        const id = view().googleCalendarId
        setCalId(typeof id === 'string' && id.trim() ? id : 'primary')
    })

    // Every action shares one guard: a second click while one runs is ignored and a failure
    // toasts (see withBusy.ts).
    const busyState = { get: busy, set: setBusy }

    const toggle = () =>
        withBusy(busyState, "Couldn't update sync", async () => {
            const next = !syncedHere()
            await api.setProperty(props.basePath, 'googleCalendarSync', next)
            // On first enable, make sure a target calendar id is persisted (default "primary").
            if (next && !view().googleCalendarId) {
                await api.setProperty(
                    props.basePath,
                    'googleCalendarId',
                    calId().trim() || 'primary',
                )
            }
            await refetchBase()
        })

    // Persist the calendar id (on blur / Enter) — only when it actually changed.
    const commitCalId = async () => {
        const v = calId().trim() || 'primary'
        if (v === (view().googleCalendarId ?? 'primary')) return
        await api.setProperty(props.basePath, 'googleCalendarId', v)
        await refetchBase()
    }

    const saveCalId = () =>
        withBusy(busyState, "Couldn't save the calendar id", commitCalId)

    const syncNow = () =>
        withBusy(busyState, 'Sync failed', async () => {
            await commitCalId() // flush any pending id edit so this sync targets the right calendar
            pushToast(summarizeSync(await api.gcalSync(props.basePath)))
        })

    const disconnect = () =>
        withBusy(busyState, 'Disconnect failed', async () => {
            await api.gcalDisconnect()
            await refetch()
            pushToast('Disconnected from Google Calendar')
        })

    return (
        <>
            <SettingsSection>google calendar sync</SettingsSection>

            <Show
                when={status()?.connected}
                fallback={
                    <GcalConnectPrompt onConnect={() => setShowConnect(true)} />
                }
            >
                <GcalStatusRow
                    account={status()!.account!}
                    disabled={busy()}
                    onDisconnect={disconnect}
                />

                <div class={styles['gcal-toggle-group']}>
                    <ToggleList>
                        <ToggleRow
                            label="sync this calendar with google"
                            checked={syncedHere()}
                            muted={!syncedHere()}
                            locked={busy()}
                            onToggle={toggle}
                        />
                    </ToggleList>
                    <SettingsHint>
                        two-way every {gc().syncIntervalMinutes} min, and
                        whenever you hit sync now.
                    </SettingsHint>
                </div>

                <SettingsField
                    label="google calendar"
                    span
                    hint={
                        <>
                            which google calendar this base syncs with.{' '}
                            <InlineCode>primary</InlineCode> is your main calendar; paste
                            another calendar's id (google calendar → settings →
                            integrate calendar → calendar id) to sync a
                            different one.
                        </>
                    }
                >
                    <TextInput
                        value={calId()}
                        onInput={setCalId}
                        onBlur={() => void saveCalId()}
                        onKeyDown={e => {
                            if (isConfirmKey(e)) {
                                e.preventDefault()
                                void saveCalId()
                            }
                        }}
                        placeholder="primary"
                        spellcheck={false}
                        autocapitalize="off"
                        autocorrect="off"
                    />
                </SettingsField>

                <SettingsField
                    label="on a conflict"
                    span
                    hint="which side wins if an event changed in both places since the last sync."
                >
                    <Select
                        value={gc().conflictPolicy}
                        options={POLICIES}
                        onChange={v =>
                            setSettings(
                                'googleCalendar',
                                'conflictPolicy',
                                v as typeof settings.googleCalendar.conflictPolicy,
                            )
                        }
                    />
                </SettingsField>

                <div class={styles['gcal-actions']}>
                    <IconTextButton
                        icon="refresh-cw"
                        variant="selected"
                        onClick={syncNow}
                        disabled={busy()}
                    >
                        {busy() ? 'syncing…' : 'sync now'}
                    </IconTextButton>
                </div>
            </Show>

            <Show when={showConnect()}>
                <GcalConnectModal
                    basePath={props.basePath}
                    onClose={() => {
                        setShowConnect(false)
                        void refetch()
                        void refetchBase()
                    }}
                />
            </Show>
        </>
    )
}
