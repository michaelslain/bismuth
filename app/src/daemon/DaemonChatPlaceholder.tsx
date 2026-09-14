// app/src/daemon/DaemonChatPlaceholder.tsx
// The daemon page's chat band before the chat is armed: an inert, composer-shaped stand-in. It
// opens no session and holds no state — it only has to READ as the composer it becomes, and be
// focusable so a keyboard user can arm the chat by tabbing into it. The arming itself is not here:
// DaemonPageHost listens for a trusted pointerdown/focusin on the band (daemonChatArming.ts), and
// App's chat overlay then covers the band with the real ChatView (variant="dock").
//
// Geometry mirrors ChatView's composer (ChatComposer.module.css `.chat-composer` +
// `.chat-composer-inner`): the same bottom inset, the same 680px reading column, the same flat
// hairline box — so arming swaps the placeholder for the real field without the box jumping.
import Text from '../ui/Text'
import styles from './DaemonChatPlaceholder.module.css'

export type DaemonChatPlaceholderProps = {
    class?: string
}

function DaemonChatPlaceholder(props: DaemonChatPlaceholderProps) {
    return (
        <div
            class={`${styles.placeholder} ${props.class ?? ''}`}
            data-testid="daemon-chat-placeholder"
        >
            <div
                class={styles.box}
                tabindex="0"
                role="button"
                aria-label="Chat with the daemon"
            >
                <Text as="span" size="ui" class={styles.prompt}>
                    &gt;
                </Text>
                <Text as="span" size="ui" tone="faint">
                    ask the daemon…
                </Text>
            </div>
        </div>
    )
}

export default DaemonChatPlaceholder
