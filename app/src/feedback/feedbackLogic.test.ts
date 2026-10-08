import { test, expect } from 'bun:test'
import { draftProblem, extractDraft, latestDraftIn, EMPTY_DRAFT } from './feedbackLogic'

test('no fence, no draft', () => {
    expect(extractDraft('what do you use bismuth for?')).toBeNull()
    expect(extractDraft('```ts\nconst x = 1\n```')).toBeNull()
})

test('title line becomes the title', () => {
    const text = 'here it is:\n\n```feedback\ntitle: Graph pans slowly\n\nPanning stutters.\nZoom is fine.\n```\nedit away'
    expect(extractDraft(text)).toEqual({
        title: 'Graph pans slowly',
        body: 'Panning stutters.\nZoom is fine.',
    })
})

test('the last fence wins', () => {
    const text = '```feedback\ntitle: one\n\nfirst\n```\nrevised:\n```feedback\ntitle: two\n\nsecond\n```'
    expect(extractDraft(text)?.title).toBe('two')
})

test('no title line falls back to the first body line', () => {
    expect(extractDraft('```feedback\nSync is great\nmore\n```')).toEqual({
        title: 'Sync is great',
        body: 'Sync is great\nmore',
    })
})

test('draftProblem gates sending', () => {
    expect(draftProblem(EMPTY_DRAFT)).toBe('add a title')
    expect(draftProblem({ ...EMPTY_DRAFT, title: 't' })).toBe('add some feedback')
    expect(draftProblem({ title: 't', body: 'b', contact: '' })).toBeNull()
    expect(draftProblem({ title: 'x'.repeat(201), body: 'b', contact: '' })).toContain('title')
})

test('latestDraftIn reads the newest complete fence from assistant turns', () => {
    const t = [
        { role: 'user', text: 'hi' },
        { role: 'assistant', parts: [{ kind: 'text', text: '```feedback\ntitle: old\n\nx\n```' }] },
        { role: 'user', text: 'change it' },
        { role: 'assistant', parts: [{ kind: 'text', text: '```feedback\ntitle: new\n\ny' }] },
    ]
    expect(latestDraftIn(t)?.title).toBe('old')
    t[3].parts![0].text += '\n```'
    expect(latestDraftIn(t)?.title).toBe('new')
    expect(latestDraftIn([])).toBeNull()
})
