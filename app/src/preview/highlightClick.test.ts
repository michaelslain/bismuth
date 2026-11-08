import { describe, expect, test } from 'bun:test'
import { isClick, singleClick } from './highlightClick'

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('singleClick', () => {
    test('runs once the window passes with no second press', async () => {
        let ran = 0
        const c = singleClick(20)
        c.press()
        c.schedule(() => ran++)
        expect(c.pending()).toBe(true)
        await wait(40)
        expect(ran).toBe(1)
        expect(c.pending()).toBe(false)
    })

    test('a double-click and a triple-click never run it', async () => {
        let ran = 0
        let t = 0
        const c = singleClick(20, () => t)
        for (const at of [0, 5, 10]) {
            t = at
            c.press()
            c.schedule(() => ran++)
        }
        await wait(40)
        expect(ran).toBe(0)
    })

    test('a lone click after a pause runs again', async () => {
        let ran = 0
        let t = 0
        const c = singleClick(20, () => t)
        c.press()
        c.schedule(() => ran++)
        await wait(40)
        t = 1000
        c.press()
        c.schedule(() => ran++)
        await wait(40)
        expect(ran).toBe(2)
    })
})

describe('isClick', () => {
    test('a release within the slop is a click; past it is a drag', () => {
        expect(isClick({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(true)
        expect(isClick({ x: 10, y: 10 }, { x: 40, y: 10 })).toBe(false)
    })
})
