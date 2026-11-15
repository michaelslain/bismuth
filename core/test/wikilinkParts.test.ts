import { describe, expect, test } from 'bun:test'
import { splitWikilinkInner } from '../src/wikilinkParts'

describe('splitWikilinkInner', () => {
    test('plain target', () => {
        expect(splitWikilinkInner('Note')).toEqual({ target: 'Note' })
    })
    test('target, anchor and alias', () => {
        expect(splitWikilinkInner('Folder/Note#Some Heading|Shown')).toEqual({
            target: 'Folder/Note',
            anchor: 'Some Heading',
            alias: 'Shown',
        })
    })
    test('a table-escaped pipe separates like a bare one', () => {
        expect(splitWikilinkInner('Note\\|Alias')).toEqual({ target: 'Note', alias: 'Alias' })
        expect(splitWikilinkInner('Note#^block\\|Alias')).toEqual({
            target: 'Note',
            anchor: '^block',
            alias: 'Alias',
        })
        expect(splitWikilinkInner('image.png\\|100')).toEqual({ target: 'image.png', alias: '100' })
    })
    test('a backslash with no pipe after it stays in the target', () => {
        expect(splitWikilinkInner('odd\\name').target).toBe('odd\\name')
    })
})
