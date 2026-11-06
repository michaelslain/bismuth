// Visual spec for <BarSettings> — a view bar's settings button and its panel of labelled rows,
// where a view keeps the settings a person sets once (the book's layout lives here, behind `Aa`).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { createSignal } from 'solid-js'
import BarSettings from './BarSettings'
import SegmentedToggle from './SegmentedToggle'

const meta = {
    title: 'UI/BarSettings',
    component: BarSettings,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof BarSettings>

export default meta
type Story = StoryObj<typeof meta>

function Posed(props: { glyph?: string; defaultOpen?: boolean }) {
    const [layout, setLayout] = createSignal<'auto' | 'single'>('auto')
    const [size, setSize] = createSignal<'s' | 'm' | 'l'>('m')
    return (
        <div style={{ display: 'flex', 'justify-content': 'flex-end', width: '360px' }}>
            <BarSettings
                glyph={props.glyph}
                label="display"
                defaultOpen={props.defaultOpen}
                rows={[
                    {
                        label: 'layout',
                        control: (
                            <SegmentedToggle<'auto' | 'single'>
                                options={[
                                    { id: 'auto', label: 'auto' },
                                    { id: 'single', label: 'single' },
                                ]}
                                value={layout()}
                                onChange={setLayout}
                            />
                        ),
                    },
                    {
                        label: 'text size',
                        control: (
                            <SegmentedToggle<'s' | 'm' | 'l'>
                                options={[
                                    { id: 's', label: 's' },
                                    { id: 'm', label: 'm' },
                                    { id: 'l', label: 'l' },
                                ]}
                                value={size()}
                                onChange={setSize}
                            />
                        ),
                    },
                ]}
            />
        </div>
    )
}

/** The book's trigger: the `Aa` glyph, closed. */
export const GlyphClosed: Story = {
    name: 'Glyph closed',
    render: () => <Posed glyph="Aa" />,
    play: async ({ canvasElement }) => {
        const b = within(canvasElement).getByRole('button', { name: 'display' })
        await expect(b).toHaveAttribute('aria-expanded', 'false')
    },
}

/** Open: one grid, every control starting at the same x; a click on a row's option takes. */
export const Open: Story = {
    render: () => <Posed glyph="Aa" />,
    play: async ({ canvasElement }) => {
        await userEvent.click(within(canvasElement).getByRole('button', { name: 'display' }))
        const panel = await waitFor(() => {
            const el = document.querySelector<HTMLElement>('[data-bar-settings-panel]')
            expect(el).not.toBeNull()
            return el!
        })
        const single = within(panel).getByText('single')
        await userEvent.click(single)
        await expect(single.closest('button')).toHaveAttribute('aria-pressed', 'true')
        const xs = [...panel.querySelectorAll<HTMLElement>('[data-kind]')].map(
            el => el.closest('div')!.getBoundingClientRect().left,
        )
        await expect(new Set(xs.map(Math.round)).size).toBe(1)
    },
}

/** A view with no glyph of its own: the sliders icon. */
export const IconTrigger: Story = {
    name: 'Icon trigger',
    render: () => <Posed defaultOpen />,
    play: async ({ canvasElement }) => {
        const b = within(canvasElement).getByRole('button', { name: 'display' })
        await expect(b.querySelector('svg')).not.toBeNull()
        await waitFor(() => expect(document.querySelector('[data-bar-settings-panel]')).not.toBeNull())
    },
}
