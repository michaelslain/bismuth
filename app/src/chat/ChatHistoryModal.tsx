// app/src/chat/ChatHistoryModal.tsx
// The chat history as a dialog over the chat: a FormModal (scrim, focus trap, focus restore,
// dismiss key) with the standard `history` header — whose `[x]` is the one close — around
// ChatHistoryPanel. The chat underneath stays mounted — its transcript, scroll position and draft
// are exactly where they were when the dialog closes.
//
// The shell and the body are separate components on purpose: ChatHistoryPanel renders inline in
// its own stories (no portal, no scrim), so its states can be looked at and asserted one by one;
// this file only decides how big the dialog is. There is no footer: nothing here is confirmed, a
// pick resumes a chat and closes the dialog, and the header and Esc both dismiss.
import type { Component } from 'solid-js'
import styles from './ChatHistoryModal.module.css'
import type { ChatHistoryState } from './chatSession'
import ChatHistoryPanel from './ChatHistoryPanel'
import FormModal from '../ui/FormModal'
import ModalHeader from '../ui/ModalHeader'

export type ChatHistoryModalProps = {
    history: ChatHistoryState
    onNewChat?: () => void
    class?: string
}

const ChatHistoryModal: Component<ChatHistoryModalProps> = props => (
    <FormModal
        onClose={() => props.history.close()}
        label="Chat history"
        width={600}
        class={`${styles.dialog} ${props.class ?? ''}`}
    >
        <ModalHeader title="history" onClose={() => props.history.close()} />
        <ChatHistoryPanel history={props.history} onNewChat={props.onNewChat} />
    </FormModal>
)

export default ChatHistoryModal
