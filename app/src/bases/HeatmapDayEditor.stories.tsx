// Visual spec for <HeatmapDayEditor> — the small number field a heatmap opens over a clicked day.
// The stories hold real state: committing a value shows it on the "saved" line underneath, the
// same value a real heatmap would hand to its write seam, so the field is never a no-op to try.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import { createSignal } from 'solid-js'
import HeatmapDayEditor from './HeatmapDayEditor'
import Text from '../ui/Text'

const meta = {
    title: 'Bases/HeatmapDayEditor',
    component: HeatmapDayEditor,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof HeatmapDayEditor>

export default meta
type Story = StoryObj<typeof meta>

function Harness(props: { initial: number | undefined }) {
    const [saved, setSaved] = createSignal<string>(
        props.initial === undefined ? 'nothing yet' : String(props.initial),
    )
    return (
        <div style={{ position: 'relative', height: '120px' }}>
            <HeatmapDayEditor
                dateLabel="Tue Jul 8"
                value={props.initial}
                style={{ top: '0px', left: '0px' }}
                onSave={v => setSaved(v === undefined ? 'cleared' : String(v))}
                onCancel={() => setSaved('cancelled')}
            />
            <Text as="p" size="ui" tone="muted" style={{ 'margin-top': '72px' }}>
                saved: {saved()}
            </Text>
        </div>
    )
}

/** An empty day: type a number, Enter — the saved line shows it. */
export const EmptyDay: Story = {
    args: { dateLabel: 'Tue Jul 8', value: undefined, onSave: () => {}, onCancel: () => {} },
    render: () => <Harness initial={undefined} />,
    play: async ({ canvasElement }) => {
        const input = await waitFor(() => {
            const el = canvasElement.querySelector('input')
            if (!el) throw new Error('field not mounted')
            return el
        })
        await userEvent.click(input)
        await userEvent.type(input, '42{enter}')
        await waitFor(() => expect(canvasElement.textContent).toContain('saved: 42'))
    },
}

/** A day that already has a value — the field opens prefilled. */
export const ExistingValue: Story = {
    args: { dateLabel: 'Tue Jul 8', value: 30, onSave: () => {}, onCancel: () => {} },
    render: () => <Harness initial={30} />,
}

/** Escape cancels: the typed text is discarded and the saved line reads `cancelled`, never the
 *  half-typed number. */
export const EscapeCancels: Story = {
    args: { dateLabel: 'Tue Jul 8', value: 30, onSave: () => {}, onCancel: () => {} },
    render: () => <Harness initial={30} />,
    play: async ({ canvasElement }) => {
        const input = await waitFor(() => {
            const el = canvasElement.querySelector('input')
            if (!el) throw new Error('field not mounted')
            return el
        })
        await userEvent.click(input)
        await userEvent.clear(input)
        await userEvent.type(input, '99{Escape}')
        await waitFor(() => expect(canvasElement.textContent).toContain('saved: cancelled'))
    },
}

/** Text that is not a number commits as a clear (`cleared`), never as NaN. */
export const NonNumericInput: Story = {
    args: { dateLabel: 'Tue Jul 8', value: 30, onSave: () => {}, onCancel: () => {} },
    render: () => <Harness initial={30} />,
    play: async ({ canvasElement }) => {
        const input = await waitFor(() => {
            const el = canvasElement.querySelector('input')
            if (!el) throw new Error('field not mounted')
            return el
        })
        await userEvent.click(input)
        await userEvent.clear(input)
        await userEvent.type(input, 'abc{enter}')
        await waitFor(() => expect(canvasElement.textContent).toContain('saved: cleared'))
    },
}

/** Emptying a prefilled field and confirming clears the day. */
export const ClearValue: Story = {
    args: { dateLabel: 'Tue Jul 8', value: 30, onSave: () => {}, onCancel: () => {} },
    render: () => <Harness initial={30} />,
    play: async ({ canvasElement }) => {
        const input = await waitFor(() => {
            const el = canvasElement.querySelector('input')
            if (!el) throw new Error('field not mounted')
            return el
        })
        expect(input.value).toBe('30')
        await userEvent.click(input)
        await userEvent.clear(input)
        await userEvent.keyboard('{Enter}')
        await waitFor(() => expect(canvasElement.textContent).toContain('saved: cleared'))
    },
}
