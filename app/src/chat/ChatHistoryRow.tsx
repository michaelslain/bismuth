// app/src/chat/ChatHistoryRow.tsx
// One past conversation in the history panel: origin icon, title, relative time, and — for a
// search hit — the matching snippet clamped to two lines under the title. The resume list and the
// search results render this same row, so the two can never drift into different geometries
// (they had: a cramped PopoverList row against a roomier hand-rolled hit).
import { Show, type Component } from 'solid-js'
import styles from './ChatHistoryRow.module.css'
import type { ChatOrigin } from '../api'
import { chatOriginIcon } from './chatOrigin'
import { relTimeChat } from '../relTime'
import { Icon } from '../icons/Icon'
import Label from '../ui/Label'
import Text from '../ui/Text'
import PlainButton from '../ui/PlainButton'

export type ChatHistoryRowProps = {
    summary?: string
    lastModified: number
    origin?: ChatOrigin
    /** A search hit's matching excerpt; omitted for a plain resume-list row. */
    snippet?: string
    /** The keyboard-highlighted row (the panel's arrow-key cursor), painted like a selected menu row. */
    active?: boolean
    onClick: () => void
    ref?: (el: HTMLButtonElement) => void
    class?: string
}

const ChatHistoryRow: Component<ChatHistoryRowProps> = props => (
    <PlainButton
        ref={props.ref}
        class={`${styles.row} ${props.class ?? ''}`}
        data-active={props.active ? '' : undefined}
        onClick={() => props.onClick()}
    >
        <Icon value={chatOriginIcon(props.origin)} class={styles.icon} />
        <Label class={styles.title}>
            {props.summary?.trim() || 'Untitled session'}
        </Label>
        <Text as="span" size="ui" tone="faint" class={styles.time}>
            {relTimeChat(props.lastModified)}
        </Text>
        <Show when={props.snippet}>
            {snippet => (
                <Label lines={2} tone="muted" class={styles.snippet}>
                    {snippet()}
                </Label>
            )}
        </Show>
    </PlainButton>
)

export default ChatHistoryRow
