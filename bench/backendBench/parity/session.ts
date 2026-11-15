// bench/backendBench/parity/session.ts
// The session scenarios: resume, history, private erase, small windows, compaction. They grade
// plumbing (frames, what `bismuth chat list` prints, what reached the model), never answer quality.
import type { ChatFrame } from '../../../core/src/chat'
import { CHAT_HISTORY_SOURCES } from '../../../core/src/chatProviders/chatHistorySources'
import type {
    ChatDriver,
    Scenario,
    ScenarioCtx,
    ScenarioOutcome,
} from '../types'
import { DAEMON_NAME } from '../vault'
import {
    firstOf,
    installed,
    mainRequest,
    needsCap,
    needsLocalModel,
    watchedModel,
} from './gates'

const SUITE = 'parity'
// Distinctive openings of CHAT_RENDERING_NOTE and AGENT_CLI_NOTE (core/src/chatRenderingNote.ts,
// agentCliNote.ts); the body is searched serialised, so backticks survive as-is.
// (the persona note also says 'Bismuth chat tab', so that cannot be the mark)
const RENDERING_MARK = 'LaTeX math with KaTeX'
const CLI_MARK = 'CLI does everything Bismuth does'
const WINDOW_SMALL = 8192
const WINDOW_BIG = 131072

const fail = (detail: string): ScenarioOutcome => ({ verdict: 'fail', detail })
const pass = (
    detail: string,
    metrics?: Record<string, number>,
): ScenarioOutcome => ({ verdict: 'pass', detail, metrics })

const reply = (userMessage: string, content: string) => ({
    match: { userMessage },
    response: { content },
})

const bodies = (ctx: ScenarioCtx) =>
    ctx.modelRequests().map(r => JSON.stringify(r.body))

const count = (hay: string, needle: string) => hay.split(needle).length - 1

/** A chat that keeps its conversation, so history and `chat list` can find it. */
async function openPublic(ctx: ScenarioCtx): Promise<ChatDriver> {
    const chat = await ctx.newChat()
    chat.setPrivate(false)
    await chat.open()
    return chat
}

/** Under `--home real` a public bench chat stays in the user's own store; reopening it by id,
 *  marking it private and closing it erases the transcript, so a run leaves no history behind. */
async function erase(ctx: ScenarioCtx, id: string | null): Promise<void> {
    if (!id) return
    try {
        const again = await ctx.resumeChat(id)
        await again.open()
        again.setPrivate(true)
        await again.close()
    } catch {
        // best effort: the scenario's verdict is already decided
    }
}

/** Wraps a scenario body: every id it pushes onto `ids` is erased once the body is done. */
const cleaning =
    (body: (ctx: ScenarioCtx, ids: string[]) => Promise<ScenarioOutcome>) =>
    async (ctx: ScenarioCtx): Promise<ScenarioOutcome> => {
        const ids: string[] = []
        try {
            return await body(ctx, ids)
        } finally {
            for (const id of ids) await erase(ctx, id)
        }
    }

async function ask(chat: ChatDriver, text: string): Promise<string | null> {
    const turn = await chat.send(text, { timeoutMs: 90_000 })
    if (turn.ended !== 'done')
        return `turn "${text.slice(0, 40)}" ended ${turn.ended}, error: ${turn.error ?? 'none'}`
    return null
}

// ---- resume ----------------------------------------------------------------------------------

const CODE_TELL = 'the code word is mango-7Q for the bench, remember it'
const CODE_ASK = 'repeat the earlier code word for the bench'
const CODE_WORD = 'mango-7Q'

const resume: Scenario = {
    id: 'resume',
    suite: SUITE,
    title: 'a resumed chat sends the earlier turn to the model',
    timeoutMs: 180_000,
    applies: t => firstOf(installed(t), watchedModel(t)),
    mockFixtures: [reply(CODE_TELL, 'noted'), reply(CODE_ASK, 'mango')],
    async run(ctx) {
        const chat = await openPublic(ctx)
        let id: string | null = null
        try {
            const bad = await ask(chat, CODE_TELL)
            if (bad) return fail(bad)
            id = chat.sessionId()
            if (!id) return fail('no session frame, so there is nothing to resume')
            await chat.close()
            const before = ctx.modelRequests().length
            const again = await ctx.resumeChat(id)
            await again.open()
            const bad2 = await ask(again, CODE_ASK)
            if (bad2) return fail(`after resume: ${bad2}`)
            const later = bodies(ctx).slice(before)
            if (later.length === 0)
                return fail('the resumed turn sent no request to the model')
            if (!later.some(b => b.includes(CODE_WORD)))
                return fail(
                    `${later.length} request(s) after resume, none carries turn 1 (${CODE_WORD}); the resumed chat lost its history`,
                )
            return pass(`request after resume carries turn 1 (${CODE_WORD})`)
        } finally {
            await erase(ctx, id)
        }
    },
}

