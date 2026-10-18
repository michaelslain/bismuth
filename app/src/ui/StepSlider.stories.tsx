// Visual spec for <StepSlider> — the stepped level slider: `○` markers on a `─` track, the current
// stop `●` in accent, a label under each marker, a trailing `custom` slot lit when no stop matches.
//
// Props: stops, value, onChange, label, class.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import StepSlider from './StepSlider'

const stops = [
    { id: 'private', label: 'private' },
    { id: 'recall', label: 'recall' },
    { id: 'assist', label: 'assist' },
    { id: 'full', label: 'full' },
]

const meta = {
    title: 'UI/StepSlider',
    component: StepSlider,
    parameters: { layout: 'centered' },
    args: { stops, value: 'private', label: 'privacy level', onChange: fn() },
    decorators: [Story => <div style={{ width: '420px' }}><Story /></div>],
} satisfies Meta<typeof StepSlider>

export default meta
type Story = StoryObj<typeof meta>

/** First stop current. */
export const AtStart: Story = {
    play: async ({ canvasElement }) => {
        const slider = within(canvasElement).getByRole('slider')
        expect(slider.getAttribute('aria-valuenow')).toBe('0')
        expect(slider.getAttribute('aria-valuetext')).toBe('private')
        expect(canvasElement.textContent).toContain('●')
        expect(canvasElement.textContent!.split('●').length).toBe(2)
    },
}

/** A middle stop current: only `assist` is filled. */
export const Middle: Story = {
    args: { value: 'assist' },
    play: async ({ canvasElement }) => {
        const slider = within(canvasElement).getByRole('slider')
        expect(slider.getAttribute('aria-valuenow')).toBe('2')
        expect(canvasElement.textContent!.split('●').length).toBe(2)
        expect(canvasElement.textContent!.split('○').length).toBe(4)
    },
}

/** No stop matches: every stop marker is `○`, the trailing `custom` slot is lit `●`, no valuenow. */
export const Custom: Story = {
    args: { value: null },
    play: async ({ canvasElement }) => {
        const slider = within(canvasElement).getByRole('slider')
        expect(slider.hasAttribute('aria-valuenow')).toBe(false)
        expect(slider.getAttribute('aria-valuetext')).toBe('custom')
        expect(canvasElement.textContent!.split('○').length).toBe(5)
        const custom = canvasElement.querySelector('[data-stop-custom]')!
        expect(custom.textContent).toBe('●custom')
    },
}

/** Controlled by a local signal: ArrowRight twice 0 to 2, End to last, a label click selects it. */
export const Interactive: Story = {
    render: args => {
        const [value, setValue] = createSignal<string | null>('private')
        return <StepSlider {...args} value={value()} onChange={setValue} />
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const slider = c.getByRole('slider')
        slider.focus()
        await userEvent.keyboard('{ArrowRight}{ArrowRight}')
        expect(slider.getAttribute('aria-valuenow')).toBe('2')
        await userEvent.keyboard('{End}')
        expect(slider.getAttribute('aria-valuenow')).toBe('3')
        await userEvent.click(c.getByText('recall'))
        expect(slider.getAttribute('aria-valuenow')).toBe('1')
        expect(slider.getAttribute('aria-valuetext')).toBe('recall')
    },
}
