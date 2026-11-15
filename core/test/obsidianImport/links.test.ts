import { expect, test } from 'bun:test'
import { rewriteLinks, unresolvedLinks } from '../../src/obsidianImport/links'
import type { ImportContext } from '../../src/obsidianImport/types'

const cfg = { present: true, plugins: [], app: null, dailyNotes: null, templates: null, appearance: null, pluginData: {} }
function run(files: Record<string, string>, extra: string[] = []) {
    const map = new Map(Object.entries(files))
    const ctx: ImportContext = { config: cfg, allPaths: [...map.keys(), ...extra] }
    const r = rewriteLinks(map, ctx)
    const out = new Map(map)
    for (const e of r.edits) out.set(e.path, e.text!)
    return { out, items: r.items }
}

test('md extension stripped, embeds untouched', () => {
    const { out } = run({ 'A.md': '[[Note.md]] [[Note.md|x]] [[Note.md#H]] ![[x.png]]', 'Note.md': '' }, ['x.png'])
    expect(out.get('A.md')).toBe('[[Note]] [[Note|x]] [[Note#H]] ![[x.png]]')
})

test('aliases resolve to the owning note', () => {
    const files = { 'N.md': '---\naliases: [A]\n---\n', 'B.md': '[[A]] [[A|t]] [[A#H]]' }
    expect(run(files).out.get('B.md')).toBe('[[N|A]] [[N|t]] [[N#H]]')
    const str = { 'N.md': '---\naliases: A\n---\n', 'B.md': '[[A]]' }
    expect(run(str).out.get('B.md')).toBe('[[N|A]]')
})

test('alias owner path-qualified when basename is not unique', () => {
    const files = { 'x/N.md': '---\naliases: [A]\n---\n', 'y/N.md': '', 'B.md': '[[A]]' }
    expect(run(files).out.get('B.md')).toBe('[[x/N|A]]')
})

test('alias equal to another note name: the file name wins, as in Obsidian, with no item', () => {
    const files = { 'N.md': '---\naliases: [M]\n---\n', 'M.md': '', 'B.md': '[[M]]' }
    const r = run(files)
    expect(r.out.get('B.md')).toBe('[[M]]')
    expect(r.items.filter(i => i.path === 'B.md')).toEqual([])
})

test('a markdown link to a note that exists nowhere stays a markdown link, as written', () => {
    const src = '`[c](Example.md)` appears as [c](Example.md) and [d](./Gone.md#H) and [e](/Root.md)'
    const r = run({ 'Linking/n.md': src })
    expect(r.out.get('Linking/n.md')).toBe(src)
    expect(unresolvedLinks(r.out, ['Linking/n.md'])).toEqual([])
})

test('case mismatch resolves when unique, decides when not', () => {
    expect(run({ 'Note.md': '', 'B.md': '[[note]]' }).out.get('B.md')).toBe('[[Note]]')
    const r = run({ 'a/Note.md': '', 'b/NOTE.md': '', 'B.md': '[[note]]' })
    expect(r.out.get('B.md')).toBe('[[note]]')
    expect(r.items.some(i => i.section === 'decide')).toBe(true)
})

test('markdown links become wikilinks; urls and images untouched', () => {
    const src = '[t](Other%20Note.md) [u](sub/Other.md#H) [e](https://x.com/x.md) ![i](a.md)'
    expect(run({ 'A.md': src, 'Other Note.md': '', 'sub/Other.md': '' }).out.get('A.md')).toBe('[[Other Note|t]] [[sub/Other#H|u]] [e](https://x.com/x.md) ![i](a.md)')
})

test('table rows needing a pipe are left with a decide item', () => {
    const files = { 'N.md': '---\naliases: [A]\n---\n', 'O.md': '', 'B.md': '| c |\n| [[A]] [t](O.md) |' }
    const r = run(files)
    expect(r.out.get('B.md')).toBe(files['B.md'])
    expect(r.items.filter(i => i.section === 'decide').length).toBe(2)
})

test('fences and code spans stay byte-identical', () => {
    const src = '```\n[[x.md]] [t](O.md)\n```\n`[[x.md]]`\n'
    expect(run({ 'A.md': src }).out.get('A.md')).toBe(src)
})

test('a relative markdown link resolves against the note folder', () => {
    const { out } = run({ 'a/b/n.md': '[r](../Other.md) [s](./Sib.md)', 'a/Other.md': '', 'a/b/Sib.md': '' })
    expect(out.get('a/b/n.md')).toBe('[[a/Other|r]] [[a/b/Sib|s]]')
    expect(unresolvedLinks(out, ['a/b/n.md', 'a/Other.md', 'a/b/Sib.md'])).toEqual([])
})

test('a markdown link resolves note-relative, then from the vault root, then by name', () => {
    const files = { 'a/n.md': '[t](Other.md) [u](b/Deep.md) [v](Sib.md)', 'Other.md': '', 'b/Deep.md': '', 'a/Sib.md': '' }
    expect(run(files).out.get('a/n.md')).toBe('[[Other|t]] [[b/Deep|u]] [[a/Sib|v]]')
})

test('a ./ or ../ markdown link is only ever note-relative', () => {
    const { out } = run({ 'a/n.md': '[t](./Other.md)', 'Other.md': '' })
    // `./Other.md` names a/Other.md, which does not exist; the root Other.md is never tried
    expect(out.get('a/n.md')).toBe('[t](./Other.md)')
})

test('a wikilink ending in a backslash (escaped pipe in a table) is a decide item and stays unresolved', () => {
    const files = { 'A.md': '| x |\n|---|\n| [[Note\\|Alias]] |', 'Note.md': '' }
    const { out, items } = run(files)
    expect(out.get('A.md')).toBe(files['A.md'])
    expect(items.some(i => i.section === 'decide' && i.area === 'links' && i.detail.includes('backslash'))).toBe(true)
    expect(unresolvedLinks(out, ['A.md', 'Note.md']).map(x => x.target)).toEqual(['Note\\'])
})

test('a pipe in markdown link text becomes a dash', () => {
    const { out } = run({ 'n.md': '[a|b](Note.md)', 'Note.md': '' })
    expect(out.get('n.md')).toBe('[[Note|a-b]]')
})

test('unresolvedLinks', () => {
    const files = new Map([
        ['A.md', '[[Missing]] [[x.md]] [[a/../b]] [[folder/Note]] [[Note]] [[img.png]] [[gone.png]]\n```\n[[Fenced]]\n```\n`[[Span]]`'],
        ['folder/Note.md', ''],
    ])
    const r = unresolvedLinks(files, ['A.md', 'folder/Note.md', 'img.png'])
    expect(r.map(x => x.target)).toEqual(['Missing', 'x.md', 'a/../b', 'gone.png'])
    expect(r.every(x => x.path === 'A.md')).toBe(true)
})

test('unresolvedLinks resolves a base by its .base.jsonl file', () => {
    expect(unresolvedLinks(new Map([['n.md', '[[Books]]']]), ['n.md', 'Books.base.jsonl'])).toEqual([])
    expect(unresolvedLinks(new Map([['n.md', '[[Books]]']]), ['n.md', 'sub/Books.base.jsonl'])).toEqual([])
})

test('note embeds lose .md, other embeds are untouched', () => {
    const { out } = run({ 'A.md': '![[Note.md]] ![[Note.md#H]] ![[Note.md|x]] ![[x.png]]', 'Note.md': '' }, ['x.png'])
    expect(out.get('A.md')).toBe('![[Note]] ![[Note#H]] ![[Note|x]] ![[x.png]]')
})
