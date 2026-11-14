import { describe, expect, test } from 'bun:test'
import { allocate, allowedLicense, cleanText, dedupePassages, docPassages, firstSight, passageRows, usablePassage } from './embedCorpus'

describe('allowedLicense', () => {
    test('passes CC0, public domain and CC BY of any version', () => {
        for (const l of ['CC0', 'cc0-1.0', 'cc-by-4.0', 'CC BY 3.0', 'CC BY', 'public domain', 'Public Domain', 'Creative Commons - Attribution - https://creativecommons.org/licenses/by/4.0/', 'Creative Commons Zero - Public Domain - https://creativecommons.org/publicdomain/zero/1.0/'])
            expect(allowedLicense(l), l).toBe(true)
    })
    test('refuses share-alike, non-commercial, no-derivatives, empty and unknown', () => {
        for (const l of ['cc-by-sa-4.0', 'cc-by-nc-sa', 'CC BY-ND', 'CC BY-NC 4.0', '', 'unknown', 'all rights reserved', 'Creative Commons - Attribution Share-Alike - https://creativecommons.org/licenses/by-sa/3.0/', 'Creative Commons - Attribution Non-Commercial - https://creativecommons.org/licenses/by-nc/4.0/', 'Creative Commons - Attribution No Derivatives - https://creativecommons.org/licenses/by-nd/4.0/'])
            expect(allowedLicense(l), l).toBe(false)
    })
})

describe('cleanText', () => {
    test('strips the libretexts page boilerplate in both layouts', () => {
        expect(cleanText('1: Scale Drawings Last updated Save as PDF Page ID 34976 Illustrative Mathematics')).toBe('1: Scale Drawings Illustrative Mathematics')
        expect(cleanText('7.4: Barriers\n-\n- Last updated\n- Save as PDF\nBarriers are present')).toBe('7.4: Barriers\nBarriers are present')
    })
    test('strips the oercommons sign-in chrome', () => {
        expect(cleanText('Intro Sign in to see your Hubs Sign in to see your Groups Log in Real content')).toBe('Intro Real content')
        expect(cleanText('Students log in to the portal each week')).toBe('Students log in to the portal each week')
    })
})

describe('usablePassage', () => {
    test('drops short, link-heavy and symbol-heavy passages', () => {
        expect(usablePassage('short')).toBe(false)
        expect(usablePassage('https://a.example/x https://b.example/y '.repeat(10))).toBe(false)
        expect(usablePassage('\\(+-*/=\\)'.repeat(60))).toBe(false)
        expect(usablePassage('A plain sentence about the water cycle and how rain falls. '.repeat(5))).toBe(true)
    })
    test('drops a passage that still carries the sign-in chrome', () => {
        expect(usablePassage('A plain sentence about the water cycle. Sign in to see your Hubs. '.repeat(5))).toBe(false)
    })
})

const prose = (n: number) => Array.from({ length: n }, (_, i) => `Sentence number ${i} explains one idea about plants and soil in plain words.`).join(' ')

describe('docPassages', () => {
    test('caps at 3 per document, each at least 200 chars, and is deterministic', () => {
        const doc = { source: 's', id: '1', license: 'CC0', title: 'Plants', text: prose(120) }
        const a = docPassages(doc, 7)
        expect(a.length).toBe(3)
        for (const p of a) expect(p.length).toBeGreaterThanOrEqual(200)
        expect(docPassages(doc, 7)).toEqual(a)
        expect(docPassages(doc, 8)).not.toEqual(a)
    })
    test('a document with only a short text gives none', () => {
        expect(docPassages({ source: 's', id: '1', license: 'CC0', title: 't', text: 'tiny' }, 7)).toEqual([])
    })
})

describe('allocate', () => {
    test('splits the target equally', () => {
        expect(allocate({ a: 100, b: 100, c: 100 }, 90)).toEqual({ a: 30, b: 30, c: 30 })
    })
    test('a short source gives its shortfall to the others', () => {
        expect(allocate({ a: 10, b: 100, c: 100 }, 90)).toEqual({ a: 10, b: 40, c: 40 })
    })
    test('an uneven target spends every passage and never exceeds availability', () => {
        const q = allocate({ a: 100, b: 100, c: 100 }, 100)
        expect(q.a + q.b + q.c).toBe(100)
        expect(Math.max(q.a, q.b, q.c) - Math.min(q.a, q.b, q.c)).toBeLessThanOrEqual(1)
        expect(allocate({ a: 5, b: 5 }, 100)).toEqual({ a: 5, b: 5 })
        expect(allocate({}, 10)).toEqual({})
    })
})

describe('passageRows', () => {
    test('builds ChunkRows keyed pub:<source>/<id> with a fold, source and license', () => {
        const rows = passageRows([{ doc: { source: 'arxiv_abstracts', id: 'x1', license: 'CC0', title: 'T' }, texts: ['p1', 'p2'] }])
        expect(rows.map(r => r.id)).toEqual([0, 1])
        expect(rows[0]).toMatchObject({ file: 'arxiv_abstracts/x1', key: 'pub:arxiv_abstracts/x1', source: 'arxiv_abstracts', license: 'CC0', text: 'p1' })
        expect(['a', 'b']).toContain(rows[0]!.fold)
    })
})

describe('dedupe', () => {
    test('a repeated {source,id} is taken once, so a key never exceeds 3 passages', () => {
        const ids = new Set<string>()
        expect(firstSight({ source: 's', id: '1' }, ids)).toBe(true)
        expect(firstSight({ source: 's', id: '1' }, ids)).toBe(false)
        expect(firstSight({ source: 's', id: '2' }, ids)).toBe(true)
        expect(firstSight({ source: 't', id: '1' }, ids)).toBe(true)
    })
    test('identical text in two documents is kept once', () => {
        const seen = new Set<string>()
        expect(dedupePassages(['a', 'b', 'a'], seen)).toEqual(['a', 'b'])
        expect(dedupePassages(['b', 'c'], seen)).toEqual(['c'])
    })
})
