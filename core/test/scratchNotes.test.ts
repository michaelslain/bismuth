// core/test/scratchNotes.test.ts
import { describe, expect, test } from 'bun:test'
import {
    newScratchId,
    parseScratch,
    serializeScratch,
} from '../src/scratchNotes'
import { extractWikilinks } from '../src/wikilinks'
import type { ScratchBlock } from '../src/scratchTypes'

const block = (over: Partial<ScratchBlock> = {}): ScratchBlock => ({
    id: 'aaaa',
    page: 0,
    x: 700,
    y: 100,
    w: 300,
    text: 'hello',
    ...over,
})

describe('parseScratch — no regions', () => {
    test('plain hand-written text round-trips verbatim with no blocks', () => {
        const text = 'Just some notes.\nSecond line.\n'
        expect(parseScratch(text)).toEqual({ rest: text, blocks: [] })
    })
    test('empty body', () => {
        expect(parseScratch('')).toEqual({ rest: '', blocks: [] })
    })
})

describe('parseScratch — one region', () => {
    test('a single well-formed region is parsed into one block, rest is empty', () => {
        const text =
            '<!-- scratch id=k3f9 p=1 x=842 y=412 w=300 -->\n**why?**\n<!-- /scratch -->\n'
        expect(parseScratch(text)).toEqual({
            rest: '',
            blocks: [
                {
                    id: 'k3f9',
                    page: 0,
                    x: 842,
                    y: 412,
                    w: 300,
                    text: '**why?**',
                },
            ],
        })
    })
    test('p is 1-based on disk, 0-based in memory', () => {
        const text =
            '<!-- scratch id=aaaa p=300 x=0 y=0 w=100 -->\ntext\n<!-- /scratch -->\n'
        expect(parseScratch(text).blocks[0].page).toBe(299)
    })
    test('x/y accept negative values', () => {
        const text =
            '<!-- scratch id=aaaa p=1 x=-10 y=-5 w=100 -->\ntext\n<!-- /scratch -->\n'
        const [b] = parseScratch(text).blocks
        expect(b.x).toBe(-10)
        expect(b.y).toBe(-5)
    })
})

describe('parseScratch — hand text around regions', () => {
    test('hand text before a region is kept as rest', () => {
        const text =
            'Before text.\n\n<!-- scratch id=aaaa p=1 x=1 y=1 w=100 -->\nblock text\n<!-- /scratch -->\n'
        const { rest, blocks } = parseScratch(text)
        expect(rest).toBe('Before text.')
        expect(blocks).toHaveLength(1)
    })
    test('hand text between two regions is kept, order preserved', () => {
        const text =
            '<!-- scratch id=aaaa p=1 x=1 y=1 w=100 -->\ntext1\n<!-- /scratch -->\n' +
            '\nmiddle text\n\n' +
            '<!-- scratch id=bbbb p=1 x=1 y=1 w=100 -->\ntext2\n<!-- /scratch -->\n'
        const { rest, blocks } = parseScratch(text)
        expect(rest).toBe('middle text')
        expect(blocks.map(b => b.id)).toEqual(['aaaa', 'bbbb'])
    })
    test('hand text before, between and after regions all round trip in order', () => {
        const text =
            'before\n\n' +
            '<!-- scratch id=aaaa p=1 x=1 y=1 w=100 -->\ntext1\n<!-- /scratch -->\n' +
            '\nmiddle\n\n' +
            '<!-- scratch id=bbbb p=1 x=1 y=1 w=100 -->\ntext2\n<!-- /scratch -->\n' +
            '\nafter\n'
        const { rest, blocks } = parseScratch(text)
        expect(rest).toBe('before\n\nmiddle\n\nafter\n')
        expect(blocks.map(b => b.id)).toEqual(['aaaa', 'bbbb'])
    })
})

describe('parseScratch — a start marker with no matching end is not a block', () => {
    test('unterminated marker stays in the hand-written text verbatim', () => {
        const text =
            'notes\n\n<!-- scratch id=aaaa p=1 x=1 y=1 w=100 -->\nnever closed\n'
        expect(parseScratch(text)).toEqual({ rest: text, blocks: [] })
    })
})

describe('parseScratch — a start marker with unparseable attributes is not a block', () => {
    test('non-numeric p is left as text', () => {
        const text =
            '<!-- scratch id=aaaa p=x x=1 y=1 w=100 -->\ntext\n<!-- /scratch -->\n'
        expect(parseScratch(text)).toEqual({ rest: text, blocks: [] })
    })
    test('uppercase id is left as text', () => {
        const text =
            '<!-- scratch id=ABCD p=1 x=1 y=1 w=100 -->\ntext\n<!-- /scratch -->\n'
        expect(parseScratch(text)).toEqual({ rest: text, blocks: [] })
    })
    test('a missing attribute is left as text', () => {
        const text =
            '<!-- scratch id=aaaa p=1 x=1 w=100 -->\ntext\n<!-- /scratch -->\n'
        expect(parseScratch(text)).toEqual({ rest: text, blocks: [] })
    })
})