// ---- history-replay ---------------------------------------------------------------------------

const H1 = 'history one for the bench'
const H2 = 'history two for the bench'

const historyReplay: Scenario = {
    id: 'history-replay',
    suite: SUITE,
    title: 'session history replays both turns in order',
    timeoutMs: 180_000,
    applies: t => firstOf(installed(t), needsCap(t, 'historyReplay')),
    mockFixtures: [reply(H1, 'first answer'), reply(H2, 'second answer')],
    run: cleaning(async (ctx, ids) => {
        const chat = await openPublic(ctx)
        for (const q of [H1, H2]) {
            const bad = await ask(chat, q)
            if (bad) return fail(bad)
        }
        const id = chat.sessionId()
        if (!id) return fail('no session frame, so there is no history to read')
        ids.push(id)
        await chat.close()
        const frames = await ctx.history(id)
        const shape = (f: ChatFrame) =>
            f.type === 'user-message'
                ? `user:${f.text.slice(0, 24)}`
                : f.type === 'assistant-text'
                  ? 'assistant'
                  : f.type
        const seen = frames.filter(
            f => f.type === 'user-message' || f.type === 'assistant-text',
        )
        const at = (needle: string) =>
            seen.findIndex(f => f.type === 'user-message' && f.text.includes(needle))
        const i1 = at(H1)
        const i2 = at(H2)
        const trail = `history frames: ${frames.map(shape).join(', ') || 'none'}`
        if (i1 < 0 || i2 < 0)
            return fail(`${i1 < 0 ? 'turn 1' : 'turn 2'} user-message missing; ${trail}`)
        if (i1 > i2) return fail(`turns out of order; ${trail}`)
        const assistantAfter = (i: number, next: number) =>
            seen.slice(i + 1, next < 0 ? undefined : next).some(f => f.type === 'assistant-text')
        if (!assistantAfter(i1, i2))
            return fail(`no assistant-text between turn 1 and turn 2; ${trail}`)
        if (!assistantAfter(i2, -1))
            return fail(`no assistant-text after turn 2; ${trail}`)
        return pass(`both turns replayed in order (${frames.length} frames)`)
    }),
}

// ---- history-list -----------------------------------------------------------------------------

const L1 = 'list me for the bench'

const historyList: Scenario = {
    id: 'history-list',
    suite: SUITE,
    title: 'a kept chat is in `bismuth chat list` and the history picker',
    timeoutMs: 180_000,
    applies: t => firstOf(installed(t), needsCap(t, 'sessionPicker')),
    mockFixtures: [reply(L1, 'listed')],
    run: cleaning(async (ctx, ids) => {
        const chat = await openPublic(ctx)
        const bad = await ask(chat, L1)
        if (bad) return fail(bad)
        const id = chat.sessionId()
        if (!id) return fail('no session frame, so there is no id to look for')
        ids.push(id)
        const cli = await ctx.bismuth(['chat', 'list'])
        if (cli.code !== 0)
            return fail(
                `bismuth chat list exited ${cli.code}: ${cli.stderr.trim().slice(0, 200)}`,
            )
        if (!cli.stdout.includes(id) && !cli.stdout.includes(id.slice(0, 8)))
            return fail(
                `bismuth chat list does not show ${id}; it printed ${cli.stdout.trim().split('\n').length} line(s): ${cli.stdout.trim().slice(0, 200)}`,
            )
        const source = CHAT_HISTORY_SOURCES[ctx.target.backend]
        if (!source)
            return fail(`no history source registered for ${ctx.target.backend}`)
        const rows = await source.list(ctx.vault, 'all')
        if (!rows.some(r => r.sessionId === id))
            return fail(
                `the ${ctx.target.backend} history source lists ${rows.length} chat(s), none is ${id}`,
            )
        return pass(`${id} is in chat list and the ${ctx.target.backend} history source`)
    }),
}

// ---- private-erase ----------------------------------------------------------------------------

const P1 = 'private one for the bench'

