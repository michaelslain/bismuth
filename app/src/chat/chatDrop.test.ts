import { describe, expect, test } from 'bun:test'
import { applyChatDrop, chatActionsFromPlan, type ChatDropSink } from './chatDrop'

describe('chatActionsFromPlan', () => {
    test('paths stay paths', () => {
        expect(chatActionsFromPlan([{ kind: 'paths', paths: ['/a.pdf'] }])).toEqual([
            { kind: 'paths', paths: ['/a.pdf'] },
        ])
    })
    test('pasteboard bytes become a named File', () => {
        const [a] = chatActionsFromPlan([{ kind: 'bytes', name: 'x.png', base64: btoa('hi') }])
        expect(a.kind).toBe('files')
        if (a.kind !== 'files') return
        expect(a.files[0].name).toBe('x.png')
        expect(a.files[0].size).toBe(2)
    })
    test('a remote image and a link hand over their URL as text', () => {
        expect(
            chatActionsFromPlan([
                { kind: 'url-image', url: 'https://e.x/a.png', name: 'a.png' },
                { kind: 'link', url: 'https://e.x' },
            ]),
        ).toEqual([
            { kind: 'text', text: 'https://e.x/a.png' },
            { kind: 'text', text: 'https://e.x' },
        ])
    })
    test('text stays text; an empty plan stays empty', () => {
        expect(chatActionsFromPlan([{ kind: 'text', text: 'hi' }])).toEqual([
            { kind: 'text', text: 'hi' },
        ])
        expect(chatActionsFromPlan([])).toEqual([])
    })
})

describe('applyChatDrop', () => {
    test('routes each kind to its sink method', async () => {
        const calls: string[] = []
        const sink: ChatDropSink = {
            addDroppedPaths: async p => void calls.push(`paths:${p}`),
            addDroppedFiles: async f => void calls.push(`files:${f.length}`),
            addDroppedText: t => void calls.push(`text:${t}`),
            addMention: p => void calls.push(`mention:${p}`),
        }
        await applyChatDrop(sink, { kind: 'paths', paths: ['/a'] })
        await applyChatDrop(sink, { kind: 'files', files: [new File([], 'f')] })
        await applyChatDrop(sink, { kind: 'text', text: 't' })
        await applyChatDrop(sink, { kind: 'mention', path: 'n.md', noteIds: [] })
        expect(calls).toEqual(['paths:/a', 'files:1', 'text:t', 'mention:n.md'])
    })
})
