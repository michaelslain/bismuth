// bench/backendBench/driver.ts
// One chat on one target, driven through the production router (core/src/chatProviders/index.ts)
// with the target's backend id: the same verbs the app's WebSocket layer calls. Every chat is
// private unless a scenario turns that off, so the bench leaves nothing in a person's agent stores.
import type { ChatFrame } from '../../core/src/chat'
import { CHAT_BACKEND_LIST } from '../../core/src/chatProviders/backends'
import * as router from '../../core/src/chatProviders/index'
import type { BenchTarget, ChatDriver, TurnResult } from './types'

const OPEN_TIMEOUT_MS = 30_000
const DEFAULT_TURN_MS = 120_000
/** After an `error` frame, how long to wait for the turn's `done` before calling it ended. */
const ERROR_GRACE_MS = 2_000
/** Frames that mean the session's header (manifest, model list, session id) has started to land. */
const HEADER_FRAMES = new Set(['manifest', 'session', 'models', 'agents', 'error'])

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function holdsChat(chatId: string): boolean {
    return CHAT_BACKEND_LIST.some(b => b.hasSession(chatId))
}

class Driver implements ChatDriver {
    readonly chatId = router.newChatId()
    readonly frames: ChatFrame[] = []
    private listeners = new Set<(f: ChatFrame) => void>()
    private opened = false
    /** Permission and question ids a scenario (or the driver) has already answered. */
    private answered = new Set<string>()

    constructor(
        private target: BenchTarget,
        readonly vault: string,
        private resumeId: string | null = null,
        private log: (line: string) => void = () => {},
    ) {}

    private sink = (frame: ChatFrame) => {
        this.frames.push(frame)
        for (const l of [...this.listeners]) l(frame)
    }

    private waitFrame(
        match: (f: ChatFrame) => boolean,
        ms: number,
    ): Promise<boolean> {
        return new Promise(resolve => {
            const done = (ok: boolean) => {
                clearTimeout(timer)
                this.listeners.delete(listener)
                resolve(ok)
            }
            const listener = (f: ChatFrame) => match(f) && done(true)
            const timer = setTimeout(() => done(false), ms)
            this.listeners.add(listener)
            if (this.frames.some(match)) done(true)
        })
    }

    async open(): Promise<void> {
        if (this.opened) return
        this.opened = true
        if (this.resumeId)
            router.resumeSession(
                this.chatId,
                this.resumeId,
                this.vault,
                this.sink,
                undefined,
                this.target.backend,
            )
        else
            router.openSession(
                this.chatId,
                this.vault,
                this.sink,
                undefined,
                this.target.backend,
            )
        await this.waitFrame(f => HEADER_FRAMES.has(f.type), OPEN_TIMEOUT_MS)
        // Under --home real an opencode session with no model would fall back to the machine's
        // last-active model, so a mock target pins the mock model before the first send.
        if (
            this.target.source.kind === 'mock' &&
            this.target.backend === 'opencode'
        ) {
            router.setModel(this.chatId, 'mock/mock')
        }
        // The session exists now, so the private toggle reaches its backend.
        router.setPrivate(this.chatId, true)
    }

    async send(
        text: string,
        opts?: {
            timeoutMs?: number
            onFrame?: (frame: ChatFrame, driver: ChatDriver) => void
        },
    ): Promise<TurnResult> {
        await this.open()
        const start = this.frames.length
        const t0 = Date.now()
        const turnFrames = () => this.frames.slice(start)
        const onFrame = opts?.onFrame
        const autoAllowed: string[] = []
        const listener = (f: ChatFrame) => onFrame?.(f, this)
        // Added after the scenario's listener, so it only sees what the scenario left unanswered.
        const autoAnswer = (f: ChatFrame) => {
            if (f.type === 'permission' && !this.answered.has(f.id)) {
                autoAllowed.push(f.toolName)
                this.log(`auto-allowed permission for ${f.toolName}`)
                this.respondPermission(f.id, 'allow')
            } else if (f.type === 'question' && !this.answered.has(f.id)) {
                this.log('auto-skipped an unanswered question')
                this.respondQuestion(f.id, null)
            }
        }
        if (onFrame) this.listeners.add(listener)
        this.listeners.add(autoAnswer)
        let ended: TurnResult['ended'] = 'timeout'
        try {
            router.sendMessage(
                this.chatId,
                text,
                this.vault,
                this.sink,
                undefined,
                undefined,
                this.target.backend,
            )
            const deadline = Date.now() + (opts?.timeoutMs ?? DEFAULT_TURN_MS)
            const isDone = (f: ChatFrame) => f.type === 'done' && !f.idle
            const isError = (f: ChatFrame) => f.type === 'error'
            const finished = await new Promise<'done' | 'error' | 'timeout'>(
                resolve => {
                    let grace: ReturnType<typeof setTimeout> | null = null
                    const finish = (v: 'done' | 'error' | 'timeout') => {
                        clearTimeout(timer)
                        if (grace) clearTimeout(grace)
                        this.listeners.delete(l)
                        resolve(v)
                    }
                    const l = (f: ChatFrame) => {
                        if (isDone(f))
                            finish(turnFrames().some(isError) ? 'error' : 'done')
                        else if (isError(f) && !grace)
                            grace = setTimeout(() => finish('error'), ERROR_GRACE_MS)
                    }
                    const timer = setTimeout(
                        () => finish('timeout'),
                        Math.max(0, deadline - Date.now()),
                    )
                    this.listeners.add(l)
                    const seen = turnFrames()
                    if (seen.some(isDone))
                        finish(seen.some(isError) ? 'error' : 'done')
                    else if (seen.some(isError))
                        grace = setTimeout(() => finish('error'), ERROR_GRACE_MS)
                },
            )
            ended = finished
        } finally {
            this.listeners.delete(listener)
            this.listeners.delete(autoAnswer)
        }
        return { ...this.result(turnFrames(), t0, ended), autoAllowed }
    }

