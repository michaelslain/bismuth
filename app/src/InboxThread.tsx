// app/src/InboxThread.tsx
// The conversation under an inbox page: each reply you sent (in the app or by email) and each
// question the daemon asked back, oldest first, as stacked messages the way a mail client shows a
// thread. Each message is the same sender line the page's own draft carries (InboxMessageHead)
// over the words themselves.
import { For, type Component } from 'solid-js'
import type { ThreadEntry } from '../../core/src/daemonPages'
import InboxMessageHead from './InboxMessageHead'
import Text from './ui/Text'
import styles from './InboxThread.module.css'

export type InboxThreadProps = {
    entries: ThreadEntry[]
    class?: string
}

const InboxThread: Component<InboxThreadProps> = props => (
    <ol class={`${styles['inbox-thread']} ${props.class ?? ''}`} data-testid="inbox-thread">
        <For each={props.entries}>
            {entry => (
                <li class={styles.message} data-from={entry.from}>
                    <InboxMessageHead
                        from={entry.from}
                        detail={entry.via === 'email' ? 'by email' : null}
                        at={entry.at}
                    />
                    <Text size="inherit" tone="inherit" register="prose" class={styles.words}>
                        {entry.text}
                    </Text>
                </li>
            )}
        </For>
    </ol>
)

export default InboxThread
