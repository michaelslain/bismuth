import { describe, expect, test } from 'bun:test'
import { findBlockLines, noteSection, stripBlockIds } from '../src/noteSection'

const BODY = [
    '# Bread',
    '',
    'A plain loaf.',
    '',
    '## Dough',
    '',
    'Mix flour.',
    '',
    '### Resting',
    '',
    'Leave it.',
    '',
    '```md',
    '## Not a heading',
    'code ^not-an-id',
    '```',
    '',
    '## Baking',
    '',
    'Bake at 230',
    'for forty minutes. ^bake-time',
    '',
    '- score the top',
    '- steam the oven ^steam',
    '    - with a tray',
    '- cool on a rack',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '^table-id',
].join('\n')

describe('noteSection', () => {
    test('a heading runs to the next heading of the same or higher level', () => {
        const s = noteSection(BODY, 'Dough')!
        expect(s.startsWith('## Dough')).toBe(true)
        expect(s).toContain('### Resting')
        expect(s).toContain('Leave it.')
        expect(s).toContain('## Not a heading') // fenced, so it does not end the section
        expect(s).not.toContain('## Baking')
    })
    test('heading match ignores case and spacing', () => {
        expect(noteSection(BODY, '  resting ')).toBe(
            ['### Resting', '', 'Leave it.', '', '```md', '## Not a heading', 'code ^not-an-id', '```'].join('\n'),
        )
    })
    test('a paragraph block, all its lines, without the id', () => {
        expect(noteSection(BODY, '^bake-time')).toBe('Bake at 230\nfor forty minutes.')
    })
    test('a list item block takes its nested lines', () => {
        expect(noteSection(BODY, '^steam')).toBe('- steam the oven\n    - with a tray')
    })
    test('an id alone on its line names the block above it', () => {
        expect(noteSection(BODY, '^table-id')).toBe('| a | b |\n| - | - |\n| 1 | 2 |')
    })
    test('an id inside a code block is not a block', () => {
        expect(noteSection(BODY, '^not-an-id')).toBeNull()
    })
    test('a heading path finds the child inside the parent', () => {
        expect(noteSection(BODY, 'Dough#Resting')!.startsWith('### Resting')).toBe(true)
        expect(noteSection(BODY, 'Baking#Resting')).toBeNull()
    })
    test('an id straight after an embed names that line', () => {
        expect(noteSection('Text.\n\n![[shot.png]]^shot\n', '^shot')).toBe('![[shot.png]]')
    })
    test('nothing matching is null', () => {
        expect(noteSection(BODY, 'Nope')).toBeNull()
        expect(noteSection(BODY, '^nope')).toBeNull()
    })
})

describe('stripBlockIds', () => {
    test('drops trailing and standalone ids, leaves code alone', () => {
        const out = stripBlockIds(BODY)
        expect(out).not.toContain('^bake-time')
        expect(out).not.toContain('^steam')
        expect(out).not.toContain('^table-id')
        expect(out).toContain('code ^not-an-id')
        expect(out).toContain('- steam the oven\n')
    })
    test('a caret mid-line is not an id', () => {
        expect(stripBlockIds('2^10 is big')).toBe('2^10 is big')
    })
})

describe('findBlockLines', () => {
    const lines = BODY.split('\n')
    test('the line range of a block, with or without the caret', () => {
        expect(findBlockLines(lines, '^bake-time')).toEqual({ from: 19, to: 21 })
        expect(findBlockLines(lines, 'steam')).toEqual({ from: 23, to: 25 })
    })
    test('an unknown id is null', () => {
        expect(findBlockLines(lines, '^nope')).toBeNull()
    })
})
