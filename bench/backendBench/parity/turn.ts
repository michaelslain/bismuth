// bench/backendBench/parity/turn.ts
// The turn: what one send must do on every chat backend. The judge is plumbing, never answer
// quality: under mock the model's replies come from `mockFixtures`, so each scenario asserts on
// frames and on the requests the backend sent the model.
import type { ChatFrame } from '../../../core/src/chat'
import type {
    BenchTarget,
    ModelRequest,
    Scenario,
    ScenarioOutcome,
} from '../types'
import { SENTINEL, DAEMON_NAME } from '../vault'
import { ACP_AGENTS } from '../../../core/src/chatProviders/acp/agents'
import { ACP_NO_PROGRESS_MS } from '../../../core/src/chatProviders/acp/driver'
import { firstOf, installed, mainRequest, watchedModel } from './gates'

const SKILL_NAME = 'bench-skill'

// Fragments of the standing instructions (core/src/chatRenderingNote.ts, agentCliNote.ts), short
// enough to survive JSON escaping of a request body.
// 'Bismuth chat tab' also appears in the persona note, so it cannot prove the rendering note.
const RENDERING_FRAGMENT = 'LaTeX math with KaTeX'
const CLI_FRAGMENT = 'does everything Bismuth does'

const fail = (detail: string): ScenarioOutcome => ({ verdict: 'fail', detail })
const pass = (
    detail: string,
    metrics?: Record<string, number>,
): ScenarioOutcome => ({ verdict: 'pass', detail, metrics })

const baseApplies = (t: BenchTarget) => installed(t)

const frameTypes = (frames: ChatFrame[]) =>
    frames.map(f => f.type).join(',') || '(no frames)'

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** The one per-backend table of the tools a fixture names. A fixture that calls a tool the backend
 *  does not have gets "unsupported call" back and loops, so every name here is the backend's real
 *  one (read from its own tool list; claude 2.x, opencode 2.3, codex 0.169, cline 3, gemini 0.68). */
export const BACKEND_TOOLS: Record<
    string,
    {
        shell?: (command: string) => { name: string; arguments: unknown }
        write?: (path: string, content: string) => { name: string; arguments: unknown }
        /** The name the backend gives Bismuth's MCP tool; absent: `bismuth__bismuth_cli`. */
        mcp?: string
    }
> = {
    claude: {
        shell: command => ({ name: 'Bash', arguments: { command } }),
        write: (path, content) => ({
            name: 'Write',
            arguments: { file_path: path, content },
        }),
        mcp: 'mcp__bismuth__bismuth_cli',
    },
    // The ACP adapters declare no fs or terminal capability to Bismuth, so claude-code-acp keeps
    // claude's own `Write`, and names the Bismuth MCP tool the way claude does. It has no shell
    // row: tool-bismuth reaches Bismuth through MCP (diag3-acp #1, #2).
    'claude-code-acp': {
        write: (path, content) => ({
            name: 'Write',
            arguments: { file_path: path, content },
        }),
        mcp: 'mcp__bismuth__bismuth_cli',
    },
    // codex's MCP tools are Responses namespace tools, which a mock fixture cannot call, so the
    // shell is the way in. Its only write path is `exec_command`, and it asks the user only for an
    // escalation request, which is what a real model sends when the sandbox blocks a write
    // (diag3-acp #3a, #3b).
    'codex-acp': {
        shell: command => ({ name: 'exec_command', arguments: { cmd: command } }),
        write: (path, content) => ({
            name: 'exec_command',
            arguments: {
                cmd: `printf '%s' ${shellQuote(content)} > ${shellQuote(path)}`,
                sandbox_permissions: 'require_escalated',
                justification: `Create ${path}?`,
            },
        }),
    },
    // hermes names MCP tools `mcp__<server>__<tool>` and writes with `write_file {path, content}`
    // (diag3-openclaw-hermes #5, #7).
    hermes: {
        write: (path, content) => ({ name: 'write_file', arguments: { path, content } }),
        mcp: 'mcp__bismuth__bismuth_cli',
    },
    opencode: {
        shell: command => ({
            name: 'shell',
            arguments: { command, description: 'read' },
        }),
        write: (path, content) => ({ name: 'write', arguments: { path, content } }),
    },
    codex: {
        shell: command => ({ name: 'exec_command', arguments: { cmd: command } }),
    },
    cline: {
        write: (path, content) => ({
            name: 'apply_patch',
            arguments: {
                input: `*** Begin Patch\n*** Add File: ${path}\n+${content}\n*** End Patch`,
            },
        }),
    },
    // goose 1.x: its own `write` and `shell` (the older developer__text_editor is "not available").
    // Only the write tool is listed: tool-bismuth reaches goose through MCP.
    goose: {
        write: (path, content) => ({ name: 'write', arguments: { path, content } }),
    },
    gemini: {
        shell: command => ({ name: 'run_shell_command', arguments: { command } }),
        write: (path, content) => ({
            name: 'write_file',
            arguments: { file_path: path, content },
        }),
    },
}

