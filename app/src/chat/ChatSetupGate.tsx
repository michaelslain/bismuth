// app/src/chat/ChatSetupGate.tsx — ChatSetupGate.tsx is the ONLY importer of ChatSetupGate.module.css.
// The "this chat can't run" dead end, extracted so ChatView and DaemonChat share ONE copy of the
// install/refusal copy instead of two forks (final review: DaemonChat's copy had lost the install
// instructions and used bare `<p>`). Renders one of two ChatSetup states — a visibility refusal
// (the backend is installed, it just can't be trusted with this vault's hidden notes), or the
// backend-neutral three-line "<agent> isn't installed" screen when no agent can run (an `auto` chat with
// nothing installed, or an explicitly chosen backend that is missing) — or `children` when the
// session has neither problem.
import {
    Match,
    Show,
    Switch,
    createSignal,
    createEffect,
    on,
    type Component,
    type JSX,
} from 'solid-js'
import type {
    FreeAgentProgress,
    FreeAgentStatus,
} from '../../../core/src/freeAgent'
import { api } from '../api'
import FreeAgentSetup, { FREE_AGENT_COPY } from './FreeAgentSetup'
import AgentSwitchRow from './AgentSwitchRow'
import { completeFreeAgentSetup } from './freeAgentClient'
import {
    agentBackends,
    refreshAgentAvailability,
    setAgentStatus,
} from './agentAvailability'
import type { ChatSession } from './chatSession'
import ChatSetup from '../ChatSetup'
import Text from '../ui/Text'
import { providerLabel, sanitizeChatProvider } from '../chatProvider'
import styles from './ChatSetupGate.module.css'

export type ChatSetupGateProps = {
    session: ChatSession
    /** The daemon page's centre column: render the dead end at its own content height instead of
     *  filling the host (ChatSetup's own `flex: 1 1 auto` only does anything inside a flex parent
     *  that WANTS it to fill — see ChatSetupGate.module.css). */
    compact?: boolean
    /** Use this instead of the shared agent-availability store, and fetch nothing (stories, tests). */
    freeAgentStatus?: FreeAgentStatus
    class?: string
    children: JSX.Element
}

const ChatSetupGate: Component<ChatSetupGateProps> = props => {
    const gateRefusal = () => props.session.gateRefusal()
    const setupError = () => props.session.setupError()
    const blocked = () => !!gateRefusal() || !!setupError()
    const switchProvider = (provider: string) =>
        props.session.switchProvider(provider)

    const [progress, setProgress] = createSignal<FreeAgentProgress>({
        phase: 'idle',
    })
    // Re-read availability whenever the dead end shows, so an agent installed outside the app since
    // the last read is offered in the switch row (and an auto chat parked here can start on it).
    createEffect(
        on(blocked, b => {
            if (b && !props.freeAgentStatus) void refreshAgentAvailability()
        }),
    )
    const backends = () =>
        props.freeAgentStatus ? props.freeAgentStatus.backends : agentBackends()
    /** Every OTHER installed agent — the one-click ways out of this dead end. */
    const alternatives = () =>
        (backends() ?? []).filter(
            b => b.installed && b.id !== props.session.provider(),
        )
    const heading = () =>
        props.session.providerAuto()
            ? 'no agent installed'
            : `${providerLabel(props.session.provider()).toLowerCase()} isn't installed`
    /** The free agent is the row's only button when nothing else is installed on an auto chat. */
    const freeAgentLabel = () =>
        props.session.providerAuto() && alternatives().length === 0
            ? 'set up free agent'
            : 'free agent'
    const copy = () =>
        props.session.providerAuto()
            ? FREE_AGENT_COPY
            : `free agent ${FREE_AGENT_COPY}`
    const busy = () =>
        progress().phase !== 'idle' && progress().phase !== 'error'

    /** Download (or detect) opencode, apply the Zen Free defaults, land the fresh status in the
     *  availability store, then re-open the chat on it. */
    const startFreeAgent = async () => {
        try {
            await completeFreeAgentSetup(
                api,
                localStorage,
                setProgress,
                props.session,
                { onStatus: setAgentStatus },
            )
        } catch (e) {
            setProgress({
                phase: 'error',
                message: e instanceof Error ? e.message : String(e),
            })
        }
    }

    return (
        <Show when={blocked()} fallback={props.children}>
            <div
                class={`${props.compact ? styles.compact : ''} ${props.class ?? ''}`}
            >
                <Switch>
                    {/* A visibility refusal is a DISTINCT dead end from setupError below: the CLI
                        is installed, it just can't be trusted with this vault's hidden notes. Kept
                        as its own top-level Match, not folded into setupError's fallback. */}
                    <Match when={gateRefusal()}>
                        {refusal => (
                            <ChatSetup
                                icon="Lock"
                                iconLabel="Visibility"
                                heading={
                                    <>
                                        {providerLabel(
                                            sanitizeChatProvider(
                                                refusal().binary,
                                            ),
                                        )}{' '}
                                        can't honour this vault's hidden notes
                                    </>
                                }
                                body={<Text>{refusal().message}</Text>}
                                actionLabel="use claude code instead"
                                onAction={() => switchProvider('claude')}
                            />
                        )}
                    </Match>
                    {/* No agent can run: ONE neutral screen for every backend, three lines — what is
                        missing, one row of choices (installed agents, then the free agent as a peer),
                        and the free agent's footnote (or its progress / error). */}
                    <Match when={setupError()}>
                        <ChatSetup
                            heading={heading()}
                            extra={
                                <>
                                    <AgentSwitchRow
                                        backends={alternatives()}
                                        onPick={switchProvider}
                                        freeAgentLabel={freeAgentLabel()}
                                        onFreeAgent={startFreeAgent}
                                        disabled={busy()}
                                    />
                                    <FreeAgentSetup
                                        buttonless
                                        copy={copy()}
                                        progress={progress()}
                                        onStart={startFreeAgent}
                                    />
                                </>
                            }
                        />
                    </Match>
                </Switch>
            </div>
        </Show>
    )
}

export default ChatSetupGate
