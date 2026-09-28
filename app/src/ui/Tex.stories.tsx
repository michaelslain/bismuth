// Visual spec for <Tex> — the KaTeX primitive (see Tex.tsx). It renders `tex` (no `$…$`
// delimiters) through the app's shared lazy KaTeX loader; `whenMathReady()` is the deterministic
// seam `play()` awaits instead of a timeout — KaTeX is a ~280KB chunk loaded on first use, so the
// very first story to mount always races the import.
//
// Props: tex, display (block vs inline, default false), class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { whenMathReady } from '../editor/katexLoader'
import Tex from './Tex'

const meta = {
    title: 'UI/Tex',
    component: Tex,
    parameters: { layout: 'centered' },
    args: { tex: 'x^2 + y^2 = r^2' },
} satisfies Meta<typeof Tex>

export default meta
type Story = StoryObj<typeof meta>

/** Inline mode — a `<span>` root, sits mid-sentence. */
export const Inline: Story = {
    render: () => (
        <p>
            The circle's equation is <Tex tex="x^2 + y^2 = r^2" /> at the origin.
        </p>
    ),
    play: async ({ canvasElement }) => {
        await whenMathReady()
        const katex = canvasElement.querySelector('.katex')
        expect(katex).not.toBeNull()
        expect(canvasElement.querySelector('span > .katex')).not.toBeNull()
    },
}

/** Display mode — a `<div>` root, centered block. */
export const Display: Story = {
    args: { tex: '\\hat{y} = -0.40\\,t + 3.10 \\qquad R^2 = 0.82', display: true },
    play: async ({ canvasElement }) => {
        await whenMathReady()
        const katex = canvasElement.querySelector('.katex')
        expect(katex).not.toBeNull()
        // Display mode's root is the `<div>` (KaTeX itself wraps the display output one level
        // deeper, in its own .katex-display span).
        expect(katex!.closest('div')?.className).toMatch(/tex/)
    },
}

/** Colour inherits from an ancestor (`color: inherit` on the KaTeX root) — dropped into a
 *  `--accent` parent here, the math should read the same accent colour, not KaTeX's own black. */
export const InheritsColour: Story = {
    render: () => (
        <div style={{ color: 'var(--accent)' }}>
            <Tex tex="\sum_{n=1}^{\infty} n" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await whenMathReady()
        const wrapper = canvasElement.querySelector('div') as HTMLElement
        const katex = canvasElement.querySelector('.katex') as HTMLElement
        expect(katex).not.toBeNull()
        expect(getComputedStyle(katex).color).toBe(getComputedStyle(wrapper).color)
    },
}

/** Hostile property names (`a_b`, `{x}`, `50%`) escaped via `\text{…}` — this must render as
 *  literal text, never a KaTeX parse error (the chart formulas wrap every property name this
 *  way; see chartLatex.ts's `texText`). */
export const EscapedText: Story = {
    args: { tex: '\\text{a\\_b \\{x\\} 50\\%}' },
    play: async ({ canvasElement }) => {
        await whenMathReady()
        const katex = canvasElement.querySelector('.katex')
        expect(katex).not.toBeNull()
        expect(canvasElement.querySelector('.katex-error')).toBeNull()
        // .katex-html is the visible render; .katex's own textContent also carries the hidden
        // .katex-mathml accessibility annotation (a second copy of the source), so assert on the
        // visible half only.
        const visible = katex!.querySelector('.katex-html')
        expect(visible).not.toBeNull()
        // KaTeX's \text{} mode renders a literal space as U+00A0 (nbsp), not a plain space.
        expect(visible!.textContent).toBe('a_b {x} 50%')
    },
}
