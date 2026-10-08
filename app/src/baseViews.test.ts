import { expect, test } from 'bun:test'
import { baseFileName, baseTemplate, uniqueBaseFileName } from './baseViews'
import {
    baseFormatOf,
    isBaseText,
    readBaseConfigRaw,
} from '../../core/src/bases/baseFile'
import { wikilinkOpenPath, pickBasePath } from './editor/wikilink'
import { formatsFor } from './export/formats'
import { contentLabel } from './tabIds'
import { vaultFileItems } from './palette/vaultFileItems'

test('a new base is a .base.jsonl whose line 1 is the config', () => {
    expect(baseFileName('Table')).toBe('Untitled Table.base.jsonl')
    for (const view of ['table', 'calendar', 'kanban']) {
        const text = baseTemplate(view)
        expect(baseFormatOf(text)).toBe('jsonl')
        expect(isBaseText(text)).toBe(true)
        expect(readBaseConfigRaw(text)?.view).toBe(view)
        expect(text.endsWith('\n')).toBe(true)
    }
    expect(readBaseConfigRaw(baseTemplate('calendar'))?.source).toBeUndefined()
    expect(readBaseConfigRaw(baseTemplate('table'))?.source).toBe('notes')
})

test('uniqueBaseFileName keeps the double extension intact', () => {
    const taken = [
        'a/Untitled Table.base.jsonl',
        'a/Untitled Table 1.base.jsonl',
    ]
    expect(uniqueBaseFileName(taken, 'a', 'Table')).toBe(
        'Untitled Table 2.base.jsonl',
    )
    expect(uniqueBaseFileName(taken, '', 'Table')).toBe(
        'Untitled Table.base.jsonl',
    )
})

test('a wikilink to a jsonl base opens it; a note of that name still wins', () => {
    const bases = ['boards/Tasks.base.jsonl', 'deep/er/Tasks.base.jsonl']
    expect(pickBasePath('Tasks', bases)).toBe('boards/Tasks.base.jsonl')
    expect(pickBasePath('deep/er/Tasks', bases)).toBe(
        'deep/er/Tasks.base.jsonl',
    )
    expect(wikilinkOpenPath('Tasks', null, bases)).toBe(
        'boards/Tasks.base.jsonl',
    )
    expect(wikilinkOpenPath('Tasks.base.jsonl', null, bases)).toBe(
        'Tasks.base.jsonl',
    )
    expect(wikilinkOpenPath('Tasks', 'notes/Tasks', bases)).toBe(
        'boards/Tasks.base.jsonl',
    )
    expect(wikilinkOpenPath('Nope', null, bases)).toBe('Nope.md')
})

test('export, tab label and palette all see .base.jsonl', () => {
    expect(formatsFor('a/X.base.jsonl')).toEqual(formatsFor('a/X.md'))
    expect(contentLabel('a/X.base.jsonl')).toBe('X')
    const items = vaultFileItems([
        { path: 'a/X.base.jsonl', name: 'X.base.jsonl', kind: 'file' },
    ] as never)
    expect(items.map(i => i.label)).toEqual(['X'])
})
