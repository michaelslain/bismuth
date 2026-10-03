// app/src/chat/ChatModelMenu.tsx
// The controls row's ONE model control: a single lowercase text trigger showing modelWord() of the
// session's current model, which opens ChatModelPicker — the one panel for connector, model, effort
// and (opencode) provider management — portalled to <body> and anchored to the trigger. The row's
// items (this control, permission mode, history, new chat) never overflow because there is nothing
// else left to drop.
import { createSignal, Show, type Component } from 'solid-js'
import { Portal } from 'solid-js/web'
import styles from './ChatModelMenu.module.css'
import type { ChatControlsView } from './ChatControls'
import ChatModelPicker from './ChatModelPicker'
import PlainButton from '../ui/PlainButton'
import { modelLabelFor } from '../chatModelResolution'
import { modelWord } from './modelWord'

export type ChatModelMenuProps = { session: ChatControlsView }

/** ONE control folding connector/model/effort behind the model word. Reads `props.session` at each use rather than binding it
 *  to a local: a `const session = props.session` alias would read the prop once at setup and keep
 *  that value forever even if a later render hands the component a different session. */
const ChatModelMenu: Component<ChatModelMenuProps> = props => {
    const [open, setOpen] = createSignal(false)
    let trigger!: HTMLButtonElement

    const word = () => {
        const label = modelLabelFor(
            props.session.displayModel(),
            props.session.models(),
        )
        return label ? modelWord(label) : 'default model'
    }

    return (
        <div
            class={styles['model-menu']}
            data-chat-model
            data-testid="chat-model"
        >
            <PlainButton
                ref={trigger}
                class={styles.word}
                title="Connector, model and effort"
                aria-haspopup="dialog"
                aria-expanded={open()}
                data-chat-model-anchor
                onClick={() => setOpen(v => !v)}
            >
                {word()}
            </PlainButton>
            <Show when={open()}>
                <Portal>
                    <ChatModelPicker
                        session={props.session}
                        anchor={trigger}
                        onClose={() => setOpen(false)}
                    />
                </Portal>
            </Show>
        </div>
    )
}

export default ChatModelMenu
