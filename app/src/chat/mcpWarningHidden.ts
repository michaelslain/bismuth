// app/src/chat/mcpWarningHidden.ts — the MCP warning panel's `hide`: server names whose down
// warning is silenced for the window's life (never written anywhere). One set for every chat in
// the window, so hiding it in one chat hides it in all. Rules: mcpWarning.ts.
import { createSignal } from 'solid-js'

const [hiddenMcpServers, setHiddenMcpServers] = createSignal<ReadonlySet<string>>(new Set())

export { hiddenMcpServers }

export function hideMcpServers(names: readonly string[]): void {
    setHiddenMcpServers(prev => new Set([...prev, ...names]))
}

/** Story fixture hook: start each story with nothing hidden. */
export function resetHiddenMcpServers(): void {
    setHiddenMcpServers(new Set<string>())
}
