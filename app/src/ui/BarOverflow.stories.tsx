// Visual spec for <BarOverflow> — the [≡] trigger and the panel that lists a view bar's dropped
// controls. ViewBar mounts it (see ViewBar.stories.tsx's ManyControlsNarrowOverflow for the full
// round trip); these stories pose it on its own, with the elements it is handed already sitting in a
// host the way they sit in a bar's trail.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { createSignal } from 'solid-js'
import BarOverflow from './BarOverflow'
import { IconButton } from './IconButton'
import { TextButton } from './TextButton'

const meta = {
    title: 'UI/BarOverflow',
    component: BarOverflow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof BarOverflow>

export default meta
type Story = StoryObj<typeof meta>

function Posed(props: { startOpen: boolean }) {
    const [open, setOpen] = createSignal(props.startOpen)
    let dark!: HTMLDivElement
    let file!: HTMLDivElement
    return (
        <div style={{ display: 'flex', 'align-items': 'center', gap: 'var(--sp-5)' }}>
            {/* Where the dropped elements sit: laid out, as they would be in a bar's trail. */}
            <div style={{ display: 'none' }}>
                <div ref={dark}>
                    <IconButton icon="Moon" label="Dark" variant="selected" />
                </div>
                <div ref={file} style={{ display: 'flex' }}>
                    <TextButton>open</TextButton>
                    <TextButton>reveal</TextButton>
                </div>
            </div>
            <BarOverflow
                items={[
                    { label: 'dark mode', el: dark },
                    { label: 'file', el: file },
                ]}
                open={open()}
                onOpenChange={setOpen}
            />
        </div>
    )
}

/** Only the trigger: a glyph with the unpainted bracket footprint of every other bar icon. */
export const Closed: Story = {
    render: () => <Posed startOpen={false} />,
    play: async ({ canvasElement }) => {
        const t = within(canvasElement).getByLabelText('More controls')
        expect(t.getAttribute('aria-expanded')).toBe('false')
        expect(document.body.querySelector('[data-popover]')).toBeNull()
    },
}

/** The panel open: one row per dropped element, a lowercase muted label and the live control. */
export const Open: Story = {
    render: () => <Posed startOpen={true} />,
    play: async ({ canvasElement }) => {
        const panel = await waitFor(() => {
            const p = document.body.querySelector<HTMLElement>('[data-popover]')
            expect(p).toBeTruthy()
            return p!
        })
        expect(within(panel).getByText('dark mode')).toBeTruthy()
        expect(within(panel).getByText('file')).toBeTruthy()
        expect(within(panel).getByLabelText('Dark').getAttribute('aria-pressed')).toBe('true')
        expect(within(panel).getByText('reveal')).toBeTruthy()
        const t = within(canvasElement).getByLabelText('More controls')
        expect(t.getAttribute('aria-expanded')).toBe('true')
        // Opening focuses the rows container, not a control, so no tooltip covers the panel.
        await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true))
        expect(document.activeElement!.matches('button, input, select')).toBe(false)
        expect(document.querySelector('[data-tooltip-bubble]')).toBeNull()
        // End-aligned, clamped into the window: never past the right edge.
        expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth)
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(document.body.querySelector('[data-popover]')).toBeNull())
        expect(document.activeElement).toBe(t)
    },
}
