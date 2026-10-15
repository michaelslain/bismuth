// app/src/InboxReplyField.tsx
// The reply prompt at the end of an inbox page's transcript: a `>` and a field right under the last
// message, the way a terminal waits for the next line. What you type is prose, so it takes the same
// face as the messages above; it grows a line at a time. The confirm key (`ui-confirm`, Enter by
// default) sends and Shift+Enter is a new line, both named in the hint under it; a `send` button
// appears once there is text, for a touch screen with no Enter key. The daemon reads the reply and
// presses the button it means, or asks a question back (core's replyToPage).
import { createSignal, Show, type Component } from 'solid-js'
import { TextInput } from './ui/TextInput'
import { TextButton } from './ui/TextButton'
import Text from './ui/Text'
import { isConfirmKey } from './ui/widgetKeys'
import styles from './InboxReplyField.module.css'

export type InboxReplyFieldProps = {
    placeholder: string
    /** The faint line under the field: how to send. Empty hides it. */
    hint?: string
    disabled?: boolean
    onSubmit: (text: string) => void | Promise<void>
    class?: string
}

/** Rows the field grows to before it scrolls. */
const MAX_ROWS = 8

const InboxReplyField: Component<InboxReplyFieldProps> = props => {
    const [text, setText] = createSignal('')
    let field: HTMLTextAreaElement | undefined

    // Grow with the text, a line at a time, up to MAX_ROWS; then scroll inside.
    const fit = () => {
        if (!field) return
        field.style.height = 'auto'
        const line = parseFloat(getComputedStyle(field).lineHeight) || 20
        field.style.height = `${Math.min(field.scrollHeight, line * MAX_ROWS)}px`
    }

    const send = async () => {
        const t = text().trim()
        if (!t || props.disabled) return
        await props.onSubmit(t)
        setText('')
        queueMicrotask(fit)
    }

    return (
        <div
            class={`${styles['inbox-reply-field']} ${props.class ?? ''}`}
            data-testid="inbox-composer"
        >
            <div class={styles.line}>
                <Text as="span" size="ui" tone="accent" weight="medium" class={styles.prompt}>
                    {'>'}
                </Text>
                <TextInput
                    multiline
                    plain
                    rows={1}
                    ref={el => {
                        field = el
                        queueMicrotask(fit)
                    }}
                    class={styles.input}
                    value={text()}
                    onInput={v => {
                        setText(v)
                        fit()
                    }}
                    placeholder={props.placeholder}
                    disabled={props.disabled}
                    aria-label="reply to this page"
                    data-testid="inbox-reply-input"
                    onKeyDown={e => {
                        if (isConfirmKey(e) && !e.isComposing) {
                            e.preventDefault()
                            void send()
                        }
                    }}
                />
                <Show when={text().trim()}>
                    <TextButton
                        variant="selected"
                        disabled={props.disabled}
                        onClick={() => void send()}
                    >
                        send
                    </TextButton>
                </Show>
            </div>
            <Show when={props.hint}>
                {h => (
                    <Text as="span" size="ui" tone="faint" class={styles.hint}>
                        {h()}
                    </Text>
                )}
            </Show>
        </div>
    )
}

export default InboxReplyField
