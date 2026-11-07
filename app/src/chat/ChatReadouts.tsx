// app/src/chat/ChatReadouts.tsx — the chat header's trailing readout: how full the context window
// is, as the system's own meter (`context [###.......] 34%`), plus a danger-toned `N mcp servers
// down` that exists ONLY while a configured MCP server is not connected. The warning is a button:
// it opens McpDownPanel (which servers, `[hide]`, `[never show again]`); a hidden or muted server
// stops raising it, and a different server going down raises it again (rules: mcpWarning.ts).
//
// What it replaced: three unlabelled icon+number stats (wrench + tool count, server + `2/3`,
// gauge + `34%`) that read as noise. The tool count is gone outright — nothing a person does
// changes it — and MCP is a warning rather than a standing count, so the corner is quiet unless
// something is actually wrong. The meter is `ui/ascii/AsciiMeter`, never a local re-draw.
//
// While the chat's private toggle is on, the run leads with the word `private`, before the first
// manifest too. Everything else is gated like before:
// nothing renders until the first manifest arrives, and the meter waits for the first `context`
// frame. ChatHeader places this in its ViewBar's `readouts` slot.
import { createSignal, Show, type Component } from 'solid-js'
import AsciiMeter from '../ui/ascii/AsciiMeter'
import AnchoredPopover from '../ui/AnchoredPopover'
import Popover from '../ui/Popover'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import { settings, setSettings } from '../settings'
import McpDownPanel from './McpDownPanel'
import { addNames, downMcpServers, mcpWarningShows } from './mcpWarning'
import { hiddenMcpServers, hideMcpServers } from './mcpWarningHidden'
import type { ChatSession } from './chatSession'
import { plural } from '../plural'
import styles from './ChatReadouts.module.css'

export type ChatReadoutsProps = {
    session: Pick<
        ChatSession,
        'manifest' | 'context' | 'isPrivate'
    >
    /** Merged onto the root, so a caller can adjust one instance without forking this. */
    class?: string
}

/** Cells in the meter. Ten makes each `#` one tenth, so the bar reads at a glance and the whole
 *  readout stays ~24 characters — short enough to sit beside a capped title in a 460px pane. */
const METER_CELLS = 10

/** At or past this fraction the fill turns `--danger` — the point at which compaction is near. */
const CONTEXT_WARN = 0.8

/** `1 mcp server down` / `2 mcp servers down`. Pure so its wording is pinned in one place. */
export function mcpDownLabel(down: number): string {
    return `${plural(down, 'mcp server')} down`
}

const ChatReadouts: Component<ChatReadoutsProps> = props => {
    const down = () =>
        downMcpServers(
            props.session.manifest()?.mcpServers ?? [],
            settings.chat.mutedMcpServers,
        )
    const warn = () => mcpWarningShows(down(), hiddenMcpServers())
    const [open, setOpen] = createSignal(false)
    const [anchor, setAnchor] = createSignal<HTMLElement>()
    const close = () => {
        setOpen(false)
        anchor()?.focus()
    }
    const names = () => down().map(s => s.name)
    return (
        <Show when={props.session.isPrivate() || props.session.manifest()}>
            <Text
                as="span"
                size="micro"
                tone="faint"
                class={`${styles.readouts} ${props.class ?? ''}`}
            >
                <Show when={props.session.isPrivate()}>
                    <Text
                        as="span"
                        inherit
                        class={styles.private}
                        data-testid="chat-private"
                        title="Private: this conversation is erased when it ends and never kept in memory"
                    >
                        private
                    </Text>
                    <Show when={props.session.manifest() && (warn() || props.session.context())}>
                        <Text as="span" inherit data-bar-drop="4">
                            {'//'}
                        </Text>
                    </Show>
                </Show>
                <Show when={props.session.manifest() && warn()}>
                    <TextButton
                        danger
                        data-testid="chat-mcp"
                        aria-haspopup="true"
                        aria-expanded={open()}
                        ref={setAnchor}
                        title="Which MCP servers are down — hide this or never show it again"
                        onClick={() => setOpen(!open())}
                    >
                        {mcpDownLabel(down().length)}
                    </TextButton>
                    <AnchoredPopover
                        open={open()}
                        anchor={anchor}
                        toggleEl={anchor}
                        onAnchorPress={close}
                        onDismiss={close}
                        placement="below"
                        align="end"
                    >
                        <Popover tone="panel">
                            <McpDownPanel
                                servers={down()}
                                onHide={() => {
                                    hideMcpServers(names())
                                    setOpen(false)
                                }}
                                onMute={() => {
                                    setSettings(
                                        'chat',
                                        'mutedMcpServers',
                                        addNames(settings.chat.mutedMcpServers, names()),
                                    )
                                    setOpen(false)
                                }}
                            />
                        </Popover>
                    </AnchoredPopover>
                    <Show when={props.session.context()}>
                        <Text as="span" inherit data-bar-drop="4">
                            {'//'}
                        </Text>
                    </Show>
                </Show>
                <Show when={props.session.manifest() && props.session.context()}>
                    {c => (
                        <Text
                            as="span"
                            inherit
                            // Drops when the bar cannot hold it, reachable from [≡]: the meter is
                            // a gauge, the warning beside it is the one readout that asks for
                            // attention and stays.
                            data-bar-drop="4"
                            data-bar-menu-label="context"
                            data-testid="chat-context"
                            title={`Context window: ${c().totalTokens.toLocaleString()} / ${c().maxTokens.toLocaleString()} tokens`}
                        >
                            <AsciiMeter
                                value={c().percentage / 100}
                                width={METER_CELLS}
                                label="context"
                                suffix={`${Math.round(c().percentage)}%`}
                                color={
                                    c().percentage / 100 >= CONTEXT_WARN
                                        ? 'var(--danger)'
                                        : undefined
                                }
                            />
                        </Text>
                    )}
                </Show>
            </Text>
        </Show>
    )
}

export default ChatReadouts
