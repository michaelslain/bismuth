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
import Select from '../ui/Select'
import { IconTextButton } from '../ui/IconTextButton'
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
> & { history: Pick<ChatSession['history'], 'open' | 'toggle'> }

/** A bracket control for the row's actions (history/new chat) — `IconTextButton`, the app's
 *  standard command control (button-family migration: every clickable command renders as
 *  TextButton/IconButton/IconTextButton, never a hand-styled PlainButton — PlainButton is reserved
 *  for readouts/rows, not commands). `history` is a TOGGLE (the history panel is open or not), so
 *  it gets `variant="selected"|"unselected"` from `active`; `new chat` passes no `active` at all,
 *  so it falls through to plain `variant="normal"` — a one-shot action, not a toggle member.
 *
 *  The word is wrapped in `data-row-label`, the row's own collapse-ladder hook
 *  (ChatControls.module.css's `@container chatrow` tier) — below that width the label disappears
 *  and the bracket keeps only its icon (`[⟲]`/`[+]`), which is what frees the room the row's
 *  floored model word (ChatModelMenu.module.css) needs to keep its own 3-character minimum. */
type RowActionProps = {
    icon: string
    label: string
    active?: boolean
    testId?: string
    onClick: () => void
    title?: string
}

const RowAction: Component<RowActionProps> = props => {
    const variant = () =>
        props.active === undefined
            ? 'normal'
            : props.active
              ? 'selected'
              : 'unselected'
    return (
        <IconTextButton
            icon={props.icon}
            variant={variant()}
            data-testid={props.testId}
            title={props.title}
            onClick={props.onClick}
        >
            <Text as="span" inherit data-row-label>
                {props.label}
            </Text>
        </IconTextButton>
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
const Actions: Component<{ session: ChatControlsView }> = props => {
    return (
        <div class={styles.actions}>
            {/* NEVER DROPPED — a row with no way to reach past chats or start a new one is a
                broken one, same reasoning as "New chat" below. The history itself is a dialog
                ChatSessionBody opens over the chat (ChatHistoryModal), so this is just the
                toggle. */}
            <Show when={providerCan(props.session.provider(), 'sessionPicker')}>
                <RowAction
                    icon="RotateCcw"
                    label="history"
                    active={props.session.history.open()}
                    testId="chat-history"
                    title="Past conversations"
                    onClick={props.session.history.toggle}
                />
            </Show>
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

export type ChatControlsProps = {
    session: ChatSession | undefined
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
 *  ChatControls.module.css), wrapped in `.disabled` (the app's standard disabled opacity, matching
 *  `.btn:disabled` in global.css's `ui/ui.css` section) plus the DOM's own `inert` attribute on
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

export default ChatControls
