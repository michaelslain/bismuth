// app/src/chat/ChatControls.tsx
// The provider/model/effort/browser/permission controls, the tools/MCP/context readouts, and the
// auth/history/new-chat actions — moved out of the old inline ChatHeader.tsx so they can render TWO
// ways from the SAME session-driven markup:
//   chatControlSlots(session) — split into ViewBar regions for ChatHeader (the chat tab's bar).
//   <ChatControls session/>   — the same controls as ONE quiet inline row for a host with no bar
//     (the daemon page): faint ui-size mono text, no boxes, readouts omitted (Acceptance: "the chat
//     controls … are ONE quiet row of faint ui-size mono text directly under the composer — no
//     boxes, no amber fill or border").
//
// The history and auth popovers (ChatHistoryPanel / ChatAuthPanel) are anchored inside `actions`
// in both shapes — this file owns only the ANCHOR + the toggle pill/button, never the popover body.
import { createSignal, Show, type JSX } from 'solid-js'
import styles from './ChatControls.module.css'
import type { ChatSession } from './chatSession'
import type { ViewBarSlots } from '../ui/ViewBar'
import Select from '../ui/Select'
import { IconButton } from '../ui/IconButton'
import { Icon } from '../icons/Icon'
import { modelLabelFor } from '../chatModelResolution'
import {
    modelPriceBadge,
    opencodeAuthSummary,
    providerCan,
    CHAT_PROVIDER_OPTIONS,
} from '../chatProvider'
import { PERMISSION_MODE_OPTIONS } from '../chatPermissionMode'
import ChatHistoryPanel from './ChatHistoryPanel'
import ChatAuthPanel from './ChatAuthPanel'
import Text from '../ui/Text'

export type ChatControlSlots = ViewBarSlots

/** The readouts region — tool/MCP counts + the context-window percentage. Gated on the manifest:
 *  nothing sensible to show before the first turn. */
function Readouts(props: { session: ChatSession }) {
    return (
        <Show when={props.session.manifest()}>
            {m => (
                <>
                    <Show when={m().tools.length > 0}>
                        <span
                            class={styles.stat}
                            data-bar-drop="4"
                            data-testid="chat-tools"
                            title={`${m().tools.length} tools available`}
                        >
                            <Icon value="Wrench" size={13} /> {m().tools.length}
                        </span>
                    </Show>
                    <Show when={m().mcpServers.length > 0}>
                        <span
                            class={styles.stat}
                            data-bar-drop="4"
                            data-testid="chat-mcp"
                            title={`${props.session.mcpConnected()}/${m().mcpServers.length} MCP servers connected`}
                        >
                            <Icon value="Server" size={13} />{' '}
                            {props.session.mcpConnected()}/{m().mcpServers.length}
                        </span>
                    </Show>
                    <Show when={props.session.context()}>
                        {c => (
                            <span
                                class={styles.stat}
                                classList={{
                                    [styles.warn]: c().percentage >= 80,
                                }}
                                data-testid="chat-context"
                                title={`Context window: ${c().totalTokens.toLocaleString()} / ${c().maxTokens.toLocaleString()} tokens`}
                            >
                                <Icon value="Gauge" size={13} />{' '}
                                {Math.round(c().percentage)}%
                            </span>
                        )}
                    </Show>
                </>
            )}
        </Show>
    )
}

/** The provider/model/effort/browser/permission-mode controls. `quiet` drops the boxed picker
 *  chrome for a host with no bar (the daemon row) — see ChatControls.module.css's `.quiet` register. */
