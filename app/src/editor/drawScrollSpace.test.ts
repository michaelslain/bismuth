// app/src/editor/drawScrollSpace.test.ts
//
// The pure half of draw mode's endless scroll space (drawScrollSpace.ts's `nextScrollPad`).
// The DOM half — that the scroller actually grows, regenerates, and snaps back on exit — is
// NOT testable here: happy-dom has no layout engine, so `clientHeight`/`scrollHeight`/
// `getBoundingClientRect()` all read back zero regardless of what is styled (drawBlock.test.ts
// says the same thing at its `expect(first.style.height).toBe('')` assertion). Those live in
// Editor.stories.tsx's `DrawModeScrollSpace` play, which runs in a real browser under
// bench/playCheck.ts.
import { describe, expect, test } from 'bun:test'
import { CONTENT_PAD_BOTTOM, nextScrollPad } from './drawScrollSpace'

// A tall note: the last line ends 5000px down (bottom = docHeight + paddingTop), in a 700px
// viewport. `pad` is always the TOTAL padding-bottom, so it starts at the theme's own value.
const tall = (over: Partial<Parameters<typeof nextScrollPad>[0]> = {}) => ({
    viewport: 700,
    scrollTop: 0,
    bottom: 5000,
    pad: CONTENT_PAD_BOTTOM,
    ...over,
})

describe('nextScrollPad', () => {
    test('entering gives a full viewport of scroll past the end of the note', () => {
        // natural extent = bottom + the theme's own trailing pad = 5080. One screenful more.
        expect(nextScrollPad(tall())).toBe(5780 - 5000)
    })

    test('a note shorter than the viewport still gets a full viewport of scroll', () => {
        // The note ends at 300px in a 700px viewport, so its natural scrollHeight is CLAMPED to
        // 700 and it does not scroll at all today. "One screenful below the end" has to be
        // measured against that clamp, not against the 380px the content occupies — otherwise a
        // short note gets 80px of scroll instead of a screenful.
        const pad = nextScrollPad(tall({ bottom: 300 }))
        expect(pad).toBe(1100)
        expect(300 + pad).toBe(1400) // scrollHeight = natural (700) + one viewport
    })

    test('scrolling into the space regenerates more of it, twice in a row', () => {
        // Round 1: entering.
        const p1 = nextScrollPad(tall())
        expect(5000 + p1).toBe(5780)
        // Scroll to the very bottom of what round 1 produced.
        // A full screenful past the bottom of what is now on screen (5080 + 700 + 700).
        const p2 = nextScrollPad(tall({ pad: p1, scrollTop: 5780 - 700 }))
        expect(p2).toBeGreaterThan(p1)
        expect(5000 + p2).toBe(6480)
        // …and again from the new bottom.
        const p3 = nextScrollPad(tall({ pad: p2, scrollTop: 6480 - 700 }))
        expect(p3).toBeGreaterThan(p2)
        expect(5000 + p3).toBe(7180)
    })

    test('always keeps a full viewport of unreached space ahead of the scroll position', () => {
        let pad = CONTENT_PAD_BOTTOM
        for (let i = 0; i < 12; i++) {
            const scrollHeight = 5000 + pad
            const scrollTop = scrollHeight - 700 // pinned to the bottom
            pad = nextScrollPad(tall({ pad, scrollTop }))
            expect(5000 + pad - (scrollTop + 700)).toBeGreaterThanOrEqual(700)
        }
    })

    test('is a fixed point — re-running on its own output changes nothing', () => {
        // Load-bearing: the plugin recomputes on every geometry change, and its own padding
        // write IS a geometry change. A non-idempotent rule would grow without bound on a
        // motionless editor and trip CodeMirror at "Measure loop restarted more than 5 times".
        const once = nextScrollPad(tall())
        expect(nextScrollPad(tall({ pad: once }))).toBe(once)
        const short = nextScrollPad(tall({ bottom: 300 }))
        expect(nextScrollPad(tall({ bottom: 300, pad: short }))).toBe(short)
    })

    test('never shrinks while draw mode is on', () => {
        // Scrolling back up must not yank the scrollbar back — the space the user already
        // reached stays reachable until they leave draw mode.
        const deep = nextScrollPad(tall({ scrollTop: 12000, pad: 3000 }))
        expect(nextScrollPad(tall({ scrollTop: 0, pad: deep }))).toBe(deep)
    })

    test('a note that grows under the pen keeps the space already opened', () => {
        // Committing ink lengthens the document. Stated exactly, because the interesting half is
        // the one a `toBeGreaterThanOrEqual` would sleep through: the end-of-note floor alone
        // would hand back 780 for this note, and the 900 the user had already scrolled open has
        // to survive the document getting longer under them.
        expect(nextScrollPad(tall({ pad: 900, bottom: 5600 }))).toBe(900)
    })

    test('an unmeasured editor is left exactly as it is', () => {
        // The hazard is not merely "viewport is 0" — it is that a pane hidden with `display: none`
        // reports `clientHeight` 0 and a `contentHeight` of 0 WHILE KEEPING the `scrollTop` it had
        // when it was visible. Ungoverned, the scroll floor then reads that live scrollTop against
        // a note that appears to be zero lines long and demands the whole thing as padding.
        expect(
            nextScrollPad({
                viewport: 0,
                scrollTop: 3000,
                bottom: 0,
                pad: 900,
            }),
        ).toBe(900)
        expect(nextScrollPad(tall({ viewport: 0 }))).toBe(CONTENT_PAD_BOTTOM)
    })
})
