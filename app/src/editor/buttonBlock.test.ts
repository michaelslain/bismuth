import { describe, expect, test } from 'bun:test'
import { EditorState } from '@codemirror/state'
import { scanButtonFences } from '../../../core/src/buttons/buttonBlock'
import { buttonRanges, locateButtonBlock } from './buttonBlock'

const fence = (body: string) => '```button\n' + body + '\n```'
const stateOf = (doc: string) => EditorState.create({ doc })

describe('buttonBlock ranges', () => {
    test('finds closed button fences with their bodies', () => {
        const doc = `intro\n\n${fence('{"a":1}')}\n\nafter`
        const r = buttonRanges(stateOf(doc))
        expect(r).toHaveLength(1)
        expect(r[0]!.body).toBe('{"a":1}')
        expect(doc.slice(r[0]!.from, r[0]!.to)).toBe(fence('{"a":1}'))
    })

    test('ignores other fences and unclosed button fences', () => {
        expect(buttonRanges(stateOf('```js\nbutton\n```'))).toEqual([])
        expect(buttonRanges(stateOf('```button\nnever closed'))).toEqual([])
        expect(buttonRanges(stateOf('no fences here'))).toEqual([])
    })

    test('adjacent fences locate independently', () => {
        const doc = `${fence('one')}\n${fence('two')}`
        const r = buttonRanges(stateOf(doc))
        expect(r).toHaveLength(2)
        expect(locateButtonBlock(r, r[0]!.from)).toBe(0)
        expect(locateButtonBlock(r, r[1]!.from)).toBe(1)
        expect(locateButtonBlock(r, r[0]!.to)).toBe(0)
    })

    test('an unrelated position locates nothing', () => {
        const doc = `text\n\n${fence('x')}`
        expect(locateButtonBlock(buttonRanges(stateOf(doc)), 1)).toBe(-1)
    })
})

describe('buttonBlock body equals core scanButtonFences body', () => {
    const bodies = (raw: string) => ({
        widget: buttonRanges(stateOf(raw)).map(r => r.body),
        core: scanButtonFences(raw).map(r => r.body),
    })

    test('a fence nested in a list item keeps its indentation', () => {
        const raw = '- item\n  ```button\n  label: A\n  send: hi\n  ```\n- next'
        const { widget, core } = bodies(raw)
        expect(core).toHaveLength(1)
        expect(widget).toEqual(core)
        expect(widget[0]).toBe('  label: A\n  send: hi')
    })

    test('a CRLF document has no CR and no trailing newline in the body', () => {
        const raw = 'intro\r\n```button\r\nlabel: A\r\nsend: hi\r\n```\r\nafter'
        const { widget, core } = bodies(raw)
        expect(widget).toEqual(core)
        expect(widget[0]).toBe('label: A\nsend: hi')
    })
})
