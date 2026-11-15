// bench/backendBench/parity/control.ts
// The control scenarios: permissions, stop, mid-turn messages, model switching. They grade plumbing
// (frames and what reached the model), never answer quality.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatFrame } from '../../../core/src/chat'
import type {
    BenchTarget,
    ChatDriver,
    Scenario,
    ScenarioCtx,
    ScenarioOutcome,
} from '../types'
import {
    firstOf,
    installed,
    mainRequest,
    needsCap,
    switchableModels,
    watchedModel,
} from './gates'
import { BACKEND_TOOLS } from './turn'

const SUITE = 'parity'
const NEW_NOTE = 'notes/new.md'
const NEW_NOTE_TEXT = 'written by the bench'

const fail = (detail: string): ScenarioOutcome => ({ verdict: 'fail', detail })
const skip = (detail: string): ScenarioOutcome => ({ verdict: 'skip', detail })
const pass = (
    detail: string,
    metrics?: Record<string, number>,
): ScenarioOutcome => ({ verdict: 'pass', detail, metrics })

/** Poll `check` until it is truthy or `ms` pass. Condition-based, never a bare sleep. */
async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
    const end = Date.now() + ms
    while (Date.now() < end) {
        if (check()) return true
        await new Promise(r => setTimeout(r, 50))
    }
    return check()
}

const bodyText = (ctx: ScenarioCtx) =>
    ctx.modelRequests().map(r => JSON.stringify(r.body))

const framesOf = <T extends ChatFrame['type']>(chat: ChatDriver, type: T) =>
    chat.frames.filter(f => f.type === type) as Extract<
        ChatFrame,
        { type: T }
    >[]

/** The backend's own file-writing tool and the argument shape it takes (the table in turn.ts). */
function writeCall(target: BenchTarget, id: string) {
    const path = join('notes', 'new.md')
    const own = BACKEND_TOOLS[target.backend]?.write?.(path, NEW_NOTE_TEXT)
    if (own) return { ...own, id }
    // A backend with no row in the table: a generic write tool.
    return {
        name: 'write',
        arguments: { filePath: path, content: NEW_NOTE_TEXT },
        id,
    }
}

const WRITE_ASK = 'please create the file notes/new.md for the bench'
const OK_ASK = 'say ok for the bench'
const LONG_ASK = 'tell a long story for the bench'
const MID_FIRST = 'bench first message long'
const MID_MARK = 'bench-mid-turn-marker-4Q9X'

/** Result reply first, call only before any tool result (see tool-bismuth in turn.ts). Gemini's
 *  functionCall has no id, so its reply matches on the request shape. */
const writeFixtures = (target: BenchTarget): unknown[] => [
    {
        match:
            target.backend === 'gemini'
                ? { userMessage: WRITE_ASK, hasToolResult: true }
                : { toolCallId: 'toolu_bench_write' },
        response: { content: 'The note is handled.' },
    },
    {
        match: { userMessage: WRITE_ASK, hasToolResult: false },
        response: { toolCalls: [writeCall(target, 'toolu_bench_write')] },
    },
]

const slowText = (n: number) =>
    Array.from({ length: n }, (_, i) => `sentence ${i}.`).join(' ')

const slowFixture = (userMessage: string) => ({
    match: { userMessage },
    response: { content: slowText(80) },
    latency: 120,
    chunkSize: 6,
})

const okFixture = { match: { userMessage: OK_ASK }, response: { content: 'ok' } }

function permissionScenario(behavior: 'allow' | 'deny'): Scenario {
    return {
        id: `permission-${behavior}`,
        suite: SUITE,
        title: `a write permission is asked, then ${behavior}ed`,
        timeoutMs: 120_000,
        applies: t =>
            firstOf(installed(t), needsCap(t, 'permissionPrompts')),
        mockFixtures: writeFixtures,
        async run(ctx) {
            const chat = await ctx.newChat()
            await chat.open()
            let asked: string | null = null
            const turn = await chat.send(WRITE_ASK, {
                timeoutMs: 90_000,
                onFrame: (f, d) => {
                    if (f.type === 'permission') {
                        asked = f.toolName
                        d.respondPermission(f.id, behavior)
                    }
                },
            })
            if (asked === null)
                return fail(
                    `no permission frame before the turn ended (${turn.ended}); tools seen: ${
                        turn.toolUses.map(t => t.name).join(',') || 'none'
                    }`,
                )
            if (turn.ended === 'timeout')
                return fail(
                    `permission ${behavior} on ${asked}, then the turn never ended`,
                )
            const exists = existsSync(join(ctx.vault, NEW_NOTE))
            if (behavior === 'deny' && exists)
                return fail(`denied ${asked} but ${NEW_NOTE} was written`)
            if (behavior === 'allow' && !exists)
                return fail(
                    `allowed ${asked} but ${NEW_NOTE} does not exist (turn ${turn.ended}, error: ${turn.error ?? 'none'})`,
                )
            return pass(`${behavior} on ${asked}; ${NEW_NOTE} ${exists ? 'written' : 'absent'}`)
        },
    }
}

