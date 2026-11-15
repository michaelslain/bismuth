import { expect, test } from 'bun:test'
import { extractTags } from '../../src/tags'
import { parseFrontmatter } from '../../src/frontmatter'
import { collectVaultTags, normalizeTags } from '../../src/obsidianImport/tags'

const apply = (files: Record<string, string>) => {
    const map = new Map(Object.entries(files))
    const r = normalizeTags(map)
    for (const e of r.edits) map.set(e.path, e.text!)
    return { out: map, items: r.items }
}

test('space-separated frontmatter tags become a list, keeping keys and comments', () => {
    const { out } = apply({ 'A.md': '---\n# top\ntitle: T # c\ntags: a b\n---\nbody' })
    expect(out.get('A.md')).toBe('---\n# top\ntitle: T # c\ntags: [a, b]\n---\nbody')
})

test('case collisions use the most frequent spelling, frontmatter and inline, not in code', () => {
    const { out, items } = apply({
        'A.md': '---\ntags: [Foo]\n---\n#Foo and #foo `#Foo`\n```\n#Foo\n```',
        'B.md': 'x #foo #foo',
    })
    expect(out.get('A.md')).toBe('---\ntags: [foo]\n---\n#foo and #foo `#Foo`\n```\n#Foo\n```')
    expect(out.get('B.md')).toBe('x #foo #foo')
    expect(items.some(i => i.section === 'defaults')).toBe(true)
})

test('tie goes to the lowercase spelling', () => {
    expect(apply({ 'A.md': '#Foo #foo' }).out.get('A.md')).toBe('#foo #foo')
})

test('emoji and unextractable inline tags are lossy', () => {
    const { items } = apply({ 'A.md': 'x #party🎉 and #ok and #a.b' })
    const lossy = items.filter(i => i.section === 'lossy')
    expect(lossy.length).toBe(1)
    expect(lossy[0].detail).toContain('#party🎉')
})

test('a comma-separated tags string is left as written, no item', () => {
    const src = '---\ntags: a, b\n---\nbody'
    const { out, items } = apply({ 'A.md': src })
    expect(out.get('A.md')).toBe(src)
    expect(items.filter(i => i.path === 'A.md')).toEqual([])
    expect(apply({ 'B.md': '---\ntags: a b\n---\n' }).out.get('B.md')).toBe('---\ntags: [a, b]\n---\n')
})

test('inline text Obsidian never read as a tag is not lossy; an emoji-led tag is', () => {
    const lossy = (t: string) => apply({ 'A.md': t }).items.filter(i => i.section === 'lossy')
    expect(lossy('x #2<br>CYPLAN')).toEqual([])
    expect(lossy('x #4**<br>**16')).toEqual([])
    expect(lossy('say #N" ok')).toEqual([])
    const l = lossy('read #📚books')
    expect(l.length).toBe(1)
    expect(l[0].detail).toContain('#📚books')
})

test('collectVaultTags agrees with extractTags', () => {
    const note = '---\ntags: [a, "#b"]\n---\nhi #c/d `#no`\n```\n#nope\n```'
    const { data, body } = parseFrontmatter(note)
    expect(collectVaultTags(new Map([['A.md', note]]))).toEqual([...extractTags(data, body)].sort())
})

test('a single scalar tag string is left alone', () => {
    const src = '---\ntags: foo\n---\nbody'
    expect(apply({ 'A.md': src }).out.get('A.md')).toBe(src)
})
