// app/src/chat/McpDownPanel.tsx — what the chat header's `N mcp servers down` warning opens: each
// down server by name with its status, then `[hide]` (silence it until another server goes down)
// and `[never show again]` (mute these servers in `.settings`, `chat.mutedMcpServers`). The box is
// <Popover>, anchored by ChatReadouts; this is the content only. Rules: mcpWarning.ts.
import { For, type Component } from 'solid-js'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import type { McpServerState } from './mcpWarning'
import styles from './McpDownPanel.module.css'

export type McpDownPanelProps = {
    servers: readonly McpServerState[]
    onHide: () => void
    onMute: () => void
    class?: string
}

/** `needs-auth` → `needs auth`: the SDK's status words, read as words. */
const statusWords = (status: string) => status.toLowerCase().replace(/[-_]+/g, ' ')

const McpDownPanel: Component<McpDownPanelProps> = props => (
    <div class={`${styles.panel} ${props.class ?? ''}`} data-testid="mcp-down-panel">
        <div class={styles.rows}>
            <For each={props.servers}>
                {s => (
                    <>
                        <Text as="span" size="ui">
                            {s.name}
                        </Text>
                        <Text as="span" size="ui" tone="danger">
                            {statusWords(s.status)}
                        </Text>
                    </>
                )}
            </For>
        </div>
        <div class={styles.actions}>
            <TextButton
                onClick={() => props.onHide()}
                title="Hide until a different server goes down"
            >
                hide
            </TextButton>
            <TextButton
                onClick={() => props.onMute()}
                title="Never warn about these servers again. Another server going down still warns. Undo: remove names from chat.mutedMcpServers in .settings"
            >
                never show again
            </TextButton>
        </div>
    </div>
)

export default McpDownPanel
