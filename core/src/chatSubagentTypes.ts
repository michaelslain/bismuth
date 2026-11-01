/** A subagent the current chat reply dispatched, as the chat's subagent strip shows it. */
export type ChatSubagentStatus = 'running' | 'done' | 'failed'

export type ChatSubagent = {
    /** The spawning tool call's id (Claude: the Agent/Task tool_use id; opencode: the task callID). */
    id: string
    /** e.g. 'Explore', 'general-purpose'. 'agent' when the backend names none. */
    agentType: string
    /** The tool input's short description, '' when absent. */
    description: string
    status: ChatSubagentStatus
}