/** The tool-call shape a backend's own shell tool takes, or null when the backend has none the
 *  bench knows (it then reaches Bismuth through MCP, or not at all). */
export function shellCall(
    backend: string,
    command: string,
): { name: string; arguments: unknown } | null {
    return BACKEND_TOOLS[backend]?.shell?.(command) ?? null
}

/** The tool names a model request lists, whichever wire shape carries them: Anthropic and the
 *  Responses API's `name`, OpenAI chat's `function.name`, Gemini's `functionDeclarations[].name`. */
export function requestToolNames(body: unknown): string[] {
    const tools = (body as { tools?: unknown } | null)?.tools
    if (!Array.isArray(tools)) return []
    const names: string[] = []
    for (const t of tools as Record<string, unknown>[]) {
        if (!t || typeof t !== 'object') continue
        if (typeof t.name === 'string') names.push(t.name)
        const fn = t.function as { name?: unknown } | undefined
        if (fn && typeof fn.name === 'string') names.push(fn.name)
        const decls = t.functionDeclarations
        if (Array.isArray(decls))
            for (const d of decls as { name?: unknown }[])
                if (typeof d?.name === 'string') names.push(d.name)
    }
    return names
}

/** The Bismuth MCP tool a fixture calls, as the backend names it (the table's `mcp`). */
export function mcpCall(backend: string): { name: string; arguments: unknown } {
    return {
        name: BACKEND_TOOLS[backend]?.mcp ?? 'bismuth__bismuth_cli',
        arguments: { args: ['read', 'notes/sentinel.md'] },
    }
}

function bismuthToolCall(target: BenchTarget) {
    return (
        shellCall(target.backend, 'bismuth read notes/sentinel.md') ??
        (target.caps.mcp === 'none' ? null : mcpCall(target.backend))
    )
}

function bodyText(req: ModelRequest): string {
    return typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
}

// ---------------------------------------------------------------------------------------------

const reply: Scenario = {
    id: 'reply',
    suite: 'parity',
    title: 'a one-line turn ends done with text and no error',
    timeoutMs: 120_000,
    applies: baseApplies,
    mockFixtures: [
        {
            match: { userMessage: 'parity-reply' },
            response: { content: 'Hello from the mock.' },
        },
    ],
    async run(ctx) {
        const chat = await ctx.newChat()
        await chat.open()
        const r = await chat.send('parity-reply: say hello')
        if (r.error) return fail(`error frame: ${r.error}`)
        if (r.ended !== 'done')
            return fail(`turn ended ${r.ended}, frames: ${frameTypes(r.frames)}`)
        if (!r.text.trim())
            return fail(`done with empty text, frames: ${frameTypes(r.frames)}`)
        return pass(`done, ${r.text.length} chars`, { wallMs: r.wallMs })
    },
}

const LONG_REPLY = Array.from(
    { length: 60 },
    (_, i) => `Streaming word number ${i + 1} arrives on its own.`,
).join(' ')

const stream: Scenario = {
    id: 'stream',
    suite: 'parity',
    title: 'a delta backend streams the reply in more than one piece',
    timeoutMs: 120_000,
    applies: t =>
        firstOf(
            installed(t),
            t.caps.streaming === 'delta'
                ? null
                : {
                      verdict: 'skip',
                      reason: `${t.backend} streams ${t.caps.streaming}, not delta`,
                  },
        ),
    mockFixtures: [
        {
            match: { userMessage: 'parity-stream' },
            response: { content: LONG_REPLY },
            // A batching CLI (opencode 2.3 coalesces ~100 ms) needs the reply spread over time to
            // emit more than one delta.
            latency: 20,
            chunkSize: 24,
        },
    ],
    async run(ctx) {
        const chat = await ctx.newChat()
        await chat.open()
        const r = await chat.send('parity-stream: write a long reply')
        if (r.error) return fail(`error frame: ${r.error}`)
        if (r.ended !== 'done')
            return fail(`turn ended ${r.ended}, frames: ${frameTypes(r.frames)}`)
        const resultAt = r.frames.findIndex(f => f.type === 'result')
        const before = resultAt < 0 ? r.frames : r.frames.slice(0, resultAt)
        const texts = before.filter(f => f.type === 'assistant-text').length
        if (texts < 2)
            return fail(
                `${texts} assistant-text frame(s) before result, wanted more than 1 (text ${r.text.length} chars, frames: ${frameTypes(r.frames)})`,
            )
        if (r.firstTokenMs === null)
            return fail('no firstTokenMs: no assistant-text frame arrived')
        return pass(`${texts} text frames, first token ${r.firstTokenMs} ms`, {
            textFrames: texts,
            firstTokenMs: r.firstTokenMs,
        })
    },
}