const stop: Scenario = {
    id: 'stop',
    suite: SUITE,
    title: 'abort ends the turn quickly and the next turn answers',
    timeoutMs: 120_000,
    applies: installed,
    mockFixtures: [slowFixture(LONG_ASK), okFixture],
    async run(ctx) {
        const chat = await ctx.newChat()
        await chat.open()
        let abortedAt = 0
        let framesAtAbort = -1
        const first = await chat.send(LONG_ASK, {
            timeoutMs: 60_000,
            onFrame: (f, d) => {
                if (f.type === 'assistant-text' && !abortedAt) {
                    abortedAt = Date.now()
                    framesAtAbort = d.frames.length
                    d.abort()
                }
            },
        })
        if (!abortedAt)
            return fail(
                `no assistant-text before the turn ended (${first.ended}, error: ${first.error ?? 'none'}); nothing to stop`,
            )
        const endMs = Date.now() - abortedAt
        if (first.ended === 'timeout' || endMs > 10_000)
            return fail(
                `turn took ${endMs} ms to end after abort (limit 10000), ended: ${first.ended}`,
            )
        const late = chat.frames
            .slice(framesAtAbort)
            .filter(f => f.type === 'assistant-text').length
        if (late > 0)
            return fail(`${late} assistant-text frame(s) arrived after abort`)
        const next = await chat.send(OK_ASK, { timeoutMs: 60_000 })
        if (next.ended !== 'done' || !next.text.trim())
            return fail(
                `next turn after abort: ended ${next.ended}, text ${JSON.stringify(next.text)}, error: ${next.error ?? 'none'}`,
            )
        return pass(`turn ended ${endMs} ms after abort; next turn answered`, {
            stopMs: endMs,
        })
    },
}

const midTurn: Scenario = {
    id: 'mid-turn',
    suite: SUITE,
    title: 'a message sent during a turn is delivered to the model',
    timeoutMs: 120_000,
    applies: t => firstOf(installed(t), needsCap(t, 'midTurnMessages')),
    mockFixtures: [slowFixture(MID_FIRST), { match: { userMessage: MID_MARK }, response: { content: 'got it' } }],
    async run(ctx) {
        const chat = await ctx.newChat()
        await chat.open()
        let sent = false
        const first = await chat.send(MID_FIRST, {
            timeoutMs: 60_000,
            onFrame: (f, d) => {
                if (f.type === 'assistant-text' && !sent) {
                    sent = true
                    d.sendMidTurn(MID_MARK)
                }
            },
        })
        if (!sent)
            return fail(
                `turn never streamed text (${first.ended}, error: ${first.error ?? 'none'}); no moment to send mid-turn`,
            )
        const delivered = await waitFor(
            () => framesOf(chat, 'delivered').length > 0,
            15_000,
        )
        if (!delivered) return fail(`no delivered frame for the mid-turn message (first turn ended ${first.ended}; frames: ${chat.frames.map(f => f.type).join(',')})`)
        const reached = await waitFor(
            () => bodyText(ctx).some(b => b.includes(MID_MARK)),
            15_000,
        )
        if (!reached)
            return fail(
                `delivered frame arrived but none of ${ctx.modelRequests().length} model request(s) contains the mid-turn text`,
            )
        return pass('mid-turn message delivered and reached the model')
    },
}