function Config(props: { session: ChatSession }) {
    const session = props.session
    return (
        <>
            <span class={styles['bar-item']} data-bar-drop="2" data-testid="chat-provider">
                <Select
                    class={styles['provider-select']}
                    value={session.provider()}
                    options={CHAT_PROVIDER_OPTIONS}
                    onChange={session.switchProvider}
                />
            </span>
            <span class={styles['bar-item']} data-testid="chat-model">
                <Show
                    when={session.models().length > 1}
                    fallback={
                        <span class={styles['model-label']} title="Active model">
                            {modelLabelFor(
                                session.displayModel(),
                                session.models(),
                            ) || 'Default model'}
                        </span>
                    }
                >
                    <Select
                        class={styles['model-select']}
                        value={session.displayModelValue()}
                        placeholder="Default model"
                        options={session.models().map(m => ({
                            value: m.value,
                            label: m.label,
                            detail: modelPriceBadge(m.free),
                        }))}
                        onChange={session.switchModel}
                    />
                </Show>
            </span>
            <Show when={session.effortOptions().length > 1}>
                <span class={styles['bar-item']} data-bar-drop="3" data-testid="chat-effort">
                    <Select
                        class={styles['effort-select']}
                        value={session.effortValue()}
                        placeholder="Effort"
                        options={session.effortOptions()}
                        onChange={session.switchEffort}
                    />
                </span>
            </Show>
            <Show when={providerCan(session.provider(), 'computerUse')}>
                <IconButton
                    icon="Globe"
                    data-testid="chat-computer-use"
                    label={
                        session.computerUse()
                            ? 'Browser (--chrome) on'
                            : 'Browser (--chrome) off'
                    }
                    title={
                        session.computerUse()
                            ? '--chrome enabled — click to disable (applies from your next message)'
                            : 'Enable --chrome browser/computer-use (applies from your next message)'
                    }
                    variant={session.computerUse() ? 'selected' : 'normal'}
                    onClick={session.toggleComputerUse}
                />
            </Show>
            <Show when={providerCan(session.provider(), 'permissionModes')}>
                {/* Bypass reads by TEXT TONE ONLY (Acceptance) — no box, no border; see the
                    `.mode-select--armed` rule in ChatControls.module.css. */}
                <span class={styles['bar-item']} data-testid="chat-perm-mode">
                    <Select
                        class={
                            styles['mode-select'] +
                            (session.permMode() === 'bypassPermissions'
                                ? ' ' + styles['mode-select--armed']
                                : '')
                        }
                        value={session.permMode()}
                        options={PERMISSION_MODE_OPTIONS}
                        onChange={session.setPermissionMode}
                    />
                </span>
            </Show>
        </>
    )
}

/** The auth pill + history + new-chat actions, with their two popovers anchored here. */
function Actions(props: { session: ChatSession }) {
    const session = props.session
    const [authOpen, setAuthOpen] = createSignal(false)
    return (
        <>
            <Show when={session.provider() === 'opencode'}>
                <div class={styles['auth-anchor']} data-chat-auth-anchor>
                    <button
                        type="button"
                        class={`${styles.stat} ${styles['auth-pill']}`}
                        classList={{
                            [styles['auth-out']]:
                                opencodeAuthSummary(session.authProviders())
                                    .signedIn === false,
                            selected: authOpen(),
                        }}
                        data-testid="chat-auth"
                        title="opencode credentials"
                        onClick={() => setAuthOpen(v => !v)}
                    >
                        <Icon value="KeyRound" size={13} />{' '}
                        {opencodeAuthSummary(session.authProviders()).label}
                    </button>
                    <Show when={authOpen()}>
                        <ChatAuthPanel
                            providers={session.authProviders()}
                            onClose={() => setAuthOpen(false)}
                        />
                    </Show>
                </div>
            </Show>
            <Show when={providerCan(session.provider(), 'sessionPicker')}>
                <div class={styles['history-anchor']} data-chat-history-anchor>
                    <IconButton
                        icon="MessagesSquare"
                        label="Past conversations"
                        data-testid="chat-history"
                        variant={session.history.open() ? 'selected' : 'normal'}
                        onClick={session.history.toggle}
                    />
                    <Show when={session.history.open()}>
                        <ChatHistoryPanel
                            history={session.history}
                            onNewChat={session.startNewChat}
                        />
                    </Show>
                </div>
            </Show>
            <IconButton
                icon="Plus"
                label="New chat"
                data-testid="chat-new"
                onClick={session.startNewChat}
            />
        </>
    )
}

/** The provider/model/effort/browser/permission selects, the tools/MCP/context readouts, and the
 *  auth/history/new-chat actions, split into ViewBar regions — ChatHeader spreads this. */
export function chatControlSlots(session: ChatSession): ChatControlSlots {
    return {
        readouts: <Readouts session={session} />,
        config: <Config session={session} />,
        actions: <Actions session={session} />,
    }
}

export type ChatControlsProps = { session: ChatSession | undefined; class?: string }

/** The same controls as ONE quiet inline row for a host with no bar (the daemon page). Readouts
 *  omitted. With no session: renders the row disabled at the same height, so arming the daemon
 *  chat doesn't shift the composer beneath it. */
export default function ChatControls(props: ChatControlsProps): JSX.Element {
    return (
        <div class={`${styles.row} ${props.class ?? ''}`}>
            <Show
                when={props.session}
                fallback={
                    <Text as="span" size="ui" tone="faint" class={styles.placeholder}>
                        ···
                    </Text>
                }
            >
                {session => (
                    <>
                        <Config session={session()} />
                        <Actions session={session()} />
                    </>
                )}
            </Show>
        </div>
    )
}
