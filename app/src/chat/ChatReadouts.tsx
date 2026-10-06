// app/src/chat/ChatReadouts.tsx — the chat header's trailing readout: how full the context window
// is, as the system's own meter (`context [###.......] 34%`), plus a danger-toned `N mcp servers
// down` that exists ONLY while a configured MCP server is not connected.
//
// What it replaced: three unlabelled icon+number stats (wrench + tool count, server + `2/3`,
// gauge + `34%`) that read as noise. The tool count is gone outright — nothing a person does
// changes it — and MCP is a warning rather than a standing count, so the corner is quiet unless
// something is actually wrong. The meter is `ui/ascii/AsciiMeter`, never a local re-draw.
//
// Gated like before: nothing renders until the first manifest arrives, and the meter waits for
// the first `context` frame. ChatHeader places this in its ViewBar's `readouts` slot.
import { Show, type Component } from 'solid-js'
import AsciiMeter from '../ui/ascii/AsciiMeter'
import Text from '../ui/Text'
import type { ChatSession } from './chatSession'
import { plural } from '../plural'
import styles from './ChatReadouts.module.css'

export type ChatReadoutsProps = {
    session: Pick<ChatSession, 'manifest' | 'context' | 'mcpConnected'>
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
    const mcpDown = () => {
        const m = props.session.manifest()
        if (!m) return 0
        return Math.max(0, m.mcpServers.length - props.session.mcpConnected())
    }
    return (
        <Show when={props.session.manifest()}>
            <Text
                as="span"
                size="micro"
                tone="faint"
                class={`${styles.readouts} ${props.class ?? ''}`}
            >
                <Show when={mcpDown() > 0}>
                    <Text
                        as="span"
                        inherit
                        class={styles.down}
                        data-testid="chat-mcp"
                        title={`${props.session.mcpConnected()} of ${props.session.manifest()!.mcpServers.length} MCP servers connected`}
                    >
                        {mcpDownLabel(mcpDown())}
                    </Text>
                    <Show when={props.session.context()}>
                        <Text as="span" inherit>
                            {'//'}
                        </Text>
                    </Show>
                </Show>
                <Show when={props.session.context()}>
                    {c => (
                        <Text
                            as="span"
                            inherit
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
