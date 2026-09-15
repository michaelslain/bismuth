// app/src/chat/ChatControls.tsx
// The provider/model/effort/browser/permission controls, the tools/MCP/context readouts, and the
// auth/history/new-chat actions — moved out of the old inline ChatHeader.tsx so they can render TWO
// ways from the SAME session-driven markup:
//   chatControlSlots(session) — split into ViewBar regions for ChatHeader (the chat tab's bar).
//   <ChatControls session/>   — the same controls as ONE quiet inline row for a host with no bar
//     (the daemon page): faint ui-size mono text, no boxes, readouts omitted (Acceptance: "the chat
//     controls … are ONE quiet row of faint ui-size mono text directly under the composer — no
//     boxes, no amber fill or border"). There is no separate "quiet" prop or register on Config/
//     Actions themselves — the daemon's borderless-at-rest look comes entirely from `.row`'s own
//     ancestor selectors in ChatControls.module.css overriding the shared picker chrome; Config and
//     Actions render identically either way.
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

/** The provider/model/effort/browser/permission-mode controls. Reads `props.session` at each use
 *  rather than binding it to a local — this is a Solid component, and a `const session =
 *  props.session` alias reads the prop ONCE at setup and keeps that value forever even if a later
 *  render hands the component a different session (switching the active chat). */
function Config(props: { session: ChatSession }) {
    return (
        <>
            <span
                class={styles['bar-item']}
                data-bar-drop="2"
                data-row-drop="1"
                data-testid="chat-provider"
            >
                <Select
                    class={styles['provider-select']}
                    value={props.session.provider()}
                    options={CHAT_PROVIDER_OPTIONS}
                    onChange={props.session.switchProvider}
                />
            </span>
            <span class={styles['bar-item']} data-testid="chat-model">
                <Show
                    when={props.session.models().length > 1}
                    fallback={
                        <span class={styles['model-label']} title="Active model">
                            {modelLabelFor(
                                props.session.displayModel(),
                                props.session.models(),
                            ) || 'Default model'}
                        </span>
                    }
                >
                    <Select
                        class={styles['model-select']}
                        value={props.session.displayModelValue()}
                        placeholder="Default model"
                        options={props.session.models().map(m => ({
                            value: m.value,
                            label: m.label,
                            detail: modelPriceBadge(m.free),
                        }))}
                        onChange={props.session.switchModel}
                    />
                </Show>
            </span>
            <Show when={props.session.effortOptions().length > 1}>
                <span class={styles['bar-item']} data-bar-drop="3" data-testid="chat-effort">
                    <Select
                        class={styles['effort-select']}
                        value={props.session.effortValue()}
                        placeholder="Effort"
                        options={props.session.effortOptions()}
                        onChange={props.session.switchEffort}
                    />
                </span>
            </Show>
            <Show when={providerCan(props.session.provider(), 'computerUse')}>
                <IconButton
                    icon="Globe"
                    data-row-drop="2"
                    data-testid="chat-computer-use"
                    label={
                        props.session.computerUse()
                            ? 'Browser (--chrome) on'
                            : 'Browser (--chrome) off'
                    }
                    title={
                        props.session.computerUse()
                            ? '--chrome enabled — click to disable (applies from your next message)'
                            : 'Enable --chrome browser/computer-use (applies from your next message)'
                    }
                    variant={props.session.computerUse() ? 'selected' : 'normal'}
                    onClick={props.session.toggleComputerUse}
                />
            </Show>
            <Show when={providerCan(props.session.provider(), 'permissionModes')}>
                {/* Permission mode: rendered from the START (not gated on the manifest) so the
                    header is populated the instant the chat opens (BUG #14). Seeded to the app
                    default and updated live.
                    NEVER TAGGED FOR THE LADDER, at any level, in either shape this renders as
                    (ChatHeader's bar or this quiet row). Its armed tint is the only signal that the
                    agent is writing to the vault unconfirmed, and a control that disappears at a
                    narrow pane/pane-column takes that signal with it — leaving exactly the
                    unindicated default the tint exists to prevent. */}
                <span class={styles['bar-item']} data-testid="chat-perm-mode">
                    <Select
                        class={
                            styles['mode-select'] +
                            // ARMED STATE. `bypassPermissions` lets the agent write to the vault
                            // with no per-action confirmation, and it is the app DEFAULT — so the
                            // most consequential runtime setting in the product used to render in
                            // exactly the same weight, size and colour as the model picker beside
                            // it, with no indication once active. A user who forgets it is on has
                            // no way to find out. The warning tone is the indicator; it is
                            // deliberately the ONLY tinted control here so it cannot be mistaken
                            // for decoration (Acceptance, for the quiet row: "a dangerous mode
                            // (Bypass) is signalled by text tone only — no box, no border").
                            (props.session.permMode() === 'bypassPermissions'
                                ? ' ' + styles['mode-select--armed']
                                : '')
                        }
                        value={props.session.permMode()}
                        options={PERMISSION_MODE_OPTIONS}
                        onChange={props.session.setPermissionMode}
                    />
                </span>
            </Show>
        </>
    )
}

