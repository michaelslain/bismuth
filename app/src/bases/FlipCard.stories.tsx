// Visual spec for <FlipCard> — the flashcard: a PlainButton holding both faces for the CSS 3D flip,
// with the per-card actions pinned outside it. The interactive story holds real state (a signal)
// and asserts the reveal in play(); the static ones pin each resting state.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import FlipCard from './FlipCard'
import { IconButton } from '../ui/IconButton'
import IconBar from '../ui/IconBar'

const meta = {
    title: 'Bases/FlipCard',
    component: FlipCard,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof FlipCard>

export default meta
type Story = StoryObj<typeof meta>

/** The card lives in a size container in the app (`.cardwrap`): the flip's push-back is `50cqi`. */
function Stage(props: { children: unknown }) {
    return (
        <div style={{ width: '680px', 'container-type': 'inline-size' }}>
            {props.children as never}
        </div>
    )
}

const PROMPT = '<p>capital of France</p>'
const ANSWER = '<p><strong>Paris</strong> — on the <em>Seine</em></p>'

const Actions = () => (
    <IconBar label="Card actions">
        <IconButton icon="Pencil" label="Edit this card" size="sm" onClick={() => {}} />
        <IconButton icon="Trash2" label="Delete this card" danger size="sm" onClick={() => {}} />
    </IconBar>
)

/** At rest: the front face shows, the back is inert. */
export const Front: Story = {
    args: { revealed: false, onReveal: () => {}, promptHtml: PROMPT, answerHtml: ANSWER },
    render: args => (
        <Stage>
            <FlipCard {...args} />
        </Stage>
    ),
    play: async ({ canvasElement }) => {
        const front = canvasElement.querySelector('[data-face="front"]')!
        const back = canvasElement.querySelector('[data-face="back"]')!
        expect(front.hasAttribute('inert')).toBe(false)
        expect(back.hasAttribute('inert')).toBe(true)
        expect(
            canvasElement.querySelector('button[aria-pressed]')!.getAttribute('aria-pressed'),
        ).toBe('false')
    },
}

/** Revealed: the answer face is live, with the prompt as an italic caption above the divider. */
export const Revealed: Story = {
    args: { revealed: true, onReveal: () => {}, promptHtml: PROMPT, answerHtml: ANSWER },
    render: args => (
        <Stage>
            <FlipCard {...args} />
        </Stage>
    ),
    play: async ({ canvasElement }) => {
        expect(
            canvasElement.querySelector('[data-face="front"]')!.hasAttribute('inert'),
        ).toBe(true)
        expect(
            canvasElement.querySelector('[data-face="back"]')!.hasAttribute('inert'),
        ).toBe(false)
    },
}

/** With the pinned actions: outside the reveal button, so a click on one never flips the card. */
export const WithActions: Story = {
    args: { revealed: false, onReveal: () => {}, promptHtml: PROMPT, answerHtml: ANSWER },
    render: args => (
        <Stage>
            <FlipCard {...args} actions={<Actions />} />
        </Stage>
    ),
    play: async ({ canvasElement }) => {
        const edit = within(canvasElement).getByLabelText('Edit this card')
        expect(edit.parentElement?.closest('button')).toBeNull()
    },
}

/** Interactive: a click reveals, Enter reveals, and a click while revealed does nothing more. */
export const RevealsOnce: Story = {
    args: { revealed: false, onReveal: () => {}, promptHtml: PROMPT, answerHtml: ANSWER },
    render: args => {
        const [revealed, setRevealed] = createSignal(false)
        const [reveals, setReveals] = createSignal(0)
        return (
            <Stage>
                <FlipCard
                    {...args}
                    revealed={revealed()}
                    onReveal={() => {
                        setReveals(n => n + 1)
                        setRevealed(true)
                    }}
                />
                <span data-testid="reveals">{reveals()}</span>
            </Stage>
        )
    },
    play: async ({ canvasElement }) => {
        const card = canvasElement.querySelector('button[aria-pressed]') as HTMLElement
        card.focus()
        await userEvent.keyboard('{Enter}')
        await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'))
        await userEvent.click(card)
        expect(canvasElement.querySelector('[data-testid="reveals"]')!.textContent).toBe('1')
    },
}
