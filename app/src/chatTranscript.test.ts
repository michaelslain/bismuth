// app/src/chatTranscript.test.ts
import { describe, it, expect } from 'bun:test'
import {
    applyChatFrame,
    buildTranscript,
    type AssistantItem,
    type TurnItem,
} from './chatTranscript'
import type { ChatFrame } from '../../core/src/chat'

/** The trailing item, asserted to be an assistant turn — most cases build one and then inspect it. */
function assistantTail(transcript: TurnItem[]): AssistantItem {
    const last = transcript[transcript.length - 1]
    expect(last?.role).toBe('assistant')
    return last as AssistantItem
}

describe('applyChatFrame — user turns', () => {
    it('pushes a replayed user turn as its own item', () => {
        const t: TurnItem[] = []
        expect(
            applyChatFrame(t, { type: 'user-message', text: 'hello there' }),
        ).toBe(true)
        expect(t).toEqual([
            { role: 'user', text: 'hello there', images: undefined },
        ])
    })

    it("keeps a replayed turn's image attachments so an image-only turn survives replay", () => {
        const t: TurnItem[] = []
        applyChatFrame(t, {
            type: 'user-message',
            text: '',
            images: ['data:image/png;base64,AAAA'],
        })
        expect(t).toEqual([
            { role: 'user', text: '', images: ['data:image/png;base64,AAAA'] },
        ])
    })

    it('keeps consecutive user turns as separate items', () => {
        const t: TurnItem[] = []
        applyChatFrame(t, { type: 'user-message', text: 'first' })
        applyChatFrame(t, { type: 'user-message', text: 'second' })
        expect(t.length).toBe(2)
        expect(t.map(i => (i as { text: string }).text)).toEqual([
            'first',
            'second',
        ])
    })
})

describe('applyChatFrame — streamed assistant prose', () => {
    it('opens an assistant turn on the first delta', () => {
        const t: TurnItem[] = []
        expect(applyChatFrame(t, { type: 'assistant-text', text: 'Hel' })).toBe(
            true,
        )
        expect(t.length).toBe(1)
        expect(assistantTail(t)).toEqual({
            role: 'assistant',
            parts: [{ kind: 'text', text: 'Hel' }],
            footer: null,
            command: false,
        })
    })

    it('MERGES consecutive text deltas into one part rather than one part per delta', () => {
        const t: TurnItem[] = []
        for (const chunk of ['Hel', 'lo, ', 'world'])
            applyChatFrame(t, { type: 'assistant-text', text: chunk })
        expect(assistantTail(t).parts).toEqual([
            { kind: 'text', text: 'Hello, world' },
        ])
    })

    it('merges thinking deltas into their own part, separate from prose', () => {
        const t: TurnItem[] = []
        applyChatFrame(t, { type: 'thinking', text: 'Let me ' })
        applyChatFrame(t, { type: 'thinking', text: 'check the vault.' })
        applyChatFrame(t, { type: 'assistant-text', text: 'Found it.' })
        expect(assistantTail(t).parts).toEqual([
            { kind: 'thinking', text: 'Let me check the vault.' },
            { kind: 'text', text: 'Found it.' },
        ])
    })

    it('starts a NEW text part after an interleaved tool call, so prose splits into two bubbles', () => {
        const t: TurnItem[] = []
        applyChatFrame(t, {
            type: 'assistant-text',
            text: 'Reading the note. ',
        })
        applyChatFrame(t, {
            type: 'tool-use',
            id: 't1',
            name: 'Read',
            input: { file_path: 'a.md' },
        })
        applyChatFrame(t, { type: 'assistant-text', text: 'It says hello.' })
        const parts = assistantTail(t).parts
        expect(parts.map(p => p.kind)).toEqual(['text', 'tool', 'text'])
        expect(parts[0]).toEqual({ kind: 'text', text: 'Reading the note. ' })
        expect(parts[2]).toEqual({ kind: 'text', text: 'It says hello.' })
    })

    it('starts a fresh assistant turn when the previous item is a user turn', () => {
        const t: TurnItem[] = []
        applyChatFrame(t, { type: 'assistant-text', text: 'first reply' })
        applyChatFrame(t, { type: 'user-message', text: 'follow-up' })
        applyChatFrame(t, { type: 'assistant-text', text: 'second reply' })
        expect(t.map(i => i.role)).toEqual(['assistant', 'user', 'assistant'])
        expect(assistantTail(t).parts).toEqual([
            { kind: 'text', text: 'second reply' },
        ])
    })

    it('flags a turn answering a SLASH-COMMAND user turn as command output (#28)', () => {
        const t: TurnItem[] = []
        applyChatFrame(t, { type: 'user-message', text: '  /context  ' }) // leading space: trimmed before the test
        applyChatFrame(t, { type: 'assistant-text', text: 'Context: 42%' })
        expect(assistantTail(t).command).toBe(true)
    })

    it('does NOT flag a turn answering ordinary prose that merely mentions a slash', () => {
        const t: TurnItem[] = []
        applyChatFrame(t, {
            type: 'user-message',
            text: 'what does /context do?',
        })
        applyChatFrame(t, { type: 'assistant-text', text: 'It shows usage.' })
        expect(assistantTail(t).command).toBe(false)
    })

    it('does NOT flag a turn that opens the transcript (no preceding user item)', () => {
        const t: TurnItem[] = []
        applyChatFrame(t, { type: 'assistant-text', text: 'hi' })
        expect(assistantTail(t).command).toBe(false)
    })

    it('does NOT flag a turn following a system notice', () => {
        const t: TurnItem[] = [{ role: 'system', text: '/chrome enabled' }]
        applyChatFrame(t, { type: 'assistant-text', text: 'ok' })
        expect(assistantTail(t).command).toBe(false)
        expect(t.map(i => i.role)).toEqual(['system', 'assistant'])
    })
})

