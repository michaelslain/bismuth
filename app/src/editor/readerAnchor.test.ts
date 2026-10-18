import { test, expect } from 'bun:test'
import { mapReaderAnchor } from './readerAnchor'

const doc = (lines: string[]) => lines.join('\n')
const at = (text: string, line: string) => text.indexOf(line)

const before = doc(['# Title', '', 'one', 'two', 'three', 'four', 'five'])

test('a line before the change keeps its position', () => {
    const after = doc(['# Title', '', 'one', 'two', 'three', 'four', 'FIVE'])
    expect(mapReaderAnchor(before, after, at(before, 'two'))).toBe(
        at(after, 'two'),
    )
})

test('a line after the change shifts by the change’s length', () => {
    const after = doc([
        '# Title',
        '',
        'zero',
        'zero',
        'one',
        'two',
        'three',
        'four',
        'five',
    ])
    expect(mapReaderAnchor(before, after, at(before, 'four'))).toBe(
        at(after, 'four'),
    )
})

test('a line inside a rewritten span finds the same line in the rewrite', () => {
    // the change spans 'one'..'five' (first and last lines differ), 'three' sits inside it
    const after = doc([
        '# Title',
        '',
        'ONE',
        'two',
        'inserted',
        'three',
        'four',
        'FIVE',
    ])
    expect(mapReaderAnchor(before, after, at(before, 'three'))).toBe(
        at(after, 'three'),
    )
})

test('a repeated line resolves to the copy nearest its proportional place', () => {
    const b = doc(['A', 'x', 'x', 'x', 'x', 'Z'])
    const a = doc(['a', 'x', 'x', 'x', 'x', 'z'])
    const third = b.indexOf('x', b.indexOf('x', b.indexOf('x') + 1) + 1)
    const thirdAfter = a.indexOf('x', a.indexOf('x', a.indexOf('x') + 1) + 1)
    expect(mapReaderAnchor(b, a, third)).toBe(thirdAfter)
})

test('a line that no longer exists maps to the line at the same proportion', () => {
    const b = doc(['head', 'aaaa', 'bbbb', 'cccc', 'tail'])
    const a = doc(['head', 'wwww', 'xxxx', 'yyyy', 'tail'])
    expect(mapReaderAnchor(b, a, at(b, 'bbbb'))).toBe(at(a, 'xxxx'))
})

test('a substring match that is not a whole line is not taken', () => {
    const b = doc(['h', 'ab', 'q', 't'])
    const a = doc(['H', 'xxab', 'Q', 'ab', 'T'])
    expect(mapReaderAnchor(b, a, at(b, 'ab'))).toBe(a.lastIndexOf('ab'))
})
