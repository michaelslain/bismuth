// app/src/chat/ChatToolRow.tsx — ChatToolRow.module.css is the ONLY importer.
// A tool-call chip: icon + name + one-line argument summary + status mark, collapsed by default;
// expands to the raw input (+ result, once it arrives). The collapse is `ui/Disclosure` (the
// chevron leads, `aria-expanded` is set, the body hangs under the summary) — it used to be a
// hand-rolled button with a Down/Right icon pair on the TRAILING edge, opposite the thinking block's
// leading one. The summary/status layout follows the plan's Acceptance ("a tool row's status mark
// sits immediately after its argument text, not at the far column edge; name and argument are
// separated by one normal gap, not a fixed wide column") — see ChatToolRow.module.css.
import { createSignal, Show, type Component } from 'solid-js'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import Disclosure from '../ui/Disclosure'
import { chipSummary, clamp, pickToolIcon } from './chatToolIcon'
import { prettyInput, summarizeInput } from './chatToolFormat'
import ChatToolInput from './ChatToolInput'
import type { ToolPart } from './chatTranscriptLogic'
import styles from './ChatToolRow.module.css'

export type ChatToolRowProps = {
    part: ToolPart
    class?: string
}

const ChatToolRow: Component<ChatToolRowProps> = props => {
    const [open, setOpen] = createSignal(false)
    // chipSummary, not clamp: an argument-less ACP tool call's only input field is its title, which
    // is also this chip's label — see chatToolIcon.ts for why the dedup has to precede the clamp.
    const summary = () =>
        chipSummary(summarizeInput(props.part.input), props.part.name, 120)
    const icon = () => pickToolIcon(props.part.toolKind, props.part.name)
    return (
        <div
            class={`${styles['chat-tool']} ${props.class ?? ''}`}
            classList={{ [styles['error']]: props.part.isError }}
        >
            <Disclosure
                open={open()}
                onToggle={() => setOpen(!open())}
                summary={
                    <Text as="span" inherit class={styles['chat-tool-line']}>
                        <Icon
                            value={icon()}
                            class={styles['chat-tool-icon']}
                        />
                        <Text
                            as="span"
                            inherit
                            weight="medium"
                            class={styles['chat-tool-name']}
                        >
                            {props.part.name}
                        </Text>
                        <Show when={summary()}>
                            <Text
                                as="span"
                                inherit
                                tone="muted"
                                class={styles['chat-tool-summary']}
                            >
                                {summary()}
                            </Text>
                        </Show>
                        <Text
                            as="span"
                            inherit
                            class={styles['chat-tool-status']}
                        >
                            <Show
                                when={props.part.pending}
                                fallback={
                                    <Icon
                                        value={
                                            props.part.isError ? 'X' : 'Check'
                                        }
                                        class={
                                            props.part.isError
                                                ? styles['chat-tool-x']
                                                : styles['chat-tool-check']
                                        }
                                    />
                                }
                            >
                                <Text
                                    as="span"
                                    inherit
                                    class={styles['chat-tool-pending']}
                                >
                                    …
                                </Text>
                            </Show>
                        </Text>
                    </Text>
                }
            >
                <div class={styles['chat-tool-detail']}>
                    <ChatToolInput
                        label="input"
                        text={prettyInput(props.part.input)}
                    />
                    <Show when={props.part.result != null}>
                        <ChatToolInput
                            label={props.part.isError ? 'error' : 'result'}
                            error={props.part.isError}
                            text={clamp(props.part.result ?? '', 4000)}
                        />
                    </Show>
                </div>
            </Disclosure>
        </div>
    )
}

export default ChatToolRow