const toolBismuth: Scenario = {
    id: 'tool-bismuth',
    suite: 'parity',
    title: 'the model reads a note through Bismuth and the result reaches the chat',
    timeoutMs: 180_000,
    applies: t =>
        firstOf(
            installed(t),
            bismuthToolCall(t)
                ? null
                : {
                      verdict: 'skip',
                      reason: `${t.backend} has no shell tool the bench knows and no MCP`,
                  },
        ),
    mockFixtures: target => {
        const call = bismuthToolCall(target)
        if (!call) return []
        // The result reply comes first and the call fixture only matches before any tool result:
        // on the OpenAI and Responses wires the last user text is still `parity-tool` on the
        // follow-up, so a call fixture listed first answers it again and the turn loops. Gemini's
        // functionCall carries no id, so its reply is matched by the request shape instead.
        const reply =
            target.backend === 'gemini'
                ? { userMessage: 'parity-tool', hasToolResult: true }
                : { toolCallId: 'toolu_parity_sentinel' }
        return [
            { match: reply, response: { content: 'I read the note.' } },
            {
                match: { userMessage: 'parity-tool', hasToolResult: false },
                response: {
                    toolCalls: [
                        {
                            name: call.name,
                            arguments: call.arguments,
                            id: 'toolu_parity_sentinel',
                        },
                    ],
                },
            },
        ]
    },
    async run(ctx) {
        const chat = await ctx.newChat()
        await chat.open()
        // A shell tool asks permission on claude and opencode; the bench allows it like a user would.
        const r = await chat.send(
            'parity-tool: read notes/sentinel.md with bismuth and tell me what it holds',
            {
                onFrame: (f, d) => {
                    if (f.type === 'permission') d.respondPermission(f.id, 'allow')
                },
            },
        )
        if (r.error) return fail(`error frame: ${r.error}`)
        if (r.ended !== 'done')
            return fail(`turn ended ${r.ended}, frames: ${frameTypes(r.frames)}`)
        if (r.toolUses.length === 0)
            return fail(`no tool-use frame, frames: ${frameTypes(r.frames)}`)
        const withResult = r.toolUses.filter(t => t.result !== undefined)
        if (withResult.length === 0)
            return fail(
                `tool-use ${r.toolUses.map(t => t.name).join(',')} never got a tool-result`,
            )
        const hit = withResult.find(
            t => !t.isError && (t.result ?? '').includes(SENTINEL),
        )
        if (!hit) {
            const t = withResult[0]
            return fail(
                `tool ${t.name} result ${t.isError ? '(isError) ' : ''}lacks ${SENTINEL}: ${(t.result ?? '').slice(0, 160)}`,
            )
        }
        return pass(`${hit.name} returned the sentinel`)
    },
}

const instructions: Scenario = {
    id: 'instructions',
    suite: 'parity',
    title: 'the first model request carries the rendering note, daemon name, CLI note, skill and Bismuth tool',
    timeoutMs: 120_000,
    applies: t => firstOf(installed(t), watchedModel(t)),
    mockFixtures: [
        {
            match: { userMessage: 'parity-instructions' },
            response: { content: 'Noted.' },
        },
    ],
    async run(ctx) {
        const chat = await ctx.newChat()
        await chat.open()
        const r = await chat.send('parity-instructions: who are you?')
        if (r.error) return fail(`error frame: ${r.error}`)
        const reqs = ctx.modelRequests()
        if (reqs.length === 0) return fail('the model server saw no request')
        const req = mainRequest(reqs, 'parity-instructions')
        if (!req)
            return fail(
                `none of ${reqs.length} request(s) carries the user message (paths: ${reqs.map(q => q.path).join(', ')})`,
            )
        const text = bodyText(req)
        const lower = text.toLowerCase()
        const missing: string[] = []
        if (!text.includes(RENDERING_FRAGMENT)) missing.push('chat rendering note')
        if (!lower.includes(DAEMON_NAME)) missing.push(`daemon name ${DAEMON_NAME}`)
        if (!text.includes(CLI_FRAGMENT)) missing.push('bismuth CLI note')
        const target = ctx.target
        const skills = target.backend === 'claude' || target.backend === 'opencode'
        if (skills && !text.includes(SKILL_NAME))
            missing.push(`vault skill ${SKILL_NAME}`)
        if (target.caps.mcp !== 'none') {
            const tools = requestToolNames(req.body).join(',')
            // claude defers MCP tools behind ToolSearch, so its tool list omits them and the
            // deferred names ride in the prompt text instead.
            if (!/bismuth[_-]/i.test(tools) && !/mcp__bismuth__|bismuth_cli/.test(text)) {
                const names = requestToolNames(req.body).join(',')
                missing.push(`a Bismuth MCP tool in the tool list (tools: ${names.slice(0, 300) || 'none'})`)
            }
        }
        if (missing.length)
            return fail(
                `first request (${req.path}, ~${req.estTokens} tokens) is missing: ${missing.join('; ')}`,
            )
        return pass(`first request (${req.path}) carries every instruction`, {
            estTokens: req.estTokens,
        })
    },
}

