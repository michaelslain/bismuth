import { expect, test } from 'bun:test'
import { renderReport } from '../../src/obsidianImport/report'
import { inventory } from '../../src/obsidianImport/inventory'
import type { ReportItem } from '../../src/obsidianImport/types'

const item = (section: ReportItem['section'], area: ReportItem['area'], path: string, detail: string): ReportItem => ({
    section,
    area,
    path,
    detail,
})

const items = [
    item('converted', 'tasks', 'b.md', '1 task'),
    item('decide', 'plugins', '', 'plugin x left'),
    item('converted', 'links', 'z.md', 'link'),
    item('converted', 'tasks', 'a.md', '2 tasks'),
    item('left', 'validation', '', 'all checks passed'),
    item('decide', 'validation', 'a.md', 'check failed'),
]
const render = (list: ReportItem[]) => renderReport({ source: '/x/Vault', out: '/x/out', inventory: [{ label: 'notes', count: 3 }], items: list })

test('sections come in the documented order, decisions first', () => {
    const r = render(items)
    const heads = [...r.matchAll(/^## (.+)$/gm)].map(m => m[1])
    expect(heads).toEqual(['Needs a decision', 'Converted', 'Lossy', 'Defaults taken', 'Left as is', 'Validation', 'Inventory'])
})

test('items group by area and sort by area then path; empty sections say none', () => {
    const r = render(items)
    expect(r).toContain('### links\n\n- z.md: link\n\n### tasks\n\n- a.md: 2 tasks\n- b.md: 1 task')
    expect(r).toMatch(/## Lossy\n\nnone\n/)
    expect(r).toContain('- (vault): plugin x left')
    expect(r).toContain('- notes: 3')
})

test('validation items live under Validation; a failed check is also a decision', () => {
    const r = render(items)
    const decide = r.slice(r.indexOf('## Needs a decision'), r.indexOf('## Converted'))
    expect(decide).toContain('- a.md: check failed')
    expect(decide).not.toContain('all checks passed')
    const validation = r.slice(r.indexOf('## Validation'), r.indexOf('## Inventory'))
    expect(validation).toContain('all checks passed')
    expect(validation).toContain('check failed')
    expect(validation).not.toContain('###')
    expect(r.slice(r.indexOf('## Left as is'), r.indexOf('## Validation'))).toMatch(/none/)
})

test('rendering is deterministic whatever the input order', () => {
    expect(render([...items].reverse())).toBe(render(items))
})

test('inventory counts notes, tasks outside fences and block kinds', () => {
    const files = new Map([
        ['a.md', '- [ ] one\n1. [ ] two\n```tasks\n- [ ] not counted\nnot done\n```\n'],
        ['b.base', 'views: []'],
    ])
    const inv = Object.fromEntries(
        inventory(files, { config: { present: false, plugins: ['p'], app: null, dailyNotes: null, templates: null, appearance: null, pluginData: {} }, allPaths: ['a.md', 'b.base', 'c.canvas'] }).map(r => [r.label, r.count]),
    )
    expect(inv['notes']).toBe(1)
    expect(inv['checkbox tasks']).toBe(1)
    expect(inv['numbered checkbox tasks']).toBe(1)
    expect(inv['tasks blocks']).toBe(1)
    expect(inv['bases']).toBe(1)
    expect(inv['canvases']).toBe(1)
    expect(inv['community plugins']).toBe(1)
})
