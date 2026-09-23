// app/src/chat/ChatSetupGate.tsx — ChatSetupGate.tsx is the ONLY importer of ChatSetupGate.module.css.
// The "this chat can't run" dead end, extracted so ChatView and DaemonChat share ONE copy of the
// install/refusal copy instead of two forks (final review: DaemonChat's copy had lost the install
// instructions and used bare `<p>`). Renders one of three ChatSetup states — a visibility refusal
// (the backend is installed, it just can't be trusted with this vault's hidden notes), the active
// provider's CLI missing, or opencode's CLI missing while it's the active provider — or `children`
// when the session has neither problem.
import { Match, Show, Switch, type JSX } from 'solid-js'
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
    class?: string
    children: JSX.Element
}

export default function ChatSetupGate(props: ChatSetupGateProps): JSX.Element {
    const gateRefusal = () => props.session.gateRefusal()
    const setupError = () => props.session.setupError()
    const blocked = () => !!gateRefusal() || !!setupError()
    const switchProvider = (provider: string) =>
        props.session.switchProvider(provider)

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
                    {/* Provider-specific guidance: name the missing CLI, how to get it, and a
                        one-click switch to the OTHER provider — gate gracefully, never a dead
                        end with no way out. */}
                    <Match when={setupError() === 'opencode'}>
                        <ChatSetup
                            icon="MessageSquare"
                            iconLabel="Chat"
                            heading="opencode isn't available"
                            body={
                                <Text>
                                    This chat is set to the opencode provider,
                                    but the <code>opencode</code> CLI wasn't
                                    found on your machine. Install it from
                                    opencode.ai (e.g.{' '}
                                    <code>brew install sst/tap/opencode</code>
                                    ), then reopen this tab.
                                </Text>
                            }
                            actionLabel="use claude code instead"
                            onAction={() => switchProvider('claude')}
                        />
                    </Match>
                    <Match when={setupError()}>
                        <ChatSetup
                            icon="MessageSquare"
                            iconLabel="Chat"
                            heading="Claude Code isn't available"
                            body={
                                <Text>
                                    This chat runs the <code>claude</code> CLI
                                    on your machine — it isn't installed or
                                    signed in. Install Claude Code and sign
                                    in, then reopen this tab.
                                </Text>
                            }
                            actionLabel="use opencode instead"
                            onAction={() => switchProvider('opencode')}
                        />
                    </Match>
                </Switch>
            </div>
        </Show>
    )
}
