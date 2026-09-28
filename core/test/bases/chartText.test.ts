import { describe, expect, test } from 'bun:test'
import {
    axisName,
    bucketReadout,
    chartCaption,
    formatValue,
    propName,
    valueAxisName,
} from '../../src/bases/chartText'
import type { ChartSpec } from '../../src/bases/chartLatex'

describe('propName', () => {
    test('strips note. prefix', () => {
        expect(propName('note.due')).toBe('due')
    })
    test('strips formula. prefix', () => {
        expect(propName('formula.ppu')).toBe('ppu')
    })
    test('strips file. prefix', () => {
        expect(propName('file.name')).toBe('name')
    })
    test('leaves a bare name as-is', () => {
        expect(propName('due')).toBe('due')
    })
})

describe('chartCaption', () => {
    test('sum by week of a date axis', () => {
        const spec: ChartSpec = {
            x: 'note.due',
            y: 'note.priority',
            aggregate: 'sum',
            bin: 'week',
            isDate: true,
        }
        expect(chartCaption(spec)).toBe('sum of priority by week of due')
    })

    test('count with no y', () => {
        const spec: ChartSpec = {
            x: 'note.due',
            aggregate: 'count',
            bin: 'week',
            isDate: true,
        }
        expect(chartCaption(spec)).toBe('count of notes by week of due')
    })

    test('avg by category axis', () => {
        const spec: ChartSpec = {
            x: 'note.status',
            y: 'note.priority',
            aggregate: 'avg',
            bin: 'day',
            isDate: false,
        }
        expect(chartCaption(spec)).toBe('average priority by status')
    })

    test('min with no x', () => {
        const spec: ChartSpec = {
            y: 'note.priority',
            aggregate: 'min',
            bin: 'day',
            isDate: false,
        }
        expect(chartCaption(spec)).toBe('min priority')
    })

    test('max by month of a date axis', () => {
        const spec: ChartSpec = {
            x: 'note.due',
            y: 'note.priority',
            aggregate: 'max',
            bin: 'month',
            isDate: true,
        }
        expect(chartCaption(spec)).toBe('max priority by month of due')
    })
})

describe('formatValue', () => {
    test('integer as-is', () => {
        expect(formatValue(3)).toBe('3')
    })
    test('non-integer to 1 decimal', () => {
        expect(formatValue(2.666)).toBe('2.7')
    })
})

describe('bucketReadout', () => {
    test('plural notes (no aggregate — legacy 3-arg call)', () => {
        expect(bucketReadout('Jul 20', 3, 2)).toEqual(['Jul 20', '3', '2 notes'])
    })
    test('singular note', () => {
        expect(bucketReadout('Jul 20', 3, 1)).toEqual(['Jul 20', '3', '1 note'])
    })
    test('non-integer value formatted to 1 decimal', () => {
        expect(bucketReadout('Jul 20', 2.666, 4)).toEqual([
            'Jul 20',
            '2.7',
            '4 notes',
        ])
    })
    test('count aggregate collapses value + note count into one part', () => {
        expect(bucketReadout('Doing', 2, 2, 'count')).toEqual(['Doing', '2 notes'])
    })
    test('count aggregate stays singular for one note', () => {
        expect(bucketReadout('Doing', 1, 1, 'count')).toEqual(['Doing', '1 note'])
    })
    test('non-count aggregate labels the value', () => {
        expect(bucketReadout('Jul 20', 5, 2, 'sum')).toEqual([
            'Jul 20',
            'sum 5',
            '2 notes',
        ])
    })
})

describe('axisName', () => {
    test('no x', () => {
        expect(axisName(undefined, false, 'day')).toBe('')
    })
    test('categorical x is just the prop name', () => {
        expect(axisName('note.status', false, 'day')).toBe('status')
    })
    test('date x carries its bin', () => {
        expect(axisName('note.due', true, 'week')).toBe('due (week)')
    })
})

describe('valueAxisName', () => {
    test('count reads notes', () => {
        expect(valueAxisName('count', undefined)).toBe('notes')
    })
    test('sum reads aggregate + prop name', () => {
        expect(valueAxisName('sum', 'note.priority')).toBe('sum priority')
    })
    test('no y falls back to just the aggregate word', () => {
        expect(valueAxisName('avg', undefined)).toBe('avg')
    })
})
