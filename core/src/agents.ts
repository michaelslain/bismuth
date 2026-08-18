/** A subagent (SDK Task tool) spawned by a visual chat session. Mirrors RelaySubagent's shape
 *  but sourced from chat.ts's drain loop rather than the relay hooks. */
export interface ChatAgentSubagent {
    /** The Task tool_use id — stable for the subagent's lifetime. */
    agentId: string
    /** e.g. "general-purpose", "Explore" — from the Task tool's `subagent_type`. */
    agentType: string
    /** True once the Task tool_result came back (the subagent finished). */
    done: boolean
}

/** One live visual-chat session (core/src/chat.ts). A chat's SDK Task-tool subagents (depth 1)
 *  are tracked alongside it so chat.ts can report a consistent shape for its own session/subagent
 *  bookkeeping (see chatAgentSnapshot in chat.ts). */
export interface ChatAgentSession {
    /** The client chat id (the ::chat: tab's id) — the durable identity of this chat session. */
    chatId: string
    /** Node label: the chat's conversation summary/title, or a cwd-basename fallback. */
    label: string
    /** A turn is currently in flight (keeps the session "active" past the heartbeat window). */
    active: boolean
    /** ms epoch of the last turn activity. */
    lastActivityAt: number
    /** Subagents this chat spawned via the SDK Task tool (depth 1). */
    subagents: ChatAgentSubagent[]
}
