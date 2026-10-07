// Visual spec for <CodeBlock> — a `<pre>` for monospace block text with a token-built default
// look (surface fill, hairline, padding, the app's mono token, wrapping). Every default has zero
// specificity, so a caller's `class` (border, padding, background, max-height) wins on the
// properties it sets — but a zero-specificity default also leaks into everything the class does NOT
// set, so the chrome is opt-out via `bare`. `play` asserts the rendered tag, the chromed default, the
// chromeless `bare` form (no padding/border/fill), and that the caller class lands on the root in both.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import CodeBlock from './CodeBlock'

const meta = {
    title: 'UI/CodeBlock',
    component: CodeBlock,
    parameters: { layout: 'centered' },
    args: {
        children: 'const x = 1\nconsole.log(x)',
    },
} satisfies Meta<typeof CodeBlock>

export default meta
type Story = StoryObj<typeof meta>

/** The default look — no caller class. It must read as a block, never as loose text: a
 *  non-transparent fill, a visible border and real padding. */
export const Playground: Story = {
    play: async ({ canvasElement }) => {
        const pre = canvasElement.querySelector('pre')
        expect(pre).not.toBeNull()
        expect(pre!.tagName).toBe('PRE')
        const cs = getComputedStyle(pre!)
        expect(cs.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
        expect(cs.backgroundColor).not.toBe('transparent')
        expect(parseFloat(cs.borderTopWidth)).toBeGreaterThan(0)
        expect(parseFloat(cs.paddingLeft)).toBeGreaterThan(0)
        expect(parseFloat(cs.paddingTop)).toBeGreaterThan(0)
    },
}

/** A long unbroken token wraps inside the block instead of blowing out its box. */
export const LongToken: Story = {
    args: {
        children:
            'const reallyLongIdentifier = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree, argumentNumberFour)\nsupercalifragilisticexpialidocious_and_then_some_more_characters_that_never_space_out_1234567890',
    },
    decorators: [
        Story => (
            <div style={{ width: '280px' }}>
                <Story />
            </div>
        ),
    ],
    play: async ({ canvasElement }) => {
        const pre = canvasElement.querySelector('pre')!
        expect(pre.scrollWidth).toBeLessThanOrEqual(pre.clientWidth + 1)
    },
}

/** With a caller class — proves the class merges onto the root. */
export const WithCallerClass: Story = {
    args: { class: 'caller-demo-class' },
    play: async ({ canvasElement }) => {
        const pre = canvasElement.querySelector('pre')
        expect(pre).not.toBeNull()
        expect(pre!.classList.contains('caller-demo-class')).toBe(true)
    },
}

/** `bare` — the chromeless form for a caller that brings its own skin (or measures the box, as
 *  LineView does). No padding, no border, no fill — and a caller class that sets none of those
 *  inherits none of them either, which is the leak the chromed default cannot avoid. */
export const Bare: Story = {
    args: { bare: true, class: 'caller-demo-class' },
    play: async ({ canvasElement }) => {
        const pre = canvasElement.querySelector('pre')!
        expect(pre.classList.contains('caller-demo-class')).toBe(true)
        const cs = getComputedStyle(pre)
        for (const side of ['top', 'right', 'bottom', 'left']) {
            expect(cs.getPropertyValue(`padding-${side}`)).toBe('0px')
            expect(cs.getPropertyValue(`border-${side}-width`)).toBe('0px')
        }
        expect(cs.backgroundColor).toBe('rgba(0, 0, 0, 0)')
        // The reset survives: mono face and wrapping are not chrome.
        expect(cs.whiteSpace).toBe('pre-wrap')
        expect(cs.margin).toBe('0px')
    },
}

/** Chromed + a caller class: the class lands on the root and the default chrome stays under it —
 *  a class that sets only (say) a colour does not remove the padding. That is why a caller with its
 *  own skin passes `bare` rather than overriding properties one by one. */
export const ChromedWithCallerClass: Story = {
    args: { class: 'caller-demo-class' },
    play: async ({ canvasElement }) => {
        const pre = canvasElement.querySelector('pre')!
        expect(pre.classList.contains('caller-demo-class')).toBe(true)
        const cs = getComputedStyle(pre)
        expect(parseFloat(cs.paddingLeft)).toBeGreaterThan(0)
        expect(parseFloat(cs.borderTopWidth)).toBeGreaterThan(0)
    },
}
