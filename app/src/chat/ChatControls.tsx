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
import { Button } from '../ui/Button'
import { Icon } from '../icons/Icon'
import { modelLabelFor } from '../chatModelResolution'
import {
    modelPriceBadge,
    opencodeAuthSummary,
    providerCan,
    sanitizeChatProvider,
    CHAT_PROVIDER_OPTIONS,
} from '../chatProvider'
import { PERMISSION_MODE_OPTIONS } from '../chatPermissionMode'
import {
    browserStorage,
    readLastEffort,
    readLastMode,
    readLastModel,
} from './chatSessionPrefs'
import { settings } from '../settings'
import ChatHistoryPanel from './ChatHistoryPanel'
import ChatAuthPanel from './ChatAuthPanel'

export type ChatControlSlots = ViewBarSlots

/** A plain lowercase text control for the quiet row's actions (browser/history/new chat) — `Button`
 *  itself, not `TextButton` (which enforces UPPERCASE labels and warns in dev otherwise: this row's
 *  whole point is a quiet lowercase line, not a toolbar of shouting buttons). All of `.btn--text`'s
 *  usual chrome (uppercase, padding, border, hover fill) is stripped back down to plain text by the
 *  row's own register in ChatControls.module.css — this component only supplies the state. */
function RowAction(props: {
    label: string
    active?: boolean
    testId?: string
    rowDrop?: string
    onClick: () => void
    title?: string
}) {
    return (
        <Button
            kind="text"
            state={props.active ? 'selected' : 'normal'}
            data-testid={props.testId}
            data-row-drop={props.rowDrop}
            title={props.title}
            onClick={props.onClick}
        >
            {props.label}
        </Button>
    )
}

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
            {/* Dropped entirely (not merely styled quiet) when there is only one provider to pick
                from — Acceptance: "provider select text-only or dropped if it adds nothing". When
                there IS a real choice it stays a real Select, just wearing the row's own borderless,
                caret-less register (ChatControls.module.css) instead of a boxed picker.
                data-row-drop="1": the row's widest single control, and the setting a user changes
                least (switching providers starts a fresh session either way) — first to go. */}
            <Show when={CHAT_PROVIDER_OPTIONS.length > 1}>
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
            </Show>
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
            {/* data-row-drop="2": next to go — a convenience readable from the transcript either
                way, unlike the never-dropped items below. */}
            <Show when={props.session.effortOptions().length > 1}>
                <span
                    class={styles['bar-item']}
                    data-bar-drop="3"
                    data-row-drop="2"
                    data-testid="chat-effort"
                >
                    <Select
                        class={styles['effort-select']}
                        value={props.session.effortValue()}
                        placeholder="Effort"
                        options={props.session.effortOptions()}
                        onChange={props.session.switchEffort}
                    />
                </span>
            </Show>
            {/* data-row-drop="3": narrowest tier — a convenience with an equivalent slash command. */}
            <Show when={providerCan(props.session.provider(), 'computerUse')}>
                <RowAction
                    label="browser"
                    active={props.session.computerUse()}
                    testId="chat-computer-use"
                    rowDrop="3"
                    title={
                        props.session.computerUse()
                            ? '--chrome enabled — click to disable (applies from your next message)'
                            : 'Enable --chrome browser/computer-use (applies from your next message)'
                    }
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
            {/* Text-only, like every other control in the row (Acceptance: "every control a
                lowercase text label") — the KeyRound glyph that used to sit in front of the summary
                is dropped; the summary text itself is the app's own copy (e.g. "signed out"), left
                as returned rather than force-lowercased. */}
            <Show when={props.session.provider() === 'opencode'}>
                <div class={styles['auth-anchor']} data-chat-auth-anchor>
                    <Button
                        kind="text"
                        state={authOpen() ? 'selected' : 'normal'}
                        class={
                            opencodeAuthSummary(props.session.authProviders())
                                .signedIn === false
                                ? styles['auth-out']
                                : undefined
                        }
                        data-testid="chat-auth"
                        title="opencode credentials"
                        onClick={() => setAuthOpen(v => !v)}
                    >
                        {opencodeAuthSummary(props.session.authProviders()).label}
                    </Button>
                    <Show when={authOpen()}>
                        <ChatAuthPanel
                            providers={props.session.authProviders()}
                            onClose={() => setAuthOpen(false)}
                        />
                    </Show>
                </div>
            </Show>
            {/* NEVER DROPPED (no data-row-drop) — a row with no way to reach past chats or start a
                new one is a broken one, same reasoning as "New chat" below. */}
            <Show when={providerCan(props.session.provider(), 'sessionPicker')}>
                <div class={styles['history-anchor']} data-chat-history-anchor>
                    <RowAction
                        label="history"
                        active={props.session.history.open()}
                        testId="chat-history"
                        title="Past conversations"
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
            <RowAction
                label="new chat"
                testId="chat-new"
                title="New chat"
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
 *  disabled opacity, matching `.btn:disabled` in ui/ui.css) so nothing in it is actually clickable.
 *
 *  SEEDED FROM THE SAME PERSISTED PREFS the real session will boot from (chatSessionPrefs.ts), not
 *  hardcoded constants — that WAS the bug (final-findings Group 2 #2): this used to hardcode
 *  `permMode: 'default'` while `createChatSession` seeds real sessions from `readLastMode`, whose
 *  own fallback is `DEFAULT_PERMISSION_MODE` ('bypassPermissions') — so arming visibly flipped the
 *  row from grey "Default" to amber "Bypass" the instant a session existed, exactly the on-screen
 *  change Acceptance forbids ("arming must change nothing on screen"). Built fresh on every render
 *  of the fallback branch (not a module-level constant) so a preference changed elsewhere in the same
 *  tab is picked up immediately, matching a real session's own initial read.
 *  Built with NO chat id (none exists before arming): `readLastModel`/`readProviderChoice` only have
 *  a PER-CHAT key to check once a chat id exists, so this reads their GLOBAL fallback only — the
 *  exact value a genuinely brand-new chat (no existing per-chat key yet) would also fall back to. */
function buildDisabledSession(): ChatSession {
    const storage = browserStorage()
    const provider = sanitizeChatProvider(settings.chat.provider)
    const model = readLastModel(storage, provider)
    return {
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
        provider: () => provider,
        permMode: () => readLastMode(storage),
        displayModel: () => model,
        displayModelValue: () => model,
        effortOptions: () => [],
        effortValue: () => readLastEffort(storage),
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
        onFocusRequest: () => () => {},
        dispose: () => {},
    }
}

/** The same controls as ONE quiet inline row for a host with no bar (the daemon page). Readouts
 *  omitted. With no session: renders the row disabled at the SAME height as the armed row at the
 *  same width, so arming the daemon chat doesn't shift the composer above it. */
export default function ChatControls(props: ChatControlsProps): JSX.Element {
    return (
        <div
            class={`${styles.row} ${props.class ?? ''}`}
            classList={{ [styles.disabled]: !props.session }}
            // `inert`, not `pointer-events: none` (final-findings Group 2 #2) — a disabled row
            // must not be reachable by Tab either, and `inert` is the one attribute that removes a
            // subtree from both hit-testing AND the tab order in one place. `|| undefined`, not a
            // bare boolean: `inert={false}` still renders the attribute (HTML treats its presence,
            // not its value, as "on") — see bases/FlashcardsView.tsx for the same idiom.
            inert={!props.session || undefined}
        >
            <Show
                when={props.session}
                fallback={(() => {
                    const disabled = buildDisabledSession()
                    return (
                        <>
                            <Config session={disabled} />
                            <Actions session={disabled} />
                        </>
                    )
                })()}
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
