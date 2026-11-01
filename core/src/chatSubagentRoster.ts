// core/src/chatSubagentRoster.ts
// The subagents one chat dispatched, as `subagent` ChatFrames. PURE: no Bun or node imports, so it is
// safe on the mobile in-process path. A driver feeds it the tool-use / tool-result frames it already
// emits (and, for Claude, the SDK's `task_started` / `task_notification` system messages) and emits
// whatever frames come back. A frame is returned only when a row is new or its status changed.
import type { ChatSubagent, ChatSubagentStatus } from './chatSubagentTypes'

export type SubagentFrame = { type: 'subagent' } & ChatSubagent

/** Tool names that spawn a subagent: Claude's `Agent` (older CLIs: `Task`) and opencode's `task`. */
const SUBAGENT_TOOLS = new Set(['Agent', 'Task', 'task'])

/** What a backgrounded subagent's immediate tool result says. */
const BACKGROUND_RESULT = /in the background|async agent launched/i

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The SDK `task_started` fields the roster reads. */
export type TaskStartedLike = {
    tool_use_id?: string
    subagent_type?: string
    description?: string
    task_type?: string
    skip_transcript?: boolean
}

/** The SDK `task_notification` fields the roster reads. */
export type TaskNotificationLike = {
    tool_use_id?: string
    status?: string
}

export type SubagentRoster = {
    /** A tool call began. Starts a `running` row when it is a subagent tool. */
    toolUse(id: string, name: string, input: unknown): SubagentFrame[]
    /** A tool call returned. Ends its row unless the subagent was backgrounded. */
    toolResult(id: string, content: string, isError: boolean): SubagentFrame[]
    /** Claude `system` `task_started`. */
    taskStarted(msg: TaskStartedLike): SubagentFrame[]
    /** Claude `system` `task_notification`. */
    taskNotification(msg: TaskNotificationLike): SubagentFrame[]
}

export function newSubagentRoster(): SubagentRoster {
    const rows = new Map<string, ChatSubagent>()
    const background = new Set<string>()
    const started = new Set<string>()

    const set = (id: string, status: ChatSubagentStatus): SubagentFrame[] => {
        const row = rows.get(id)
        if (!row || row.status === status) return []
        row.status = status
        return [{ type: 'subagent', ...row }]
    }
    const add = (
        id: string,
        agentType: string,
        description: string,
    ): SubagentFrame[] => {
        if (rows.has(id)) return []
        const row: ChatSubagent = {
            id,
            agentType: agentType || 'agent',
            description,
            status: 'running',
        }
        rows.set(id, row)
        return [{ type: 'subagent', ...row }]
    }

    return {
        toolUse(id, name, input) {
            if (!SUBAGENT_TOOLS.has(name) || !id) return []
            const i = obj(input)
            if (i.run_in_background === true) background.add(id)
            return add(id, str(i.subagent_type), str(i.description))
        },
        toolResult(id, content, isError) {
            if (isError) return set(id, 'failed')
            if (
                background.has(id) ||
                (started.has(id) && BACKGROUND_RESULT.test(content))
            )
                return []
            return set(id, 'done')
        },
        taskStarted(msg) {
            const id = str(msg.tool_use_id)
            if (!id || msg.skip_transcript === true) return []
            const kind = str(msg.task_type)
            // A background shell or a workflow is a task, not a subagent.
            if (kind && !kind.includes('agent')) return []
            started.add(id)
            return add(id, str(msg.subagent_type), str(msg.description))
        },
        taskNotification(msg) {
            const id = str(msg.tool_use_id)
            if (!id) return []
            if (msg.status === 'completed') return set(id, 'done')
            if (msg.status === 'failed' || msg.status === 'stopped')
                return set(id, 'failed')
            return []
        },
    }
}

/** Feed a roster the tool-use / tool-result frames a driver emits; any other frame yields []. */
export function observeSubagentFrame(
    roster: SubagentRoster,
    frame:
        | { type: 'tool-use'; id: string; name: string; input: unknown }
        | { type: 'tool-result'; id: string; content: string; isError: boolean }
        | { type: string },
): SubagentFrame[] {
    if (frame.type === 'tool-use') {
        const f = frame as { id: string; name: string; input: unknown }
        return roster.toolUse(f.id, f.name, f.input)
    }
    if (frame.type === 'tool-result') {
        const f = frame as { id: string; content: string; isError: boolean }
        return roster.toolResult(f.id, f.content, f.isError)
    }
    return []
}
