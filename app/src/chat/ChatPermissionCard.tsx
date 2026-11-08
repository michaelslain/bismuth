// app/src/chat/ChatPermissionCard.tsx — ChatPermissionCard.module.css is the ONLY importer.
// An inline permission prompt: allow / allow always / deny. No surface: it sits on the transcript's
// own ground like ChatToolRow and ChatQuestionCard. Pending, it is the head line, the command as bare
// ChatToolInput text, and the buttons. Settled, it is one line, the outcome then what it was for.
import { Show, type Component } from 'solid-js'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import { TextButton } from '../ui/TextButton'
import { chipSummary } from './chatToolIcon'
import { summarizeInput } from './chatToolFormat'
import ChatToolInput from './ChatToolInput'
import type { PermissionPart } from './chatTranscriptLogic'
import styles from './ChatPermissionCard.module.css'

export type ChatPermissionCardProps = {
    part: PermissionPart
    onAnswer: (behavior: 'allow' | 'deny', always: boolean) => void
    class?: string
}

const ChatPermissionCard: Component<ChatPermissionCardProps> = props => {
    // Same echo as the tool chip, but PRE-EXISTING here rather than introduced by the naming fix:
    // the driver already names the permission by `title`, so "Allow Write foo.txt?" has always been
    // followed by a "Write foo.txt" summary. One rule, both surfaces.
    const summary = () =>
        chipSummary(summarizeInput(props.part.input), props.part.toolName, 160)
    const done = () => !!props.part.answered || !!props.part.cancelled
    const outcomeIcon = () =>
        props.part.answered
            ? props.part.answered.behavior === 'allow'
                ? 'Check'
                : 'X'
            : 'Ban'
    const outcomeLabel = () =>
        props.part.answered
            ? props.part.answered.behavior === 'allow'
                ? props.part.answered.always
                    ? 'Allowed (always)'
                    : 'Allowed'
                : 'Denied'
            : 'Cancelled'
    return (
        <div class={[styles['chat-permission'], props.class ?? ''].filter(Boolean).join(' ')}>
            <Show
                when={!done()}
                fallback={
                    <div class={styles['chat-permission-line']}>
                        <Icon
                            value={outcomeIcon()}
                            class={styles['chat-permission-icon']}
                        />
                        <Text as="span" inherit class={styles['chat-permission-outcome']}>
                            {outcomeLabel()}
                        </Text>
                        <Text as="span" inherit tone="muted" class={styles['chat-permission-tool']}>
                            {props.part.toolName}
                        </Text>
                        <Show when={summary()}>
                            <Text as="div" inherit tone="muted" truncate>
                                {summary()}
                            </Text>
                        </Show>
                    </div>
                }
            >
                <div class={styles['chat-permission-line']}>
                    <Icon value="Lock" class={styles['chat-permission-icon']} />
                    <Text as="span" inherit>
                        Allow{' '}
                        <Text as="span" inherit weight="bold">
                            {props.part.toolName}
                        </Text>
                        ?
                    </Text>
                </div>
                <Show when={summary()}>
                    <ChatToolInput
                        class={styles['chat-permission-summary']}
                        tone="muted"
                        bare
                        maxHeight={160}
                        text={summary()}
                    />
                </Show>
                <div class={styles['chat-permission-actions']}>
                    <TextButton
                        primary
                        onClick={() => props.onAnswer('allow', false)}
                    >
                        allow
                    </TextButton>
                    <TextButton onClick={() => props.onAnswer('allow', true)}>
                        allow always
                    </TextButton>
                    <TextButton
                        danger
                        onClick={() => props.onAnswer('deny', false)}
                    >
                        deny
                    </TextButton>
                </div>
            </Show>
        </div>
    )
}

export default ChatPermissionCard
