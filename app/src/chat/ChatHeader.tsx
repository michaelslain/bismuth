// app/src/chat/ChatHeader.tsx — the chat view's toolbar, as a component.
//
// SESSION-DRIVEN (daemon-chat plan, Task 3): the ~13 individual props this used to take (provider,
// providerOptions, onSwitchProvider, models, …) are now ONE `session: ChatSession` — the registry-
// backed controller (chat/chatSession.ts) that outlives this component's own mount/unmount. The
// actual control markup (readouts/config/actions) now lives in `chatControlSlots()`
// (ChatControls.tsx), shared with the daemon page's quiet inline row — this file's only job is the
// identity crumb + wiring those three regions into ViewBar.
//
// THE TWO POPOVERS (history/auth) are owned by ChatControls.tsx + ChatHistoryPanel.tsx/
// ChatAuthPanel.tsx now — this component doesn't render or know about them at all.
//
// LEGACY EXPORT, TEMPORARY. `ChatView.tsx` (Task 5 rewrites it) still builds its OWN 13 props and
// passes them the old way — it cannot build a `ChatSession` because Task 1's controller isn't wired
// into it yet. Rather than break ChatView's typecheck for two tasks, this file also exports
// `LegacyChatHeader`: the OLD component, byte-identical markup, under its own props type. ChatView's
// ONE import line was changed to `import { LegacyChatHeader as ChatHeader } from './chat/ChatHeader'`
// (the one edit to ChatView.tsx this task is allowed to make). Task 5 deletes `LegacyChatHeader` and
// the classes in `../ChatHeader.module.css` it alone still needs.
import { type Component, type JSX, Show } from 'solid-js'
import ViewBar, { Crumb } from '../ui/ViewBar'
import type { ChatSession } from './chatSession'
import { chatControlSlots } from './ChatControls'
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
import legacyStyles from '../ChatHeader.module.css'

export type ChatHeaderProps = {
    /** The pane title — the tab's custom name, else the session title, else the persona. */
    title: string
    /** Daemon-vs-user glyph, mirroring the tab strip's icon. */
    originIcon: string
    session: ChatSession
    /** Merged onto the bar, so one caller can adjust one instance without forking this. */
    class?: string
}

export default function ChatHeader(props: ChatHeaderProps): JSX.Element {
    return (
        <ViewBar
            class={props.class}
            identity={<Crumb icon={props.originIcon}>{props.title}</Crumb>}
            {...chatControlSlots(props.session)}
        />
    )
}

// ── LegacyChatHeader — unchanged old component, kept only until Task 5 rewires ChatView.tsx ──

type LegacyChatHeaderModel = {
    value: string
    label: string
    description: string
    effortLevels: string[]
    free?: boolean
}

type LegacyChatContextUsage = {
    percentage: number
    totalTokens: number
    maxTokens: number
}

export type LegacyChatHeaderProps = {
    title: string
    originIcon: string
    provider: ChatProviderChoice
    providerOptions: SelectOption[]
    onSwitchProvider: (value: string) => void
    models: LegacyChatHeaderModel[]
    displayModel: string
    displayModelValue: string
    onSwitchModel: (value: string) => void
    effortOptions: SelectOption[]
    effortValue: string
    onSwitchEffort: (value: string) => void
    manifest: ChatManifest | null
    context: LegacyChatContextUsage | null
    mcpConnected: number
    permMode: string
    permissionModes: SelectOption[]
    onSetPermissionMode: (value: string) => void
    computerUse: boolean
    onToggleComputerUse: () => void
    authProviders: { name: string; kind: string }[] | null
    authOpen: boolean
    onToggleAuth: () => void
    authPanel?: JSX.Element
    historyOpen: boolean
    onOpenHistory: () => void
    historyPanel?: JSX.Element
    onNewChat: () => void
    class?: string
    compact?: boolean
}

export const LegacyChatHeader: Component<LegacyChatHeaderProps> = props => (
    <ViewBar
        class={props.class}
        identity={
            <Show when={!props.compact}>
                <Crumb icon={props.originIcon}>{props.title}</Crumb>
            </Show>
        }
        readouts={
            <Show when={props.manifest}>
                {m => (
                    <>
                        <Show when={m().tools.length > 0}>
                            <span
                                class={legacyStyles['chat-stat']}
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
                                class={legacyStyles['chat-stat']}
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
                                    class={`${legacyStyles['chat-stat']} ${legacyStyles['chat-context']}`}
                                    classList={{
                                        [legacyStyles['warn']]:
                                            c().percentage >= 80,
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
            <>
                <span
                    class={legacyStyles['chat-bar-item']}
                    data-bar-drop="2"
                    data-testid="chat-provider"
                >
                    <Select
                        class={legacyStyles['chat-provider-select']}
                        value={props.provider}
                        options={props.providerOptions}
                        onChange={props.onSwitchProvider}
                    />
                </span>
                <span
                    class={legacyStyles['chat-bar-item']}
                    data-testid="chat-model"
                >
                    <Show
                        when={props.models.length > 1}
                        fallback={
                            <span
                                class={legacyStyles['chat-model']}
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
                            class={legacyStyles['chat-model-select']}
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
                <Show when={props.effortOptions.length > 1}>
                    <span
                        class={legacyStyles['chat-bar-item']}
                        data-bar-drop="3"
                        data-testid="chat-effort"
                    >
                        <Select
                            class={legacyStyles['chat-effort-select']}
                            value={props.effortValue}
                            placeholder="Effort"
                            options={props.effortOptions}
                            onChange={props.onSwitchEffort}
                        />
                    </span>
                </Show>
                <Show when={providerCan(props.provider, 'computerUse')}>
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
                    <span
                        class={legacyStyles['chat-bar-item']}
                        data-testid="chat-perm-mode"
                    >
                        <Select
                            class={
                                legacyStyles['chat-mode-select'] +
                                (props.permMode === 'bypassPermissions'
                                    ? ' ' +
                                      legacyStyles['chat-mode-select--armed']
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
                <Show when={props.provider === 'opencode'}>
                    <div
                        class={legacyStyles['chat-auth-anchor']}
                        data-chat-auth-anchor
                    >
                        <button
                            type="button"
                            class={`${legacyStyles['chat-stat']} ${legacyStyles['chat-auth-pill']}`}
                            classList={{
                                [legacyStyles['chat-auth-out']]:
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
                    <div
                        class={legacyStyles['chat-history-anchor']}
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
