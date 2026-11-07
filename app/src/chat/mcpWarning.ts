// app/src/chat/mcpWarning.ts — which MCP servers the chat header's `N mcp servers down` warning
// is about, and when it shows. Pure: no framework imports, so it is unit-tested directly.
//
// A server is DOWN when the session's manifest reports it with a status that is not a connected
// one. Two lists silence the warning, both by server name:
//   - `muted`  — `chat.mutedMcpServers` in `.settings`, written by the panel's `never show again`;
//   - `hidden` — the panel's `hide`, kept for the window's life only.
// A muted server never counts. A hidden one still counts, but on its own never raises the
// warning: it shows again only once a server that is in NEITHER list goes down.

export type McpServerState = { name: string; status: string }

/** The SDK's connected statuses (`connected`, and the `ready`/`ok` some backends report). */
export function isMcpConnected(status: string): boolean {
    return /connect|ready|ok/i.test(status)
}

/** Servers not connected and not muted, in manifest order. */
export function downMcpServers(
    servers: readonly McpServerState[],
    muted: readonly string[],
): McpServerState[] {
    return servers.filter(s => !isMcpConnected(s.status) && !muted.includes(s.name))
}

/** Whether the warning shows: some down server is not hidden. */
export function mcpWarningShows(
    down: readonly McpServerState[],
    hidden: ReadonlySet<string>,
): boolean {
    return down.some(s => !hidden.has(s.name))
}

/** `muted` with every name in `names` added once, existing order kept. */
export function addNames(muted: readonly string[], names: readonly string[]): string[] {
    const out = [...muted]
    for (const n of names) if (!out.includes(n)) out.push(n)
    return out
}
