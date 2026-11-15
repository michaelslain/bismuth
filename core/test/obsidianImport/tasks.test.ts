import { describe, expect, test } from 'bun:test'
import { convertTasks } from '../../src/obsidianImport/tasks'
import type { ImportContext } from '../../src/obsidianImport/types'

const ctx = (plugins: string[] = ['obsidian-tasks-plugin']): ImportContext => ({
    config: {
        present: true,
        plugins,
        app: null,
        dailyNotes: null,
        templates: null,
        appearance: null,
        pluginData: {},
    },
    allPaths: [],
})
const run = (text: string, plugins?: string[]) =>
    convertTasks(new Map([['a.md', text]]), ctx(plugins), '2026-09-01')
const edited = (r: ReturnType<typeof run>) => r.edits[0]?.text
const sections = (r: ReturnType<typeof run>, s: string) => r.items.filter(i => i.section === s)

describe('emoji tasks', () => {
    test('rewrites to bracket fields', () => {
        const r = run('- [ ] pay 📅 2026-09-14 ⏫ 🔁 every week\n')
        expect(edited(r)).toBe('- [ ] pay [due 2026-09-14] [high] [every week]\n')
        expect(sections(r, 'defaults')).toHaveLength(0)
    })
    test('defaults item without the plugin', () => {
        const r = run('- [ ] pay 📅 2026-09-14\n', [])
        expect(sections(r, 'defaults')).toHaveLength(1)
    })
    test('flagged line is a decide item', () => {
        const r = run('- [ ] x 📅 2026-02-30\n')
        expect(sections(r, 'decide').some(i => i.detail.includes('2026-02-30'))).toBe(true)
    })
    test('🏁 ⛔ 🆔 are lossy', () => {
        const r = run('- [ ] x 🆔 abc ⛔ def\n')
        expect(sections(r, 'lossy')).toHaveLength(1)
        expect(sections(r, 'lossy')[0].detail).toContain('🆔 abc')
    })
    test('numbered tasks are lossy and untouched', () => {
        const r = run('1. [ ] x\n')
        expect(sections(r, 'lossy')).toHaveLength(1)
        expect(r.edits).toHaveLength(0)
    })
    test('already converted text makes no edit', () => {
        expect(run('- [ ] a [due 2026-09-14]\n').edits).toHaveLength(0)
    })
})

describe('tasks fences', () => {
    test('becomes a query block with tasks and where', () => {
        const r = run('x\n```tasks\nnot done\n```\ny\n')
        const t = edited(r)!
        expect(t.startsWith('x\n```query\ntasks:\n')).toBe(true)
        expect(t).toContain('where:')
        expect(t.endsWith('```\ny\n')).toBe(true)
        expect(sections(r, 'converted').length).toBe(1)
    })
    test('sort by becomes sort', () => {
        expect(edited(run('```tasks\nnot done\nsort by due\n```\n'))).toContain('sort: ')
    })
    test('group by and limit map to keys', () => {
        const t = edited(
            run('```tasks\nnot done\ngroup by filename\nlimit 5\n```\n'),
        )!
        expect(t).toContain('group: file.name')
        expect(t).toContain('limit: 5')
        expect(t).not.toContain('group by')
        expect(edited(run('```tasks\nnot done\ngroup by folder\n```\n'))).toContain('group: file.folder')
        expect(edited(run('```tasks\nnot done\ngroup by due\n```\n'))).toContain('group: due')
    })
    test('hide, explain and invalid group by are dropped as lossy', () => {
        const r = run('```tasks\nnot done\nhide edit button\nexplain\ngroup by happens\n```\n')
        const t = edited(r)!
        expect(t).not.toContain('hide')
        expect(t).not.toContain('explain')
        expect(t).not.toContain('group:')
        const lossy = sections(r, 'lossy').map(i => i.detail)
        expect(lossy.some(d => d.includes('"hide edit button"'))).toBe(true)
        expect(lossy.some(d => d.includes('"explain"'))).toBe(true)
        expect(lossy.some(d => d.includes('"group by happens"'))).toBe(true)
    })
    test('unrecognized leaves are decide items', () => {
        const r = run('```tasks\nnot done\nheading includes Inbox\n```\n')
        expect(sections(r, 'decide').some(i => i.detail.includes('heading includes Inbox'))).toBe(true)
        expect(edited(r)).toContain('where:')
    })
    test('new leaves translate instead of being left as written', () => {
        const r = run('```tasks\nnot done\nhas due date\npath includes Projects\n```\n')
        expect(sections(r, 'decide')).toHaveLength(0)
        expect(edited(r)).toContain('note.due')
        expect(edited(r)).toContain('file.path.lower().contains("projects")')
    })
    test('unconvertible fence stays as written with a decide item', () => {
        const src = '```tasks\ndue friday\n```\n'
        const r = run(src)
        expect(r.edits).toHaveLength(0)
        expect(sections(r, 'decide').some(i => i.detail.includes('due friday'))).toBe(true)
    })
    test('a tasks fence quoted inside a longer fence is untouched', () => {
        expect(run('````md\n```tasks\nnot done\n```\n````\n').edits).toHaveLength(0)
    })
})

