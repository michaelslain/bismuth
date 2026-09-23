// app/src/chat/ChatPermissionCard.tsx — ChatPermissionCard.module.css is the ONLY importer.
// An inline permission prompt: allow / allow always / deny, or (once answered/cancelled) a muted
// outcome line. Extracted verbatim in behaviour from ChatView.tsx's local `PermissionCard` closure.
import { Show } from 'solid-js'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import { TextButton } from '../ui/TextButton'
import CodeBlock from '../ui/CodeBlock'
import { chipSummary } from '../chatToolIcon'
import { summarizeInput } from './chatToolFormat'
import type { PermissionPart } from '../chatTranscript'
import styles from './ChatPermissionCard.module.css'

export type ChatPermissionCardProps = {
    part: PermissionPart
    onAnswer: (behavior: 'allow' | 'deny', always: boolean) => void
    class?: string
}

export default function ChatPermissionCard(props: ChatPermissionCardProps) {
    // Same echo as the tool chip, but PRE-EXISTING here rather than introduced by the naming fix:
    // the driver already names the permission by `title`, so "Allow Write foo.txt?" has always been
    // followed by a "Write foo.txt" summary. One rule, both surfaces.
    const summary = () =>
        chipSummary(summarizeInput(props.part.input), props.part.toolName, 160)
    const done = () => !!props.part.answered || !!props.part.cancelled
    return (
        <div
            class={`${styles['chat-permission']} ${props.class ?? ''}`}
            classList={{ [styles['answered']]: done() }}
        >
            <div class={styles['chat-permission-head']}>
                <Icon
                    value="Lock"
                    size={14}
                    class={styles['chat-permission-icon']}
                />
                <Text as="span" size="ui">
                    Allow{' '}
                    <Text as="span" weight="bold">
                        {props.part.toolName}
                    </Text>
                    ?
                </Text>
            </div>
            <Show when={summary()}>
                <CodeBlock class={styles['chat-permission-summary']}>
                    {summary()}
                </CodeBlock>
            </Show>
            <Show
                when={!done()}
                fallback={
                    <div
                        class={styles['chat-permission-outcome']}
                        classList={{
                            [styles['deny']]:
                                props.part.answered?.behavior === 'deny',
                            [styles['cancelled']]:
                                !props.part.answered && !!props.part.cancelled,
                        }}
                    >
                        <Icon
                            value={
                                props.part.answered
                                    ? props.part.answered.behavior === 'allow'
                                        ? 'Check'
                                        : 'X'
                                    : 'Ban'
                            }
                            size={13}
                        />
                        {props.part.answered
                            ? props.part.answered.behavior === 'allow'
                                ? props.part.answered.always
                                    ? 'Allowed (always)'
                                    : 'Allowed'
                                : 'Denied'
                            : 'Cancelled'}
                    </div>
                }
            >
                <div class={styles['chat-permission-actions']}>
                    <TextButton
                        variant="selected"
                        onClick={() => props.onAnswer('allow', false)}
                    >
                        allow
                    </TextButton>
                    <TextButton
                        onClick={() => props.onAnswer('allow', true)}
                    >
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
