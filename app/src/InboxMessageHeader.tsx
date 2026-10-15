// app/src/InboxMessageHeader.tsx
// The head of an inbox page's own message, over its subject and draft: the same sender line each
// reply and question in the thread carries (InboxMessageHead), so the draft reads as the first
// message of the conversation. Centred in the note column so it starts where the subject starts.
import type { Component } from 'solid-js'
import type { DaemonPage } from '../../core/src/daemonPages'
import InboxMessageHead from './InboxMessageHead'
import { pageSender } from './inboxPageMeta'
import styles from './InboxMessageHeader.module.css'

export type InboxMessageHeaderProps = {
    page: Pick<DaemonPage, 'source' | 'createdAt' | 'deliverAt'>
    class?: string
}

const InboxMessageHeader: Component<InboxMessageHeaderProps> = props => (
    <div
        class={`${styles['inbox-message-header']} ${props.class ?? ''}`}
        data-testid="inbox-message-header"
    >
        <InboxMessageHead
            class={styles.column}
            from="daemon"
            detail={pageSender(props.page)}
            at={props.page.deliverAt ?? props.page.createdAt}
        />
    </div>
)

export default InboxMessageHeader
