import { describe, test, expect } from 'bun:test'
import type { MemoryNote } from '../src/graph.ts'
import { buildRecallIndex, rankNotes, stem, tokenize } from '../src/rank.ts'
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
    test('question filler is a stopword: "which" and "off" match nothing', () => {
        expect(tokenize('which notes are marked off limits')).toEqual(['notes', 'marked', 'limits'])
    })
})

describe('stem', () => {
    test('a word and its inflections share one stem, -e words included', () => {
        for (const group of [
            ['update', 'updates', 'updated', 'updating'],
            ['change', 'changes', 'changed'],
            ['image', 'images'],
            ['message', 'messages'],
            ['database', 'databases'],
            ['recommend', 'recommendations'],
        ])
            expect(new Set(group.map(stem)).size).toBe(1)
    })
    test('digit tokens and short words stay whole', () => {
        expect(stem('207b')).toBe('207b')
        expect(stem('case')).toBe('case')
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

describe('semantic background (a full top-ten map)', () => {
    // 14 notes, so the vault is past the small-vault size where term statistics are switched off.
    const filler = Array.from({ length: 12 }, (_, i) => note(`filler-${i}`, `unrelated words number ${i}`))
    const notes = [
        note('course-log', 'lecture notes marked done for the course'),
        note('tide-tables', 'tide tables for the harbour', 'fact', ['tides']),
        ...filler,
    ]
    const idx = buildRecallIndex(notes)
    // Ten cosines in a flat band, the way bge-small scores a query the vault knows nothing about.
    const flat = new Map(notes.slice(0, 10).map((n, i) => [n.name, 0.63 - i * 0.004]))

    test('a flat band of cosines lifts nothing: the floor rises to the tenth cosine plus the margin', () => {
        const ranked = rankNotes(idx, { primary: 'harbour schedule' }, { semantic: flat })
        expect(ranked.every(r => r.semantic === undefined)).toBe(true)
    })

    test('a cosine standing clear of the band is still lifted', () => {
        const sem = new Map(flat).set('tide-tables', 0.8)
        const ranked = rankNotes(idx, { primary: 'when is high water' }, { semantic: sem })
        expect(ranked[0]!.note.name).toBe('tide-tables')
        expect(ranked[0]!.semantic).toBe(0.8)
    })

    test('body-only word hits the embedder does not second are dropped', () => {
        const q = { primary: 'which notes are marked off limits' }
        expect(rankNotes(idx, q).map(r => r.note.name)).toContain('course-log')
        expect(rankNotes(idx, q, { semantic: flat }).map(r => r.note.name)).not.toContain('course-log')
    })

    test('a name, tag or description hit needs no semantic second', () => {
        const ranked = rankNotes(idx, { primary: 'tides this week' }, { semantic: flat })
        expect(ranked.map(r => r.note.name)).toContain('tide-tables')
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

describe('rankNotes, keyword-only evidence (no semantic scores)', () => {
    const filler = (n: number, body: (i: number) => string, prefix = 'filler') =>
        Array.from({ length: n }, (_, i) => note(`${prefix}-${i}`, body(i)))
    const names = (notes: MemoryNote[], q: Parameters<typeof rankNotes>[1], opts?: Parameters<typeof rankNotes>[2]) =>
        rankNotes(buildRecallIndex(notes), q, opts).map(r => r.note.name)
    /** a semantic map that scores nothing above the floor: the semantic path, with no lift */
    const quietSemantic = new Map([['nobody', 0.1]])

    test('a query term matches the other forms of its stem; with semantic scores it stays exact', () => {
        const notes = [
            note('anime-recommendations', 'a list of shows'),
            ...filler(20, i => `unrelated words ${i}`),
        ]
        const q = { primary: 'recommend something' }
        expect(names(notes, q)).toContain('anime-recommendations')
        expect(names(notes, q, { semantic: quietSemantic })).not.toContain('anime-recommendations')
    })

    test('a form of the stem scores below an exact match', () => {
        const notes = [
            note('exact', 'notes about the migration plan'),
            note('variant', 'notes about the migrations plan'),
            ...filler(20, i => `unrelated words ${i}`),
        ]
        const ranked = rankNotes(buildRecallIndex(notes), { primary: 'migration plan' })
        expect(ranked.map(r => r.note.name).slice(0, 2)).toEqual(['exact', 'variant'])
        expect(ranked[1]!.score).toBeLessThan(ranked[0]!.score)
    })

    test('a lone body hit on a word found in many notes names no topic', () => {
        const notes = [
            note('politics', 'the nature of capital and labour'),
            ...filler(5, i => `capital city number ${i}`, 'city'),
            ...filler(20, i => `unrelated words ${i}`),
        ]
        expect(names(notes, { primary: 'capital australia' })).toEqual([])
        // the same shape on a word only one note has still qualifies
        const rare = [note('politics', 'the nature of capital and labour'), ...filler(25, i => `unrelated words ${i}`)]
        expect(names(rare, { primary: 'capital australia' })).toEqual(['politics'])
    })

    test('several body-only words qualify only when two share a paragraph', () => {
        const notes = [
            note('together', 'intro line\n\nmerges sorted data before output\n\nclosing line'),
            note('apart', 'merges data early\n\nsome other paragraph\n\nsorted output last'),
            ...filler(20, i => `unrelated words ${i}`),
        ]
        expect(names(notes, { primary: 'sorted merges' })).toEqual(['together'])
    })

    test('body-only words that are all common need the note to answer most of the prompt', () => {
        const common = (i: number) => `write a function over two lists number ${i}`
        const notes = [
            note('essay', 'write about the function of two lists'),
            ...filler(14, common, 'common'),
            ...filler(6, i => `unrelated words ${i}`),
        ]
        // 2 of 4 prompt terms, every one found in most notes: dropped
        expect(names(notes, { primary: 'write function sorted merges' })).not.toContain('essay')
        // 3 of 4: answered enough, kept
        expect(names(notes, { primary: 'write function lists merges' })).toContain('essay')
    })

    test('a prompt mostly outside the vault does not inject on one shared word', () => {
        const notes = [
            note('tomato-planting', 'rows and spacing for beds'),
            note('beds', 'raised beds hold basil and tomato plants'),
            ...filler(20, i => `unrelated words ${i}`),
        ]
        const q = { primary: 'tomato kubernetes cluster autoscaler' }
        expect(names(notes, q)).toEqual([])
        // a note whose name or tags share two of the terms is about the prompt regardless
        const two = [note('tomato-cluster', 'rows'), ...notes.slice(1)]
        expect(names(two, q)).toContain('tomato-cluster')
        // a note matched through the context is carried by it
        expect(names(notes, { ...q, context: 'basil' })).toContain('beds')
        // with semantic scores in play the gate is off: the semantic path keeps its own rules
        expect(names(notes, q, { semantic: quietSemantic })).toContain('tomato-planting')
        // short prompts are exempt: a bare "tomato kubernetes" has too little to judge
        expect(names(notes, { primary: 'tomato kubernetes' })).toContain('tomato-planting')
    })

    test('two rare co-located body words survive the unknown-prompt gate', () => {
        const notes = [
            note('release-signing', 'The tauri updater verifies the signature of each build.'),
            ...filler(20, i => `unrelated words ${i}`),
        ]
        expect(names(notes, { primary: 'fix the tauri updater retry logic in ci' })).toContain('release-signing')
        expect(names(notes, { primary: 'can you refactor the tauri updater signing step' })).toContain('release-signing')
        expect(names(notes, { primary: 'why does the tauri updater fail' })).toContain('release-signing')
    })

    test('query terms that share a stem are one matched term for the lone-hit rule', () => {
        const notes = [
            note('politics', 'the nature of capital and labour'),
            ...filler(5, i => `capital city number ${i}`, 'city'),
            ...filler(20, i => `unrelated words ${i}`),
        ]
        // "capital capitals" is ONE content term found only in the body of a word-common vault:
        // the lone-hit rule drops it, instead of two matches reading as several body hits
        expect(names(notes, { primary: 'capital capitals' })).toEqual([])
        const rare = [note('politics', 'the nature of capital and labour'), ...filler(25, i => `unrelated words ${i}`)]
        expect(names(rare, { primary: 'capital capitals' })).toEqual(['politics'])
    })

    test('several body words need a distinctive one: the same note passes with it and is dropped without it', () => {
        const essay = note('essay', 'write a function over lists and merges them')
        const prompt = { primary: 'write function lists merges sorted output' }
        const plain = (i: number) => `write function lists number ${i}`
        const withDistinct = [essay, ...filler(14, plain, 'common'), ...filler(6, i => `unrelated words ${i}`)]
        // "merges" is found in this note alone
        expect(names(withDistinct, prompt)).toContain('essay')
        const common = (i: number) => `write function lists merges number ${i}`
        const without = [essay, ...filler(14, common, 'common'), ...filler(6, i => `unrelated words ${i}`)]
        // now every word it shares with the prompt sits in most of the vault
        expect(names(without, prompt)).not.toContain('essay')
    })

    test('a lone body word counts when the note repeats it, however small a part of the prompt', () => {
        const policy = note('git-policy', 'Standing rule. Never push without asking. A push publishes. Ask before every push upstream. Push is the one step that needs consent. Push last.')
        const log = note('log', `${'misc entry '.repeat(40)} push once ${'misc entry '.repeat(40)}`)
        // the other prompt words appear in the vault, so the prompt is not a foreign one
        const known = [note('k1', 'we go home'), note('k2', 'ahead of schedule'), note('k3', 'a remote island')]
        const notes = [policy, log, ...known, ...filler(20, i => `unrelated words ${i}`)]
        // 1 of 4 content terms is far under the 0.4 lone-hit coverage, but the policy note is about it
        expect(names(notes, { primary: 'can you go ahead and push this to the remote' })).toEqual(['git-policy'])
    })

    test('two rare body words that are not a phrase of the prompt stay coincidence on an unknown prompt', () => {
        const notes = [
            note('server-chores', 'The proxy logs rotate weekly. Renew the tls certificate in march.'),
            ...filler(20, i => `unrelated words ${i}`),
        ]
        // proxy and tls each sit in this note alone, but apart: the prompt is about nginx, not this note
        expect(names(notes, { primary: 'how do i configure an nginx reverse proxy with tls' })).not.toContain('server-chores')
        // the same words as a phrase of the note are its topic
        const phrased = [note('server-chores', 'Renew the proxy tls certificate in march.'), ...notes.slice(1)]
        expect(names(phrased, { primary: 'how do i configure an nginx reverse proxy with tls' })).toContain('server-chores')
    })
})
