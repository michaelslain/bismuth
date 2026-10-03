import { describe, expect, test } from 'bun:test'
import { afterClose, afterToggle } from './appModal'

describe('afterClose', () => {
    test('closes the modal that is showing', () => {
        expect(afterClose('command', 'command')).toBe(null)
    })
    test("a replaced modal's late close leaves the new one open", () => {
        expect(afterClose('folder', 'command')).toBe('folder')
    })
    test('closing with nothing open stays closed', () => {
        expect(afterClose(null, 'switcher')).toBe(null)
    })
})

describe('afterToggle', () => {
    test('toggling the open modal closes it', () => {
        expect(afterToggle('switcher', 'switcher')).toBe(null)
    })
    test('toggling another modal replaces the open one', () => {
        expect(afterToggle('switcher', 'command')).toBe('command')
        expect(afterToggle('command', 'switcher')).toBe('switcher')
    })
    test('toggling from nothing opens it', () => {
        expect(afterToggle(null, 'template')).toBe('template')
    })
})
