// The disconnected fallback of the calendar's Google Calendar sync section: what the sync is,
// and the button that starts connecting. Presentational — GcalSyncPanel owns the modal.
import type { Component } from 'solid-js'
import { IconTextButton } from '../../ui/IconTextButton'
import SettingsHint from '../../ui/SettingsHint'
import styles from './GcalConnectPrompt.module.css'

export type GcalConnectPromptProps = {
    onConnect: () => void
}

const GcalConnectPrompt: Component<GcalConnectPromptProps> = props => (
    <div class={styles['gcal-connect']}>
        <SettingsHint>
            two-way sync between this calendar and google — events only (no
            gmail, drive, or contacts).
        </SettingsHint>
        {/* A command, not a pick: the modal's own primary action stays the only filled button. */}
        <IconTextButton icon="calendar" onClick={() => props.onConnect()}>
            connect google calendar
        </IconTextButton>
    </div>
)

export default GcalConnectPrompt
