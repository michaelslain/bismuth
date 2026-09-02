// app/src/chat/ChatHeader.tsx — the chat view's toolbar, as a component.
//
// WHY IT IS ITS OWN FILE. This was ~210 lines of JSX inlined in ChatView.tsx, a 3816-line file, and
// it was the ONLY view toolbar in the app with no story — the one bar visual verification could not
// see. Nothing here owns a signal, opens a socket or calls the api: every value and every callback
// arrives as a prop, exactly like app/src/shell/'s components, so a story can render all 13 controls
// from literals with no transport, no session and no manifest.
//
// THE TWO POPOVERS STAY IN ChatView.tsx and arrive as JSX slots (`authPanel` / `historyPanel`).
// They close over session state — the history list, its search, the auth frame — which is precisely
// what this component is not allowed to own. The ANCHORS live here, because their positioning is
// header chrome.
//
// REGIONS, NOT A ROW. Every control answers one of ViewBar's six questions, so it goes in that
// region rather than in source order (see ui/ViewBar.tsx's comment for the vocabulary):
//   identity — the crumb: which chat is this, and is it the daemon's or mine
//   readouts — tools / MCP / context: state you cannot click
//   config   — provider · model · effort · browser · permission mode: what governs this session
//   actions  — auth · history · new chat: do a thing, primary last
// Before this the four `config` controls sat on BOTH sides of the old spacer with the whole readout
// run wedged between them, which is why three of them carried hand-tuned `margin-left`s: they were
// supplying a gap the group they belonged to could not, because the group did not exist. Adjacent
// under `.vb-config`, the region's own gap does it.
import { type Component, type JSX, Show } from 'solid-js'
import ViewBar, { Crumb } from '../ui/ViewBar'
import Select, { type SelectOption } from '../ui/Select'
import { IconButton } from '../ui/IconButton'
import { Icon } from '../icons/Icon'
import { modelLabelFor } from '../chatModelResolution'
import {
    modelPriceBadge,
    opencodeAuthSummary,
    providerCan,
    type ChatProviderChoice,
} from '../chatProvider'
import type { ChatManifest } from '../../../core/src/chat'
import styles from '../ChatHeader.module.css'

/** One entry of the backend's `models` frame — the picker's options and, via `effortLevels`, what
 *  the effort picker is allowed to offer. */
export type ChatHeaderModel = {
    value: string
    label: string
    description: string
    effortLevels: string[]
    free?: boolean
}

/** The `context` frame's window usage, as the readout renders it. */
export type ChatContextUsage = {
    percentage: number
    totalTokens: number
    maxTokens: number
}

export type ChatHeaderProps = {
    /** The pane title — the tab's custom name, else the session title, else the persona. */
    title: string
    /** Daemon-vs-user glyph, mirroring the tab strip's icon. */
    originIcon: string
    provider: ChatProviderChoice
    providerOptions: SelectOption[]
    onSwitchProvider: (value: string) => void
    models: ChatHeaderModel[]
    /** Best-known model id — this session's manifest model, else the last-used one. */
    displayModel: string
    /** …the same value mapped into PICKER space, which is what the Select can match (Bug #89). */
    displayModelValue: string
    onSwitchModel: (value: string) => void
    effortOptions: SelectOption[]
    effortValue: string
    onSwitchEffort: (value: string) => void
    /** null until the first init frame lands — the count readouts are gated on it. */
    manifest: ChatManifest | null
    context: ChatContextUsage | null
    mcpConnected: number
    permMode: string
    permissionModes: SelectOption[]
    onSetPermissionMode: (value: string) => void
    computerUse: boolean
    onToggleComputerUse: () => void
    /** null = the `auth` frame has not landed (or this is not an opencode session). */
    authProviders: { name: string; kind: string }[] | null
    authOpen: boolean
    onToggleAuth: () => void
    /** The opencode auth popover. Rendered by ChatView, anchored here. */
    authPanel?: JSX.Element
    historyOpen: boolean
    onOpenHistory: () => void
    /** The session-history popover. Rendered by ChatView, anchored here. */
    historyPanel?: JSX.Element
    onNewChat: () => void
    /** Merged onto the bar, so one caller can adjust one instance without forking this. */
    class?: string
}

