// core/src/chatProviders/codex/protocol.ts
//
// The PURE half of the Codex chat backend: translates the `codex exec --json`/`--experimental-json`
// ThreadEvent/ThreadItem JSON union (the CLI's own NDJSON wire event stream — see ./driver.ts, which
// spawns `codex exec` directly rather than depending on `@openai/codex-sdk`) into Bismuth's
// ChatFrame union. No I/O, no process spawning — mirrors the split chatProviders/acp/protocol.ts +
// driver.ts already use (and chatProviders/opencodeTranslate.ts + opencode.ts before it).
// Unit-tested in core/test/chatProviders/codexProtocol.test.ts against captured/hand-built event
// shapes — never against a real `codex` process (none is installed here).
//
// Shape verified DIRECTLY from `@openai/codex-sdk@0.146.0`'s shipped `dist/index.d.ts` (read
// verbatim, not from docs): the top-level ThreadEvent kinds this module dispatches on
// (`thread.started`/`item.started`/`item.updated`/`item.completed`/`turn.failed`/`error` — see
// translateThreadEvent's switch below) and the ThreadItem.type union nested inside them
// (`agent_message`/`reasoning`/`error`/`command_execution`/`file_change`/`mcp_tool_call`/
// `web_search` — see frameForItem's switch below). This is the same wire protocol `codex exec`
// itself emits on stdout, which is what this translator actually consumes; the SDK was only the
// evidence source for the shape, not a runtime dependency. Two things that .d.ts does NOT say, so
// this translator is defensive about both rather than assuming the friendlier case:
//
//  1. Whether `item.updated` for an `agent_message`/`reasoning` item carries the FULL text seen so
//     far, or just the newly-added chunk. The one real captured sample only shows
//     started(text:"") -> completed(text:<full>) with no intermediate `item.updated` — consistent
//     with "the `text` field is always cumulative", so `textDelta` below diffs against the last
//     known text for that item id and emits only the newly-appended suffix. If a future Codex
//     version instead sends already-incremental text, `textDelta`'s "does the new value start with
//     what we already emitted" check fails safely — it re-emits the WHOLE current value rather than
//     computing a garbage negative-length slice, so text is never silently dropped, only
//     (worst case) shown twice in that one edge case.
//  2. Whether ThreadItem ids (`item_0`, `item_1`, …) are unique for the whole thread or reset every
//     turn. ./driver.ts calls `resetCodexTurnState` once per turn (before consuming that turn's
//     events), so this module never has to assume either way — a reused id in a later turn can
//     never collide with stale state from an earlier one.
import type { ChatFrame } from '../../chat'

/** Per-session translation state, threaded through every `translateThreadEvent` call. */
export interface CodexTranslateState {
    /** Last known CUMULATIVE text emitted for each agent_message/reasoning item id — see point 1
     *  above. Reset per turn (resetCodexTurnState), not per session. */
    text: Map<string, string>
    /** Item ids for which a tool-use frame has already been emitted (command_execution/file_change/
     *  mcp_tool_call/web_search) — guards against re-emitting one on a later item.updated/completed
     *  for the SAME item. Reset per turn. */
    toolUseSeen: Set<string>
    /** Item ids for which the paired tool-result has already been emitted — guards against double-
     *  reporting if a "completed"/"failed" status is somehow observed twice for one item. Reset per
     *  turn. */
    toolResultSeen: Set<string>
    /** The Codex thread id, learned from `thread.started` (or pre-seeded on resume). Not reset per
     *  turn — it's the session's durable identity. */
    threadId: string | null
}

export function newCodexTranslateState(
    threadId: string | null = null,
): CodexTranslateState {
    return {
        text: new Map(),
        toolUseSeen: new Set(),
        toolResultSeen: new Set(),
        threadId,
    }
}

/** Clear the per-turn item-tracking maps — called by the driver once per turn, BEFORE consuming
 *  that turn's events (see point 2 above). Does not touch `threadId`. */
export function resetCodexTurnState(state: CodexTranslateState): void {
    state.text.clear()
    state.toolUseSeen.clear()
    state.toolResultSeen.clear()
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
    return typeof v === 'string' ? v : undefined
}

/** The newly-appended suffix of `full` relative to what's already been emitted for `id` — see file
 *  header point 1. Updates `state.text` as a side effect. */
function textDelta(
    state: CodexTranslateState,
    id: string,
    full: string,
): string {
    const prev = state.text.get(id) ?? ''
    state.text.set(id, full)
    if (full === prev) return ''
    if (full.startsWith(prev)) return full.slice(prev.length)
    // The stream didn't grow the way we assumed — never guess at a slice; the whole current value is
    // the safest thing to show.
    return full
}

const TOOL_ITEM_TYPES = new Set([
    'command_execution',
    'file_change',
    'mcp_tool_call',
    'web_search',
])

function toolNameFor(item: Record<string, unknown>): string {
    switch (item.type) {
        case 'command_execution':
            return 'command_execution'
        case 'file_change':
            return 'file_change'
        case 'mcp_tool_call': {
            const tool = str(item.tool)
            const server = str(item.server)
            return tool ? `mcp:${server ?? '?'}/${tool}` : 'mcp_tool_call'
        }
        case 'web_search':
            return 'web_search'
        default:
            return typeof item.type === 'string' ? item.type : 'tool'
    }
}

