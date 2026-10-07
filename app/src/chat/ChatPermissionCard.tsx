// app/src/chat/ChatPermissionCard.tsx — ChatPermissionCard.module.css is the ONLY importer.
// An inline permission prompt: allow / allow always / deny, or (once answered/cancelled) a settled
// outcome line. Composes `ui/Card` (the proposal recipe: bordered surface + the accent left edge)
// instead of rebuilding it; the chat tint arrives through Card's `--card-bg` seam, set in the
// stylesheet. The argument summary is ChatToolInput — the same block the tool row shows.
import { Show, type Component } from 'solid-js'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import Card from '../ui/Card'
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
    return (
        <Card
            variant="proposal"
            class={[
                styles['chat-permission'],
                done() ? styles['answered'] : '',
                props.class ?? '',
            ]
                .filter(Boolean)
                .join(' ')}
        >
            <div class={styles['chat-permission-head']}>
                <Icon value="Lock" class={styles['chat-permission-icon']} />
                <Text as="span" inherit class={styles['chat-permission-title']}>
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
                    maxHeight={160}
                    text={summary()}
                />
            </Show>
            <Show
                when={!done()}
                fallback={
                    <Text
                        as="div"
                        inherit
                        class={styles['chat-permission-outcome']}
                    >
                        <Icon
                            value={
                                props.part.answered
                                    ? props.part.answered.behavior === 'allow'
                                        ? 'Check'
                                        : 'X'
                                    : 'Ban'
                            }
                        />
                        {props.part.answered
                            ? props.part.answered.behavior === 'allow'
                                ? props.part.answered.always
                                    ? 'Allowed (always)'
                                    : 'Allowed'
                                : 'Denied'
                            : 'Cancelled'}
                    </Text>
                }
            >
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
        </Card>
    )
}

export default ChatPermissionCard