const ChatHeader: Component<ChatHeaderProps> = props => (
    <ViewBar
        class={props.class}
        identity={
            /* Daemon-vs-user glyph (card A). The PANE header only shows when the tab is split, so
               this crumb is the primary at-a-glance "which kind of chat am I reading" mark in the
               common unsplit case. */
            <Crumb icon={props.originIcon}>{props.title}</Crumb>
        }
        readouts={
            /* Tools / MCP / context: counts that only mean something once the manifest reports
               them, so these stay gated on it (nothing sensible to show before the first turn).
               THE TWO COUNTS ARE THE BAR'S FIRST DROP (level 4, the widest tier in the ladder) and
               the context percentage is NOT tagged at all — see the tier table in ui/ui.css. A tool
               count is a curiosity; the context percentage is the only warning the user gets before
               a turn starts failing, so it survives every tier. */
            <Show when={props.manifest}>
                {m => (
                    <>
                        <Show when={m().tools.length > 0}>
                            <span
                                class={styles['chat-stat']}
                                data-bar-drop="4"
                                data-testid="chat-tools"
                                title={`${m().tools.length} tools available`}
                            >
                                <Icon value="Wrench" size={13} />{' '}
                                {m().tools.length}
                            </span>
                        </Show>
                        <Show when={m().mcpServers.length > 0}>
                            <span
                                class={styles['chat-stat']}
                                data-bar-drop="4"
                                data-testid="chat-mcp"
                                title={`${props.mcpConnected}/${m().mcpServers.length} MCP servers connected`}
                            >
                                <Icon value="Server" size={13} />{' '}
                                {props.mcpConnected}/{m().mcpServers.length}
                            </span>
                        </Show>
                        <Show when={props.context}>
                            {c => (
                                <span
                                    class={`${styles['chat-stat']} ${styles['chat-context']}`}
                                    classList={{
                                        [styles['warn']]: c().percentage >= 80,
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
        }
        config={
            /* THE WRAPPER SPANS ARE NOT CEREMONY. `Select` types its props explicitly and has no
               rest spread, so `data-bar-drop` / `data-testid` written on one is a TYPE ERROR rather
               than a silently-inert attribute — and an inert tier attribute is exactly the failure
               this codebase keeps shipping. The wrapper carries the hook; `.chat-bar-item` is
               `display: inline-flex`, so the Select still sizes and sits exactly as it did.

               THE LEVELS COUNT UP FROM THE FLOOR: 2 is the LAST of this bar's controls to go, 4 the
               first, and each number's width is measured — see the ladder's table in ui/ui.css.
               Effort goes before provider because it is a property OF the selected model; provider
               goes before the model itself because the model is what says what is answering. */
            <>
                {/* Provider (card #90): which CLI drives this chat. Persisted per tab (like the
                    model); switching starts a FRESH session on the other driver. */}
                <span
                    class={styles['chat-bar-item']}
                    data-bar-drop="2"
                    data-testid="chat-provider"
                >
                    <Select
                        class={styles['chat-provider-select']}
                        value={props.provider}
                        options={props.providerOptions}
                        onChange={props.onSwitchProvider}
                    />
                </span>
                {/* Model: a LIVE picker as soon as the session reports its supported models — the
                    backend emits them EAGERLY on session spawn, so it is switchable before the
                    first message. Before the frame lands (or for single-model logins) a read-only
                    best-known label; the placeholder covers a brand-new install with no prior
                    chat. NEVER DROPPED: which model is answering is the bar's headline fact. */}
                <span class={styles['chat-bar-item']} data-testid="chat-model">
                    <Show
                        when={props.models.length > 1}
                        fallback={
                            <span
                                class={styles['chat-model']}
                                title="Active model"
                            >
                                {modelLabelFor(
                                    props.displayModel,
                                    props.models,
                                ) || 'Default model'}
                            </span>
                        }
                    >
                        <Select
                            class={styles['chat-model-select']}
                            value={props.displayModelValue}
                            placeholder="Default model"
                            options={props.models.map(m => ({
                                value: m.value,
                                label: m.label,
                                detail: modelPriceBadge(m.free),
                            }))}
                            onChange={props.onSwitchModel}
                        />
                    </Show>
                </span>
                {/* Effort: a LIVE picker of the SELECTED model's reasoning-effort levels (FEATURE
                    #63), straight from the `models` frame — never a hardcoded list. Hidden when the
                    model exposes none. */}
                <Show when={props.effortOptions.length > 1}>
                    <span
                        class={styles['chat-bar-item']}
                        data-bar-drop="3"
                        data-testid="chat-effort"
                    >
                        <Select
                            class={styles['chat-effort-select']}
                            value={props.effortValue}
                            placeholder="Effort"
                            options={props.effortOptions}
                            onChange={props.onSwitchEffort}
                        />
                    </span>
                </Show>
                {/* Graceful degradation (card #90), per-CAPABILITY rather than per-provider: each
                    control renders iff the active backend declares the capability it needs
                    (core/src/agentBackends/catalog.ts). A backend that lacks one hides that control
                    rather than breaking. */}
                <Show when={providerCan(props.provider, 'computerUse')}>
                    {/* Browser/computer-use (--chrome): same toggle as the /chrome slash command —
                        persists the setting AND retargets the LIVE session, which picks the flag up
                        on the next message via a respawn that resumes this conversation (BUG #87). */}
                    <IconButton
                        icon="Globe"
                        data-testid="chat-computer-use"
                        label={
                            props.computerUse
                                ? 'Browser (--chrome) on'
                                : 'Browser (--chrome) off'
                        }
                        title={
                            props.computerUse
                                ? '--chrome enabled — click to disable (applies from your next message)'
                                : 'Enable --chrome browser/computer-use (applies from your next message)'
                        }
                        variant={props.computerUse ? 'selected' : 'normal'}
                        onClick={props.onToggleComputerUse}
                    />
                </Show>
                <Show when={providerCan(props.provider, 'permissionModes')}>
                    {/* Permission mode: rendered from the START (not gated on the manifest) so the
                        header is populated the instant the chat opens (BUG #14). Seeded to the app
                        default (Bypass) and updated live.
                        NEVER TAGGED FOR THE LADDER, at any level. Its armed tint is the only signal
                        that the agent is writing to the vault unconfirmed, and a control that
                        disappears at a narrow pane takes that signal with it — leaving exactly the
                        unindicated default the tint exists to prevent. */}
                    <span
                        class={styles['chat-bar-item']}
                        data-testid="chat-perm-mode"
                    >
                        <Select
                            class={
                                styles['chat-mode-select'] +
                                // ARMED STATE. `bypassPermissions` lets the agent write to the
                                // vault with no per-action confirmation, and it is the app DEFAULT
                                // — so the most consequential runtime setting in the product used
                                // to render in exactly the same weight, size and colour as the
                                // model picker beside it, with no indication once active. A user
                                // who forgets it is on has no way to find out. The warning tone is
                                // the indicator; it is deliberately the ONLY tinted control in the
                                // header so it cannot be mistaken for decoration.
                                (props.permMode === 'bypassPermissions'
                                    ? ' ' + styles['chat-mode-select--armed']
                                    : '')
                            }
                            value={props.permMode}
                            options={props.permissionModes}
                            onChange={props.onSetPermissionMode}
                        />
                    </span>
                </Show>
            </>
        }
        actions={
            <>
                {/* opencode auth (RE-FIX #90: "i dont see a way to do auth"): a pill showing whether
                    `opencode auth list` has stored credentials, with a popover listing the
                    providers + the in-app path to log in (opencode's login wizard is
                    CLI-interactive). Hidden for Claude sessions, which manage their own login. */}
                <Show when={props.provider === 'opencode'}>
                    <div
                        class={styles['chat-auth-anchor']}
                        data-chat-auth-anchor
                    >
                        <button
                            type="button"
                            class={`${styles['chat-stat']} ${styles['chat-auth-pill']}`}
                            classList={{
                                [styles['chat-auth-out']]:
                                    opencodeAuthSummary(props.authProviders)
                                        .signedIn === false,
                                selected: props.authOpen,
                            }}
                            data-testid="chat-auth"
                            title="opencode credentials"
                            onClick={props.onToggleAuth}
                        >
                            <Icon value="KeyRound" size={13} />{' '}
                            {opencodeAuthSummary(props.authProviders).label}
                        </button>
                        <Show when={props.authOpen}>{props.authPanel}</Show>
                    </div>
                </Show>
                <Show when={providerCan(props.provider, 'sessionPicker')}>
                    {/* History (resume a past session from the backend's own store) — always
                        available, even before the first turn's manifest. The panel anchors to this
                        wrapper. Gated on sessionPicker, NOT resume: opencode resumes per tab but
                        exposes no cross-session list. */}
                    <div
                        class={styles['chat-history-anchor']}
                        data-chat-history-anchor
                    >
                        <IconButton
                            icon="MessagesSquare"
                            label="Past conversations"
                            data-testid="chat-history"
                            variant={props.historyOpen ? 'selected' : 'normal'}
                            onClick={props.onOpenHistory}
                        />
                        <Show when={props.historyOpen}>
                            {props.historyPanel}
                        </Show>
                    </div>
                </Show>
                {/* The primary action, last, and never tagged for the ladder: a bar with no way to
                    start a chat is not a narrower chat header, it is a broken one. */}
                <IconButton
                    icon="Plus"
                    label="New chat"
                    data-testid="chat-new"
                    onClick={props.onNewChat}
                />
            </>
        }
    />
)

export default ChatHeader
