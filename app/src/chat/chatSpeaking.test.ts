import { test, expect } from 'bun:test'
import { isSpeaking } from './chatSpeaking'
import type { TurnItem, UserItem, AssistantItem } from '../chatTranscript'

const user = (over: Partial<UserItem> = {}): UserItem => ({
    role: 'user',
    text: 'hi',
    ...over,
})
const assistant = (over: Partial<AssistantItem> = {}): AssistantItem => ({
    role: 'assistant',
    parts: [{ kind: 'text', text: 'hello' }],
    footer: null,
    ...over,
})

test('not streaming is never speaking, whatever the transcript holds', () => {
    expect(isSpeaking([assistant()], false)).toBe(false)
    expect(isSpeaking([], false)).toBe(false)
})

test('empty transcript while streaming is not speaking', () => {
    expect(isSpeaking([], true)).toBe(false)
})

test('streaming assistant text is speaking', () => {
    const transcript: TurnItem[] = [user(), assistant()]
    expect(isSpeaking(transcript, true)).toBe(true)
})

test('a thinking-only trailing part is not speaking (nothing written yet)', () => {
    const transcript: TurnItem[] = [
        user(),
        assistant({ parts: [{ kind: 'thinking', text: 'hmm' }] }),
    ]
    expect(isSpeaking(transcript, true)).toBe(false)
})

test('a trailing tool part is not speaking', () => {
    const transcript: TurnItem[] = [
        user(),
        assistant({
            parts: [
                { kind: 'text', text: 'ok' },
                {
                    kind: 'tool',
                    id: '1',
                    name: 'Read',
                    input: {},
                    result: null,
                    isError: false,
                    pending: true,
                },
            ],
        }),
    ]
    expect(isSpeaking(transcript, true)).toBe(false)
})

test('a queued user bubble staged after streaming text keeps isSpeaking true', () => {
    const transcript: TurnItem[] = [
        user(),
        assistant(),
        user({ text: 'next question', queued: true }),
    ]
    expect(isSpeaking(transcript, true)).toBe(true)
})

test('multiple queued user bubbles in a row are all walked past', () => {
    const transcript: TurnItem[] = [
        user(),
        assistant(),
        user({ text: 'a', queued: true }),
        user({ text: 'b', queued: true }),
    ]
    expect(isSpeaking(transcript, true)).toBe(true)
})

test('a non-queued user bubble as the last item is not speaking', () => {
    const transcript: TurnItem[] = [assistant(), user({ text: 'sent already' })]
    expect(isSpeaking(transcript, true)).toBe(false)
})

test('a queued user bubble with nothing but earlier user turns underneath is not speaking', () => {
    const transcript: TurnItem[] = [
        user({ text: 'first' }),
        user({ text: 'second', queued: true }),
    ]
    expect(isSpeaking(transcript, true)).toBe(false)
})
