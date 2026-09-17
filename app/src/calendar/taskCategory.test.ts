import { describe, expect, test } from 'bun:test'
import { PALETTE_TOKENS } from '../ui/palette'
import {
    autoCategoryColor,
    taskCategoryColors,
    taskCategoryName,
    taskCategoryNames,
} from './taskCategory'
import { EMPTY_FILE, type Row } from '../../../core/src/bases/types'

function row(
    note: Record<string, unknown>,
    fileName = 'tasks',
): Row {
    return {
        file: { ...EMPTY_FILE, name: fileName, basename: fileName, path: `${fileName}.md` },
        note,
        formula: {},
    }
}

describe('taskCategoryName', () => {
    test('an explicit categoryField wins when it is a non-empty string', () => {
        const r = row({ line: 3, category: 'ignored', urgency: 'work' })
        expect(taskCategoryName(r, 'urgency')).toBe('work')
    })

    test('categoryField set but blank falls through to the scanned-row rule', () => {
        const r = row({ line: 3, urgency: '   ' }, 'inbox')
        expect(taskCategoryName(r, 'urgency')).toBe('inbox')
    })

    test('categoryField set but absent falls through to the scanned-row rule', () => {
        const r = row({ line: 3 }, 'inbox')
        expect(taskCategoryName(r, 'urgency')).toBe('inbox')
    })

    test('no categoryField, a scanned row (numeric note.line) uses the source note basename', () => {
        const r = row({ line: 7, category: 'ignored-too' }, 'groceries')
        expect(taskCategoryName(r)).toBe('groceries')
    })

    test('no categoryField, not scanned, falls back to note.category', () => {
        const r = row({ category: 'billing' })
        expect(taskCategoryName(r)).toBe('billing')
    })

    test('no categoryField, not scanned, blank note.category yields undefined', () => {
        const r = row({ category: '' })
        expect(taskCategoryName(r)).toBeUndefined()
    })

    test('nothing resolves → undefined', () => {
        const r = row({})
        expect(taskCategoryName(r)).toBeUndefined()
    })

    test('a self-owned row (no note.line) never falls back to file.name', () => {
        // No `line` at all → not scanned. Only note.category can supply a name.
        const r = row({}, 'should-not-appear')
        expect(taskCategoryName(r)).toBeUndefined()
    })
})

describe('taskCategoryNames', () => {
    test('distinct names in first-seen order, deduped', () => {
        const rows = [
            row({ line: 1 }, 'b'),
            row({ line: 2 }, 'a'),
            row({ line: 3 }, 'b'),
            row({ category: 'c' }),
        ]
        expect(taskCategoryNames(rows)).toEqual(['b', 'a', 'c'])
    })

    test('rows that resolve to no category are skipped, not inserted as undefined', () => {
        const rows = [row({}), row({ line: 1 }, 'x')]
        expect(taskCategoryNames(rows)).toEqual(['x'])
    })

    test('an explicit categoryField is honoured for every row', () => {
        const rows = [
            row({ line: 1, urgency: 'work' }, 'a'),
            row({ line: 2, urgency: 'home' }, 'b'),
        ]
        expect(taskCategoryNames(rows, 'urgency')).toEqual(['work', 'home'])
    })
})

describe('autoCategoryColor', () => {
    test('is a pure function of the name alone — repeated calls agree', () => {
        const a1 = autoCategoryColor('groceries')
        const a2 = autoCategoryColor('groceries')
        const a3 = autoCategoryColor('groceries')
        expect(a1).toBe(a2)
        expect(a2).toBe(a3)
    })

    test('is order-independent — computing other names first changes nothing', () => {
        const before = autoCategoryColor('groceries')
        autoCategoryColor('a')
        autoCategoryColor('b')
        autoCategoryColor('c')
        const after = autoCategoryColor('groceries')
        expect(before).toBe(after)
    })

    test('two different names CAN land on the same token (it is a hash, not a registry) but a '
        + 'given name never moves once computed', () => {
        // Calling it 50 times in a fresh sequence each time must never perturb the result —
        // proof there is no counter or insertion-order state backing it.
        const results = new Set<string>()
        for (let i = 0; i < 50; i++) results.add(autoCategoryColor('recurring-name'))
        expect(results.size).toBe(1)
    })

    test('a spread of distinct names covers all seven palette tokens', () => {
        const names = Array.from({ length: 60 }, (_, i) => `source-note-${i}`)
        const colors = new Set(names.map(autoCategoryColor))
        expect(colors.size).toBe(PALETTE_TOKENS.length)
    })

    test('every result is one of the resolved palette tokens, never an invented colour', () => {
        const resolved = new Set(
            PALETTE_TOKENS.map(t => `var(--${t})`),
        )
        for (let i = 0; i < 20; i++) {
            expect(resolved.has(autoCategoryColor(`n${i}`))).toBe(true)
        }
    })
})

describe('taskCategoryColors', () => {
    test('a declared colour wins over the auto-assigned one', () => {
        const colors = taskCategoryColors(['work'], [{ name: 'work', color: 'rose' }])
        expect(colors.get('work')).toBe('var(--rose)')
    })

    test('a declared colour tolerates a raw CSS value, not just a token', () => {
        const colors = taskCategoryColors(['work'], [{ name: 'work', color: '#e5484d' }])
        expect(colors.get('work')).toBe('#e5484d')
    })

    test('a name absent from declared still gets a colour', () => {
        const colors = taskCategoryColors(['home'], [{ name: 'work', color: 'rose' }])
        expect(colors.get('home')).toBe(autoCategoryColor('home'))
        expect(colors.has('home')).toBe(true)
    })

    test('undefined declared list still colours everything via auto-assignment', () => {
        const colors = taskCategoryColors(['a', 'b'], undefined)
        expect(colors.get('a')).toBe(autoCategoryColor('a'))
        expect(colors.get('b')).toBe(autoCategoryColor('b'))
    })

    test('every requested name is present in the map', () => {
        const names = ['a', 'b', 'c']
        const colors = taskCategoryColors(names, [{ name: 'b', color: 'teal' }])
        for (const n of names) expect(colors.has(n)).toBe(true)
    })
})
