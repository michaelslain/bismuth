// app/src/preview/ScratchPaper.stories.tsx
// Visual spec for <ScratchPaper> — the note-styled surface behind the scratch strip. Nothing
// dynamic here: the whole component is one div whose look comes from two tokens, so the one
// story proves those tokens actually reached it, resolved to real colours — not a hand-typed
// stand-in (app/.storybook/preview.ts already projects the real theme; see its header).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import ScratchPaper from './ScratchPaper'

const meta = {
    title: 'Preview/ScratchPaper',
    component: ScratchPaper,
} satisfies Meta<typeof ScratchPaper>

export default meta
type Story = StoryObj<typeof meta>

/** A `#RRGGBB` custom-property VALUE (the raw text `getPropertyValue` returns for a token defined
 *  as a hex literal — never resolved to `rgb(...)` the way a native CSS property would be) parsed
 *  into channels, for comparing against a computed `rgb(...)` style. */
function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.replace('#', ''), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function parseRgb(css: string): [number, number, number] {
    const m = css.match(/rgba?\(([^)]+)\)/)
    const parts = (m?.[1] ?? '').split(',').map(v => parseFloat(v.trim()))
    return [parts[0] ?? NaN, parts[1] ?? NaN, parts[2] ?? NaN]
}

/** Rest state: the surface's background resolves to `--editor`, its left border to `--rule-soft`
 *  (`1px solid var(--border-soft)`) — this is what would fail if the component still used the
 *  PDF page's own white/`PDF_PAGE_RULE` instead of the note-editor tokens. */
export const Default: Story = {
    render: () => (
        <div style={{ position: 'relative', height: '220px', width: '360px' }}>
            <ScratchPaper
                index={0}
                style={{
                    position: 'absolute',
                    left: '0',
                    top: '0',
                    width: '160px',
                    height: '220px',
                }}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector(
            '[data-pdf-margin="0"]',
        ) as HTMLElement
        await expect(el).not.toBeNull()

        const root = getComputedStyle(document.documentElement)
        const editorHex = root.getPropertyValue('--editor').trim()
        const borderSoftHex = root.getPropertyValue('--border-soft').trim()

        const cs = getComputedStyle(el)
        await expect(parseRgb(cs.backgroundColor)).toEqual(hexToRgb(editorHex))
        await expect(parseRgb(cs.borderLeftColor)).toEqual(
            hexToRgb(borderSoftHex),
        )
        await expect(cs.borderLeftWidth).toBe('1px')
        await expect(cs.borderLeftStyle).toBe('solid')
    },
}
