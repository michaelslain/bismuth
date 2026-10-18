import { test, expect, beforeEach } from 'bun:test'
import { recordBlock } from './blockHeightRecorder'
import {
    blockHeightKey,
    clearBlockHeights,
    estimateBlockHeight,
} from './blockHeights'

const view = { defaultLineHeight: 22 }
const key = blockHeightKey('table', 'rows')
const widget = (estimatedHeight: number, heightUnits?: number) =>
    ({ heightKey: key, heightUnits, estimatedHeight }) as never

beforeEach(clearBlockHeights)

test('a measured block widget is stored under its key', () => {
    recordBlock(view, { type: 0 as never, widget: widget(-1), height: 812 })
    expect(estimateBlockHeight(key)).toBe(812)
})

test('an unmeasured block (height still equals its estimate) is not stored', () => {
    // estimate -1 → CodeMirror sized it as one default line
    recordBlock(view, { type: 0 as never, widget: widget(-1), height: 22 })
    expect(estimateBlockHeight(key)).toBe(-1)
    // a per-unit fallback guess must not become a remembered height either
    recordBlock(view, { type: 0 as never, widget: widget(500), height: 500 })
    expect(estimateBlockHeight(key)).toBe(-1)
})

test('a widget without a heightKey, or no widget, is ignored', () => {
    recordBlock(view, {
        type: 0 as never,
        widget: { estimatedHeight: -1 } as never,
        height: 300,
    })
    recordBlock(view, { type: 0 as never, widget: null, height: 300 })
    expect(estimateBlockHeight(key)).toBe(-1)
})

test('blocks nested in a composite line block are recorded', () => {
    recordBlock(view, {
        type: [{ type: 0, widget: widget(-1, 10), height: 400 }] as never,
        widget: null,
        height: 400,
    })
    expect(estimateBlockHeight(key)).toBe(400)
    expect(estimateBlockHeight(blockHeightKey('table', 'other'), 5)).toBe(200)
})