const models: Scenario = {
    id: 'models',
    suite: SUITE,
    title: 'the model list arrives and a model switch takes effect or is refused',
    timeoutMs: 120_000,
    applies: t => firstOf(installed(t), needsCap(t, 'models')),
    mockFixtures: [okFixture],
    async run(ctx) {
        const chat = await ctx.newChat()
        await chat.open()
        const got = await waitFor(() => framesOf(chat, 'models').length > 0, 20_000)
        const all = framesOf(chat, 'models').at(-1)?.models ?? []
        const list = switchableModels(ctx.target, all)
        if (!got || all.length === 0)
            return fail(
                `no models frame with an entry (frames: ${[...new Set(chat.frames.map(f => f.type))].join(',')})`,
            )
        if (list.length < 2)
            return skip(
                `${list.length} switchable model(s) of ${all.length} listed; need two to switch`,
            )
        const target = list[list.length - 1].value
        const before = ctx.modelRequests().length
        chat.setModel(target)
        const turn = await chat.send(OK_ASK, { timeoutMs: 60_000 })
        if (turn.ended !== 'done')
            return fail(
                `turn after setModel(${target}) ended ${turn.ended}, error: ${turn.error ?? 'none'}`,
            )
        const refused = framesOf(chat, 'model-refused').find(f => f.model === target)
        if (refused)
            return pass(`${target} refused, session kept ${refused.current || 'the default'}`)
        // The wire carries the bare id: a `provider/` or `provider:` prefix is the chat's, not the
        // request's (hermes sends `mock-2` for `custom:mock-2`).
        const tail = (target.split('/').pop() as string).split(':').pop() as string
        // gemini names its model in the URL path, not the body.
        const named = ctx
            .modelRequests()
            .slice(before)
            .some(r => {
                const b = JSON.stringify(r.body)
                return (
                    b.includes(target) ||
                    b.includes(tail) ||
                    r.path.includes(target) ||
                    r.path.includes(tail)
                )
            })
        if (!named)
            return fail(
                `setModel(${target}) was not refused and ${ctx.modelRequests().length - before} later request(s) do not name it`,
            )
        return pass(`next request names ${target}`)
    },
}

/** opencode 2.3 marks an agent switch with a synthetic user message before the next real one:
 *  `<system-reminder>You are in Plan mode ...`. Its system prompt and tools do not change. */
const MODE_NAME = /You are in ([A-Za-z -]{1,30}) mode/i
const MODE_MARKER = /<system-reminder>(?:\\n|\\r|\s)*You are in [A-Za-z -]{1,30} mode/i

/** What a request tells the model about its role: the top-level system/instructions fields, every
 *  system/developer message and the mode named by the LAST agent-mode marker message, serialised. The scenario never knows an agent's prompt text,
 *  so it compares this between requests: a switched agent changes it, a kept agent repeats it. */
export function instructionSignature(body: unknown): string {
    if (!body || typeof body !== 'object') return ''
    const b = body as Record<string, unknown>
    const parts: string[] = []
    let lastMode: string | null = null
    for (const k of ['system', 'instructions', 'system_instruction'])
        if (b[k] !== undefined) parts.push(JSON.stringify(b[k]))
    for (const k of ['messages', 'input']) {
        const list = b[k]
        if (!Array.isArray(list)) continue
        for (const m of list) {
            const role = (m as { role?: unknown } | null)?.role
            if (role === 'system' || role === 'developer')
                parts.push(JSON.stringify(m))
            else if (role === 'user' && MODE_MARKER.test(JSON.stringify(m)))
                lastMode = MODE_NAME.exec(JSON.stringify(m))![1]
        }
    }
    if (lastMode !== null) parts.push(`mode:${lastMode}`)
    return parts.join('\n')
}

/** The signature of the main request of the turn that began at request index `from`; null when
 *  that turn sent no main request. A title or side request fired after it is ignored. */
const turnSignature = (ctx: ScenarioCtx, from: number): string | null => {
    const req = mainRequest(ctx.modelRequests().slice(from), OK_ASK)
    return req ? instructionSignature(req.body) : null
}

const agents: Scenario = {
    id: 'agents',
    suite: SUITE,
    title: 'switching agent changes the next request, and a resumed chat keeps it',
    timeoutMs: 180_000,
    applies: t => firstOf(installed(t), needsCap(t, 'agents'), watchedModel(t)),
    mockFixtures: [okFixture],
    async run(ctx) {
        const chat = await ctx.newChat()
        await chat.open()
        // A private chat's session is erased when it closes, and the resume below needs it. open()
        // marks every bench chat private, so this turns it off after the session exists; the resumed
        // chat is private again, and closing it in the scenario's cleanup erases the session.
        chat.setPrivate(false)
        let resumedOpen = false
        try {
            return await runAgents(ctx, chat, () => {
                resumedOpen = true
            })
        } finally {
            // A run that stopped before the resume still owns a public session: hand it back to private.
            if (!resumedOpen) chat.setPrivate(true)
        }
    },
}

