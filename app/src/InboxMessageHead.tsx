// app/src/InboxMessageHead.tsx
// The ruled line that opens every message of an inbox page's transcript — the page's own draft and
// each reply and question after it: `── daemon // answer-emails ──────── 2h ago`. A short rule, the
// sender (the daemon in sage, you in ink), what it came from or how it arrived, a rule that fills
// the line, and the time. The rule is what separates one message from the next.
import { Show, type Component } from 'solid-js'
import { relTimeISO } from './relTime'
import Text from './ui/Text'
import styles from './InboxMessageHead.module.css'

export type InboxMessageHeadProps = {
    from: 'you' | 'daemon'
    /** After the sender: the page's source, or `by email`. */
    detail?: string | null
    at: string
    class?: string
}

const InboxMessageHead: Component<InboxMessageHeadProps> = props => (
    <div class={`${styles['inbox-message-head']} ${props.class ?? ''}`}>
        <Text
            as="span"
            size="ui"
            weight="medium"
            tone={props.from === 'daemon' ? 'accent' : 'default'}
        >
            {props.from}
        </Text>
        <Show when={props.detail}>
            {d => (
                <Text as="span" size="ui" tone="faint" class={styles.detail}>
                    {`// ${d()}`}
                </Text>
            )}
        </Show>
        <Text as="span" size="ui" tone="faint" class={styles.when}>
            {relTimeISO(props.at)}
        </Text>
    </div>
)

export default InboxMessageHead
