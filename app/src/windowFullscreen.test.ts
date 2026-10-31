import { expect, test } from 'bun:test'
import { trackFullscreen } from './windowFullscreen'

function fakeWindow(initial: boolean) {
    let full = initial
    let handler: (() => void) | undefined
    let unlistened = false
    return {
        win: {
            isFullscreen: async () => full,
            onResized: async (h: () => void) => {
                handler = h
                return () => {
                    unlistened = true
                }
            },
        },
        resize(to: boolean) {
            full = to
            handler?.()
        },
        unlistened: () => unlistened,
    }
}

test('reports the initial state, then every resize', async () => {
    const w = fakeWindow(false)
    const seen: boolean[] = []
    const unlisten = await trackFullscreen(w.win, v => seen.push(v))
    expect(seen).toEqual([false])
    w.resize(true)
    await Bun.sleep(0)
    w.resize(false)
    await Bun.sleep(0)
    expect(seen).toEqual([false, true, false])
    unlisten()
    expect(w.unlistened()).toBe(true)
})

test('starts fullscreen when the window opens fullscreen', async () => {
    const seen: boolean[] = []
    await trackFullscreen(fakeWindow(true).win, v => seen.push(v))
    expect(seen).toEqual([true])
})
