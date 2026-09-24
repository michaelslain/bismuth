// app/src/chat/ChatControls.tsx
// The permission-mode control (provider/model/effort are ChatModelMenu.tsx's now, and the old
// browser/--chrome toggle is deleted), the tools/MCP/context readouts, and the
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
// The auth popover (ChatAuthPanel) is anchored inside `actions` in both shapes — this file owns
// only the ANCHOR + the toggle pill/button, never the popover body. History's own popover
// (ChatHistoryPanel) is no longer anchored here at all: Task 4 has it render as a full-region pane
// in the HOST (ChatView.tsx / DaemonChat.tsx), in place of the transcript + composer, so this file
// keeps only the "history" toggle button.
import { createSignal, Show, type JSX } from 'solid-js'
import styles from './ChatControls.module.css'
import type { ChatSession } from './chatSession'
import type { ViewBarSlots } from '../ui/ViewBar'
import Select from '../ui/Select'
import { TextButton } from '../ui/TextButton'
import Text from '../ui/Text'
import { Icon } from '../icons/Icon'
import ChatModelMenu from './ChatModelMenu'
import { opencodeAuthSummary, providerCan, sanitizeChatProvider } from '../chatProvider'
import { PERMISSION_MODE_OPTIONS } from '../chatPermissionMode'
import {
    browserStorage,
    readLastEffort,
    readLastMode,
    readLastModel,
    readProviderChoice,
} from './chatSessionPrefs'
import { settings } from '../settings'
import ChatAuthPanel from './ChatAuthPanel'

export type ChatControlSlots = ViewBarSlots

/** A bracket text control for the row's actions (history/new chat) — `TextButton`, the app's
 *  standard command control (button-family migration: every clickable command renders as
 *  TextButton/IconButton/IconTextButton, never a hand-styled PlainButton — PlainButton is reserved
 *  for readouts/rows, not commands). `history` is a TOGGLE (the history panel is open or not), so
 *  it gets `variant="selected"|"unselected"` from `active`; `new chat` passes no `active` at all,
 *  so it falls through to plain `variant="normal"` — a one-shot action, not a toggle member. */
function RowAction(props: {
    label: string
    active?: boolean
    testId?: string
    onClick: () => void
    title?: string
}) {
    const variant = () =>
        props.active === undefined
            ? 'normal'
            : props.active
              ? 'selected'
              : 'unselected'
    return (
        <TextButton
            variant={variant()}
            data-testid={props.testId}
            title={props.title}
            onClick={props.onClick}
        >
            {props.label}
        </TextButton>
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
                        <Text
                            as="span"
                            inherit
                            class={styles.stat}
                            data-bar-drop="4"
                            data-testid="chat-tools"
                            title={`${m().tools.length} tools available`}
                        >
                            <Icon value="Wrench" /> {m().tools.length}
                        </Text>
                    </Show>
                    <Show when={m().mcpServers.length > 0}>
                        <Text
                            as="span"
                            inherit
                            class={styles.stat}
                            data-bar-drop="4"
                            data-testid="chat-mcp"
                            title={`${props.session.mcpConnected()}/${m().mcpServers.length} MCP servers connected`}
                        >
                            <Icon value="Server" />{' '}
                            {props.session.mcpConnected()}/{m().mcpServers.length}
                        </Text>
                    </Show>
                    <Show when={props.session.context()}>
                        {c => (
                            <Text
                                as="span"
                                inherit
                                class={styles.stat}
                                classList={{
                                    [styles.warn]: c().percentage >= 80,
                                }}
                                data-testid="chat-context"
                                title={`Context window: ${c().totalTokens.toLocaleString()} / ${c().maxTokens.toLocaleString()} tokens`}
                            >
                                <Icon value="Gauge" />{' '}
                                {Math.round(c().percentage)}%
                            </Text>
                        )}
                    </Show>
                </>
            )}
        </Show>
    )
}

/** The permission-mode control. Provider/model/effort and the browser toggle are gone from here —
 *  ChatModelMenu owns the first three (folded behind the model word), and the browser (--chrome)
 *  toggle is deleted outright (Task 2: "no browser toggle"). Reads `props.session` at each use
 *  rather than binding it to a local — this is a Solid component, and a `const session =
 *  props.session` alias reads the prop ONCE at setup and keeps that value forever even if a later
 *  render hands the component a different session (switching the active chat). */
function Config(props: { session: ChatSession }) {
    return (
        <Show when={providerCan(props.session.provider(), 'permissionModes')}>
            {/* Permission mode: rendered from the START (not gated on the manifest) so the
                header is populated the instant the chat opens (BUG #14). Seeded to the app
                default and updated live. NEVER DROPPED — its armed tint is the only signal that
                the agent is writing to the vault unconfirmed. */}
            <Text
                as="span"
                inherit
                class={styles['bar-item']}
                data-testid="chat-perm-mode"
            >
                <Select
                    caretClass={styles['mode-caret']}
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
            </Text>
        </Show>
    )
}

/** The auth pill + history + new-chat actions, with their two popovers anchored here. Wrapped in
 *  ONE `.actions` cluster — a single child of `.row` — so the three sit `--sp-4` apart with NO `//`
 *  between them: brackets already separate adjacent commands, and `//` is reserved for separating
 *  readout GROUPS (Acceptance 7: "opus 4.8 // bypass // [history] [new chat]" — exactly two `//`,
 *  none inside the actions cluster itself). */
