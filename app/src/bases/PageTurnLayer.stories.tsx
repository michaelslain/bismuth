// Visual spec for <PageTurnLayer> — the WebGL page curl. Faces are canvases drawn here (typeset
// book pages from _bookPages.ts) so every story is deterministic; `data-turn-state` is the settled seam.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, waitFor } from 'storybook/test'
import PageTurnLayer from './PageTurnLayer'
import { bookPage } from './_bookPages'

const PAGE_W = 320
const PAGE_H = 440

const meta = {
    title: 'Bases/PageTurnLayer',
    component: PageTurnLayer,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof PageTurnLayer>

export default meta
type Story = StoryObj<typeof meta>


/** A typeset book page in the theme's background and ink. */
const face = (n: number): HTMLCanvasElement => bookPage(n, { w: PAGE_W, h: PAGE_H })

const faces = (l: number) => ({ left: face(l), right: face(l + 1) })

const SPREAD_W = PAGE_W * 2

/** Pointer x (layer px) that puts a forward spread turn at `p`. */
const forwardDrag = (p: number) => ({ x: PAGE_W + PAGE_W - 2 * PAGE_W * p, y: PAGE_H * 0.7 })

/** Counts pixels in the right half that match neither flat spread (from or to). */
function inkedPct(layer: HTMLElement): number {
    const gl = layer.querySelector('canvas')!
    const W = 160
    const H = 220
    const sample = (draw: (g: CanvasRenderingContext2D) => void) => {
        const c = document.createElement('canvas')
        c.width = W * 2
        c.height = H
        const g = c.getContext('2d')!
        draw(g)
        return g.getImageData(W, 0, W, H).data
    }
    const got = sample(g => g.drawImage(gl, 0, 0, W * 2, H))
    const flatFrom = sample(g => g.drawImage(fromFlat, 0, 0, W * 2, H))
    const flatTo = sample(g => g.drawImage(toFlat, 0, 0, W * 2, H))
    let inked = 0
    for (let i = 0; i < got.length; i += 4) {
        const dFrom = Math.abs(got[i] - flatFrom[i]) + Math.abs(got[i + 1] - flatFrom[i + 1]) + Math.abs(got[i + 2] - flatFrom[i + 2])
        const dTo = Math.abs(got[i] - flatTo[i]) + Math.abs(got[i + 1] - flatTo[i + 1]) + Math.abs(got[i + 2] - flatTo[i + 2])
        if (dFrom > 24 && dTo > 24) inked++
    }
    return (inked / (W * H)) * 100
}

function flatSpread(l: number): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = SPREAD_W
    c.height = PAGE_H
    const g = c.getContext('2d')!
    g.drawImage(face(l), 0, 0, PAGE_W, PAGE_H)
    g.drawImage(face(l + 1), PAGE_W, 0, PAGE_W, PAGE_H)
    return c
}
const fromFlat = flatSpread(2)
const toFlat = flatSpread(4)

const noop = () => {}

const staticStory = (p: number): Story => ({
    render: () => (
        <PageTurnLayer
            width={SPREAD_W}
            height={PAGE_H}
            layout="spread"
            direction="forward"
            from={faces(2)}
            to={faces(4)}
            drag={forwardDrag(p)}
            onSettled={noop}
        />
    ),
    play: async ({ canvasElement }) => {
        const layer = canvasElement.querySelector<HTMLElement>('[data-turn-state]')!
        await waitFor(() => expect(layer.dataset.turnState).toBe('turning'))
        expect(inkedPct(layer)).toBeGreaterThan(0)
    },
})

export const StaticAt03: Story = staticStory(0.3)
export const StaticAt05: Story = staticStory(0.5)
export const StaticAt08: Story = staticStory(0.8)

const autoStory = (direction: 'forward' | 'back'): Story => ({
    render: () => {
        const [committed, setCommitted] = createSignal<boolean | null>(null)
        return (
            <div data-committed={String(committed())}>
                <PageTurnLayer
                    width={SPREAD_W}
                    height={PAGE_H}
                    layout="spread"
                    direction={direction}
                    from={faces(2)}
                    to={faces(4)}
                    drag={null}
                    durationMs={300}
                    onSettled={setCommitted}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const layer = canvasElement.querySelector<HTMLElement>('[data-turn-state]')!
        await waitFor(() => expect(layer.dataset.turnState).toBe('settled'), { timeout: 4000 })
        expect(canvasElement.querySelector<HTMLElement>('[data-committed]')!.dataset.committed).toBe('true')
    },
})

export const AutoForward: Story = autoStory('forward')
export const AutoBack: Story = autoStory('back')

/** Solid-colour page, so a pixel sample says which spread the layer painted. */
function solid(color: string): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 88
    const g = c.getContext('2d')!
    g.fillStyle = color
    g.fillRect(0, 0, 64, 88)
    return c
}

function portraitSolid(color: string): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = 100
    c.height = 200
    const g = c.getContext('2d')!
    g.fillStyle = color
    g.fillRect(0, 0, 100, 200)
    return c
}

