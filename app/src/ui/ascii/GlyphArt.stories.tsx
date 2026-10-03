// Visual spec for <GlyphArt> — a pure GlyphScene painted on the graph's cell grid by GlyphCanvas.
// The DEMO scene below is local to this file: it types `glyph art` on row 1, then runs a `.` across
// row 3 once typing is done. Frame 0 is therefore EMPTY on purpose, so `Frame0` can assert 0 inked
// pixels and every other story can assert > 0.
//
// Props: scene, active? (default true), at? (pin time, ms: one frame, no loop), label, className?.
// Canvas proof is pixels, never DOM — a blank <canvas> has the same DOM as a drawn one.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, Show } from 'solid-js'
import { expect, waitFor } from 'storybook/test'
import GlyphArt from './GlyphArt'
import {
    AMBIENT_FPS,
    putChar,
    putText,
    clearFrame,
    type GlyphFrame,
    type GlyphScene,
} from './glyphScene'

const meta = {
    title: 'UI/ASCII/GlyphArt',
    parameters: { layout: 'centered' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const WORD = 'glyph art'
const TYPE_MS = 80
const DEMO: GlyphScene = {
    cols: 24,
    rows: 5,
    revealMs: WORD.length * TYPE_MS + 180,
    frame(t: number, out: GlyphFrame) {
        clearFrame(out)
        putText(out, 7, 1, WORD.slice(0, Math.floor(t / TYPE_MS)), 'fg')
        if (t < DEMO.revealMs) return
        const step = Math.floor(((t - DEMO.revealMs) * AMBIENT_FPS) / 1000)
        putChar(out, step % DEMO.cols, 3, '.', 'accent')
    },
}

/** Fraction of the canvas's pixels with any ink (alpha > 0). */
const inked = (canvas: HTMLCanvasElement): number => {
    const d = canvas
        .getContext('2d')!
        .getImageData(0, 0, canvas.width, canvas.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n / (d.length / 4)
}

/** A hash of every pixel, so two reads of the same canvas can be compared. */
const signature = (canvas: HTMLCanvasElement): string => {
    const d = canvas
        .getContext('2d')!
        .getImageData(0, 0, canvas.width, canvas.height).data
    let h = 0
    for (let i = 0; i < d.length; i++) h = (Math.imul(h, 31) + d[i]) | 0
    return String(h)
}

const canvasIn = async (root: HTMLElement): Promise<HTMLCanvasElement> =>
    waitFor(() => {
        const c = root.querySelector('canvas')
        if (!c) throw new Error('no canvas mounted')
        return c
    })

const Box = (props: {
    w: number
    h: number
    children: import('solid-js').JSX.Element
}) => (
    <div style={{ width: `${props.w}px`, height: `${props.h}px` }}>
        {props.children}
    </div>
)

/** t = 0: nothing typed yet, so the canvas is empty. */
export const Frame0: Story = {
    render: () => (
        <Box w={600} h={288}>
            <GlyphArt scene={DEMO} at={0} label="glyph art, frame 0" />
        </Box>
    ),
    play: async ({ canvasElement }) => {
        const canvas = await canvasIn(canvasElement)
        await expect(inked(canvas)).toBe(0)
    },
}

/** t = revealMs: the whole phrase typed, the `.` at the start of its run. */
export const Revealed: Story = {
    render: () => (
        <Box w={600} h={288}>
            <GlyphArt
                scene={DEMO}
                at={DEMO.revealMs}
                label="glyph art, revealed"
            />
        </Box>
    ),
    play: async ({ canvasElement }) => {
        const canvas = await canvasIn(canvasElement)
        await waitFor(() => expect(inked(canvas)).toBeGreaterThan(0))
    },
}

/** No `at`: the live loop. Types the phrase, then the `.` runs. */
export const Live: Story = {
    render: () => (
        <Box w={600} h={288}>
            <GlyphArt scene={DEMO} label="glyph art, live" />
        </Box>
    ),
    play: async ({ canvasElement }) => {
        const canvas = await canvasIn(canvasElement)
        await waitFor(() => expect(inked(canvas)).toBeGreaterThan(0), {
            timeout: 3000,
        })
    },
}

/** `active: false` with no pin: the loop is off, so the canvas holds one still image. */
export const Inactive: Story = {
    render: () => (
        <Box w={600} h={288}>
            <GlyphArt scene={DEMO} active={false} label="glyph art, inactive" />
        </Box>
    ),
    play: async ({ canvasElement }) => {
        const canvas = await canvasIn(canvasElement)
        const before = signature(canvas)
        // Let a few ambient ticks' worth of time pass; an inactive canvas must not repaint.
        const start = performance.now()
        await waitFor(() =>
            expect(performance.now() - start).toBeGreaterThanOrEqual(400),
        )
        await expect(signature(canvas)).toBe(before)
    },
}

/** A box smaller than the scene: the cells shrink to fit, the scene stays centred. */
export const Compact: Story = {
    render: () => (
        <Box w={120} h={60}>
            <GlyphArt
                scene={DEMO}
                at={DEMO.revealMs}
                label="glyph art, compact"
            />
        </Box>
    ),
    play: async ({ canvasElement }) => {
        const canvas = await canvasIn(canvasElement)
        await waitFor(() => expect(inked(canvas)).toBeGreaterThan(0))
    },
}

/** A theme change recolours the ink: overriding --fg changes the canvas's pixels. */
export const ThemeSwitch: Story = {
    render: () => (
        <Box w={600} h={288}>
            <GlyphArt
                scene={DEMO}
                at={DEMO.revealMs}
                label="glyph art, theme switch"
            />
        </Box>
    ),
    play: async ({ canvasElement }) => {
        const root = document.documentElement
        const prior = root.style.getPropertyValue('--fg')
        try {
            const canvas = await canvasIn(canvasElement)
            await waitFor(() => expect(inked(canvas)).toBeGreaterThan(0))
            const before = signature(canvas)
            root.style.setProperty('--fg', '#ff0000')
            await waitFor(() => expect(signature(canvas)).not.toBe(before))
        } finally {
            if (prior) root.style.setProperty('--fg', prior)
            else root.style.removeProperty('--fg')
        }
    },
}

const [mounted, setMounted] = createSignal(true)

/** Unmounting stops the loop: no requestAnimationFrame is requested after the canvas is gone. */
export const Remount: Story = {
    render: () => {
        setMounted(true)
        return (
            <Box w={600} h={288}>
                <Show when={mounted()}>
                    <GlyphArt scene={DEMO} label="glyph art, remount" />
                </Show>
            </Box>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = await canvasIn(canvasElement)
        await waitFor(() => expect(inked(canvas)).toBeGreaterThan(0), {
            timeout: 3000,
        })
        const real = window.requestAnimationFrame
        let before = 0
        let after = 0
        let removed = false
        window.requestAnimationFrame = cb => {
            if (cb.name === 'tick') removed ? after++ : before++
            return real.call(window, cb)
        }
        try {
            await waitFor(() => expect(before).toBeGreaterThan(0))
            setMounted(false)
            await waitFor(() =>
                expect(canvasElement.querySelector('canvas')).toBeNull(),
            )
            removed = true
            const start = performance.now()
            await waitFor(() =>
                expect(performance.now() - start).toBeGreaterThanOrEqual(300),
            )
            await expect(after).toBe(0)
        } finally {
            window.requestAnimationFrame = real
            setMounted(true)
        }
    },
}