const privateErase: Scenario = {
    id: 'private-erase',
    suite: SUITE,
    title: 'a private chat is gone from the backend store once closed',
    timeoutMs: 180_000,
    applies: t => firstOf(installed(t), needsCap(t, 'historyReplay')),
    mockFixtures: [reply(P1, 'secret')],
    run: cleaning(async (ctx, ids) => {
        // control: the same turn on a public chat must be readable back, or an empty read proves nothing
        const pub = await openPublic(ctx)
        const badPub = await ask(pub, P1)
        if (badPub) return fail(`control chat: ${badPub}`)
        const pubId = pub.sessionId()
        if (!pubId) return fail('control chat sent no session frame')
        ids.push(pubId)
        await pub.close()
        const pubFrames = await ctx.history(pubId)
        if (!pubFrames.some(f => f.type === 'user-message' || f.type === 'assistant-text'))
            return fail(
                `control: the public chat ${pubId} has no message frames in history, so an empty private read would prove nothing`,
            )
        const chat = await ctx.newChat()
        chat.setPrivate(true)
        await chat.open()
        const bad = await ask(chat, P1)
        if (bad) return fail(bad)
        const id = chat.sessionId()
        if (!id) return fail('no session frame, so there is nothing to find')
        await chat.close()
        // The erase runs once the backend's child process exits, a moment after close; read until
        // nothing is left or 15 s pass.
        const keptNow = async () => {
            try {
                return (await ctx.history(id)).filter(
                    f => f.type === 'user-message' || f.type === 'assistant-text',
                )
            } catch {
                // a store that no longer knows the id may throw: that is erased
                return [] as ChatFrame[]
            }
        }
        let kept = await keptNow()
        for (const end = Date.now() + 15_000; kept.length > 0 && Date.now() < end; ) {
            await new Promise(r => setTimeout(r, 500))
            kept = await keptNow()
        }
        if (kept.length > 0)
            return fail(
                `closed private chat ${id} still has ${kept.length} message frame(s) in the ${ctx.target.backend} store`,
            )
        return pass(`private chat ${id} left no history after close`)
    }),
}

// ---- small-window -----------------------------------------------------------------------------

const W1 = 'small window one for the bench'
const W2 = 'big window one for the bench'

/** What a full-instructions request carries: the rendering note, the daemon name, the CLI note. */
const missingInstructions = (body: string) =>
    [
        [RENDERING_MARK, 'chat rendering note'],
        [DAEMON_NAME, `daemon name ${DAEMON_NAME}`],
        [CLI_MARK, 'bismuth CLI note'],
    ]
        .filter(([needle]) => !body.includes(needle))
        .map(([, label]) => label)

const smallWindow: Scenario = {
    id: 'small-window',
    suite: SUITE,
    title: 'an 8192 window answers its first message; a 131072 window keeps every instruction',
    timeoutMs: 240_000,
    applies: t => firstOf(installed(t), watchedModel(t), needsLocalModel(t)),
    mockFixtures: [reply(W1, 'small ok'), reply(W2, 'big ok')],
    async run(ctx) {
        try {
            ctx.setWindow(WINDOW_SMALL)
            const small = await ctx.newChat()
            await small.open()
            const t1 = await small.send(W1, { timeoutMs: 120_000 })
            const first = mainRequest(ctx.modelRequests(), W1)
            if (t1.ended !== 'done' || t1.error)
                return fail(
                    `first turn at a ${WINDOW_SMALL} window ended ${t1.ended}, error: ${t1.error ?? 'none'}${
                        first ? `; first request ~${first.estTokens} tokens` : ''
                    }`,
                )
            if (!first)
                return fail(`first turn ended done but no model request carries the message (${ctx.modelRequests().length} request(s))`)
            if (first.estTokens > WINDOW_SMALL)
                return fail(
                    `first request is ~${first.estTokens} tokens, over the ${WINDOW_SMALL} window`,
                )
            if (small.frames.some(f => f.type === 'error'))
                return fail(`an error frame reached the ${WINDOW_SMALL}-window chat`)
            await small.close()

            const before = ctx.modelRequests().length
            ctx.setWindow(WINDOW_BIG)
            const big = await ctx.newChat()
            await big.open()
            const t2 = await big.send(W2, { timeoutMs: 120_000 })
            if (t2.ended !== 'done')
                return fail(
                    `first turn at a ${WINDOW_BIG} window ended ${t2.ended}, error: ${t2.error ?? 'none'}`,
                )
            const firstBig = mainRequest(ctx.modelRequests().slice(before), W2)
            if (!firstBig)
                return fail(`no request carrying the message reached the model at a ${WINDOW_BIG} window`)
            const missing = missingInstructions(JSON.stringify(firstBig.body))
            if (missing.length > 0)
                return fail(
                    `${WINDOW_BIG}-window first request is missing: ${missing.join(', ')} (a big window is being starved)`,
                )
            return pass(
                `${WINDOW_SMALL}: first request ~${first.estTokens} tokens; ${WINDOW_BIG}: all instructions present`,
                { firstTokens: first.estTokens },
            )
        } finally {
            ctx.setWindow(null)
        }
    },
}