/** At progress 0 with no curl the layer shows the spread it starts from, not the one it reveals. */
export const FlatAtZeroShowsFrom: Story = {
    render: () => (
        <PageTurnLayer
            width={SPREAD_W}
            height={PAGE_H}
            layout="spread"
            direction="forward"
            from={{ left: solid('#c00000'), right: solid('#c00000') }}
            to={{ left: solid('#0000c0'), right: solid('#0000c0') }}
            drag={{ x: SPREAD_W, y: PAGE_H * 0.5 }}
            onSettled={noop}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = canvasElement.querySelector('canvas')!
        const probe = document.createElement('canvas')
        probe.width = canvas.width
        probe.height = canvas.height
        const g = probe.getContext('2d')!
        g.drawImage(canvas, 0, 0)
        const px = g.getImageData(Math.round(canvas.width * 0.75), Math.round(canvas.height / 2), 1, 1).data
        expect(px[0]).toBeGreaterThan(150)
        expect(px[2]).toBeLessThan(60)
    },
}

/** Single layout: one page wide, the back of the leaf is blank paper. */
export const SingleStatic: Story = {
    render: () => (
        <PageTurnLayer
            width={PAGE_W}
            height={PAGE_H}
            layout="single"
            direction="forward"
            from={{ left: null, right: face(2) }}
            to={{ left: null, right: face(3) }}
            drag={{ x: PAGE_W * 0.55, y: PAGE_H * 0.75 }}
            onSettled={noop}
        />
    ),
    play: async ({ canvasElement }) => {
        const layer = canvasElement.querySelector<HTMLElement>('[data-turn-state]')!
        await waitFor(() => expect(layer.dataset.turnState).toBe('turning'))
    },
}

/** prefers-reduced-motion: no drawing, settles on the next frame. */
export const ReducedMotion: Story = {
    render: () => {
        const real = window.matchMedia.bind(window)
        window.matchMedia = (q: string) =>
            q.includes('prefers-reduced-motion') ? ({ ...real(q), matches: true } as MediaQueryList) : real(q)
        const [committed, setCommitted] = createSignal<boolean | null>(null)
        return (
            <div data-committed={String(committed())}>
                <PageTurnLayer
                    width={SPREAD_W}
                    height={PAGE_H}
                    layout="spread"
                    direction="forward"
                    from={faces(2)}
                    to={faces(4)}
                    drag={null}
                    onSettled={c => {
                        window.matchMedia = real
                        setCommitted(c)
                    }}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const layer = canvasElement.querySelector<HTMLElement>('[data-turn-state]')!
        await waitFor(() => expect(layer.dataset.turnState).toBe('settled'))
        expect(canvasElement.querySelector<HTMLElement>('[data-committed]')!.dataset.committed).toBe('true')
    },
}

/** Three turns back to back, each remounted the moment the last settles. */
export const ThreeQuickTurns: Story = {
    render: () => {
        const [n, setN] = createSignal(0)
        return (
            <div data-cycles={n()}>
                {(() => {
                    n()
                    return (
                        <PageTurnLayer
                            width={SPREAD_W}
                            height={PAGE_H}
                            layout="spread"
                            direction="forward"
                            from={faces(2)}
                            to={faces(4)}
                            drag={null}
                            durationMs={20}
                            onSettled={() => setN(v => (v < 3 ? v + 1 : v))}
                        />
                    )
                })()}
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelector<HTMLElement>('[data-cycles]')!.dataset.cycles).toBe('3'), {
            timeout: 4000,
        })
        const layer = canvasElement.querySelector<HTMLElement>('[data-turn-state]')!
        await waitFor(() => expect(layer.dataset.turnState).toBe('settled'), { timeout: 4000 })
    },
}

/** A portrait face behind a landscape spread (progress 0.8, where the back face covers most of the left page): the curled back face letterboxes onto paper
 *  (the page background, `--bg`) instead of stretching or going black. Static `drag`, so motion plays no part. */
export const PortraitFaceLetterboxed: Story = {
    render: () => (
        <PageTurnLayer
            width={SPREAD_W}
            height={PAGE_H}
            layout="spread"
            direction="forward"
            from={{ left: solid('#0000c0'), right: solid('#0000c0') }}
            to={{ left: portraitSolid('#c00000'), right: solid('#0000c0') }}
            drag={forwardDrag(0.8)}
            onSettled={noop}
        />
    ),
    play: async ({ canvasElement }) => {
        const layer = canvasElement.querySelector<HTMLElement>('[data-turn-state]')!
        await waitFor(() => expect(layer.dataset.turnState).toBe('turning'))
        const canvas = layer.querySelector('canvas')!
        const probe = document.createElement('canvas')
        probe.width = canvas.width
        probe.height = canvas.height
        const g = probe.getContext('2d')!
        g.drawImage(canvas, 0, 0)
        // the left half, a band of rows through the middle of the page
        const y0 = Math.round(canvas.height * 0.3)
        const band = g.getImageData(0, y0, Math.round(canvas.width / 2), Math.round(canvas.height * 0.4)).data
        let red = 0
        let paper = 0
        for (let i = 0; i < band.length; i += 4) {
            const [r, gg, b] = [band[i], band[i + 1], band[i + 2]]
            if (r > gg + 60 && r > b + 60) red++
            else if (r < 110 && Math.abs(r - gg) < 24 && Math.abs(b - r) < 36 && b >= r) paper++
        }
        expect(red, `red ${red} paper ${paper}`).toBeGreaterThan(0)
        expect(paper, `red ${red} paper ${paper}`).toBeGreaterThan(0)
    },
}
