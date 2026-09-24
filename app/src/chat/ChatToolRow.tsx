// app/src/chat/ChatToolRow.tsx — ChatToolRow.module.css is the ONLY importer.
// A tool-call chip: icon + name + one-line argument summary + status mark, collapsed by default;
// expands to the raw input (+ result, once it arrives). Extracted verbatim in behaviour from
// ChatView.tsx's local `ToolChip` closure; the summary/status layout is restyled per the plan's
// Acceptance ("a tool row's status mark sits immediately after its argument text, not at the far
// column edge; name and argument are separated by one normal gap, not a fixed wide column") — see
// ChatToolRow.module.css's header for what changed.
import { createSignal, Show } from 'solid-js'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import PlainButton from '../ui/PlainButton'
import CodeBlock from '../ui/CodeBlock'
import { chipSummary, clamp, pickToolIcon } from '../chatToolIcon'
import { prettyInput, summarizeInput } from './chatToolFormat'
import type { ToolPart } from '../chatTranscript'
import styles from './ChatToolRow.module.css'

export type ChatToolRowProps = {
    part: ToolPart
    class?: string
}

export default function ChatToolRow(props: ChatToolRowProps) {
    const [open, setOpen] = createSignal(false)
    // chipSummary, not clamp: an argument-less ACP tool call's only input field is its title, which
    // is also this chip's label — see chatToolIcon.ts for why the dedup has to precede the clamp.
    const summary = () =>
        chipSummary(summarizeInput(props.part.input), props.part.name, 120)
    return (
        <div
            class={`${styles['chat-tool']} ${props.class ?? ''}`}
            classList={{
                [styles['open']]: open(),
                [styles['error']]: props.part.isError,
            }}
        >
            <PlainButton
                class={styles['chat-tool-head']}
                onClick={() => setOpen(!open())}
            >
                <Icon
                    value={pickToolIcon(props.part.toolKind, props.part.name)}
                    class={styles['chat-tool-icon']}
                />
                <Text as="span" weight="medium" class={styles['chat-tool-name']}>
                    {props.part.name}
                </Text>
                <Show when={summary()}>
                    <Text
                        as="span"
                        size="ui"
                        tone="faint"
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
                                value={props.part.isError ? 'X' : 'Check'}
                                class={
                                    props.part.isError
                                        ? styles['chat-tool-x']
                                        : styles['chat-tool-check']
                                }
                            />
                        }
                    >
                        <Text as="span" class={styles['chat-tool-pending']}>
                            …
                        </Text>
                    </Show>
                </Text>
                <Icon
                    value={open() ? 'ChevronDown' : 'ChevronRight'}
                    class={styles['chat-tool-caret']}
                />
            </PlainButton>
            <Show when={open()}>
                <div class={styles['chat-tool-detail']}>
                    {/* NOT the eyebrow register: this label wants UPPERCASE ("INPUT"), which
                        Text's `eyebrow` deliberately never applies (see ui/Text.module.css) — the
                        transform stays in this file's own `.chat-tool-section-label` instead. */}
                    <Text
                        as="div"
                        size="micro"
                        tone="faint"
                        class={styles['chat-tool-section-label']}
                    >
                        Input
                    </Text>
                    <CodeBlock class={styles['chat-tool-pre']}>
                        {prettyInput(props.part.input)}
                    </CodeBlock>
                    <Show when={props.part.result != null}>
                        <Text
                            as="div"
                            size="micro"
                            tone="faint"
                            class={styles['chat-tool-section-label']}
                        >
                            {props.part.isError ? 'Error' : 'Result'}
                        </Text>
                        <CodeBlock
                            class={styles['chat-tool-pre']}
                            classList={{
                                [styles['chat-tool-pre-error']]:
                                    props.part.isError,
                            }}
                        >
                            {clamp(props.part.result ?? '', 4000)}
                        </CodeBlock>
                    </Show>
                </div>
            </Show>
        </div>
    )
}
