import { expect, test } from 'bun:test'
import {
    frameFade,
    growKeyframes,
    parseDuration,
    relativeBox,
    viewFade,
} from './takeoverMotion'

const origin = { left: 100, top: 50 }

test('relativeBox moves a viewport rect into the container', () => {
    expect(
        relativeBox({ left: 400, top: 80, width: 300, height: 120 }, origin),
    ).toEqual({
        left: 300,
        top: 30,
        width: 300,
        height: 120,
    })
})

test('growKeyframes runs from the source box to the resting rect', () => {
    const k = growKeyframes(
        { left: 900, top: 70, width: 400, height: 160 },
        { left: 112, top: 62, width: 1200, height: 700 },
        origin,
    )
    expect(k).toEqual([
        { left: '800px', top: '20px', width: '400px', height: '160px' },
        { left: '12px', top: '12px', width: '1200px', height: '700px' },
    ])
})

test('the frame fades in early and out late; the view the other way round', () => {
    expect(frameFade(false)).toEqual([
        { opacity: 0 },
        { opacity: 1, offset: 0.3 },
        { opacity: 1 },
    ])
    expect(frameFade(true)).toEqual([
        { opacity: 1 },
        { opacity: 1, offset: 0.7 },
        { opacity: 0 },
    ])
    expect(viewFade(false)).toEqual([
        { opacity: 0 },
        { opacity: 0, offset: 0.7 },
        { opacity: 1 },
    ])
    expect(viewFade(true)).toEqual([
        { opacity: 1 },
        { opacity: 0, offset: 0.35 },
        { opacity: 0 },
    ])
})

test('parseDuration reads ms and s, falls back otherwise', () => {
    expect(parseDuration('200ms', 1)).toBe(200)
    expect(parseDuration(' 0.2s ', 1)).toBe(200)
    expect(parseDuration('', 180)).toBe(180)
    expect(parseDuration('fast', 180)).toBe(180)
})
