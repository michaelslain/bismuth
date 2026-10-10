// Client for core's POST /memory/recall. Core owns ranking, dedup and settings; the hooks only
// forward the payload and print what comes back. No in-hook fallback: core unreachable → null.
import { relayUrl } from './report.ts'

// Mirrors core/src/memoryRecall.ts (relay must not import core).
export type RecallMode = 'prompt' | 'tool' | 'session-start' | 'subagent'
export type RecallRequest = {
    mode: RecallMode
    sessionId: string
    agentId?: string
    prompt?: string
    transcriptPath?: string
    toolCalls?: {
        tool_name: string
        tool_input: unknown
        tool_response?: unknown
    }[]
    source?: string
}
export type RecallResponse = {
    context: string | null
    injected: string[]
    reason?: 'disabled' | 'mid-turn-off' | 'no-memory' | 'no-match'
}

export const PROMPT_TIMEOUT_MS = 1500
export const TOOL_BATCH_TIMEOUT_MS = 700
export const SESSION_START_TIMEOUT_MS = 1500
export const SUBAGENT_TIMEOUT_MS = 1500
export const TOOL_RESPONSE_CAP = 2000

export type RecallEvent =
    | 'SessionStart'
    | 'UserPromptSubmit'
    | 'PostToolBatch'
    | 'SubagentStart'

/** Ask core for context; null on any error, non-2xx, bad body or timeout. */
export async function requestRecall(
    req: RecallRequest,
    timeoutMs: number,
): Promise<string | null> {
    try {
        const res = await fetch(
            `${relayUrl().replace(/\/+$/, '')}/memory/recall`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    // Relay hooks run in the user's own terminal tabs: the chat channel.
                    'x-bismuth-channel': 'chat',
                },
                body: JSON.stringify(req),
                signal: AbortSignal.timeout(timeoutMs),
            },
        )
        if (!res.ok) return null
        const body = (await res.json()) as Partial<RecallResponse>
        return typeof body.context === 'string' && body.context
            ? body.context
            : null
    } catch {
        return null
    }
}

/** Print the one hookSpecificOutput object, or nothing. */
export function printContext(event: RecallEvent, context: string | null): void {
    if (!context) return
    process.stdout.write(
        JSON.stringify({
            hookSpecificOutput: {
                hookEventName: event,
                additionalContext: context,
            },
        }),
    )
}

/** Cap each tool_response at TOOL_RESPONSE_CAP chars; non-strings are serialized first. */
export function capToolCalls(calls: unknown): NonNullable<RecallRequest['toolCalls']> {
    if (!Array.isArray(calls)) return []
    return calls.map((c: any) => {
        const r = c?.tool_response
        const text =
            r === undefined || r === null
                ? undefined
                : typeof r === 'string'
                  ? r
                  : JSON.stringify(r)
        return {
            tool_name: String(c?.tool_name ?? ''),
            tool_input: c?.tool_input,
            ...(text === undefined
                ? {}
                : { tool_response: text.slice(0, TOOL_RESPONSE_CAP) }),
        }
    })
}
