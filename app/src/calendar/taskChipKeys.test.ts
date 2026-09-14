import { test, expect } from 'bun:test'
import { chipKeyAction, taskKey } from './taskChipKeys'
import type { Row } from '../../../core/src/bases/types'

const k = (key: string, mods: Partial<{ altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
    key,
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    ...mods,
})

test('enter opens, space toggles', () => {
    expect(chipKeyAction(k('Enter'))).toEqual({ kind: 'open' })
    expect(chipKeyAction(k(' '))).toEqual({ kind: 'toggle' })
})

test('the status menu opens from the context-menu key or shift+f10', () => {
    expect(chipKeyAction(k('ContextMenu'))).toEqual({ kind: 'menu' })
    expect(chipKeyAction(k('F10', { shiftKey: true }))).toEqual({ kind: 'menu' })
    expect(chipKeyAction(k('F10'))).toBeNull()
})

test('alt+arrows reschedule by a day horizontally and a week vertically', () => {
    expect(chipKeyAction(k('ArrowLeft', { altKey: true }))).toEqual({ kind: 'reschedule', days: -1 })
    expect(chipKeyAction(k('ArrowRight', { altKey: true }))).toEqual({ kind: 'reschedule', days: 1 })
    expect(chipKeyAction(k('ArrowUp', { altKey: true }))).toEqual({ kind: 'reschedule', days: -7 })
    expect(chipKeyAction(k('ArrowDown', { altKey: true }))).toEqual({ kind: 'reschedule', days: 7 })
})

test('bare arrows, ctrl or meta combos, and alt+enter do nothing', () => {
    expect(chipKeyAction(k('ArrowRight'))).toBeNull()
    expect(chipKeyAction(k('Enter', { metaKey: true }))).toBeNull()
    expect(chipKeyAction(k('ArrowRight', { altKey: true, ctrlKey: true }))).toBeNull()
    expect(chipKeyAction(k('Enter', { altKey: true }))).toBeNull()
    expect(chipKeyAction(k('a'))).toBeNull()
})

test('a task key is its file path and line', () => {
    const row = { file: { path: 'Sprint.md' }, note: { line: 7 } } as unknown as Row
    expect(taskKey(row)).toBe('Sprint.md:7')
})
