import { describe, test, expect } from 'bun:test'
import type { MemoryNote } from '../src/graph.ts'
import { buildRecallIndex, rankNotes, tokenize } from '../src/rank.ts'
import { PACK_LIMITS } from '../src/pack.ts'

const note = (
    name: string,
    content: string,
    type: MemoryNote['frontmatter']['type'] = 'fact',
    tags: string[] = [],
): MemoryNote => ({
    name,
    frontmatter: { type, tags, created: '2026-01-01', updated: '2026-01-01' },
    content,
    backlinks: [],
})

describe('tokenize', () => {
    test('splits hyphenated names and keeps digit-bearing tokens', () => {
        const t = tokenize('astro-207b-class-policy')
        for (const w of ['astro', '207b', 'class', 'policy']) expect(t).toContain(w)
    })
    test('splits camelCase and drops stopwords and 1-char tokens', () => {
        expect(tokenize('ProjectAuth the x')).toEqual(['project', 'auth'])
    })
})

describe('rankNotes', () => {
    test('a rare term outranks a common one (IDF)', () => {
        const notes = [
            note('astro-207b-class-policy', 'observing log policy for 207b'),
            ...Array.from({ length: 20 }, (_, i) => note(`n${i}`, `please fix thing ${i}`)),
        ]
        const ranked = rankNotes(buildRecallIndex(notes), { primary: 'fix 207b' })
        expect(ranked[0]!.note.name).toBe('astro-207b-class-policy')
    })

    test('a semantic map lifts a note with zero lexical overlap; without it the note is absent', () => {
        const notes = [
            note('dinner-ideas', 'pasta and curry recipes'),
            note('calendar-view', 'the calendar view renders events'),
        ]
        const idx = buildRecallIndex(notes)
        const q = { primary: 'what should i cook tonight' }
        expect(rankNotes(idx, q).map(r => r.note.name)).not.toContain('dinner-ideas')
        const withSem = rankNotes(idx, q, { semantic: new Map([['dinner-ideas', 0.8]]) })
        expect(withSem.map(r => r.note.name)).toContain('dinner-ideas')
        expect(withSem[0]!.semantic).toBe(0.8)
        expect(withSem[0]!.lexical).toBe(0)
    })

    test('context terms count for less than primary terms', () => {
        const notes = [note('a', 'zebra'), note('b', 'giraffe')]
        const ranked = rankNotes(buildRecallIndex(notes), { primary: 'zebra', context: 'giraffe' })
        expect(ranked.map(r => r.note.name)).toEqual(['a', 'b'])
        expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score)
    })

    test('an 80KB note does not beat a short exact match on a shared term', () => {
        const big = note('big', `${'filler words here '.repeat(4500)} calendar`)
        const small = note('small', 'calendar notes', 'fact', ['calendar'])
        const ranked = rankNotes(buildRecallIndex([big, small]), { primary: 'calendar' })
        expect(ranked[0]!.note.name).toBe('small')
    })
})

describe('semantic cosine floor', () => {
    const notes = [
        note('dinner-ideas', 'pasta and curry recipes'),
        note('calendar-view', 'the calendar view renders events'),
    ]
    const idx = buildRecallIndex(notes)
    const q = { primary: 'what should i cook tonight' }

    test('a low-cosine note with no lexical overlap gets no lift and misses minScore', () => {
        const low = rankNotes(idx, q, { semantic: new Map([['dinner-ideas', 0.3]]) })
        expect(low.map(r => r.note.name)).not.toContain('dinner-ideas')
        expect(low.every(r => r.score < PACK_LIMITS.prompt.minScore)).toBe(true)
    })

    test('a high-cosine note is lifted past minScore', () => {
        const high = rankNotes(idx, q, { semantic: new Map([['dinner-ideas', 0.9]]) })
        expect(high[0]!.note.name).toBe('dinner-ideas')
        expect(high[0]!.score).toBeGreaterThanOrEqual(PACK_LIMITS.prompt.minScore)
    })

    test('the floor is per call: cosine 0.65 is lifted with 0.55, not with 0.75', () => {
        const sem = { semantic: new Map([['dinner-ideas', 0.65]]) }
        const loose = rankNotes(idx, q, { ...sem, semanticMinCosine: 0.55 })
        expect(loose[0]!.note.name).toBe('dinner-ideas')
        expect(loose[0]!.semantic).toBe(0.65)
        const strict = rankNotes(idx, q, { ...sem, semanticMinCosine: 0.75 })
        expect(strict.map(r => r.note.name)).not.toContain('dinner-ideas')
    })
})

describe('rankNotes, tool-payload options', () => {
    const filler = Array.from({ length: 14 }, (_, i) => note(`filler-${i}`, `unrelated words number ${i}`))
    test('maxQueryWeight keeps a long payload from diluting a strong match', () => {
        const notes = [note('tidepool-survey', 'tide pool survey on thursdays', 'fact', ['tidepool-survey']), ...filler]
        const index = buildRecallIndex(notes)
        const q = { primary: 'weekend', context: 'weekend plan saturday morning stop tide pool survey volunteers pick clipboards week' }
        const plain = rankNotes(index, q, { contextWeight: 0.5 })[0]!
        const capped = rankNotes(index, q, { contextWeight: 0.5, maxQueryWeight: 3 })[0]!
        expect(capped.note.name).toBe('tidepool-survey')
        expect(capped.score).toBeGreaterThan(plain.score * 1.5)
        expect(capped.score).toBeGreaterThanOrEqual(PACK_LIMITS.tool.minScore)
    })
    test('strictEvidence: location alone, a lone body hit, or two stray context terms never qualify', () => {
        const notes = [
            note('bismuth-setup', 'the app ships as a package', 'project', ['bismuth']),
            note('seminar', 'one page per class with the figure number'),
            note('torque', 'always state the bolt value'),
            ...filler,
        ]
        const index = buildRecallIndex(notes)
        const strict = { strictEvidence: true, contextWeight: 0.5, locationWeight: 0.3, maxQueryWeight: 3 }
        const names = (q: { primary: string; context?: string; location?: string }, o = strict) =>
            rankNotes(index, q, o).map(r => r.note.name)
        expect(names({ primary: '', location: 'bismuth app' })).not.toContain('bismuth-setup')
        expect(names({ primary: 'state' })).not.toContain('torque')
        expect(names({ primary: 'product card', context: 'class number' })).not.toContain('seminar')
        // the same queries without the rule do surface them
        expect(names({ primary: '', location: 'bismuth app' }, {} as typeof strict)).toContain('bismuth-setup')
        expect(names({ primary: 'product card', context: 'class number' }, {} as typeof strict)).toContain('seminar')
        // and a primary term, or a hit on the note's own subject, still qualifies
        expect(names({ primary: 'torque bolt' })).toContain('torque')
        expect(names({ primary: '', context: 'bismuth release', location: 'app' })).toContain('bismuth-setup')
    })
})
