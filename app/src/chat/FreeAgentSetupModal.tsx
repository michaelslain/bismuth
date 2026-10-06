// app/src/chat/FreeAgentSetupModal.tsx — "set up free agent" palette panel. Runs the same flow as
// ChatSetupGate and the intro's first-run runner: download (or detect) opencode, apply the Zen
// Free defaults, and land the fresh status in the agent-availability store (so every auto chat
// parked on the setup screen starts on opencode). FreeAgentSetup is presentational; this owns the polling.
import { Show, createSignal, type Component } from 'solid-js'
import type { FreeAgentProgress } from '../../../core/src/freeAgent'
import { api } from '../api'
import FormModal from '../ui/FormModal'
import ModalHeader from '../ui/ModalHeader'
import ModalBody from '../ui/ModalBody'
import Text from '../ui/Text'
import FreeAgentSetup from './FreeAgentSetup'
import { completeFreeAgentSetup } from './freeAgentClient'
import { setAgentStatus } from './agentAvailability'
import styles from './FreeAgentSetupModal.module.css'

export type FreeAgentSetupModalProps = {
    onClose: () => void
    /** Start in this state instead of idle (stories). */
    initialProgress?: FreeAgentProgress
    class?: string
}

const FreeAgentSetupModal: Component<FreeAgentSetupModalProps> = props => {
    const [progress, setProgress] = createSignal<FreeAgentProgress>(
        props.initialProgress ?? { phase: 'idle' },
    )
    let running = false

    const start = async () => {
        if (running) return
        running = true
        try {
            // ready shows only once the defaults have landed, never before
            const done = await completeFreeAgentSetup(
                api,
                localStorage,
                p => {
                    if (p.phase !== 'ready') setProgress(p)
                },
                undefined,
                { onStatus: setAgentStatus },
            )
            setProgress(done)
        } catch (e) {
            setProgress({
                phase: 'error',
                message: e instanceof Error ? e.message : String(e),
            })
        } finally {
            running = false
        }
    }

    return (
        <FormModal
            onClose={props.onClose}
            width={460}
            closeOnBackdrop={false}
            label="set up free agent"
            class={props.class}
        >
            <ModalHeader title="set up free agent" onClose={props.onClose} />
            <ModalBody>
                <div class={styles.column}>
                    <Show
                        when={progress().phase === 'ready'}
                        fallback={
                            <FreeAgentSetup
                                progress={progress()}
                                onStart={start}
                            />
                        }
                    >
                        <Text tone="muted" role="status">
                            ready // new opencode chats run on Zen Free
                            (rotating)
                        </Text>
                    </Show>
                </div>
            </ModalBody>
        </FormModal>
    )
}

export default FreeAgentSetupModal