describe('untranslatable tasks query', () => {
    test('left as written with a decide item', () => {
        const r = run('```tasks\ndue friday\n```\n')
        expect(r.edits).toHaveLength(0)
        const d = sections(r, 'decide')
        expect(d).toHaveLength(1)
        expect(d[0].detail).toContain('due friday')
        expect(sections(r, 'converted')).toHaveLength(0)
    })
})

describe('a ```tasks fence is Tasks text without the looksLikeTaskDsl guess', () => {
    test('opens with a word the guess does not know, and has a dot', () => {
        const src = '```tasks\npath includes Projects/a.b\ndescription regex matches /x.y/i\n```\n'
        const r = run(src)
        expect(r.edits).toHaveLength(1)
        const t = edited(r)!
        expect(t.startsWith('```query\ntasks:\nwhere: ')).toBe(true)
        expect(t).toContain('file.path.lower().contains("projects/a.b")')
        expect(t).toContain('note.description.matches(/x.y/i)')
        expect(sections(r, 'decide')).toHaveLength(0)
        expect(sections(r, 'converted')).toHaveLength(1)
    })
})

describe('one report item per query', () => {
    const src = [
        '```tasks',
        'not done',
        'filter by function task.due',
        'heading includes Inbox',
        'explain',
        'hide backlinks',
        'ignore global query',
        'show tree',
        'limit groups 3',
        'short mode',
        '```',
        '',
    ].join('\n')
    test('untranslated leaves are one decide item, the query is still written', () => {
        const r = run(src)
        expect(edited(r)).toContain('where: ')
        const d = sections(r, 'decide')
        expect(d).toHaveLength(1)
        expect(d[0].detail).toContain('"filter by function task.due"')
        expect(d[0].detail).toContain('"heading includes Inbox"')
    })
    test('display-only lines are one lossy item', () => {
        const r = run(src)
        const l = sections(r, 'lossy')
        expect(l).toHaveLength(1)
        for (const line of ['explain', 'hide backlinks', 'ignore global query', 'show tree', 'limit groups 3', 'short mode'])
            expect(l[0].detail).toContain(`"${line}"`)
        expect(edited(r)).not.toContain('explain')
        expect(sections(r, 'converted')).toHaveLength(1)
    })
    test('a query with nothing to drop or decide reports only converted', () => {
        const r = run('```tasks\nnot done\n```\n')
        expect(r.items.map(i => i.section)).toEqual(['converted'])
    })
    test('a multi-line filter by function is one untranslated leaf', () => {
        const r = run('```tasks\nnot done\nfilter by function \\\n  const a = 1 \\\n  return a\n```\n')
        const d = sections(r, 'decide')
        expect(d).toHaveLength(1)
        expect(d[0].detail.match(/"/g)).toHaveLength(2)
    })
})

describe('{{query.file.*}} placeholders', () => {
    test('are filled from the host note, with a lossy item about renames', () => {
        const src =
            '```tasks\npath includes {{query.file.path}}\nfolder includes {{query.file.folder}}\nfilename includes {{query.file.filename}}\ndescription includes {{query.file.filenameWithoutExtension}}\n```\n'
        const r = convertTasks(new Map([['Projects/Home/Plan.md', src]]), ctx(), '2026-09-01')
        const t = r.edits[0]?.text ?? ''
        expect(t).toContain('file.path.lower().contains("projects/home/plan.md")')
        expect(t).toContain('"projects/home/"')
        expect(t).toContain('"plan.md"')
        expect(t).toContain('note.description.lower().contains("plan")')
        expect(t).not.toContain('{{')
        expect(r.items.filter(i => i.section === 'decide')).toHaveLength(0)
        expect(r.items.some(i => i.section === 'lossy' && i.detail.includes('{{query.file'))).toBe(true)
    })
    test('a note at the vault root has folder and root "/"', () => {
        const r = convertTasks(new Map([['Root.md', '```tasks\nfolder includes {{query.file.folder}}\n```\n']]), ctx(), '2026-09-01')
        expect(r.edits[0]?.text).not.toContain('{{')
    })
})

describe('Tasks plugin presets', () => {
    const withPresets = (presets: Record<string, string>): ImportContext => {
        const c = ctx()
        c.config.pluginData = { 'obsidian-tasks-plugin': { presets } }
        return c
    }
    test('preset lines and {{preset.x}} are inlined from the plugin settings, nested ones too', () => {
        const c = withPresets({
            this_file: 'path includes {{query.file.path}}',
            hide_all: '# hide\nhide edit button\npreset hide_more',
            hide_more: 'hide backlinks',
        })
        const src = '```tasks\nnot done\npreset this_file\nNOT ({{preset.this_file}})\npreset hide_all\n```\n'
        const r = convertTasks(new Map([['P/n.md', src]]), c, '2026-09-01')
        const t = r.edits[0]?.text ?? ''
        expect(t).toContain('file.path.lower().contains("p/n.md")')
        expect(t).toContain('!(file.path.lower().contains("p/n.md"))')
        expect(t).not.toContain('preset')
        expect(r.items.filter(i => i.section === 'decide')).toHaveLength(0)
    })
    test('an undefined preset is reported, not guessed', () => {
        const r = convertTasks(new Map([['n.md', '```tasks\nnot done\npreset nope\n```\n']]), withPresets({}), '2026-09-01')
        expect(r.items.some(i => i.section === 'decide' && i.detail.includes('preset nope'))).toBe(true)
    })
})