/** The auth pill + history + new-chat actions, with their two popovers anchored here. */
function Actions(props: { session: ChatSession }) {
    const [authOpen, setAuthOpen] = createSignal(false)
    return (
        <>
            <Show when={props.session.provider() === 'opencode'}>
                <div class={styles['auth-anchor']} data-chat-auth-anchor>
                    <button
                        type="button"
                        class={`${styles.stat} ${styles['auth-pill']}`}
                        classList={{
                            [styles['auth-out']]:
                                opencodeAuthSummary(props.session.authProviders())
                                    .signedIn === false,
                            selected: authOpen(),
                        }}
                        data-testid="chat-auth"
                        title="opencode credentials"
                        onClick={() => setAuthOpen(v => !v)}
                    >
                        <Icon value="KeyRound" size={13} />{' '}
                        {opencodeAuthSummary(props.session.authProviders()).label}
                    </button>
                    <Show when={authOpen()}>
                        <ChatAuthPanel
                            providers={props.session.authProviders()}
                            onClose={() => setAuthOpen(false)}
                        />
                    </Show>
                </div>
            </Show>
            <Show when={providerCan(props.session.provider(), 'sessionPicker')}>
                <div class={styles['history-anchor']} data-chat-history-anchor>
                    <IconButton
                        icon="MessagesSquare"
                        label="Past conversations"
                        data-testid="chat-history"
                        variant={props.session.history.open() ? 'selected' : 'normal'}
                        onClick={props.session.history.toggle}
                    />
                    <Show when={props.session.history.open()}>
                        <ChatHistoryPanel
                            history={props.session.history}
                            onNewChat={props.session.startNewChat}
                        />
                    </Show>
                </div>
            </Show>
            <IconButton
                icon="Plus"
                label="New chat"
                data-testid="chat-new"
                onClick={props.session.startNewChat}
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

/** A session-shaped object with no live wiring — every accessor a constant, every action a no-op —
 *  used ONLY to render Config/Actions before a real session exists. This is what "render the real
 *  Config/Actions disabled" means: the SAME components, the SAME classes, the SAME control set as
 *  the armed row (so the row is the same height and shape at every width, including the narrow
 *  widths where the armed row starts dropping controls — see the `data-row-drop` ladder in
 *  ChatControls.module.css), wrapped in `.disabled` (pointer-events: none + the app's standard
 *  disabled opacity, matching `.btn:disabled` in ui/ui.css) so nothing in it is actually clickable. */
const DISABLED_SESSION: ChatSession = {
    chatId: '',
    transcript: [],
    draft: () => '',
    setDraft: () => {},
    attachments: () => [],
    removeAttachment: () => {},
    addImageFiles: async () => {},
    addDroppedFiles: async () => {},
    addDroppedPaths: async () => {},
    streaming: () => false,
    awaitingReply: () => false,
    manifest: () => null,
    setupError: () => null,
    gateRefusal: () => null,
    turnError: () => null,
    models: () => [],
    authProviders: () => null,
    provider: () => 'claude',
    permMode: () => 'default',
    displayModel: () => '',
    displayModelValue: () => '',
    effortOptions: () => [],
    effortValue: () => '',
    context: () => null,
    mcpConnected: () => 0,
    computerUse: () => false,
    fileCandidates: () => [],
    slashCommands: () => [],
    slashCommandDetail: () => undefined,
    historyEntries: () => [],
    persona: () => '',
    send: () => {},
    stop: () => {},
    answerPermission: () => {},
    answerQuestion: () => {},
    cancelQueued: () => {},
    setPermissionMode: () => {},
    switchModel: () => {},
    switchEffort: () => {},
    switchProvider: () => {},
    toggleComputerUse: () => {},
    startNewChat: () => {},
    quoteReply: () => {},
    history: {
        open: () => false,
        loading: () => false,
        sessions: () => [],
        scope: () => 'user',
        query: () => '',
        searchHits: () => [],
        searchLoading: () => false,
        toggle: () => {},
        close: () => {},
        setScope: () => {},
        setQuery: () => {},
        resume: async () => {},
    },
    onAppend: () => () => {},
    dispose: () => {},
}

/** The same controls as ONE quiet inline row for a host with no bar (the daemon page). Readouts
 *  omitted. With no session: renders the row disabled at the SAME height as the armed row at the
 *  same width, so arming the daemon chat doesn't shift the composer above it. */
export default function ChatControls(props: ChatControlsProps): JSX.Element {
    return (
        <div
            class={`${styles.row} ${props.class ?? ''}`}
            classList={{ [styles.disabled]: !props.session }}
        >
            <Show
                when={props.session}
                fallback={
                    <>
                        <Config session={DISABLED_SESSION} />
                        <Actions session={DISABLED_SESSION} />
                    </>
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
