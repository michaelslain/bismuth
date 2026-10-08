import { test, expect } from 'bun:test'
import {
    emptyDoc,
    serializeDoc,
    parseDocOrEmpty,
} from '../../../core/src/drawing/model'

test('a 0-byte or whitespace .draw is a blank doc, not a parse error', () => {
    expect(parseDocOrEmpty('')).toEqual(emptyDoc())
    expect(parseDocOrEmpty('  \n')).toEqual(emptyDoc())
})

test('a serialized doc still parses', () => {
    expect(parseDocOrEmpty(serializeDoc(emptyDoc()))).toEqual(emptyDoc())
})