const errorReadable: Scenario = {
    id: 'error-readable',
    suite: 'parity',
    title: 'a model server 500 reaches the chat as a readable error and the next turn works',
    timeoutMs: 330_000,
    applies: t => firstOf(installed(t), watchedModel(t)),
    mockFixtures: [
        // Recovery first: claude merges the failed and the next user turn into one message that
        // still holds `parity-fail`, so the 500 fixture would answer the recovery too.
        {
            match: { userMessage: 'parity-recover' },
            response: { content: 'Back again.' },
        },
        {
            match: { userMessage: 'parity-fail' },
            response: {
                error: { message: 'mock upstream failure', type: 'server_error' },
                status: 500,
            },
        },
    ],
    async run(ctx) {
        const chat = await ctx.newChat()
        await chat.open()
        // An ACP agent that retries the failing server in silence is ended by the driver's
        // no-progress window, so its error lands one window plus slack after the send.
        const limit = ACP_AGENTS.some(a => a.id === ctx.target.backend)
            ? ACP_NO_PROGRESS_MS + 20_000
            : 60_000
        const bad = await chat.send('parity-fail: this request gets a 500', {
            timeoutMs: limit,
        })
        const surfaced = bad.error
        if (surfaced === null)
            return fail(
                `no error frame after a 500 (ended ${bad.ended}, frames: ${frameTypes(bad.frames)})`,
            )
        const msg = surfaced.trim()
        if (!msg) return fail('error frame has an empty message')
        if (/^\s*at .+:\d+|\n\s+at .+\(.+:\d+/.test(msg) || msg.length > 600)
            return fail(
                `error message is a stack or a dump, not a sentence: ${msg.slice(0, 160)}`,
            )
        if (bad.wallMs > limit)
            return fail(`error took ${bad.wallMs} ms, over ${limit / 1000} s`)
        const next = await chat.send('parity-recover: are you there?', {
            timeoutMs: 260_000,
        })
        if (next.error) return fail(`next turn errored too: ${next.error}`)
        if (next.ended !== 'done' || !next.text.trim())
            return fail(
                `next turn after the error ended ${next.ended} with ${next.text.length} chars`,
            )
        return pass(`error "${msg.slice(0, 80)}" in ${bad.wallMs} ms, next turn ok`)
    },
}

const title: Scenario = {
    id: 'title',
    suite: 'parity',
    title: 'a title frame arrives by the end of the second turn',
    timeoutMs: 180_000,
    applies: t => installed(t),
    mockFixtures: [
        {
            match: { userMessage: 'parity-title-one' },
            response: { content: 'First answer.' },
        },
        {
            match: { userMessage: 'parity-title-two' },
            response: { content: 'Second answer.' },
        },
    ],
    async run(ctx) {
        const chat = await ctx.newChat()
        await chat.open()
        const one = await chat.send('parity-title-one: plan a trip to Lisbon', {
            timeoutMs: 60_000,
        })
        if (one.error) return fail(`turn 1 error: ${one.error}`)
        const two = await chat.send('parity-title-two: and a day in Porto', {
            timeoutMs: 60_000,
        })
        if (two.error) return fail(`turn 2 error: ${two.error}`)
        const t = chat.frames.find(f => f.type === 'title')
        if (!t || t.type !== 'title')
            return fail(
                `no title frame after two turns, frames: ${frameTypes(chat.frames)}`,
            )
        if (!t.title.trim()) return fail('title frame is empty')
        return pass(`title "${t.title.slice(0, 60)}"`)
    },
}

const scenarios: Scenario[] = [
    reply,
    stream,
    toolBismuth,
    instructions,
    errorReadable,
    title,
]

export default scenarios
