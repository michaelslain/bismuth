// app/src/preview/PageReadout.stories.tsx
// Visual + behavioural spec for <PageReadout> — the PDF's `p. N / M` in the ViewBar's readouts
// slot, which edits in place to go to a page. Mounted inside a real ui/ViewBar so the readout is
// measured in the bar it ships in, not floating on a blank canvas.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import PageReadout from './PageReadout'
import ViewBar, { Crumb } from '../ui/ViewBar'

const meta = {
    title: 'Preview/PageReadout',
    component: PageReadout,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PageReadout>

export default meta
type Story = StoryObj<typeof meta>

/** Every `onGo` the readout made, in order (module-level so play() can read it). */
let gone: number[] = []

function Harness(props: { start: number; count: number }) {
    const [current, setCurrent] = createSignal(props.start)
    return (
        <div style={{ width: '520px' }}>
            <ViewBar
                identity={<Crumb icon="FileText">handbook.pdf</Crumb>}
                readouts={
                    <PageReadout
                        current={current}
                        count={() => props.count}
                        onGo={i => {
                            gone.push(i)
                            setCurrent(i)
                        }}
                    />
                }
            />
        </div>
    )
}

/** Rest: `p. 3 / 12`, lowercase, muted, no frame — a readout, not another toggle. */
export const Rest: Story = {
    render: () => {
        gone = []
        return <Harness start={2} count={12} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const btn = await canvas.findByRole('button', { name: /Page 3 of 12/ })
        await expect(btn.textContent).toBe('p. 3 / 12')
        const cs = getComputedStyle(btn)
        await expect(cs.textTransform).toBe('none')
        // No rest frame: the border stays transparent (the mode toggles are the framed controls).
        await expect(cs.borderTopColor).toBe('rgba(0, 0, 0, 0)')
        // Sits inside the 36px bar, vertically centred to within a pixel.
        const bar = canvasElement.querySelector('[data-viewbar]') as HTMLElement
        const b = bar.getBoundingClientRect()
        const r = btn.getBoundingClientRect()
        await expect(r.top).toBeGreaterThanOrEqual(b.top)
        await expect(r.bottom).toBeLessThanOrEqual(b.bottom)
        await expect(
            Math.abs(r.top + r.height / 2 - (b.top + (b.height - 1) / 2)),
        ).toBeLessThanOrEqual(1.5)
    },
}

/** Click → an input holding the current page; typing 7 + Enter goes to page index 6 and the
 *  readout comes back showing it. Escape leaves the page alone; an out-of-range number clamps. */
export const GoToPage: Story = {
    render: () => {
        gone = []
        return <Harness start={2} count={12} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await fireEvent.click(
            await canvas.findByRole('button', { name: /Page 3 of 12/ }),
        )
        const input = (await canvas.findByLabelText(
            'Go to page (1–12)',
        )) as HTMLInputElement
        await expect(input.value).toBe('3')
        await waitFor(() => expect(document.activeElement).toBe(input))
        input.value = '7'
        await fireEvent.keyDown(input, { key: 'Enter' })
        await waitFor(() => expect(gone).toEqual([6]))
        await expect(
            (await canvas.findByRole('button', { name: /Page 7 of 12/ }))
                .textContent,
        ).toBe('p. 7 / 12')

        // Escape: no navigation.
        await fireEvent.click(canvas.getByRole('button', { name: /Page 7/ }))
        const again = (await canvas.findByLabelText(
            'Go to page (1–12)',
        )) as HTMLInputElement
        again.value = '2'
        await fireEvent.keyDown(again, { key: 'Escape' })
        await canvas.findByRole('button', { name: /Page 7 of 12/ })
        await expect(gone).toEqual([6])

        // Out of range clamps to the last page; junk goes nowhere.
        await fireEvent.click(canvas.getByRole('button', { name: /Page 7/ }))
        const clamp = (await canvas.findByLabelText(
            'Go to page (1–12)',
        )) as HTMLInputElement
        clamp.value = '99'
        await fireEvent.keyDown(clamp, { key: 'Enter' })
        await canvas.findByRole('button', { name: /Page 12 of 12/ })
        await fireEvent.click(canvas.getByRole('button', { name: /Page 12/ }))
        const junk = (await canvas.findByLabelText(
            'Go to page (1–12)',
        )) as HTMLInputElement
        junk.value = 'abc'
        await fireEvent.keyDown(junk, { key: 'Enter' })
        await canvas.findByRole('button', { name: /Page 12 of 12/ })
        await expect(gone).toEqual([6, 11])
    },
}

/** The edit state, left open for the shot: `p. [3] / 12` in the bar. */
export const Editing: Story = {
    render: () => {
        gone = []
        return <Harness start={2} count={12} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await fireEvent.click(
            await canvas.findByRole('button', { name: /Page 3 of 12/ }),
        )
        const input = await canvas.findByLabelText('Go to page (1–12)')
        const bar = canvasElement.querySelector('[data-viewbar]') as HTMLElement
        const b = bar.getBoundingClientRect()
        const r = input.getBoundingClientRect()
        await expect(r.top).toBeGreaterThanOrEqual(b.top)
        await expect(r.bottom).toBeLessThanOrEqual(b.bottom)
    },
}
