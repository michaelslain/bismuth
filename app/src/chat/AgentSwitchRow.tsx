// app/src/chat/AgentSwitchRow.tsx — AgentSwitchRow.tsx is the ONLY importer of AgentSwitchRow.module.css.
// The setup screen's row of agents: one button per OTHER installed agent plus, optionally, the free agent as a peer, so a chat whose agent is missing is one click from one
// that is here. Renders nothing for an empty list
// (offering nothing would be a dead label). Labels are lowercased, like the rest of the setup copy.
import { For, Show, type Component } from 'solid-js'
import { TextButton } from '../ui/TextButton'
import styles from './AgentSwitchRow.module.css'

export type AgentSwitchRowProps = {
    backends: { id: string; label: string }[]
    onPick: (id: string) => void
    /** A peer choice after the installed agents (the free agent). Renders only with a handler. */
    freeAgentLabel?: string
    onFreeAgent?: () => void
    /** Disables every button (an install is running). */
    disabled?: boolean
    class?: string
}

const AgentSwitchRow: Component<AgentSwitchRowProps> = props => (
    <Show when={props.backends.length > 0 || props.onFreeAgent}>
        <div class={`${styles.row} ${props.class ?? ''}`}>
            <For each={props.backends}>
                {b => (
                    <TextButton
                        class={styles.pick}
                        disabled={props.disabled}
                        onClick={() => props.onPick(b.id)}
                    >
                        {b.label.toLowerCase()}
                    </TextButton>
                )}
            </For>
            <Show when={props.onFreeAgent}>
                <TextButton
                    class={styles.pick}
                    disabled={props.disabled}
                    onClick={() => props.onFreeAgent?.()}
                >
                    {props.freeAgentLabel ?? 'free agent'}
                </TextButton>
            </Show>
        </div>
    </Show>
)

export default AgentSwitchRow
