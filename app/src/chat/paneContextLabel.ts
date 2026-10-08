// app/src/chat/paneContextLabel.ts
// Pure: the human label the chat preamble's `Active pane:` line carries for a sentinel content id
// (graph, daemon page, terminal, export screen). Null for files, empty panes and chats — those
// are either reported as `Active file:` or are nothing worth telling the model.
import {
    CHAT_PREFIX,
    DAEMON_TAB,
    EXPORT_PREFIX,
    GRAPH_TAB,
    TERMINAL_PREFIX,
} from '../tabIds'

const GRAPH_MODE_LABELS: Record<string, string> = {
    '2nd': '2nd brain',
    '3rd': '3rd brain',
    both: 'both brains',
    local: 'local',
}

/** Prefix of the export-screen pane label; core/src/chat.ts matches it. */
export const EXPORT_PANE_LABEL = 'export options for '

export function paneContextLabel(
    content: string,
    graphMode?: string,
): string | null {
    if (content === GRAPH_TAB)
        return graphMode
            ? `knowledge graph (${GRAPH_MODE_LABELS[graphMode] ?? graphMode})`
            : 'knowledge graph'
    if (content === DAEMON_TAB) return 'daemon page'
    if (content.startsWith(TERMINAL_PREFIX)) return 'terminal'
    if (content.startsWith(EXPORT_PREFIX))
        return `${EXPORT_PANE_LABEL}${content.slice(EXPORT_PREFIX.length)}`
    if (content.startsWith(CHAT_PREFIX)) return null
    return null
}