describe('escaping a literal end-marker line inside block text', () => {
    test('serializeScratch escapes it, parseScratch unescapes it back — round trip', () => {
        const withMarkerLine = block({
            text: 'before\n<!-- /scratch -->\nafter',
        })
        const serialized = serializeScratch('', [withMarkerLine])
        expect(serialized).toContain('<!-- /scratch -- >')
        // The region still closes at the REAL end marker, not the escaped line.
        const { rest, blocks } = parseScratch(serialized)
        expect(rest).toBe('')
        expect(blocks).toHaveLength(1)
        expect(blocks[0].text).toBe('before\n<!-- /scratch -->\nafter')
    })
})

describe('serializeScratch — blank blocks are dropped', () => {
    test('a block whose text is only whitespace is never written', () => {
        expect(
            serializeScratch('', [
                block({ text: '' }),
                block({ id: 'bbbb', text: '   \n  ' }),
            ]),
        ).toBe('')
    })
    test('rest survives even when every block is blank', () => {
        expect(serializeScratch('hand text\n', [block({ text: '' })])).toBe(
            'hand text\n',
        )
    })
})

describe('serializeScratch — sort order', () => {
    test('blocks are written sorted by page, then y, then x', () => {
        const blocks = [
            block({ id: 'dddd', page: 1, y: 0, x: 0 }),
            block({ id: 'aaaa', page: 0, y: 10, x: 5 }),
            block({ id: 'bbbb', page: 0, y: 10, x: 0 }),
            block({ id: 'cccc', page: 0, y: 0, x: 0 }),
        ]
        const { blocks: parsed } = parseScratch(serializeScratch('', blocks))
        expect(parsed.map(b => b.id)).toEqual(['cccc', 'bbbb', 'aaaa', 'dddd'])
    })
})

describe('parseScratch(serializeScratch(r, bs)) returns the non-blank bs sorted', () => {
    test('blank blocks are absent, the rest carry over unchanged', () => {
        const blocks = [
            block({ id: 'bbbb', page: 0, y: 5, x: 0, text: 'second' }),
            block({ id: 'aaaa', page: 0, y: 0, x: 0, text: 'first' }),
            block({ id: 'cccc', page: 0, y: 0, x: 0, text: '' }),
        ]
        const { rest, blocks: parsed } = parseScratch(
            serializeScratch('hand\n', blocks),
        )
        // The blank-line padding serializeScratch inserts before the first region is stripped
        // back out on parse (see parseScratch's header) — the trailing \n that was ONLY there as
        // separator padding does not survive, even though the hand text itself did.
        expect(rest).toBe('hand')
        expect(parsed).toEqual([
            block({ id: 'aaaa', page: 0, y: 0, x: 0, text: 'first' }),
            block({ id: 'bbbb', page: 0, y: 5, x: 0, text: 'second' }),
        ])
    })
})

describe('round trip stability', () => {
    test('serializing a second time reproduces the first serialization exactly (fixed point)', () => {
        const text =
            'Anything the user wrote by hand stays here, untouched.\n\n' +
            '<!-- scratch id=k3f9 p=300 x=842 y=412 w=300 -->\n**why?** see [[Lecture 7]]\n<!-- /scratch -->\n\n' +
            '<!-- scratch id=a01c p=300 x=836 y=900 w=280 -->\n- check eq (3)\n<!-- /scratch -->\n'
        const once = parseScratch(text)
        const u = serializeScratch(once.rest, once.blocks)
        const twice = parseScratch(u)
        const u2 = serializeScratch(twice.rest, twice.blocks)
        expect(u2).toBe(u)
    })
    test('no-region text is a fixed point immediately (empty blocks pass rest through verbatim)', () => {
        const text = 'no markers here at all\njust prose\n'
        const { rest, blocks } = parseScratch(text)
        expect(serializeScratch(rest, blocks)).toBe(text)
    })
})

describe('\\r\\n input', () => {
    test('a CRLF body parses the same as its LF equivalent', () => {
        const crlf =
            'before\r\n\r\n<!-- scratch id=aaaa p=1 x=1 y=1 w=100 -->\r\nblock text\r\n<!-- /scratch -->\r\n'
        const lf = crlf.replace(/\r\n/g, '\n')
        expect(parseScratch(crlf)).toEqual(parseScratch(lf))
    })
})

describe('newScratchId', () => {
    test('4 lowercase base36 chars', () => {
        const id = newScratchId([], () => 0.5)
        expect(id).toMatch(/^[a-z0-9]{4}$/)
    })
    test('deterministic with an injected rand', () => {
        expect(newScratchId([], () => 0)).toBe('0000')
        expect(newScratchId([], () => 0.999999)).toBe('zzzz')
    })
    test('retries until it finds an id not in `taken`', () => {
        const sequence = [0, 0, 0.5] // first two draws collide with 'taken', third succeeds
        let i = 0
        const rand = () => sequence[i++]
        const id = newScratchId(new Set(['0000']), rand)
        expect(id).not.toBe('0000')
    })
})

describe('the graph half of the storage decision', () => {
    test('extractWikilinks finds a [[link]] written inside a serialized scratch block', () => {
        const withLink = block({ text: '**why?** see [[Lecture 7]]' })
        const serialized = serializeScratch('', [withLink])
        expect(extractWikilinks(serialized)).toContain('Lecture 7')
    })
})
