// The router gates the backend that will actually RUN, and a refused resume tears nothing down.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import type { ChatFrame } from '../../src/chat'
import {
    gate,
    openSession,
    sendMessage,
    resumeSession,
} from '../../src/chatProviders'
import { CHAT_BACKENDS } from '../../src/chatProviders/backends'

type Verdict = Awaited<ReturnType<typeof gate.resolve>>

const realResolve = gate.resolve
const saved = {
    claude: { ...CHAT_BACKENDS.claude },
    cline: { ...CHAT_BACKENDS.cline },
}
let judged: string[] = []
let calls: string[] = []
let verdict: Verdict = { allowed: true }
let frames: ChatFrame[] = []
const sink = (f: ChatFrame) => void frames.push(f)
const settle = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
    judged = []
    calls = []
    frames = []
    verdict = { allowed: true }
    gate.resolve = async id => {
        judged.push(id)
        return verdict
    }
    for (const id of ['claude', 'cline'] as const) {
        const b = CHAT_BACKENDS[id]
        b.hasSession = () => false
        b.openSession = () => void calls.push(`${id}.open`)
        b.sendMessage = () => void calls.push(`${id}.send`)
        b.resumeSession = () => void calls.push(`${id}.resume`)
        b.closeChat = () => void calls.push(`${id}.close`)
    }
})

afterEach(() => {
    gate.resolve = realResolve
    Object.assign(CHAT_BACKENDS.claude, saved.claude)
    Object.assign(CHAT_BACKENDS.cline, saved.cline)
})

describe('dispatch gates the backend that runs', () => {
    test('a chat live under claude opened with provider cline is judged as claude and runs on claude', async () => {
        CHAT_BACKENDS.claude.hasSession = () => true
        openSession('c1', '/v', sink, undefined, 'cline')
        await settle()
        expect(judged).toEqual(['claude'])
        expect(calls).toEqual(['claude.open'])
    })

    test('sendMessage judges the live owner too', async () => {
        CHAT_BACKENDS.claude.hasSession = () => true
        sendMessage('c1', 'hi', '/v', sink, undefined, undefined, 'cline')
        await settle()
        expect(judged).toEqual(['claude'])
        expect(calls).toEqual(['claude.send'])
    })

    test('the refusal frame names the backend that was judged, not the raw provider', async () => {
        CHAT_BACKENDS.claude.hasSession = () => true
        verdict = { allowed: false, restrictedCount: 1, message: 'no' }
        openSession('c1', '/v', sink, undefined, 'cline')
        await settle()
        expect(calls).toEqual([])
        expect(frames).toEqual([
            {
                type: 'error',
                code: 'visibility-refused',
                binary: 'claude',
                message: 'no',
            },
        ])
    })
})

describe('resume teardown waits for the gate', () => {
    test('a refused resume leaves the other backend session alone', async () => {
        CHAT_BACKENDS.claude.hasSession = () => true
        verdict = { allowed: false, restrictedCount: 1, message: 'no' }
        resumeSession('c1', 's1', '/v', sink, undefined, 'cline')
        await settle()
        expect(judged).toEqual(['cline'])
        expect(calls).toEqual([])
        expect(frames[0]).toMatchObject({ code: 'visibility-refused' })
    })

    test('an allowed resume closes the other backend then resumes the chosen one', async () => {
        CHAT_BACKENDS.claude.hasSession = () => true
        resumeSession('c1', 's1', '/v', sink, undefined, 'cline')
        await settle()
        expect(calls).toEqual(['claude.close', 'cline.resume'])
    })
})