    private result(
        frames: ChatFrame[],
        t0: number,
        ended: TurnResult['ended'],
    ): TurnResult {
        let text = ''
        const toolUses: TurnResult['toolUses'] = []
        let error: string | null = null
        let firstTokenMs: number | null = null
        const stamped = this.stamps
        for (const f of frames) {
            if (f.type === 'assistant-text') {
                text += f.text
                if (firstTokenMs === null)
                    firstTokenMs = (stamped.get(f) ?? Date.now()) - t0
            } else if (f.type === 'tool-use')
                toolUses.push({ id: f.id, name: f.name, input: f.input })
            else if (f.type === 'tool-result') {
                const u = toolUses.find(t => t.id === f.id)
                if (u) {
                    u.result = f.content
                    u.isError = f.isError
                }
            } else if (f.type === 'error' && error === null)
                error = f.message
        }
        // claude reports a failed request as an error result plus assistant text, not an error frame
        if (error === null && frames.some(f => f.type === 'result' && f.isError))
            error = text.trim() || 'the turn ended with an error result'
        return {
            frames,
            text,
            toolUses,
            error,
            firstTokenMs,
            wallMs: Date.now() - t0,
            ended,
        }
    }

    // Arrival time of each assistant-text frame, for `firstTokenMs`.
    private stamps = new Map<ChatFrame, number>()

    sendMidTurn(text: string): void {
        router.sendMessage(
            this.chatId,
            text,
            this.vault,
            this.sink,
            undefined,
            undefined,
            this.target.backend,
            // the app tags a mid-turn message with a UUID; a backend answers it with a `delivered` frame (claude takes a UUID only)
            crypto.randomUUID(),
        )
    }
    abort(): void {
        router.abortTurn(this.chatId)
    }
    respondPermission(id: string, behavior: 'allow' | 'deny'): void {
        this.answered.add(id)
        router.respondPermission(this.chatId, id, behavior)
    }
    respondQuestion(id: string, answers: Record<string, string> | null): void {
        this.answered.add(id)
        router.respondQuestion(this.chatId, id, answers)
    }
    setModel(model: string): void {
        router.setModel(this.chatId, model)
    }
    setAgent(agent: string): void {
        router.setAgent(this.chatId, agent)
    }
    setEffort(effort: string): void {
        router.setEffort(this.chatId, effort)
    }
    setPrivate(on: boolean): void {
        router.setPrivate(this.chatId, on)
    }
    sessionId(): string | null {
        for (let i = this.frames.length - 1; i >= 0; i--) {
            const f = this.frames[i]
            if (f.type === 'session') return f.sessionId
        }
        return null
    }
    async close(): Promise<void> {
        router.closeChat(this.chatId)
        for (let i = 0; i < 100 && holdsChat(this.chatId); i++) await sleep(100)
        if (holdsChat(this.chatId))
            throw new Error(
                `chat ${this.chatId} is still held by ${this.target.backend} 10 s after closeChat`,
            )
    }

    /** Stamp frames as they arrive, so `firstTokenMs` is the real arrival time. */
    stamp(): void {
        this.listeners.add(f => {
            if (f.type === 'assistant-text') this.stamps.set(f, Date.now())
        })
    }
}

export function createChatDriver(
    target: BenchTarget,
    vault: string,
    log?: (line: string) => void,
): ChatDriver {
    const d = new Driver(target, vault, null, log)
    d.stamp()
    return d
}

/** A new chat id bound to `sessionId` (the backend's own session), header frames landed. */
export async function resumeChatDriver(
    target: BenchTarget,
    vault: string,
    sessionId: string,
): Promise<ChatDriver> {
    const d = new Driver(target, vault, sessionId)
    d.stamp()
    await d.open()
    return d
}

export function historyFrames(
    target: BenchTarget,
    vault: string,
    sessionId: string,
): Promise<ChatFrame[]> {
    return router.sessionHistoryFrames(sessionId, vault, target.backend)
}
