// app/src/chat/ChatSessionProbe.tsx
// DEV-ONLY: renders a chat session's state as labelled readouts, so the session controller
// (chatSession.ts) is provable in Storybook before any real view composes it. Not used by the app.
import {
    createEffect,
    createSignal,
    onCleanup,
    For,
    Show,
    type Component,
} from 'solid-js'
import type { ChatSession } from './chatSession'
import Text from '../ui/Text'
import styles from './ChatSessionProbe.module.css'

export type ChatSessionProbeProps = {
    /** The session to read; undefined renders a "not retained" readout. */
    session: ChatSession | undefined
    class?: string
}

type Readout = { key: string; label: string; value: () => string }

const ChatSessionProbe: Component<ChatSessionProbeProps> = props => {
    // Counts onFocusRequest firings for the session currently bound (New chat, provider switch, a
    // history resume, Stop restoring queued text, a quote reply, a drop/mention insert) — the probe
    // has no ref of its own to focus, so a count is the only observable proof the seam fired.
    const [focusRequests, setFocusRequests] = createSignal(0)
    createEffect(() => {
        const session = props.session
        setFocusRequests(0)
        if (!session) return
        const off = session.onFocusRequest(() => setFocusRequests(n => n + 1))
        onCleanup(off)
    })

    const readouts: Readout[] = [
        {
            key: 'transcript',
            label: 'transcript items',
            value: () => String(props.session?.transcript.length ?? 0),
        },
        {
            key: 'queued',
            label: 'queued turns',
            value: () =>
                String(
                    props.session?.transcript.filter(
                        it => it.role === 'user' && it.queued,
                    ).length ?? 0,
                ),
        },
        {
            key: 'streaming',
            label: 'streaming',
            value: () => String(props.session?.streaming() ?? false),
        },
        {
            key: 'awaiting',
            label: 'awaiting reply',
            value: () => String(props.session?.awaitingReply() ?? false),
        },
        {
            key: 'model',
            label: 'manifest model',
            value: () => props.session?.manifest()?.model ?? '—',
        },
        {
            key: 'permmode',
            label: 'permission mode',
            value: () => props.session?.permMode() ?? '—',
        },
        {
            key: 'focus',
            label: 'focus requests',
            value: () => String(focusRequests()),
        },
        {
            key: 'draft',
            label: 'draft',
            value: () => props.session?.draft() ?? '',
        },
        {
            key: 'error',
            label: 'turn error',
            value: () => props.session?.turnError() ?? '—',
        },
    ]

    return (
        <div
            class={[styles.probe, props.class].filter(Boolean).join(' ')}
            data-testid="chat-session-probe"
        >
            <Text size="micro" tone="muted" eyebrow>
                <Show when={props.session} fallback="session not retained">
                    {session => `session ${session().chatId}`}
                </Show>
            </Text>
            <div class={styles.grid}>
                <For each={readouts}>
                    {r => (
                        <>
                            <Text as="span" size="ui" tone="muted">
                                {r.label}
                            </Text>
                            <div
                                class={styles.value}
                                data-testid={`probe-${r.key}`}
                            >
                                <Text as="span" size="ui">
                                    {r.value()}
                                </Text>
                            </div>
                        </>
                    )}
                </For>
            </div>
        </div>
    )
}

export default ChatSessionProbe
