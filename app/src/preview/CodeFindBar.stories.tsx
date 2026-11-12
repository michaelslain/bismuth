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
        <div style={{ position: 'relative', width: '760px', height: '200px' }}>
            {props.children}
        </div>
    )
}

/** Every step the bar asked for, in order (module-level so play() can read it). */
let steps: number[] = []

function Harness(props: {
    query: string
    count: string
    matches: number
    caseOn?: boolean
    hint?: string
    answer?: string
    answerTone?: 'muted' | 'danger'
}) {
    const [query, setQuery] = createSignal(props.query)
    const [matchCase, setMatchCase] = createSignal(!!props.caseOn)
    steps = []
    return (
        <Body>
            <CodeFindBar
                query={query()}
                onQuery={setQuery}
                count={props.count}
                noResults={query() !== '' && props.matches === 0}
                matchCount={props.matches}
                canAsk={props.hint !== undefined || props.answer !== undefined}
                hint={props.hint}
                answer={props.answer}
                answerTone={props.answerTone}
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

/** Match case on: the toggle is the mono text `Aa` drawn `[Aa]`, no SVG. */
export const CaseOn: Story = {
    render: () => <Harness query="return" count="1/3" matches={3} caseOn />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const btn = await canvas.findByLabelText('Match case')
        await expect(btn).toHaveAttribute('aria-pressed', 'true')
        await expect(btn.textContent).toContain('Aa')
        await expect(btn.querySelector('svg')).toBeNull()
        // `[Aa]` draws at the same scale as its neighbour `[x]` (a text button, brackets generated
        // from the button's own font): the two buttons' computed font sizes (which size the brackets) must match.
        const close = canvas.getByLabelText('Close (Esc)')
        const fs = (el: HTMLElement) => parseFloat(getComputedStyle(el).fontSize)
        await expect(Math.abs(fs(btn) - fs(close))).toBeLessThanOrEqual(1)
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

/** A query with no match while asking from find is on: `no results` in the danger tone, then the
 *  key that asks, muted. */
export const AskHint: Story = {
    render: () => <Harness query="where is the greeting" count="no results" matches={0} hint="↵ ask" />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const hint = await canvas.findByText('↵ ask')
        await expect(hint).toHaveAttribute('title', 'Press Enter to ask ai about this file')
        await expect(getComputedStyle(hint).color).not.toBe(getComputedStyle(canvas.getByText(/no results/)).color)
    },
}

/** The ai's answer under the bar, part of it: prose, the bar's width, split by the soft rule. */
export const Answer: Story = {
    render: () => (
        <Harness
            query="where is the greeting"
            count="ai 1/2"
            matches={2}
            answer="greet returns a friendly, capitalized greeting: Hello, then the name."
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const answer = await canvas.findByTestId('find-answer')
        const bar = answer.parentElement!.getBoundingClientRect()
        const box = answer.getBoundingClientRect()
        await expect(box.right).toBeLessThanOrEqual(bar.right + 0.5)
        await expect(box.top).toBeGreaterThan(canvas.getByPlaceholderText('find').getBoundingClientRect().bottom)
    },
}

/** Asking: a muted status line in the answer row. */
export const Asking: Story = {
    render: () => (
        <Harness query="where is the greeting" count="no results" matches={0} answer="asking…" answerTone="muted" />
    ),
    play: async ({ canvasElement }) => {
        const answer = await within(canvasElement).findByTestId('find-answer')
        await expect(answer.textContent).toBe('asking…')
        await expect(answer).toHaveAttribute('aria-live', 'polite')
    },
}

/** The ai could not answer: the reason in the danger tone. */
export const AnswerRefused: Story = {
    render: () => (
        <Harness
            query="where is the greeting"
            count="no results"
            matches={0}
            answer="this file is hidden from ai"
            answerTone="danger"
        />
    ),    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const answer = await canvas.findByTestId('find-answer')
        // the refusal and the red count share the danger ink
        await expect(getComputedStyle(answer).color).toBe(getComputedStyle(canvas.getByText('no results')).color)
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
