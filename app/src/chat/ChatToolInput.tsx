// app/src/chat/ChatToolInput.tsx — ChatToolInput.module.css is the ONLY importer.
// ONE block for the raw text of a tool call: the pretty-printed input, a result, an error, or the
// one-line argument summary on a permission prompt. Was two divergent recipes — bright / 1px rule /
// an `INPUT` caption / 320px (the tool row) against muted / 2px rule / no caption / 160px (the
// permission card) — so the same JSON read as two different things depending on which card held it.
// The look is `ui/CodeBlock`'s own (surface fill, hairline, `--code-font-size` mono); this adds the
// optional lowercase caption, a tone, and a height cap.
import { Show, type Component } from 'solid-js'
import CodeBlock from '../ui/CodeBlock'
import SectionLabel from '../ui/SectionLabel'
import styles from './ChatToolInput.module.css'

export type ChatToolInputProps = {
    /** The text to show, already formatted (the caller owns pretty-printing and clamping). */
    text: string
    /** A lowercase caption over the block (`input`, `result`, `error`); omit for none. */
    label?: string
    /** 'default' reads --fg (the input a user is deciding on); 'muted' reads --text-muted (a
     *  summary that restates what the card's own head already says). Default 'default'. */
    tone?: 'default' | 'muted'
    /** The block scrolls past this many px. Default 320. */
    maxHeight?: number
    /** A failed call's output — --danger ink. */
    error?: boolean
    class?: string
}

const ChatToolInput: Component<ChatToolInputProps> = props => {
    return (
        <div class={`${styles['chat-tool-input']} ${props.class ?? ''}`}>
            <Show when={props.label}>
                {label => (
                    <SectionLabel class={styles['chat-tool-input-label']}>
                        {label()}
                    </SectionLabel>
                )}
            </Show>
            <CodeBlock
                class={styles['chat-tool-input-body']}
                classList={{
                    [styles['muted']]: props.tone === 'muted',
                    [styles['error']]: !!props.error,
                }}
                style={{ 'max-height': `${props.maxHeight ?? 320}px` }}
            >
                {props.text}
            </CodeBlock>
        </div>
    )
}

export default ChatToolInput
