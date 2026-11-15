import { describe, expect, test } from 'bun:test'
import { scanUnconverted } from '../../src/obsidianImport/scan'
import type { ImportContext } from '../../src/obsidianImport/types'

const ctx = (allPaths: string[] = [], plugins: string[] = []): ImportContext => ({
    config: {
        present: true,
        plugins,
        app: null,
        dailyNotes: null,
        templates: null,
        appearance: null,
        pluginData: {},
    },
    allPaths,
})
const scan = (text: string, c = ctx()) => scanUnconverted(new Map([['a.md', text]]), c)
const one = (text: string, c?: ImportContext) => {
    const r = scan(text, c)
    expect(r).toHaveLength(1)
    return r[0]
}

describe('scanUnconverted', () => {
    test('simple dataview is left', () => {
        const i = one('```dataview\nLIST FROM #tag\n```\n')
        expect([i.section, i.detail]).toEqual(['left', expect.stringContaining('"LIST FROM #tag"')])
        expect(one('```dataview\nTABLE a, b FROM "folder"\n```\n').section).toBe('left')
    })
    test('dataview with WHERE or other shapes is decide', () => {
        expect(one('```dataview\nLIST FROM #t WHERE x\n```\n').section).toBe('decide')
        expect(one('```dataview\nTASK\n```\n').section).toBe('decide')
    })
    test('dataviewjs, inline, templater are decide', () => {
        expect(one('```dataviewjs\ndv.x()\n```\n').section).toBe('decide')
        expect(one('see `= this.x` now\n').section).toBe('decide')
        const t = one('<% tp.date.now() %>\n')
        expect([t.section, t.detail]).toEqual(['decide', expect.stringContaining('<% tp.date.now() %>')])
    })
    test('mermaid is left', () => {
        expect(one('```mermaid\ngraph TD\n```\n').section).toBe('left')
    })
    test('canvas files and embeds', () => {
        const r = scanUnconverted(new Map([['a.md', '![[board.canvas]]\n']]), ctx(['board.canvas', 'a.md']))
        expect(r.map(i => [i.section, i.area])).toEqual([
            ['decide', 'drawings'],
            ['decide', 'drawings'],
        ])
        expect(r[0].detail).toContain('canvas is not shown in Bismuth; export an image of it from Obsidian and embed it')
    })
    test('excalidraw note', () => {
        const r = scanUnconverted(new Map([['d.excalidraw.md', 'x']]), ctx())
        expect(r.map(i => i.section)).toEqual(['decide'])
        expect(r[0].detail).toContain('Excalidraw drawing shows as raw text; export an image from Obsidian')
    })
    test('block links, block anchors and section embeds need no report', () => {
        const text = 'see [[x#^abc]]\na paragraph ^abc\n![[Note#Heading]]\n![[Note#^abc]]\n'
        expect(scanUnconverted(new Map([['n.md', text]]), ctx())).toHaveLength(0)
    })
    test('companion source beside a binary', () => {
        const r = scanUnconverted(new Map([['x.png.md', '']]), ctx(['x.png', 'x.png.md']))
        expect(r.map(i => i.section)).toEqual(['defaults'])
        expect(r[0].path).toBe('')
        const names = 'abcdefg'.split('')
        const files = new Map(names.map(n => [`${n}.pdf.md`, ''] as [string, string]))
        const many = scanUnconverted(files, ctx(names.flatMap(n => [`${n}.pdf`, `${n}.pdf.md`])))
        expect(many).toHaveLength(1)
        expect(many[0].detail).toContain('7 notes')
        expect(many[0].detail).toContain('e.pdf.md')
        expect(many[0].detail).not.toContain('f.pdf.md')
        expect(scanUnconverted(new Map([['x.png.md', '']]), ctx(['x.png.md']))).toHaveLength(0)
    })
    test('custom callouts are left, known ones ignored', () => {
        expect(one('> [!custom] Title\n> body\n').section).toBe('left')
        expect(scan('> [!warning] Title\n> [!info]\n')).toHaveLength(0)
    })
    test('templater code inside a fence is not reported, outside it is', () => {
        expect(scan('```js\nconst x = "<% tp.date.now() %>"\n```\n')).toHaveLength(0)
        expect(scan('<% tp.date.now() %>\n')).toHaveLength(1)
    })
    test('templater tags in the templates folder are one left item per file, elsewhere one decide each', () => {
        const c = ctx()
        c.config.pluginData = { 'templater-obsidian': { templates_folder: '/_meta/templates/' } }
        const text = '<% tp.date.now() %>\n<% tp.file.title %>\n'
        const r = scanUnconverted(new Map([['_meta/templates/Daily.md', text], ['notes/n.md', text]]), c)
        const inTemplates = r.filter(i => i.path === '_meta/templates/Daily.md')
        expect(inTemplates).toHaveLength(1)
        expect(inTemplates[0].section).toBe('left')
        expect(inTemplates[0].detail).toContain('2 tag(s)')
        expect(r.filter(i => i.path === 'notes/n.md' && i.section === 'decide')).toHaveLength(2)
        const core = ctx()
        core.config.templates = { folder: 'Templates' }
        expect(scanUnconverted(new Map([['Templates/T.md', text]]), core).map(i => i.section)).toEqual(['left'])
    })
    test('unhandled plugins are decide, handled ones silent', () => {
        const r = scan('plain\n', ctx([], ['dataview', 'obsidian-tasks-plugin', 'calendar', 'obsidian-icon-folder']))
        expect(r.map(i => i.detail)).toEqual([expect.stringContaining('calendar')])
    })
    test('plain syntax inside a code fence is not scanned', () => {
        expect(scan('```js\n`= x` and [[a#^b]]\n```\n')).toHaveLength(0)
    })
})
