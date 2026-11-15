import { describe, expect, test } from 'bun:test'
import type { BaseConfig } from '../../../core/src/bases/types'
import { columnLabel } from './columnLabel'

const config = (properties: BaseConfig['properties']): BaseConfig => ({
    properties,
    view: { type: 'table' },
})

describe('columnLabel', () => {
    test('a displayName declared under the bare name labels the note column', () => {
        expect(columnLabel('note.exercise', config({ exercise: { displayName: 'Workout' } }))).toBe('Workout')
    })
    test('a displayName declared under the note. name labels the bare column', () => {
        expect(columnLabel('price', config({ 'note.price': { displayName: 'Price (USD)' } }))).toBe('Price (USD)')
    })
    test('an exact match wins', () => {
        expect(
            columnLabel('note.price', config({ 'note.price': { displayName: 'A' }, price: { displayName: 'B' } })),
        ).toBe('A')
    })
    test('no declaration falls back to the id without its prefix', () => {
        expect(columnLabel('note.price', config({}))).toBe('price')
        expect(columnLabel('file.name', config({ name: { displayName: 'X' } }))).toBe('name')
    })
})