async function runAgents(
    ctx: ScenarioCtx,
    chat: ChatDriver,
    onResume: () => void,
): Promise<ScenarioOutcome> {
    const got = await waitFor(() => framesOf(chat, 'agents').length > 0, 20_000)
    const frame = framesOf(chat, 'agents').at(-1)
    const list = frame?.agents ?? []
    if (!got || list.length < 2)
        return fail(
            `agents frame ${got ? `lists ${list.length} agent(s), need 2` : 'never arrived'} (frames: ${[...new Set(chat.frames.map(f => f.type))].join(',')})`,
        )
    const second = list[1].value
    const at1 = ctx.modelRequests().length
    const first = await chat.send(OK_ASK, { timeoutMs: 60_000 })
    if (first.ended !== 'done')
        return fail(`first turn ended ${first.ended}, error: ${first.error ?? 'none'}`)
    const base = turnSignature(ctx, at1)
    if (base === null)
        return fail('no model request of the first turn carries its message')
    if (!base)
        return fail('the first model request carries no system prompt to compare against')
    chat.setAgent(second)
    const at2 = ctx.modelRequests().length
    const turn = await chat.send(OK_ASK, { timeoutMs: 60_000 })
    if (turn.ended !== 'done')
        return fail(
            `turn after setAgent(${second}) ended ${turn.ended}, error: ${turn.error ?? 'none'}`,
        )
    const switched = turnSignature(ctx, at2)
    if (switched === null)
        return fail(`no model request after setAgent(${second}) carries the turn's message`)
    if (switched === base)
        return fail(
            `setAgent(${second}) left the next request on the old agent: its system prompt is identical to the default agent's`,
        )
    const sid = chat.sessionId()
    if (!sid) return fail('no session id to resume after setAgent')
    await chat.close()
    const resumed = await ctx.resumeChat(sid)
    await resumed.open()
    onResume()
    const at3 = ctx.modelRequests().length
    const again = await resumed.send(OK_ASK, { timeoutMs: 60_000 })
    if (again.ended !== 'done')
        return fail(
            `turn on the resumed chat ended ${again.ended}, error: ${again.error ?? 'none'}`,
        )
    const kept = turnSignature(ctx, at3)
    if (kept === null)
        return fail('no model request of the resumed turn carries its message')
    if (kept === base)
        return fail(
            `resumed chat dropped ${second}: its request carries the default agent's prompt again`,
        )
    if (kept !== switched)
        return fail(
            `resumed chat's request carries neither the default's nor ${second}'s prompt`,
        )
    return pass(`setAgent(${second}) changed the request and the resumed chat kept it`)
}

/** Levels no request carries a value for: `off`/`none` mean no reasoning, `adaptive`/`auto`/`default`
 *  mean the backend picks its own. */
const NO_EFFORT = new Set(['off', 'none', 'adaptive', 'auto', 'default'])

const effort: Scenario = {
    id: 'effort',
    suite: SUITE,
    title: 'a chosen effort level reaches the model request',
    timeoutMs: 120_000,
    applies: t => firstOf(installed(t), needsCap(t, 'effort'), watchedModel(t)),
    mockFixtures: [okFixture],
    async run(ctx) {
        const chat = await ctx.newChat()
        await chat.open()
        const got = await waitFor(() => framesOf(chat, 'models').length > 0, 20_000)
        const all = framesOf(chat, 'models').at(-1)?.models ?? []
        const list = switchableModels(ctx.target, all)
        if (!got || all.length === 0)
            return fail('no models frame, so no effort levels to choose from')
        const provable = (m: { effortLevels: string[] }) =>
            m.effortLevels.filter(l => !NO_EFFORT.has(l.toLowerCase()))
        const withLevels = list.find(m => provable(m).length > 0)
        if (!withLevels)
            return skip(
                `none of ${list.length} listed model(s) has an effort level besides off`,
            )
        chat.setModel(withLevels.value)
        // Prefer a level that is not the lowest, so a default cannot fake the result. `off` means no
        // reasoning, so no request carries it, and `adaptive`/`auto`/`default` mean the backend's own
        // choice: none can be the level to prove.
        const level = provable(withLevels).at(-1) as string
        chat.setEffort(level)
        const before = ctx.modelRequests().length
        const turn = await chat.send(OK_ASK, { timeoutMs: 60_000 })
        if (turn.ended !== 'done')
            return fail(
                `turn after setEffort(${level}) ended ${turn.ended}, error: ${turn.error ?? 'none'}`,
            )
        const later = ctx.modelRequests().slice(before)
        const hit = later.some(r => {
            const b = r.body as Record<string, unknown>
            const fields = [
                b.reasoning_effort,
                (b.reasoning as { effort?: unknown } | undefined)?.effort,
                (b.output_config as { effort?: unknown } | undefined)?.effort,
            ]
            return fields.some(f => f === level)
        })
        if (!hit)
            return fail(
                `setEffort(${level}) on ${withLevels.value}: none of ${later.length} later request(s) carries it (reasoning effort field absent)`,
            )
        return pass(`next request carries effort ${level}`)
    },
}

const scenarios: Scenario[] = [
    permissionScenario('deny'),
    permissionScenario('allow'),
    stop,
    midTurn,
    models,
    agents,
    effort,
]

export default scenarios
