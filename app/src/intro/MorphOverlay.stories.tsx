// Visual spec for <MorphOverlay>: the welcome slide's text cells flying into the theme slide's, at
// pinned progress 0, 0.25, 0.5, 0.75 and 1. The grids are fixed MorphGrid fixtures, so every frame
// is deterministic. The stage is exactly COLS x ROWS cells, the grid the overlay paints on. The
// headlines carry a real footprint (x/y/scale) the way a snapshot of serif text does, so they fly and
// resize between a 2.5x and a 1.6x run.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import MorphOverlay from './MorphOverlay'
import type { MorphCell, MorphGrid } from './morph/morphGrid'
import { planMorph } from './morph/morphPlan'
import type { GlyphColor } from '../ui/ascii/glyphScene'

const COLS = 96
const ROWS = 22
const SEED = 7

const put = (
    cells: MorphCell[],
    text: string,
    col: number,
    row: number,
    color: GlyphColor,
) => {
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== ' ') cells.push({ col: col + i, row, ch: text[i], color })
    }
}
const centred = (text: string) => Math.floor((COLS - text.length) / 2)

/** A centred headline on the base grid, carrying a footprint `scale` cells per glyph wide. */
const headline = (cells: MorphCell[], text: string, row: number, scale: number) => {
    const c0 = centred(text)
    const x0 = COLS / 2 - (text.length * scale) / 2
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== ' ')
            cells.push({ col: c0 + i, row, ch: text[i], color: 'fg', x: x0 + i * scale, y: row + 0.5, scale })
    }
}

const chrome = (cells: MorphCell[], label: string) => {
    put(cells, 'bismuth_', 0, 0, 'fg')
    put(cells, '[skip]', COLS - 6, 0, 'muted')
    put(cells, label, 0, ROWS - 1, 'muted')
    put(cells, '[back] [next]', COLS - 13, ROWS - 1, 'accent')
}

const welcome = (): MorphGrid => {
    const cells: MorphCell[] = []
    chrome(cells, '1/12 // welcome')
    headline(cells, 'Your notes, on your disk.', 11, 2.5)
    const body = 'Bismuth is a local-first vault with a live knowledge graph.'
    put(cells, body, centred(body), 14, 'muted')
    put(cells, '[ b i s m u t h ]', centred('[ b i s m u t h ]'), 6, 'accent')
    return { cols: COLS, rows: ROWS, cells }
}

const theme = (): MorphGrid => {
    const cells: MorphCell[] = []
    chrome(cells, '2/12 // palette')
    headline(cells, 'Pick a palette.', 11, 1.6)
    const body = 'It recolours everything, and your new vault starts with it.'
    put(cells, body, centred(body), 14, 'muted')
    put(cells, 'ink   paper   riso', centred('ink   paper   riso'), 18, 'accent')
    for (let i = 0; i < 40; i++) {
        put(cells, i % 3 === 0 ? 'o' : '.', 28 + ((i * 7) % 40), 3 + ((i * 5) % 8), (['graph0', 'graph1', 'graph2', 'graph3'] as const)[i % 4])
    }
    return { cols: COLS, rows: ROWS, cells }
}

const plan = planMorph(welcome(), theme(), SEED)

const meta = {
    title: 'Intro/MorphOverlay',
    component: MorphOverlay,
    parameters: { layout: 'centered' },
    args: { plan, seed: SEED, progress: 0 },
    decorators: [
        Story => (
            <div
                style={{
                    position: 'relative',
                    width: `calc(${COLS} * var(--cell-w))`,
                    height: `calc(${ROWS} * var(--row-h))`,
                    background: 'var(--bg)',
                    color: 'var(--fg)',
                }}
            >
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof MorphOverlay>

export default meta
type Story = StoryObj<typeof meta>

/** Fraction of canvas pixels that carry ink (alpha > 0). */
const inked = (canvasElement: HTMLElement): number => {
    const c = canvasElement.querySelector('canvas')!
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++
    return n / (c.width * c.height)
}

const at = (progress: number): Story => ({
    args: { progress },
    play: async ({ canvasElement }) => {
        await expect(inked(canvasElement)).toBeGreaterThan(0.002)
    },
})

/** p = 0: exactly the welcome slide's characters. */
export const Start: Story = at(0)
/** p = 0.25: letters lifting off, a few already scrambling. */
export const Quarter: Story = at(0.25)
/** p = 0.5: a cloud of characters mid-flight, scrambled glyphs among settled ones. */
export const Half: Story = at(0.5)
/** p = 0.75: most characters on their new cells, the rest still locking in. */
export const ThreeQuarters: Story = at(0.75)
/** p = 1: exactly the theme slide's characters. */
export const End: Story = at(1)