describe('applyChatFrame — tool calls', () => {
    it("pushes a pending chip carrying the frame's name, input, and machine kind", () => {
        const t: TurnItem[] = []
        expect(
            applyChatFrame(t, {
                type: 'tool-use',
                id: 't1',
                name: 'Read',
                kind: 'read',
                input: { file_path: 'notes/a.md' },
            }),
        ).toBe(true)
        expect(assistantTail(t).parts).toEqual([
            {
                kind: 'tool',
                id: 't1',
                name: 'Read',
                toolKind: 'read',
                input: { file_path: 'notes/a.md' },
                result: null,
                isError: false,
                pending: true,
            },
        ])
    })

    it('leaves toolKind undefined for a backend that carries no machine token', () => {
        const t: TurnItem[] = []
        applyChatFrame(t, {
            type: 'tool-use',
            id: 't1',
            name: 'Read',
            input: {},
        })
        expect(
            (assistantTail(t).parts[0] as { toolKind?: string }).toolKind,
        ).toBeUndefined()
    })

    it('resolves the matching chip when its result lands', () => {
        const t: TurnItem[] = []
        applyChatFrame(t, {
            type: 'tool-use',
            id: 't1',
            name: 'Read',
            input: {},
        })
        expect(
            applyChatFrame(t, {
                type: 'tool-result',
                id: 't1',
                content: 'file body',
                isError: false,
            }),
        ).toBe(true)
        expect(assistantTail(t).parts[0]).toEqual({
            kind: 'tool',
            id: 't1',
            name: 'Read',
            toolKind: undefined,
            input: {},
            result: 'file body',
            isError: false,
            pending: false, // the chip is no longer in flight
        })
    })

    it('records a FAILED tool result on the chip', () => {
        const t: TurnItem[] = []
        applyChatFrame(t, {
            type: 'tool-use',
            id: 't1',
            name: 'Bash',
            input: { command: 'false' },
        })
        applyChatFrame(t, {
            type: 'tool-result',
            id: 't1',
            content: 'exit 1',
            isError: true,
        })
        const part = assistantTail(t).parts[0] as {
            result: string | null
            isError: boolean
            pending: boolean
        }
        expect(part.result).toBe('exit 1')
        expect(part.isError).toBe(true)
        expect(part.pending).toBe(false)
    })

    it('matches a chip in an EARLIER turn — results can arrive out of band', () => {
        const t: TurnItem[] = []
        applyChatFrame(t, {
            type: 'tool-use',
            id: 'slow',
            name: 'Task',
            input: {},
        })
        applyChatFrame(t, { type: 'user-message', text: 'meanwhile…' })
        applyChatFrame(t, { type: 'assistant-text', text: 'still working' })
        applyChatFrame(t, {
            type: 'tool-result',
            id: 'slow',
            content: 'done at last',
            isError: false,
        })
        const firstTurn = t[0] as AssistantItem
        expect(
            (firstTurn.parts[0] as { result: string | null; pending: boolean })
                .result,
        ).toBe('done at last')
        expect((firstTurn.parts[0] as { pending: boolean }).pending).toBe(false)
    })

    it('resolves only the chip with the MATCHING id, leaving its siblings pending', () => {
        const t: TurnItem[] = []
        applyChatFrame(t, {
            type: 'tool-use',
            id: 'a',
            name: 'Read',
            input: {},
        })
        applyChatFrame(t, {
            type: 'tool-use',
            id: 'b',
            name: 'Grep',
            input: {},
        })
        applyChatFrame(t, {
            type: 'tool-result',
            id: 'b',
            content: '2 matches',
            isError: false,
        })
        const parts = assistantTail(t).parts as {
            id: string
            result: string | null
            pending: boolean
        }[]
        expect(parts[0]).toMatchObject({ id: 'a', result: null, pending: true })
        expect(parts[1]).toMatchObject({
            id: 'b',
            result: '2 matches',
            pending: false,
        })
    })

    it('drops a result for an unknown id WITHOUT creating a turn or throwing', () => {
        const t: TurnItem[] = []
        // Still reported as a transcript frame (the caller scrolls either way) — but nothing is added.
        expect(
            applyChatFrame(t, {
                type: 'tool-result',
                id: 'ghost',
                content: 'x',
                isError: false,
            }),
        ).toBe(true)
        expect(t).toEqual([])
    })
})

