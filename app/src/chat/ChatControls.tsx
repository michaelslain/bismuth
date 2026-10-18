// app/src/chat/ChatControls.tsx
// The permission-mode control (provider/model/effort are ChatModelMenu.tsx's now, and the old
// browser/--chrome toggle is deleted) and the auth/history/new-chat actions — moved out of the old
// inline ChatHeader.tsx. The header's readouts are their own component now (ChatReadouts.tsx).
//   <ChatControls session/>   — the model/permission/actions controls as ONE quiet inline row under
//     the composer (chat tab and daemon page): faint ui-size mono text, no boxes (Acceptance: "the chat
//     controls … are ONE quiet row of faint ui-size mono text directly under the composer — no
//     boxes, no amber fill or border"). There is no separate "quiet" prop or register on Config/
//     Actions themselves — the daemon's borderless-at-rest look comes entirely from `.row`'s own
//     ancestor selectors in ChatControls.module.css overriding the shared picker chrome; Config and
//     Actions render identically either way.
//
// opencode credentials are managed inside ChatModelPicker (opened from the model word), so the
// row carries no auth pill. History is not anchored here at all: ChatSessionBody.tsx opens it as a
// dialog over the chat (ChatHistoryModal), so this file keeps only the "history" toggle button.
import { Show, type Component } from 'solid-js'
import styles from './ChatControls.module.css'
import type { ChatSession } from './chatSession'
import { canHandOff } from './chatHandoff'
import Select from '../ui/Select'
import BarTwin from '../ui/BarTwin'
import IconButton from '../ui/IconButton'
import { dismissToast, pushToast } from '../ui/ToastHost'
import Text from '../ui/Text'
import ChatModelMenu from './ChatModelMenu'
import { providerCan, resolveChatProvider } from './chatProvider'
import { installedBackendIds, loadAgentAvailability } from './agentAvailability'
import { PERMISSION_MODE_OPTIONS } from './chatPermissionMode'
import {
    browserStorage,
    readLastEffort,
    readLastMode,
    readLastModel,
    readProviderChoice,
} from './chatSessionPrefs'
import { settings } from '../settings'

/** The members the controls row reads off a session — ChatModelMenu, Config and Actions take this
 *  rather than the whole `ChatSession`, so the no-session row builds only what it renders. */
export type ChatControlsView = Pick<
    ChatSession,
    | 'provider'
    | 'models'
    | 'displayModel'
    | 'displayModelValue'
    | 'effortOptions'
    | 'effortValue'
    | 'permMode'
    | 'switchProvider'
    | 'applyPreset'
    | 'switchModel'
    | 'switchEffort'
    | 'setPermissionMode'
    | 'startNewChat'
    | 'isPrivate'
    | 'setPrivate'
> & { history: Pick<ChatSession['history'], 'open' | 'toggle'> }

/** A command for the row's actions (history/new chat), drawn as a `BarTwin` (ui/BarTwin.tsx): the
 *  worded `[⟲ history]` while there is room, the bare icon below the row's own `@container chatrow`
 *  tier (ChatControls.module.css). `history` is a TOGGLE: `[⟲]` only while open; worded it inks like
 *  `[+ new chat]` beside it while closed (`offVariant="normal"`, the documented exception).
 *  `new chat` is a one-shot action. The wrapper carries `data-row-action`, the hook the row's tier
 *  keys on (chatRowDrop.test.ts checks it is matched inside `@container chatrow`) and the unit the
 *  cluster's spacing counts once. */
type RowActionProps = {
    icon: string
    label: string
    /** A toggle member (history): `active` is whether it is on. Absent = a one-shot action. */
    toggle?: boolean
    active?: boolean
    testId?: string
    onClick: () => void
    title?: string
}

const RowAction: Component<RowActionProps> = props => {
    return (
        <Text as="span" inherit class={styles.action} data-row-action>
            <BarTwin
                drop="row"
                icon={props.icon}
                label={props.label}
                title={props.title}
                active={props.toggle ? !!props.active : undefined}
                offVariant="normal"
                data-testid={props.testId}
                onClick={props.onClick}
            />
        </Text>
    )
}

/** The permission-mode control. Provider/model/effort and the browser toggle are gone from here —
 *  ChatModelMenu owns the first three (folded behind the model word), and the browser (--chrome)
 *  toggle is deleted outright (Task 2: "no browser toggle"). Reads `props.session` at each use
 *  rather than binding it to a local — this is a Solid component, and a `const session =
 *  props.session` alias reads the prop ONCE at setup and keeps that value forever even if a later
 *  render hands the component a different session (switching the active chat). */
