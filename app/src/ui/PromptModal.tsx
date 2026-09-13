import type { Component, JSX } from 'solid-js'
import { Modal } from './Modal'
import styles from './PromptModal.module.css'

export type PromptModalProps = {
    onClose: () => void
    /** The panel's heading — rendered first, always exactly one. */
    title: JSX.Element
    /** The footer row of buttons — rendered last, always exactly one. */
    actions: JSX.Element
    /** Everything between the title and the actions: hints, inputs, a Select, however many. */
    children: JSX.Element
    class?: string
}

/**
 * The small typed-input / status-and-action modal body shared by FolderPrompt,
 * DaemonOwnerModal, GcalConnectModal, BismuthInstallModal and DaemonSetupModal — five
 * components that were each importing FolderPrompt.css directly for this exact chrome (see
 * ~/.claude/rules/one-module-one-importer.md). Named slots rather than positional children,
 * the same idiom CLAUDE.md documents for ViewBar: `title` and `actions` are always exactly
 * one each across every call site, while everything variable (a status hint, a typed path, a
 * Select, a Show branch) lives in `children` untouched. Owns `closeOnBackdrop={false}` and the
 * panel's own class so no call site repeats either.
 */
const PromptModal: Component<PromptModalProps> = props => {
    return (
        <Modal
            onClose={props.onClose}
            class={`${styles['prompt-modal']} ${props.class ?? ''}`}
            closeOnBackdrop={false}
        >
            <div class={styles['prompt-modal-title']}>{props.title}</div>
            {props.children}
            <div class={styles['prompt-modal-actions']}>{props.actions}</div>
        </Modal>
    )
}

export default PromptModal
