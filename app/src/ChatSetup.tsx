// app/src/ChatSetup.tsx
// The "this chat can't run" screen ChatView.tsx renders INSTEAD of the transcript+composer: either
// the active provider's CLI isn't installed (setupError), or this vault's hidden-notes policy can't
// be honoured by the active backend (gateRefusal) — see core/src/chat.ts's "visibility-refused"
// frame. Both are the same layout (a disabled illustration icon, a heading, one paragraph of
// guidance, one escape-hatch button) with different copy, so this is ONE parameterized component,
// not three copy-pasted blocks. Extracted per the visual-unification audit §6/§9.8:
// ChatSetup.module.css already existed as its own file with no component behind it.
import type { Component, JSX } from 'solid-js'
import styles from './ChatSetup.module.css'
import { IconButton } from './ui/IconButton'
import { TextButton } from './ui/TextButton'
import Heading from './ui/Heading'

export type ChatSetupProps = {
    /** Registry icon name for the large, disabled, decorative illustration mark. */
    icon: string
    /** Accessible label for that icon (it renders disabled, so this is descriptive only). */
    iconLabel: string
    heading: JSX.Element
    body: JSX.Element
    actionLabel: string
    onAction: () => void
}

/** A dead-end screen with exactly one way out. Never tells the user to install anything unless the
 *  CLI is genuinely missing — a visibility refusal (the backend IS installed, it just can't be
 *  trusted with hidden notes) uses the same shell with different copy. */
const ChatSetup: Component<ChatSetupProps> = props => (
    <div class={styles['chat-setup']}>
        <div class={styles['chat-setup-icon']}>
            {/* iconSize is IconButton's sanctioned per-call escape hatch for an oversized
                illustration mark (visual-unification audit §9.5) — not a bare <Icon size=>
                override. */}
            <IconButton icon={props.icon} label={props.iconLabel} iconSize={28} disabled />
        </div>
        <Heading level={3}>{props.heading}</Heading>
        {props.body}
        <TextButton onClick={props.onAction}>{props.actionLabel}</TextButton>
    </div>
)

export default ChatSetup
export { ChatSetup }