describe('applyChatFrame — inline prompts', () => {
    it('pushes an unanswered permission card', () => {
        const t: TurnItem[] = []
        expect(
            applyChatFrame(t, {
                type: 'permission',
                id: 'p1',
                toolName: 'Bash',
                input: { command: 'rm -rf build' },
            }),
        ).toBe(true)
        expect(assistantTail(t).parts).toEqual([
            {
                kind: 'permission',
                id: 'p1',
                toolName: 'Bash',
                input: { command: 'rm -rf build' },
                answered: null,
            },
        ])
    })

    it('pushes an unanswered AskUserQuestion card carrying every option', () => {
        const questions = [
            {
                question: 'Which theme should the export use?',
                header: 'Theme',
                multiSelect: false,
                options: [
                    { label: 'ink', description: 'The dark default' },
                    { label: 'paper', description: 'Light' },
                ],
            },
        ]
        const t: TurnItem[] = []
        expect(
            applyChatFrame(t, { type: 'question', id: 'q1', questions }),
        ).toBe(true)
        expect(assistantTail(t).parts).toEqual([
            { kind: 'question', id: 'q1', questions, answered: null },
        ])
    })
})

describe('applyChatFrame — the result footer', () => {
    it('stamps turns + cost onto the turn it ends', () => {
        const t: TurnItem[] = []
        applyChatFrame(t, { type: 'assistant-text', text: 'done' })
        expect(
            applyChatFrame(t, {
                type: 'result',
                isError: false,
                numTurns: 3,
                costUsd: 0.0142,
            }),
        ).toBe(true)
        expect(assistantTail(t).footer).toEqual({
            numTurns: 3,
            costUsd: 0.0142,
        })
    })

    it('keeps a null cost (a backend that reports no price) as null, not 0', () => {
        const t: TurnItem[] = []
        applyChatFrame(t, { type: 'assistant-text', text: 'done' })
        applyChatFrame(t, {
            type: 'result',
            isError: false,
            numTurns: 1,
            costUsd: null,
        })
        expect(assistantTail(t).footer).toEqual({ numTurns: 1, costUsd: null })
    })

    it('opens an assistant turn for a result that arrives with no prose before it', () => {
        const t: TurnItem[] = []
        applyChatFrame(t, { type: 'user-message', text: 'hi' })
        applyChatFrame(t, {
            type: 'result',
            isError: true,
            numTurns: 1,
            costUsd: null,
        })
        expect(t.map(i => i.role)).toEqual(['user', 'assistant'])
        expect(assistantTail(t)).toEqual({
            role: 'assistant',
            parts: [],
            footer: { numTurns: 1, costUsd: null },
            command: false,
        })
    })
})

