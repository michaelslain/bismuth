// app/src/preview/CodeFindBar.stories.tsx
// Visual + behavioural spec for <CodeFindBar> — the find popover a code/text preview floats over its
// body, and its PDF sibling (the "not available yet" note on the same chrome). The bar is
// absolutely positioned against the preview body, so every story mounts it inside a relative box of
// the body's shape rather than on a blank canvas.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, within } from 'storybook/test'
import CodeFindBar from './CodeFindBar'

const meta = {
    title: 'Preview/CodeFindBar',
    component: CodeFindBar,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CodeFindBar>

export default meta
type Story = StoryObj<typeof meta>

function Body(props: { children: import('solid-js').JSX.Element }) {
    return (
        <div style={{ position: 'relative', width: '560px', height: '96px' }}>
            {props.children}
        </div>
    )
}

/** Every step the bar asked for, in order (module-level so play() can read it). */
let steps: number[] = []

function Harness(props: { query: string; count: string; matches: number }) {
    const [query, setQuery] = createSignal(props.query)
    const [matchCase, setMatchCase] = createSignal(false)
    steps = []
    return (
        <Body>
            <CodeFindBar
                query={query()}
                onQuery={setQuery}
                count={props.count}
                noResults={query() !== '' && props.matches === 0}
                matchCount={props.matches}
                caseSensitive={matchCase()}
                onToggleCase={() => setMatchCase(v => !v)}
                onStep={d => steps.push(d)}
                onClose={() => {}}
            />
        </Body>
    )
}

/** A query with hits: count `1/3`, steppers enabled, Enter / Shift+Enter step the match. */
export const Default: Story = {
    render: () => <Harness query="return" count="1/3" matches={3} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const input = await canvas.findByPlaceholderText('find')
        fireEvent.keyDown(input, { key: 'Enter' })
        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
        await expect(steps).toEqual([1, -1])
        await expect(canvas.getByLabelText('Next match (Enter)')).toBeEnabled()
    },
}

/** A query that matched nothing: the count reads the danger ink and both steppers are disabled. */
export const NoResults: Story = {
    render: () => <Harness query="zzz" count="No results" matches={0} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const count = await canvas.findByText('No results')
        const danger = getComputedStyle(document.documentElement)
            .getPropertyValue('--danger')
            .trim()
        const probe = document.createElement('span')
        probe.style.color = danger
        document.body.appendChild(probe)
        const want = getComputedStyle(probe).color
        probe.remove()
        await expect(getComputedStyle(count).color).toBe(want)
        await expect(canvas.getByLabelText('Next match (Enter)')).toBeDisabled()
        await expect(canvas.getByLabelText('Previous match (Shift+Enter)')).toBeDisabled()
    },
}

/** The PDF variant: no input, just the note and a dismiss. */
export const PdfNote: Story = {
    render: () => (
        <Body>
            <CodeFindBar mode="pdf" onClose={() => {}} />
        </Body>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText("In-app PDF search isn't available yet."),
        ).toBeInTheDocument()
        await expect(canvas.queryByPlaceholderText('find')).toBeNull()
    },
}