function Actions(props: { session: ChatSession }) {
    const [authOpen, setAuthOpen] = createSignal(false)
    return (
        <div class={styles.actions}>
            {/* Text-only, like every other control in the row (Acceptance: "every control a
                lowercase text label") — the KeyRound glyph that used to sit in front of the summary
                is dropped; the summary text itself is the app's own copy (e.g. "signed out"), left
                as returned rather than force-lowercased. `danger` (not a hand-rolled `.auth-out`
                class) carries the signed-out tone — the same orthogonal prop every other danger
                control in the app uses. */}
            <Show when={props.session.provider() === 'opencode'}>
                <div class={styles['auth-anchor']} data-chat-auth-anchor>
                    <TextButton
                        variant={authOpen() ? 'selected' : 'unselected'}
                        danger={
                            opencodeAuthSummary(props.session.authProviders())
                                .signedIn === false
                        }
                        data-testid="chat-auth"
                        title="opencode credentials"
                        onClick={() => setAuthOpen(v => !v)}
                    >
                        {opencodeAuthSummary(props.session.authProviders()).label}
                    </TextButton>
                    <Show when={authOpen()}>
                        <ChatAuthPanel
                            providers={props.session.authProviders()}
                            onClose={() => setAuthOpen(false)}
                        />
                    </Show>
                </div>
            </Show>
            {/* NEVER DROPPED — a row with no way to reach past chats or start a new one is a
                broken one, same reasoning as "New chat" below. The popover itself is no longer
                anchored here: Task 4 has the host (ChatView/DaemonChat) render ChatHistoryPanel as
                a full-region pane in place of the transcript/composer when open, so this is just
                the toggle. */}
            <Show when={providerCan(props.session.provider(), 'sessionPicker')}>
                <RowAction
                    label="history"
                    active={props.session.history.open()}
                    testId="chat-history"
                    title="Past conversations"
                    onClick={props.session.history.toggle}
                />
            </Show>
            <RowAction
                label="new chat"
                testId="chat-new"
                title="New chat"
                onClick={props.session.startNewChat}
            />
        </div>
    )
}

/** The permission-mode select, the tools/MCP/context readouts, and the
 *  auth/history/new-chat actions, split into ViewBar regions — ChatHeader spreads this. */
export function chatControlSlots(session: ChatSession): ChatControlSlots {
    return {
        readouts: <Readouts session={session} />,
        config: <Config session={session} />,
        actions: <Actions session={session} />,
    }
}

export type ChatControlsProps = {
    session: ChatSession | undefined
    /** The chat id the disabled fallback should seed its provider/model from — the SAME id the real
     *  session will be created with once armed (the daemon page passes `DAEMON_CHAT_ID`). Omit when
     *  no chat id exists yet (e.g. no host chat id at all); the fallback then reads the global prefs
     *  only, same as before. */
    chatId?: string
    class?: string
}

/** A session-shaped object with no live wiring — every accessor a constant, every action a no-op —
 *  used ONLY to render ChatModelMenu/Config/Actions before a real session exists. This is what
 *  "render the real controls disabled" means: the SAME components, the SAME classes, the SAME
 *  control set as the armed row (so the row is the same height and shape at every width — there is
 *  no longer a narrow-width ladder to keep in sync; the model control alone shrinks, see
 *  ChatControls.module.css), wrapped in `.disabled` (the app's standard disabled opacity, matching
 *  `.btn:disabled` in ui/ui.css) plus the DOM's own `inert` attribute on `.row` (ChatControls.tsx)
 *  so nothing in it is actually clickable OR reachable by Tab.
 *
 *  SEEDED FROM THE SAME PERSISTED PREFS the real session will boot from (chatSessionPrefs.ts), not
 *  hardcoded constants — that WAS the bug (final-findings Group 2 #2): this used to hardcode
 *  `permMode: 'default'` while `createChatSession` seeds real sessions from `readLastMode`, whose
 *  own fallback is `DEFAULT_PERMISSION_MODE` ('bypassPermissions') — so arming visibly flipped the
 *  row from grey "Default" to amber "Bypass" the instant a session existed, exactly the on-screen
 *  change Acceptance forbids ("arming must change nothing on screen"). Built fresh on every render
 *  of the fallback branch (not a module-level constant) so a preference changed elsewhere in the same
 *  tab is picked up immediately, matching a real session's own initial read.
 *  Mirrors `createChatSession`'s own provider/model reads EXACTLY — same functions, same order, same
 *  fallbacks — `readProviderChoice(storage, chatId) ?? sanitizeChatProvider(settings.chat.provider)`
 *  then `readLastModel(storage, provider, chatId)` — so a host that passes its chat id (the daemon
 *  page's `DAEMON_CHAT_ID`) sees the SAME per-chat provider/model the armed session will adopt, not
 *  just the global fallback that used to be all this read (a model once picked inside that chat used
 *  to make the row's text change the instant it armed). With no `chatId`, both reads only have a
 *  GLOBAL key to check, which is the exact value a genuinely brand-new chat (no existing per-chat key
 *  yet) would also fall back to. */
function buildDisabledSession(chatId?: string): ChatSession {
    const storage = browserStorage()
    const provider =
        (chatId ? readProviderChoice(storage, chatId) : null) ??
        sanitizeChatProvider(settings.chat.provider)
    const model = readLastModel(storage, provider, chatId)
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
                    const disabled = buildDisabledSession(props.chatId)
                    return (
                        <>
                            <ChatModelMenu session={disabled} />
                            <Config session={disabled} />
                            <Actions session={disabled} />
                        </>
                    )
                })()}
            >
                {session => (
                    <>
                        <ChatModelMenu session={session()} />
                        <Config session={session()} />
                        <Actions session={session()} />
                    </>
                )}
            </Show>
        </div>
    )
}