describe('applyChatFrame — the transcript-NEUTRAL frames', () => {
    // These eight drive session/header state ChatView owns (see chatTranscript.ts's SCOPE note). The
    // contract is that they report false AND leave the transcript byte-identical — a regression that
    // made any of them push an item would show up as stray chrome in the conversation.
    const neutral: ChatFrame[] = [
        {
            type: 'manifest',
            manifest: {
                model: 'opus',
                permissionMode: 'default',
                slashCommands: [],
                tools: [],
                mcpServers: [],
            },
        },
        { type: 'done' },
        {
            type: 'models',
            models: [
                {
                    value: 'opus',
                    label: 'Opus',
                    description: '',
                    effortLevels: [],
                },
            ],
        },
        { type: 'auth', providers: [{ name: 'anthropic', kind: 'oauth' }] },
        { type: 'title', title: 'Refactoring the chat view' },
        { type: 'session', sessionId: 'sess-1', origin: 'user' },
        {
            type: 'context',
            percentage: 12,
            totalTokens: 24000,
            maxTokens: 200000,
        },
        { type: 'error', code: 'error', message: 'the turn failed' },
    ]

    for (const frame of neutral) {
        it(`reports \`${frame.type}\` as non-transcript and leaves the transcript untouched`, () => {
            const t: TurnItem[] = [{ role: 'user', text: 'hi' }]
            const before = structuredClone(t)
            expect(applyChatFrame(t, frame)).toBe(false)
            expect(t).toEqual(before)
        })
    }

    it('covers every error CODE without ever touching the transcript', () => {
        const codes = [
            'no-claude',
            'no-opencode',
            'no-binary',
            'visibility-refused',
            'spawn',
            'exit',
            'error',
        ] as const
        for (const code of codes) {
            const t: TurnItem[] = []
            expect(
                applyChatFrame(t, {
                    type: 'error',
                    code,
                    message: `failed: ${code}`,
                }),
            ).toBe(false)
            expect(t).toEqual([])
        }
    })
})

describe('buildTranscript', () => {
    it('returns an empty transcript for no frames', () => {
        expect(buildTranscript([])).toEqual([])
    })

    it('folds a whole replayed conversation — prose, thinking, a resolved tool call, and a footer', () => {
        const frames: ChatFrame[] = [
            {
                type: 'manifest',
                manifest: {
                    model: 'opus',
                    permissionMode: 'default',
                    slashCommands: [],
                    tools: [],
                    mcpServers: [],
                },
            },
            { type: 'session', sessionId: 'sess-1', origin: 'user' },
            { type: 'user-message', text: "What's in my daily note?" },
            { type: 'thinking', text: 'The daily note lives ' },
            { type: 'thinking', text: 'under journal/.' },
            { type: 'assistant-text', text: 'Let me read it.' },
            {
                type: 'tool-use',
                id: 't1',
                name: 'Read',
                kind: 'read',
                input: { file_path: 'journal/2026-08-04.md' },
            },
            {
                type: 'tool-result',
                id: 't1',
                content: '- [ ] ship the refactor',
                isError: false,
            },
            {
                type: 'assistant-text',
                text: 'One open task: ship the refactor.',
            },
            { type: 'result', isError: false, numTurns: 2, costUsd: 0.031 },
            { type: 'done' },
        ]

        const t = buildTranscript(frames)

        expect(t.length).toBe(2)
        expect(t[0]).toEqual({
            role: 'user',
            text: "What's in my daily note?",
            images: undefined,
        })

        const turn = t[1] as AssistantItem
        expect(turn.command).toBe(false)
        expect(turn.footer).toEqual({ numTurns: 2, costUsd: 0.031 })
        expect(turn.parts.map(p => p.kind)).toEqual([
            'thinking',
            'text',
            'tool',
            'text',
        ])
        expect(turn.parts[0]).toEqual({
            kind: 'thinking',
            text: 'The daily note lives under journal/.',
        })
        expect(turn.parts[1]).toEqual({ kind: 'text', text: 'Let me read it.' })
        expect(turn.parts[2]).toEqual({
            kind: 'tool',
            id: 't1',
            name: 'Read',
            toolKind: 'read',
            input: { file_path: 'journal/2026-08-04.md' },
            result: '- [ ] ship the refactor',
            isError: false,
            pending: false,
        })
        expect(turn.parts[3]).toEqual({
            kind: 'text',
            text: 'One open task: ship the refactor.',
        })
    })

    it('is equivalent to applying the same frames one at a time', () => {
        const frames: ChatFrame[] = [
            { type: 'user-message', text: '/context' },
            { type: 'assistant-text', text: '12% used' },
            { type: 'result', isError: false, numTurns: 1, costUsd: null },
        ]
        const stepwise: TurnItem[] = []
        for (const f of frames) applyChatFrame(stepwise, f)
        expect(buildTranscript(frames)).toEqual(stepwise)
        // …and the slash-command flag really did survive the fold.
        expect((buildTranscript(frames)[1] as AssistantItem).command).toBe(true)
    })
})
