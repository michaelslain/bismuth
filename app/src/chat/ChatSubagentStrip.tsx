// app/src/chat/ChatSubagentStrip.tsx — ChatSubagentStrip.module.css is the ONLY importer.
// The agents strip above the composer: one row per subagent the current reply dispatched —
// a little daemon face (busy while it runs, idle once done, hurt when it failed), type, description. Renders nothing for an
// empty list, so a reply with no subagents leaves no gap.
import { For, Show, createEffect, type Component } from 'solid-js'
import type { ChatSubagent } from '../../../core/src/chatSubagentTypes'
import Text from '../ui/Text'
import DaemonFace from '../daemon/DaemonFace'
import styles from './ChatSubagentStrip.module.css'

export type ChatSubagentStripProps = {
    agents: ChatSubagent[]
    class?: string
}

const FACE = { running: 'busy', done: 'idle', failed: 'hurt' } as const
const TYPE_TONE = { running: 'muted', done: 'faint', failed: 'danger' } as const

const ChatSubagentStrip: Component<ChatSubagentStripProps> = props => {
    let rows: HTMLDivElement | undefined
    // Dispatch order stays; the list scrolls to the first running row so live work is visible.
    createEffect(() => {
        const agents = props.agents
        const el = rows
        if (!el) return
        const first = agents.findIndex(a => a.status === 'running')
        const row = first >= 0 ? el.children[first] : undefined
        if (row instanceof HTMLElement) el.scrollTop = row.offsetTop - el.offsetTop
        if (el.scrollHeight > el.clientHeight) el.setAttribute('data-overflow', '')
        else el.removeAttribute('data-overflow')
    })
    return (
    <Show when={props.agents.length > 0}>
        <div
            class={`${styles['strip']} ${props.class ?? ''}`}
            role="status"
            aria-label="subagents"
        >
            <div ref={rows} class={styles['rows']} role="list">
                <For each={props.agents}>
                    {agent => (
                        <div class={styles['row']} role="listitem" aria-label={`${agent.agentType} ${agent.description} ${agent.status}`}>
                            <DaemonFace
                                mood={FACE[agent.status]}
                                size="inline"
                                label={agent.status}
                            />
                            <Text
                                as="span"
                                inherit
                                tone={TYPE_TONE[agent.status]}
                                truncate
                                class={styles['type']}
                            >
                                {agent.agentType}
                            </Text>
                            <Text
                                as="span"
                                inherit
                                tone="faint"
                                truncate
                                class={styles['description']}
                            >
                                {agent.description}
                            </Text>
                        </div>
                    )}
                </For>
            </div>
        </div>
    </Show>
    )
}

export default ChatSubagentStrip
