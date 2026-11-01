// app/src/chat/ChatStatusMark.tsx — ChatStatusMark.module.css is the ONLY importer.
// The tool row's status mark: the pending `…`, the check, or the X in its error tone. ChatToolRow
// and ChatSubagentStrip both render it, so a running subagent reads like a running tool call.
import { Show, type Component } from 'solid-js'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import styles from './ChatStatusMark.module.css'

export type ChatStatusMarkProps = {
    status: 'pending' | 'ok' | 'error'
    class?: string
}

const ChatStatusMark: Component<ChatStatusMarkProps> = props => (
    <Text
        as="span"
        inherit
        class={`${styles['chat-tool-status']} ${props.class ?? ''}`}
    >
        <Show
            when={props.status !== 'pending'}
            fallback={
                <Text as="span" inherit class={styles['chat-tool-pending']}>
                    …
                </Text>
            }
        >
            <Icon
                value={props.status === 'error' ? 'X' : 'Check'}
                class={
                    props.status === 'error'
                        ? styles['chat-tool-x']
                        : styles['chat-tool-check']
                }
            />
        </Show>
    </Text>
)

export default ChatStatusMark
