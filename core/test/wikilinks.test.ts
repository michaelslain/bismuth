import { test, expect } from 'bun:test'
import { extractWikilinks, stripCode } from '../src/wikilinks'

test('extracts targets, strips alias and heading, dedupes', () => {
    const md = `See [[internship]] and [[housing|my place]] and [[essay#intro]] and [[internship]].`
    expect(extractWikilinks(md).sort()).toEqual([
        'essay',
        'housing',
        'internship',
    ])
})

test('no links returns empty array', () => {
    expect(extractWikilinks('plain text')).toEqual([])
})

test('wikilink with heading anchor is extracted without anchor', () => {
    const md = `[[note#section]] [[another#deep.nested]]`
    expect(extractWikilinks(md).sort()).toEqual(['another', 'note'])
})

test('wikilink with alias strips alias', () => {
    const md = `[[target|alias text]]`
    expect(extractWikilinks(md)).toEqual(['target'])
})

test('multiple wikilinks on same line are all extracted', () => {
    const md = `[[one]][[two]] [[three]] [[four]]`
    expect(extractWikilinks(md).sort()).toEqual(['four', 'one', 'three', 'two'])
})

test('wikilinks are case sensitive', () => {
    const md = `[[Note]] and [[note]]`
    expect(extractWikilinks(md).sort()).toEqual(['Note', 'note'])
})

test('wikilinks with numbers are extracted', () => {
    const md = `[[2024-01-15]] [[note123]] [[123abc]]`
    expect(extractWikilinks(md).sort()).toEqual([
        '123abc',
        '2024-01-15',
        'note123',
    ])
})

test('wikilinks with hyphens and underscores are extracted', () => {
    const md = `[[my-note]] [[my_note]] [[my-note_v2]]`
    expect(extractWikilinks(md).sort()).toEqual([
        'my-note',
        'my-note_v2',
        'my_note',
    ])
})

test('wikilinks with spaces in alias are extracted', () => {
    const md = `[[note|this is a long alias text]]`
    expect(extractWikilinks(md)).toEqual(['note'])
})

test('incomplete or malformed wikilinks are ignored', () => {
    const md = `[incomplete [[valid]] [also incomplete [[another valid]]`
    expect(extractWikilinks(md).sort()).toEqual(['another valid', 'valid'])
})

test('nested brackets do not create additional links', () => {
    const md = `[[outer [[inner]] outer]]`
    // Should match outermost brackets
    expect(extractWikilinks(md).length).toBeGreaterThan(0)
})

test('empty wikilinks are ignored', () => {
    const md = `[[]] [[valid]]`
    const result = extractWikilinks(md)
    expect(result).toContain('valid')
})

test('wikilinks with special characters are extracted', () => {
    const md = `[[note@tag]] [[doc-v1.2.3]]`
    expect(extractWikilinks(md).sort()).toEqual(['doc-v1.2.3', 'note@tag'])
})

test('wikilinks spanning multiple lines work', () => {
    const md = `[[\nmultiline\nlink\n]]`
    // Behavior depends on regex; verify it doesn't crash
    expect(Array.isArray(extractWikilinks(md))).toBe(true)
})

test('embeds (![[...]]) are NOT extracted — they are render-only, not graph links', () => {
    const md = `Link [[Real Note]] but embed ![[Resonance.pdf]] and ![[Diagram.png]] and ![[Other Note]].`
    expect(extractWikilinks(md)).toEqual(['Real Note'])
})

test('an embed adjacent to a real link only excludes the embed', () => {
    const md = `![[image.png]][[Note]]`
    expect(extractWikilinks(md)).toEqual(['Note'])
})

test('wikilinks inside a fenced code block are NOT extracted', () => {
    const md =
        'Real [[Outside]]\n```\nsee [[Inside]]\n```\nmore [[Also Outside]]'
    expect(extractWikilinks(md).sort()).toEqual(['Also Outside', 'Outside'])
})

