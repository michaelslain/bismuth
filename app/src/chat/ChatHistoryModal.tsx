// app/src/chat/ChatHistoryModal.tsx
// The chat history as a dialog over the chat: the shared `<Modal>` shell (scrim, focus trap,
// focus restore, dismiss key) around ChatHistoryPanel. The chat underneath stays mounted — its
// transcript, scroll position and draft are exactly where they were when the dialog closes.
//
// The shell and the body are separate components on purpose: ChatHistoryPanel renders inline in
// its own stories (no portal, no scrim), so its states can be looked at and asserted one by one;
// this file only decides how big the dialog is.
import type { Component } from 'solid-js'
import styles from './ChatHistoryModal.module.css'
import type { ChatHistoryState } from './chatSession'
import ChatHistoryPanel from './ChatHistoryPanel'
import Modal from '../ui/Modal'

export type ChatHistoryModalProps = {
    history: ChatHistoryState
    onNewChat?: () => void
    class?: string
}

const ChatHistoryModal: Component<ChatHistoryModalProps> = props => (
    <Modal
        onClose={() => props.history.close()}
        label="Chat history"
        class={`${styles.dialog} ${props.class ?? ''}`}
    >
        <ChatHistoryPanel history={props.history} onNewChat={props.onNewChat} />
    </Modal>
)

export default ChatHistoryModal
