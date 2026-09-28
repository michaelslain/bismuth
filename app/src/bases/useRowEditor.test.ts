import { expect, test } from 'bun:test'
import type { BaseConfig, Row, ViewConfig } from '../../../core/src/bases/types'
import { placeholderFile } from '../../../core/src/bases/types'
import { useRowEditor } from './useRowEditor'

const row = (over: Partial<Row>): Row => ({
    file: placeholderFile('a', 'a.md'),
    note: {},
    formula: {},
    ...over,
})

const editor = useRowEditor({
    config: () => ({}) as BaseConfig,
    view: () => ({ type: 'table' }) as ViewConfig,
})

test('a note row is editable', () => {
    expect(editor.editable(row({}))).toBe(true)
})

test('a stored row is editable', () => {
    expect(editor.editable(row({ index: 0, note: { title: 'x' } }))).toBe(true)
})

test('a task-line row is not editable', () => {
    expect(editor.editable(row({ note: { line: 12 } }))).toBe(false)
})

test('a pending placeholder is not editable', () => {
    expect(editor.editable(row({ index: -1 }))).toBe(false)
})