const Config: Component<{ session: ChatControlsView }> = props => {
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

/** The history + new-chat actions. Wrapped in
 *  ONE `.actions` cluster — a single child of `.row` — so they sit `--sp-4` apart with NO `//`
 *  between them: brackets already separate adjacent commands, and `//` is reserved for separating
 *  readout GROUPS (Acceptance 7: "opus 4.8 // bypass // [history] [new chat]" — exactly two `//`,
 *  none inside the actions cluster itself). */
const Actions: Component<{
    session: ChatControlsView
    openInChat?: OpenInChat
}> = props => {
    /** The private toggle's last toast, replaced by the next click. */
    let privateToast: number | undefined
    return (
        <div class={styles.actions}>
            {/* The daemon page's hand-off: its conversation moves to its own chat tab. Icon only
                (`[↗]`, named by its tooltip) — a secondary action beside the two worded ones. Only a
                host that passes `onOpenInChat` gets it, and only once there is a conversation to
                move. A turn in flight moves with it and keeps streaming in the new tab. */}
            <Show when={props.openInChat}>
                {open => (
                    <Text
                        as="span"
                        inherit
                        class={styles.action}
                        data-row-action
                    >
                        <IconButton
                            icon="ExternalLink"
                            label="open in chat"
                            data-testid="chat-open-in-chat"
                            onClick={open().onClick}
                        />
                    </Text>
                )}
            </Show>
            {/* NEVER DROPPED — a row with no way to reach past chats or start a new one is a
                broken one, same reasoning as "New chat" below. The history itself is a dialog
                ChatSessionBody opens over the chat (ChatHistoryModal), so this is just the
                toggle. */}
            <Show when={providerCan(props.session.provider(), 'sessionPicker')}>
                <RowAction
                    icon="RotateCcw"
                    label="history"
                    toggle
                    active={props.session.history.open()}
                    testId="chat-history"
                    title="Past conversations"
                    onClick={props.session.history.toggle}
                />
            </Show>
            {/* The conversation's private toggle: a bare eye-slash, bracketed while on. The agent's
                record of the conversation is erased when it ends, so it can be flipped at any point. */}
            <Text as="span" inherit class={styles.action}>
                <IconButton
                    icon="EyeSlash"
                    label="private"
                    variant={
                        props.session.isPrivate() ? 'selected' : 'unselected'
                    }
                    data-testid="chat-private-toggle"
                    title={
                        props.session.isPrivate()
                            ? 'Private: this conversation is erased when it ends. Click to keep it'
                            : 'Make private: erase this conversation when it ends'
                    }
                    onClick={() => {
                        const on = !props.session.isPrivate()
                        props.session.setPrivate(on)
                        // Confirms the click: what happens to this conversation when it ends. Each
                        // click replaces the last one's toast, so quick flips never stack.
                        if (privateToast !== undefined)
                            dismissToast(privateToast)
                        privateToast = pushToast(
                            on
                                ? 'Private: this conversation is erased when it ends'
                                : 'This conversation will be kept',
                        )
                    }}
                />
            </Text>
            <RowAction
                icon="Plus"
                label="new chat"
                testId="chat-new"
                title="New chat"
                onClick={props.session.startNewChat}
            />
        </div>
    )
}

/** The the `[↗]` open-in-chat icon action's state, built from the live session. */
type OpenInChat = { onClick: () => void }

export type ChatControlsProps = {
    session: ChatSession | undefined
    /** Moves this conversation to its own chat tab — the daemon page passes it. Shown once the
     *  session has a conversation; omitted, the row is unchanged. */
    onOpenInChat?: () => void
    /** The chat id the disabled fallback should seed its provider/model from — the SAME id the real
     *  session will be created with once armed (the daemon page passes `DAEMON_CHAT_ID`). Omit when
     *  no chat id exists yet (e.g. no host chat id at all); the fallback then reads the global prefs
     *  only, same as before. */
    chatId?: string
    class?: string
}

/** A controls-view object with no live wiring — every accessor a constant, every action a no-op —
 *  used ONLY to render ChatModelMenu/Config/Actions before a real session exists. This is what
 *  "render the real controls disabled" means: the SAME components, the SAME classes, the SAME
 *  control set as the armed row (so the row is the same height and shape at every width — there is
 *  no longer a narrow-width ladder to keep in sync; the model control alone shrinks, see
 *  ChatControls.module.css), wrapped in `.disabled` (every ink drops to `--faint` — a colour, never an opacity) plus the DOM's own `inert` attribute on
 *  `.row` (ChatControls.tsx)
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
 *  fallbacks — `resolveChatProvider(readProviderChoice(storage, chatId), settings.chat.provider,
 *  installedBackendIds())` (so an `auto` chat shows the agent it will actually run on, never a
 *  placeholder) then `readLastModel(storage, provider, chatId)` — so a host that passes its chat id (the daemon
 *  page's `DAEMON_CHAT_ID`) sees the SAME per-chat provider/model the armed session will adopt, not
 *  just the global fallback that used to be all this read (a model once picked inside that chat used
 *  to make the row's text change the instant it armed). With no `chatId`, both reads only have a
 *  GLOBAL key to check, which is the exact value a genuinely brand-new chat (no existing per-chat key
 *  yet) would also fall back to. */
function buildDisabledSession(chatId?: string): ChatControlsView {
    const storage = browserStorage()
    void loadAgentAvailability()
    const provider = resolveChatProvider(
        chatId ? readProviderChoice(storage, chatId) : null,
        settings.chat.provider,
        installedBackendIds(),
    ).provider
    const model = readLastModel(storage, provider, chatId)
    return {
        provider: () => provider,
        isPrivate: () => false,
        setPrivate: () => {},
        models: () => [],
        displayModel: () => model,
        displayModelValue: () => model,
        effortOptions: () => [],
        effortValue: () => readLastEffort(storage),
        permMode: () => readLastMode(storage),
        switchProvider: () => {},
        switchModel: () => {},
        switchEffort: () => {},
        applyPreset: () => {},
        setPermissionMode: () => {},
        startNewChat: () => {},
        history: { open: () => false, toggle: () => {} },
    }
}

/** The same controls as ONE quiet inline row for a host with no bar (the daemon page). Readouts
 *  omitted. With no session: renders the row disabled at the SAME height as the armed row at the
 *  same width, so arming the daemon chat doesn't shift the composer above it. */
const ChatControls: Component<ChatControlsProps> = props => {
    const openInChat = (s: ChatSession): OpenInChat | undefined => {
        const onClick = props.onOpenInChat
        if (!onClick || !canHandOff(s.transcript.length)) return undefined
        return { onClick }
    }
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
                        <Actions
                            session={session()}
                            openInChat={openInChat(session())}
                        />
                    </>
                )}
            </Show>
        </div>
    )
}

export default ChatControls
