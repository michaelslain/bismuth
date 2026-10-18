// Visual spec for <PrivacyPicker> — the privacy slide's body: a level slider over seven switches.
//
// Props: values, onChange, class.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import PrivacyPicker from './PrivacyPicker'
import { DEFAULT_PRIVACY, applyLevel } from './introPrivacy'

const meta = {
    title: 'Intro/PrivacyPicker',
    component: PrivacyPicker,
    parameters: { layout: 'centered' },
    args: { values: DEFAULT_PRIVACY, onChange: fn() },
    // the picker is a size container, so it needs a width from its parent (the slide's art box gives one)
    decorators: [Story => <div style={{ width: 'min(100vw, calc(110 * var(--cell-w)))' }}><Story /></div>],
} satisfies Meta<typeof PrivacyPicker>

export default meta
type Story = StoryObj<typeof meta>

const rows = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('[data-testid="toggle-row"]'))
const row = (el: HTMLElement, name: string) => rows(el).find(r => r.textContent!.includes(name))!
const slider = (el: HTMLElement) => within(el).getByRole('slider')
const tick = () => new Promise(r => setTimeout(r, 0))

/** Everything off, slider at private. */
export const AllOff: Story = {
    play: async ({ canvasElement }) => {
        expect(rows(canvasElement)).toHaveLength(7)
        expect(rows(canvasElement).every(r => r.getAttribute('aria-checked') === 'false')).toBe(true)
        expect(slider(canvasElement).getAttribute('aria-valuetext')).toBe('private')
    },
}

/** The assist preset: five on, mid-turn recall unlocked. */
export const Assist: Story = {
    args: { values: applyLevel('assist') },
    play: async ({ canvasElement }) => {
        expect(slider(canvasElement).getAttribute('aria-valuetext')).toBe('assist')
        expect(rows(canvasElement).filter(r => r.getAttribute('aria-checked') === 'true')).toHaveLength(5)
    },
}

/** A mix no stop matches: the slider's `custom` slot lights up. */
export const Custom: Story = {
    args: { values: { ...DEFAULT_PRIVACY, dream: true } },
    play: async ({ canvasElement }) => {
        expect(slider(canvasElement).getAttribute('aria-valuetext')).toBe('custom')
    },
}

/** A 500px box: one column of rows, the slider still centred. */
export const Narrow: Story = {
    args: { values: applyLevel('assist') },
    decorators: [Story => <div style={{ width: '500px' }}><Story /></div>],
    play: async ({ canvasElement }) => {
        const [a, b] = rows(canvasElement)
        expect(a!.getBoundingClientRect().left).toBe(b!.getBoundingClientRect().left)
        expect(b!.getBoundingClientRect().top).toBeGreaterThan(a!.getBoundingClientRect().bottom - 1)
    },
}

/** Local state: the slider drives the rows and the rows drive the slider. */
export const Interactive: Story = {
    render: () => {
        const [values, setValues] = createSignal(DEFAULT_PRIVACY)
        return <PrivacyPicker values={values()} onChange={setValues} />
    },
    play: async ({ canvasElement }) => {
        const s = slider(canvasElement)
        s.focus()
        await userEvent.keyboard('{End}')
        await tick()
        expect(rows(canvasElement).every(r => r.getAttribute('aria-checked') === 'true')).toBe(true)
        row(canvasElement, 'dream').click()
        await tick()
        expect(slider(canvasElement).getAttribute('aria-valuetext')).toBe('custom')
        row(canvasElement, 'memory recall').click()
        await tick()
        expect(row(canvasElement, 'mid-turn recall').getAttribute('aria-disabled')).toBe('true')
    },
}