// ---- compaction -------------------------------------------------------------------------------

const TURNS = 10
const FILLER = 'lorem ipsum dolor sit amet '.repeat(220) // ~6k chars, ~1.5k tokens
const compactAsk = (n: number) => `bench-compact-turn-${n}-marker ${FILLER}`

/** Phrases from the prompts a backend's compaction sends as the last user message, read from
 *  recorded requests: opencode's first summary and its update of an existing checkpoint, claude's
 *  summary prompt (diag3-windows #1) and codex's checkpoint prompt (diag3-windows #2) and goose's. They stay
 *  ahead of the per-turn fixtures: claude's reactive compaction puts its prompt in the same user
 *  message as the turn marker. */
export const COMPACT_SUMMARY_PROMPTS = [
    'summarize the conversation above into a structured summary that will be given to another agent',
    'Update the existing checkpoint in the conversation above into one consolidated summary',
    'Your task is to create a detailed summary of the conversation so far',
    'You are performing a CONTEXT CHECKPOINT COMPACTION',
    'Please summarize the conversation history provided in the system prompt',
]

const compaction: Scenario = {
    id: 'compaction',
    suite: SUITE,
    title: 'long turns at 8192 compact without an overflow and without a duplicated message',
    timeoutMs: 600_000,
    applies: t => firstOf(installed(t), watchedModel(t), needsLocalModel(t)),
    mockFixtures: [
        // The summary requests opencode sends once the window fills: the last user message is its
        // own fixed prompt (read from recorded requests), so each matches only that request. The
        // first compaction writes a summary; the next one updates the checkpoint.
        ...COMPACT_SUMMARY_PROMPTS.map(userMessage => ({
            match: { userMessage },
            response: {
                content:
                    '## Objective\n- the user is running benchmark turns\n\n## Progress\n- each turn was answered',
            },
        })),
        ...Array.from({ length: TURNS }, (_, i) =>
            reply(`bench-compact-turn-${i + 1}-marker`, `answer ${i + 1}`),
        ),
    ],
    async run(ctx) {
        try {
            ctx.setWindow(WINDOW_SMALL)
            const chat = await ctx.newChat()
            await chat.open()
            let compactedAt = 0
            let prevMain = 0
            for (let n = 1; n <= TURNS; n++) {
                const from = ctx.modelRequests().length
                const turn = await chat.send(compactAsk(n), { timeoutMs: 120_000 })
                if (turn.ended !== 'done' || turn.error)
                    return fail(
                        `turn ${n} ended ${turn.ended}, error: ${turn.error ?? 'none'}${compactedAt ? ` (compacted at turn ${compactedAt})` : ''}`,
                    )
                const reqs = ctx.modelRequests().slice(from)
                if (reqs.length === 0)
                    return fail(`turn ${n} ended done but sent no model request`)
                const mark = `bench-compact-turn-${n}-marker`
                const carrying = reqs
                    .map(r => JSON.stringify(r.body))
                    .filter(b => b.includes(mark))
                // a backend may send a summary request first, carrying the whole history: judge the
                // turn by its main request
                const main = mainRequest(reqs, mark)
                if (!compactedAt && n > 1 && main && main.estTokens < prevMain)
                    compactedAt = n
                const lastBody = carrying.at(-1)
                if (lastBody && compactedAt && count(lastBody, mark) !== 1)
                    return fail(
                        `turn ${n} request carries ${count(lastBody, mark)} copies of the latest user message after compaction at turn ${compactedAt}`,
                    )
                if (main) prevMain = main.estTokens
            }
            if (chat.frames.some(f => f.type === 'error'))
                return fail('an error frame reached the chat')
            return pass(
                compactedAt
                    ? `compacted at turn ${compactedAt}; every turn done, one copy of the latest message`
                    : `${TURNS} turns done with no compaction needed`,
                { compactedAt },
            )
        } finally {
            ctx.setWindow(null)
        }
    },
}

const scenarios: Scenario[] = [
    resume,
    historyReplay,
    historyList,
    privateErase,
    smallWindow,
    compaction,
]

export default scenarios
