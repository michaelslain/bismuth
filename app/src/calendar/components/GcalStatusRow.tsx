// The connected status row of the calendar's Google Calendar sync section: a green dot, the
// connected account, and the disconnect button. Presentational — GcalSyncPanel owns the handler.
import type { Component } from 'solid-js'
import { TextButton } from '../../ui/TextButton'
import Text from '../../ui/Text'
import StatusDot from '../../ui/StatusDot'
import styles from './GcalStatusRow.module.css'

export type GcalStatusRowProps = {
    account: string
    /** Locks the disconnect button while another action is running. */
    disabled?: boolean
    onDisconnect: () => void
}

const GcalStatusRow: Component<GcalStatusRowProps> = props => (
    <div class={styles['gcal-status']}>
        <StatusDot color="var(--green)" />
        <Text
            as="span"
            inherit
            class={styles['gcal-acct']}
            title={props.account}
        >
            {props.account}
        </Text>
        <TextButton
            danger
            onClick={() => props.onDisconnect()}
            disabled={props.disabled}
        >
            disconnect
        </TextButton>
    </div>
)

export default GcalStatusRow
