// Visual spec for <PropertyControl> — the per-property control CardEditModal lists. One story per
// dispatch branch; the interactive ones hold real state and assert each commit.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import PropertyControl from './PropertyControl'
import type { PropertyEditKind } from './propertyEdit'

const meta = {
    title: 'Bases/PropertyControl',
    component: PropertyControl,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof PropertyControl>

export default meta
type Story = StoryObj<typeof meta>

const Harness = (p: {
    kind: PropertyEditKind
    initial: unknown
    writable?: boolean
    emptyText?: string
    markdown?: boolean
}) => {
    const [value, setValue] = createSignal<unknown>(p.initial)
    const [committed, setCommitted] = createSignal('none')
    return (
        <div style={{ width: '320px' }}>
            <PropertyControl
                kind={p.kind}
                value={value()}
                writable={p.writable ?? true}
                emptyText={p.emptyText}
                markdown={p.markdown ? () => <div data-testid="rich">rich surface</div> : undefined}
                onCommit={v => {
                    setValue(v)
                    setCommitted(JSON.stringify(v))
                }}
            />
            <span hidden data-testid="committed">
                {committed()}
            </span>
        </div>
    )
}

/** A boolean is a Yes/No ChipToggle; each click writes the flip. */
export const BooleanToggles: Story = {
    render: () => <Harness kind={{ kind: 'boolean' }} initial={false} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const chip = await canvas.findByRole('button', { name: /no/i })
        await expect(chip).toHaveAttribute('aria-pressed', 'false')
        await userEvent.click(chip)
        await waitFor(() => expect(canvas.getByTestId('committed')).toHaveTextContent('true'))
        await expect(canvas.getByRole('button', { name: /yes/i })).toHaveAttribute(
            'aria-pressed',
            'true',
        )
        await userEvent.click(canvas.getByRole('button', { name: /yes/i }))
        await waitFor(() => expect(canvas.getByTestId('committed')).toHaveTextContent('false'))
    },
}

/** Not writable: a muted line, an em dash when empty, and no control to commit from. */
export const ReadonlyEmpty: Story = {
    render: () => (
        <Harness kind={{ kind: 'text' }} initial={null} writable={false} emptyText="—" />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('—')).toBeInTheDocument()
        await expect(canvasElement.querySelector('input, textarea, button')).toBeNull()
    },
}

/** A markdown kind renders the host's rich surface when it supplies one. */
export const MarkdownHostSurface: Story = {
    render: () => <Harness kind={{ kind: 'markdown' }} initial="hi" markdown />,
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByTestId('rich')).toBeInTheDocument()
        await expect(canvasElement.querySelector('textarea')).toBeNull()
    },
}

/** Without a host surface a markdown kind falls back to the plain textarea. */
export const MarkdownFallback: Story = {
    render: () => <Harness kind={{ kind: 'markdown' }} initial="hi" />,
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelector('textarea')).not.toBeNull()
    },
}

/** Everything else is PropertyValueEditor: a text edit commits on Enter. */
export const TextCommits: Story = {
    render: () => <Harness kind={{ kind: 'text' }} initial="old" />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const input = canvas.getByDisplayValue('old')
        await userEvent.clear(input)
        await userEvent.type(input, 'new{Enter}')
        await waitFor(() => expect(canvas.getByTestId('committed')).toHaveTextContent('"new"'))
    },
}
