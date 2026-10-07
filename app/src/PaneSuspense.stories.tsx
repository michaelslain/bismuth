// Visual + behavioural spec for <PaneSuspense> — the Suspense boundary every lazy pane view sits in.
// A child reads a resource this story resolves on demand (a deterministic seam, never a timeout),
// so the story can observe BOTH sides: the full-size empty fallback while pending, and the view
// once it settles.
import { createResource, type Component } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import PaneSuspense from './PaneSuspense'

const meta = {
    title: 'App/PaneSuspense',
    component: PaneSuspense,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PaneSuspense>

export default meta
type Story = StoryObj<typeof meta>

let release: () => void = () => {}

const Lazy: Component = () => {
    const [text] = createResource(
        () =>
            new Promise<string>(resolve => {
                release = () => resolve('the pane view')
            }),
    )
    return <p data-testid="settled">{text()}</p>
}

/** Pending: the default fallback is a `.full` box (the pane keeps its whole box), no content yet.
 *  Then the resource settles and the view replaces it. */
export const FallbackThenView: Story = {
    render: () => (
        <div style={{ width: '320px', height: '160px' }}>
            <PaneSuspense>
                <Lazy />
            </PaneSuspense>
        </div>
    ),
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelector('.full')).not.toBeNull())
        await expect(canvasElement.querySelector('[data-testid="settled"]')).toBeNull()
        release()
        await waitFor(() =>
            expect(canvasElement.querySelector('[data-testid="settled"]')?.textContent).toBe(
                'the pane view',
            ),
        )
        await expect(canvasElement.querySelector('.full')).toBeNull()
    },
}

/** A caller-supplied fallback replaces the default (ExportView's grid-shaped placeholder). */
export const CustomFallback: Story = {
    render: () => (
        <PaneSuspense fallback={<div data-testid="custom-fallback">holding the grid</div>}>
            <Lazy />
        </PaneSuspense>
    ),
    play: async ({ canvasElement }) => {
        await waitFor(() =>
            expect(canvasElement.querySelector('[data-testid="custom-fallback"]')).not.toBeNull(),
        )
        await expect(canvasElement.querySelector('.full')).toBeNull()
        release()
    },
}
