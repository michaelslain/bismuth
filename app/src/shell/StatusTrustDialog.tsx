import { For, Show, type Component } from 'solid-js'
import Modal from '../ui/Modal'
import ModalHeader from '../ui/ModalHeader'
import ModalBody from '../ui/ModalBody'
import ModalFooter from '../ui/ModalFooter'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import { isApprovable, visibleParts } from './visibleCommand'
import styles from './StatusTrustDialog.module.css'

export type StatusTrustDialogProps = {
    /** The full command the status bar wants to run, verbatim. */
    command: string
    onConfirm: () => void
    onCancel: () => void
    className?: string
}

// The approval boundary for a `run:` status segment: the bar only shows a truncated command, so
// the owner must see the WHOLE thing here, with invisible/control characters made visible, before
// the trust API is called. Escape (ui-dismiss) is wired by Modal and cancels. There is
// deliberately no confirm-key shortcut: initial focus lands on [ cancel ], so a stray Enter is
// safe, and approving a shell command should take a deliberate click on [ allow ].
const StatusTrustDialog: Component<StatusTrustDialogProps> = props => {
    const parts = () => visibleParts(props.command)
    const approvable = () => isApprovable(props.command)
    return (
        <Modal
            onClose={props.onCancel}
            label="run a shell command?"
            panelClass={[styles.panel, props.className]
                .filter(Boolean)
                .join(' ')}
        >
            <ModalHeader
                title="run a shell command?"
                onClose={props.onCancel}
            />
            <ModalBody>
                <div class={styles.stack}>
                    <Text size="ui">
                        this vault's status bar wants to run this command on
                        your machine every time it refreshes:
                    </Text>
                    <Text
                        as="div"
                        size="ui"
                        class={styles.command}
                        data-suspicious={
                            parts().some(p => p.hidden) ? '' : undefined
                        }
                    >
                        <For each={parts()}>
                            {part => (
                                <Show when={part.hidden} fallback={part.text}>
                                    <Text as="span" inherit class={styles.mark}>
                                        {part.text}
                                    </Text>
                                    {part.text === '⏎' ? '\n' : ''}
                                </Show>
                            )}
                        </For>
                    </Text>
                    <Show
                        when={approvable()}
                        fallback={
                            <Text size="ui" class={styles.refuse}>
                                this command contains hidden line breaks or
                                direction characters and cannot be approved. fix
                                it in .settings.
                            </Text>
                        }
                    >
                        <Text size="ui" tone="muted">
                            only allow commands you recognise. editing the
                            command will ask again.
                        </Text>
                    </Show>
                </div>
            </ModalBody>
            <ModalFooter>
                <TextButton onClick={props.onCancel}>
                    {approvable() ? 'cancel' : 'close'}
                </TextButton>
                <Show when={approvable()}>
                    <TextButton primary onClick={props.onConfirm}>
                        allow
                    </TextButton>
                </Show>
            </ModalFooter>
        </Modal>
    )
}

export default StatusTrustDialog
