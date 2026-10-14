import { describe, expect, it } from 'bun:test'
import { tagHighlighter, tags as t } from '@lezer/highlight'
import { codeTokens } from './codeTokens'

const h = tagHighlighter([
    { tag: t.propertyName, class: 'key' },
    { tag: t.meta, class: 'meta' },
])
const text = (toks: { text: string }[]) => toks.map(x => x.text).join('')

describe('codeTokens', () => {
    it('round-trips the text exactly, line breaks included', () => {
        const code = 'appearance:\n  theme: paper\nlayout:\n  sidebarSide: right'
        expect(text(codeTokens(code, 'yaml', h))).toBe(code)
    })
    it('marks yaml keys', () => {
        const keys = codeTokens('a: 1\nb: two', 'yaml', h)
            .filter(x => x.cls === 'key')
            .map(x => x.text)
        expect(keys).toEqual(['a', 'b'])
    })
    it('highlights a note frontmatter as yaml inside markdown', () => {
        const toks = codeTokens('---\ntags: [x]\n---\n# Title', 'markdown', h)
        expect(toks.filter(x => x.cls === 'key').map(x => x.text)).toEqual(['tags'])
        const fences = toks.filter(x => x.cls === 'meta' && x.text === '---')
        expect(fences.length).toBe(2)
    })
})