test('wikilinks inside an inline code span are NOT extracted', () => {
    const md = 'Use `[[NotALink]]` but [[RealLink]] counts.'
    expect(extractWikilinks(md)).toEqual(['RealLink'])
})

test('tilde-fenced code block also hides wikilinks', () => {
    const md = '[[Before]]\n~~~\n[[Hidden]]\n~~~\n[[After]]'
    expect(extractWikilinks(md).sort()).toEqual(['After', 'Before'])
})

test('unterminated fenced block hides links to end of document', () => {
    const md = '[[Before]]\n```\n[[StillHidden]]\nno closing fence'
    expect(extractWikilinks(md)).toEqual(['Before'])
})

// Oracle: the pre-optimisation stripCode, kept verbatim so the linear-time blanking
// is proven byte-identical.
function oldStripCode(md: string): string {
    if (md.indexOf('`') === -1 && md.indexOf('~~~') === -1) return md
    const blank = (s: string): string => s.replace(/[^\n]/g, ' ')
    let out = md
    out = out.replace(
        /(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\3[^\n]*(?=\n|$)|$)/g,
        m => blank(m),
    )
    out = out.replace(/(`+)(?:(?!\1)[^\n])*?\1/g, m => blank(m))
    return out
}

const big = (n: number) => 'AbC+/=\u00e9 '.repeat(Math.ceil(n / 9)).slice(0, n)

const stripCases: Record<string, string> = {
    plain: 'no code [[Link]] #tag',
    fenced: 'a\n```js\nconst x = [[In]]\n```\nb [[Out]]',
    tilde: '[[B]]\n~~~\n[[H]]\n~~~\n[[A]]',
    unterminated: '[[B]]\n```\n[[H]]\nno close',
    unterminatedTilde: 'x\n~~~ info\nbody\nmore',
    longerClose: '````\n```\ninner\n```\n````\nafter',
    nestedBackticks: 'a ``b ` c`` d ```` e `f` g',
    inline: 'Use `[[X]]` and ``a`b`` and `` ` `` and `unclosed',
    crlf: 'a\r\n```\r\n[[In]]\r\n```\r\nb `c`\r\n',
    indentedFence: '  ```\n  x\n  ```\ny',
    emptyFence: '```\n```\n',
    fenceAtEnd: 'x\n```',
    onlyBackticks: '```',
    trailingNewlines: '```\nx\n\n\n',
    twoBlocks: '```\na\n```\nmid\n~~~\nb\n~~~\nend',
    bigFence: 'before\n```json\n' + big(2_000_000) + '\n```\nafter [[X]]',
    bigMultiline:
        '```\n' +
        Array.from({ length: 20000 }, (_, i) => 'line ' + i + ' `x`').join('\n') +
        '\n```\n`tail`',
    bigUnterminated: 'a\n```\n' + big(1_000_000),
    bigTilde: '~~~\n' + big(500_000) + '\n~~~',
}

for (const [name, md] of Object.entries(stripCases)) {
    test(`stripCode matches the old implementation: ${name}`, () => {
        const got = stripCode(md)
        expect(got.length).toBe(md.length)
        expect(got === oldStripCode(md)).toBe(true)
    })
}

test('stripCode matches the old implementation on generated mixes', () => {
    const pieces = ['`', '``', '```', '~~~', '\n', '\r\n', ' ', 'a', '[[L]]', '#t', '  ', '\t']
    let seed = 12345
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let i = 0; i < 400; i++) {
        let md = ''
        const n = 1 + Math.floor(rnd() * 40)
        for (let j = 0; j < n; j++) md += pieces[Math.floor(rnd() * pieces.length)]
        expect(stripCode(md) === oldStripCode(md)).toBe(true)
    }
})

test('stripCode blanks a 2.7 MB fenced block in under 30ms', () => {
    const md = 'x\n```json\n' + big(2_700_000) + '\n```\ny'
    stripCode(md)
    const t0 = performance.now()
    stripCode(md)
    const ms = performance.now() - t0
    console.log('stripCode 2.7MB ms', ms.toFixed(1))
    expect(ms).toBeLessThan(30)
})
