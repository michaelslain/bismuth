// Visual spec for <Swatch> — the colour square button CategoryPanel used to hand-roll twice
// (`.cat-chip` the 20px current-colour chip, `.cat-sw` the 22px picker option). See Swatch.tsx's
// header comment.
//
// Props: color (required, any CSS colour), selected, label (required a11y name), size
// ("md" default | "sm"), onClick (required), class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { For, createSignal } from 'solid-js'
import { expect } from 'storybook/test'
import { Swatch } from './Swatch'

const meta = {
    title: 'UI/Swatch',
    component: Swatch,
    parameters: { layout: 'centered' },
    args: {
        color: 'var(--accent)',
        label: 'Accent',
        onClick: () => {},
    },
} satisfies Meta<typeof Swatch>

export default meta
type Story = StoryObj<typeof meta>

const TOKENS = ['--accent', '--rose', '--gold', '--jade', '--violet', '--faint']

/** A picker row — one swatch per token, one selected. `play` asserts the row rendered exactly
 *  one swatch per token and that the selected one alone carries `aria-pressed`. */
export const Palette: Story = {
    render: () => {
        const [value, setValue] = createSignal('--rose')
        return (
            <div style={{ display: 'flex', gap: '6px' }}>
                <For each={TOKENS}>
                    {tok => (
                        <Swatch
                            color={`var(${tok})`}
                            label={tok}
                            selected={value() === tok}
                            onClick={() => setValue(tok)}
                        />
                    )}
                </For>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const swatches = [
            ...canvasElement.querySelectorAll('button[aria-label]'),
        ]
        expect(swatches.length).toBe(TOKENS.length)
        const pressed = swatches.filter(
            s => s.getAttribute('aria-pressed') === 'true',
        )
        expect(pressed.length).toBe(1)
        expect(pressed[0]!.getAttribute('aria-label')).toBe('--rose')
    },
}

/** The empty-rule defect this component fixes: `.cat-chip.open` and `.cat-sw.on` were both blank
 *  CSS rules, so a selected swatch was indistinguishable from every other one. `play` proves the
 *  variant actually differs — the selected swatch's computed `box-shadow` is not `none` and not
 *  equal to an unselected swatch's. */
export const Selected: Story = {
    render: () => (
        <div style={{ display: 'flex', gap: '10px' }}>
            <Swatch
                color="var(--accent)"
                label="Unselected"
                onClick={() => {}}
            />
            <Swatch
                color="var(--accent)"
                label="Selected"
                selected
                onClick={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const plain = canvasElement.querySelector(
            'button[aria-label="Unselected"]',
        ) as HTMLElement
        const sel = canvasElement.querySelector(
            'button[aria-label="Selected"]',
        ) as HTMLElement
        expect(plain).not.toBeNull()
        expect(sel).not.toBeNull()
        const plainShadow = getComputedStyle(plain).boxShadow
        const selShadow = getComputedStyle(sel).boxShadow
        expect(selShadow).not.toBe('none')
        expect(selShadow).not.toBe(plainShadow)
    },
}