function toolInputFor(item: Record<string, unknown>): unknown {
    switch (item.type) {
        case 'command_execution':
            return { command: str(item.command) ?? '' }
        case 'file_change':
            return { changes: Array.isArray(item.changes) ? item.changes : [] }
        case 'mcp_tool_call':
            return {
                server: str(item.server) ?? '',
                tool: str(item.tool) ?? '',
                arguments: item.arguments,
            }
        case 'web_search':
            return { query: str(item.query) ?? '' }
        default:
            return {}
    }
}

function toolResultContentFor(item: Record<string, unknown>): string {
    switch (item.type) {
        case 'command_execution':
            return str(item.aggregated_output) ?? ''
        case 'file_change': {
            const changes = Array.isArray(item.changes) ? item.changes : []
            return changes
                .map(c =>
                    isRecord(c)
                        ? `${str(c.kind) ?? 'update'} ${str(c.path) ?? ''}`.trim()
                        : '',
                )
                .filter(Boolean)
                .join('\n')
        }
        case 'mcp_tool_call': {
            if (isRecord(item.error) && typeof item.error.message === 'string')
                return item.error.message
            const result = item.result
            if (isRecord(result)) {
                if (Array.isArray(result.content)) {
                    return result.content
                        .map(c =>
                            isRecord(c) && typeof c.text === 'string'
                                ? c.text
                                : JSON.stringify(c),
                        )
                        .join('\n')
                }
                if (result.structured_content !== undefined)
                    return JSON.stringify(result.structured_content)
            }
            return ''
        }
        case 'web_search':
            return str(item.query) ?? ''
        default:
            return ''
    }
}

function toolIsError(item: Record<string, unknown>): boolean {
    if (str(item.status) === 'failed') return true
    if (item.type === 'mcp_tool_call' && isRecord(item.error)) return true
    return false
}

/** Translate one ThreadItem (the payload of item.started/updated/completed) into 0-2 ChatFrames. */
function frameForItem(item: unknown, state: CodexTranslateState): ChatFrame[] {
    if (!isRecord(item)) return []
    const id = str(item.id)
    const type = str(item.type)
    if (!id || !type) return []

    if (type === 'agent_message' || type === 'reasoning') {
        const delta = textDelta(state, id, str(item.text) ?? '')
        if (!delta) return []
        return [
            type === 'agent_message'
                ? { type: 'assistant-text', text: delta }
                : { type: 'thinking', text: delta },
        ]
    }

    if (type === 'error') {
        return [
            {
                type: 'error',
                code: 'error',
                message: str(item.message) ?? 'Codex reported an error.',
            },
        ]
    }

    if (TOOL_ITEM_TYPES.has(type)) {
        const frames: ChatFrame[] = []
        if (!state.toolUseSeen.has(id)) {
            state.toolUseSeen.add(id)
            frames.push({
                type: 'tool-use',
                id,
                name: toolNameFor(item),
                input: toolInputFor(item),
            })
        }
        const status = str(item.status)
        if (
            (status === 'completed' || status === 'failed') &&
            !state.toolResultSeen.has(id)
        ) {
            state.toolResultSeen.add(id)
            frames.push({
                type: 'tool-result',
                id,
                content: toolResultContentFor(item),
                isError: toolIsError(item),
            })
        }
        return frames
    }

    // todo_list and anything future/unrecognized: no ChatFrame kind maps to a plan/checklist today —
    // skip cleanly rather than guess at one (see "never crash on an unrecognized shape").
    return []
}

/**
 * Translate one top-level ThreadEvent (already JSON.parse'd) into 0-N ChatFrames. `event` is
 * `unknown` on purpose — a malformed/future/older-CLI shape must be ignored, never thrown on.
 */
export function translateThreadEvent(
    event: unknown,
    state: CodexTranslateState,
): ChatFrame[] {
    if (!isRecord(event)) return []
    const type = str(event.type)
    if (!type) return []

    switch (type) {
        case 'thread.started': {
            const id = str(event.thread_id)
            if (!id) return []
            state.threadId = id
            return [{ type: 'session', sessionId: id, origin: 'user' }]
        }
        case 'item.started':
        case 'item.updated':
        case 'item.completed':
            return frameForItem(event.item, state)
        case 'turn.failed': {
            const err = event.error
            const message =
                isRecord(err) && typeof err.message === 'string'
                    ? err.message
                    : 'Codex turn failed.'
            return [{ type: 'error', code: 'error', message }]
        }
        case 'error':
            return [
                {
                    type: 'error',
                    code: 'error',
                    message:
                        str(event.message) ?? 'Codex reported a fatal error.',
                },
            ]
        default:
            // turn.started (nothing of its own to show — the driver resets per-turn state itself before
            // the loop starts) / turn.completed (usage bookkeeping the driver doesn't currently surface,
            // since cost/contextUsage are both false in the catalog) / anything else future: ignored.
            return []
    }
}
