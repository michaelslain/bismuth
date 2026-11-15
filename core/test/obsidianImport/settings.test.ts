import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { SETTINGS_SCHEMA } from '../../src/schema/settingsSchema'
import { validateEntry } from '../../src/schema/validate'
import { FORMAT_TOKENS, mapSettings } from '../../src/obsidianImport/settings'
import type { ObsidianConfig } from '../../src/obsidianImport/types'

const base: ObsidianConfig = {
    present: true,
    plugins: [],
    app: null,
    dailyNotes: null,
    templates: null,
    appearance: null,
    pluginData: {},
}
const cfg = (over: Partial<ObsidianConfig>): ObsidianConfig => ({ ...base, ...over })

function entryAt(path: string[]) {
    let schema = SETTINGS_SCHEMA
    for (let i = 0; i < path.length; i++) {
        const e = schema[path[i]]
        expect(e).toBeDefined()
        if (i === path.length - 1) return e
        const t = e.type as { kind: string; fields: typeof schema }
        expect(t.kind).toBe('object')
        schema = t.fields
    }
    throw new Error('empty path')
}

function expectValid(settings: Array<{ path: string[]; value: unknown }>) {
    for (const s of settings) {
        expect(validateEntry(entryAt(s.path), s.value)).toBeNull()
    }
}

const get = (r: ReturnType<typeof mapSettings>, ...path: string[]) =>
    r.settings.find(s => s.path.join('.') === path.join('.'))?.value

describe('mapSettings', () => {
    test('absent .obsidian', () => {
        const r = mapSettings(cfg({ present: false }))
        expect(r.settings).toEqual([])
        expect(r.items).toEqual([
            {
                section: 'defaults',
                area: 'settings',
                path: '',
                detail: 'no .obsidian folder: settings defaults apply',
            },
        ])
    })

    test('attachmentFolderPath forms', () => {
        const f = (v: string) => mapSettings(cfg({ app: { attachmentFolderPath: v } }))
        expect(get(f('assets'), 'attachments', 'folder')).toBe('assets')
        expect(get(f('/'), 'attachments', 'folder')).toBe('')
        expect(get(f('./'), 'attachments', 'folder')).toBe('.')
        const sub = f('./sub')
        expect(sub.settings).toEqual([])
        expect(sub.items.map(i => i.section)).toEqual(['lossy'])
        expectValid([...f('assets').settings, ...f('/').settings, ...f('./').settings])
    })

    test('editor flags', () => {
        const r = mapSettings(
            cfg({ app: { livePreview: false, showLineNumber: true, spellcheck: false } }),
        )
        expect(get(r, 'editor', 'livePreview')).toBe(false)
        expect(get(r, 'editor', 'lineNumbers')).toBe(true)
        expect(get(r, 'editor', 'spellcheck')).toBe(false)
        expectValid(r.settings)
    })

    test('templates folder', () => {
        const r = mapSettings(cfg({ templates: { folder: 'Templates/' } }))
        expect(get(r, 'templates', 'folder')).toBe('Templates')
        expectValid(r.settings)
    })

    test('daily notes item', () => {
        const r = mapSettings(
            cfg({
                dailyNotes: { folder: 'Daily', format: 'YYYY-MM-DD', template: 'Templates/Daily' },
            }),
        )
        expect(get(r, 'dailyNotes')).toEqual([
            {
                id: 'daily',
                label: 'Daily',
                icon: 'calendar',
                folder: 'Daily',
                fileName: '{{date:YYYY-MM-DD}}',
                template: 'Templates/Daily.md',
            },
        ])
        expect(r.items).toEqual([])
        expectValid(r.settings)
    })

    test('daily format with slash or foreign Moment tokens is lossy', () => {
        const slash = mapSettings(cfg({ dailyNotes: { folder: '', format: 'YYYY/MM/DD' } }))
        expect(slash.items.map(i => i.section)).toEqual(['lossy'])
        const tok = mapSettings(cfg({ dailyNotes: { folder: '', format: 'YYYY-[W]W' } }))
        expect(tok.items.map(i => i.section)).toEqual(['lossy'])
        expect(get(tok, 'dailyNotes')).toEqual([
            expect.objectContaining({ fileName: '{{date}}' }),
        ])
        const doTok = mapSettings(cfg({ dailyNotes: { format: 'MMMM Do, YYYY' } }))
        expect(doTok.items.length).toBe(1)
        expectValid([...slash.settings, ...tok.settings, ...doTok.settings])
    })

    test('iconize object entries read iconName, else lossy', () => {
        const r = mapSettings(
            cfg({
                plugins: ['obsidian-icon-folder'],
                pluginData: {
                    'obsidian-icon-folder': {
                        A: { iconName: 'LuBook', iconColor: 'red' },
                        B: { iconColor: 'red' },
                    },
                },
            }),
        )
        expect(r.folderIcons).toEqual([{ folder: 'A', icon: 'Book' }])
        expect(r.items).toHaveLength(1)
        expect(r.items[0].path).toBe('B')
        expect(r.items[0].section).toBe('lossy')
    })

    test('a run of adjacent tokens such as YYYYMMDD is supported', () => {
        const r = mapSettings(cfg({ dailyNotes: { format: 'YYYYMMDD' } }))
        expect((r.settings[0].value as Array<{ fileName: string }>)[0].fileName).toBe('{{date:YYYYMMDD}}')
        expect(r.items).toHaveLength(0)
    })

    test('iconize folder icons', () => {
        const r = mapSettings(
            cfg({
                plugins: ['obsidian-icon-folder'],
                pluginData: {
                    'obsidian-icon-folder': {
                        settings: { x: 1 },
                        Projects: 'LuFolder',
                        Notes: '📝',
                        Work: 'IbWork',
                    },
                },
            }),
        )
        expect(r.folderIcons).toEqual([
            { folder: 'Projects', icon: 'Folder' },
            { folder: 'Notes', icon: '📝' },
        ])
        expect(r.items).toHaveLength(1)
        expect(r.items[0].section).toBe('lossy')
        expect(r.items[0].path).toBe('Work')
    })

    test('unmapped settings are one lossy item each', () => {
        const r = mapSettings(
            cfg({
                app: {
                    userIgnoreFilters: ['private/'],
                    newFileLocation: 'folder',
                    useMarkdownLinks: true,
                    alwaysUpdateLinks: true,
                },
                appearance: { theme: 'moonstone', enabledCssSnippets: ['a'] },
            }),
        )
        expect(r.settings).toEqual([])
        expect(r.items.every(i => i.section === 'lossy')).toBe(true)
        expect(r.items.length).toBe(6)
    })
})

test('FORMAT_TOKENS equals the token list in core/src/templates.ts', () => {
    const src = readFileSync(join(import.meta.dir, '../../src/templates.ts'), 'utf8')
    const i = src.indexOf('function formatDate')
    const tokens = [...src.slice(i).matchAll(/^\s*\[\s*'([A-Za-z]+)',/gm)].map(m => m[1])
    expect([...FORMAT_TOKENS].sort()).toEqual([...new Set(tokens)].sort())
})
