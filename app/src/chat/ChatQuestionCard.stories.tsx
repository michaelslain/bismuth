// Visual spec for <ChatQuestionCard> — an interactive AskUserQuestion card. `AnswerSingleSelect`'s
// play() clicks an option (a lone single-select question submits immediately, no Submit click
// needed — see ChatQuestionCard.tsx's `immediate`) and asserts onAnswer fires with that option.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import ChatQuestionCard from './ChatQuestionCard'
import type { QuestionPart } from './chatTranscriptLogic'

const meta = {
    title: 'Chat/ChatQuestionCard',
    component: ChatQuestionCard,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatQuestionCard>

export default meta
type Story = StoryObj<typeof meta>

const singlePart: QuestionPart = {
    kind: 'question',
    id: 'q1',
    questions: [
        {
            question: 'Which package should the fix land in?',
            header: 'scope',
            multiSelect: false,
            options: [
                { label: 'app', description: 'the frontend workspace' },
                { label: 'core', description: 'the backend workspace' },
            ],
        },
    ],
    answered: null,
}

const multiPart: QuestionPart = {
    kind: 'question',
    id: 'q2',
    questions: [
        {
            question: 'Which surfaces need a story?',
            header: 'stories',
            multiSelect: true,
            options: [
                { label: 'ChatToolRow', description: '' },
                { label: 'ChatPermissionCard', description: '' },
                { label: 'ChatQuestionCard', description: '' },
            ],
        },
    ],
    answered: null,
}

/** A lone single-select question — submits the instant an option is clicked. */
export const SingleSelect: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatQuestionCard part={singlePart} onAnswer={fn()} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('Which package should the fix land in?'),
        ).toBeInTheDocument()
    },
}

/** Multi-select stages picks; Submit/Skip only appear once at least one is answerable. Also
 *  proves the design #7 vocabulary fix: the header chip is lowercase (no CSS uppercase
 *  transform), the option rows carry no individual fill/border (an unfilled hairline list, not
 *  boxed slabs), and Submit/Skip render as bracket buttons — the same idiom + component
 *  ChatPermissionCard's "[allow]"/"[deny]" uses. */
export const MultiSelect: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatQuestionCard part={multiPart} onAnswer={fn()} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('Which surfaces need a story?'),
        ).toBeInTheDocument()

        const chip = canvas.getByText('stories')
        await expect(getComputedStyle(chip).textTransform).toBe('none')

        const firstOption = canvas.getByRole('button', { name: 'ChatToolRow' })
        const secondOption = canvas.getByRole('button', {
            name: 'ChatPermissionCard',
        })
        await expect(getComputedStyle(firstOption).backgroundColor).toBe(
            'rgba(0, 0, 0, 0)',
        )
        await expect(getComputedStyle(firstOption).borderTopStyle).toBe('none')
        await expect(getComputedStyle(secondOption).borderTopStyle).toBe(
            'solid',
        )

        // Stage a pick so Submit/Skip render, then confirm the bracket wrap.
        await userEvent.click(canvas.getByText('ChatToolRow'))
        const submit = canvas.getByRole('button', { name: 'submit' })
        await expect(getComputedStyle(submit).textTransform).toBe('none')
        await expect(
            getComputedStyle(submit, '::before').content,
        ).toContain('[')
        await expect(
            getComputedStyle(submit, '::after').content,
        ).toContain(']')
    },
}

/** Already answered — a muted outcome list, options inert. */
export const Answered: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatQuestionCard
                part={{
                    ...singlePart,
                    answered: { 'Which package should the fix land in?': 'app' },
                }}
                onAnswer={fn()}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // "app" appears both as the (now-disabled) option label and in the outcome line, so
        // getAllByText rather than getByText — this just proves the answer rendered at all.
        await expect(canvas.getAllByText('app').length).toBeGreaterThan(0)
        // SETTLED IS INK, NOT OPACITY: neither the card nor any ancestor-level control fades, and
        // the outcome line reads at full ink (--fg), not a dimmed one.
        const probe = document.createElement('span')
        probe.style.color = 'var(--fg)'
        canvasElement.appendChild(probe)
        const fg = getComputedStyle(probe).color
        probe.remove()
        const outcome = within(canvasElement).getByTestId('chat-question-outcome')
        await expect(getComputedStyle(outcome).color).toBe(fg)
        for (let el: Element | null = outcome; el && el !== canvasElement.parentElement; el = el.parentElement)
            await expect(getComputedStyle(el).opacity).toBe('1')
        for (const opt of canvasElement.querySelectorAll('button'))
            await expect(getComputedStyle(opt).opacity).toBe('1')
    },
}

/** An option whose label contains a comma ("Yes, do it") still shows as the chosen one once
 *  answered: the answer map holds `parts.join(', ')`, so recovering the pick by splitting on `, `
 *  would cut the label in two and match nothing. */
export const AnsweredCommaLabel: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatQuestionCard
                part={{
                    ...singlePart,
                    questions: [
                        {
                            ...singlePart.questions[0],
                            options: [
                                { label: 'Yes, do it', description: '' },
                                { label: 'Yes', description: '' },
                                { label: 'No', description: '' },
                            ],
                        },
                    ],
                    answered: { 'Which package should the fix land in?': 'Yes, do it' },
                }}
                onAnswer={fn()}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const mark = (label: string) => {
            const button = Array.from(canvasElement.querySelectorAll('button')).find(b =>
                b.textContent?.includes(label),
            )!
            return getComputedStyle(button.querySelector('i')!, '::before').content
        }
        await expect(mark('Yes, do it')).toBe('"x"')
        // the neighbours that merely share a fragment of the label are not marked
        await expect(mark('No')).not.toBe('"x"')
        const bare = Array.from(canvasElement.querySelectorAll('button')).find(
            b => b.textContent?.replace(/[\[\]\sx]/g, '') === 'Yes',
        )!
        await expect(getComputedStyle(bare.querySelector('i')!, '::before').content).not.toBe('"x"')
    },
}

/** Skipped/orphaned by Stop — a muted "Skipped" note, options inert. */
export const Skipped: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatQuestionCard
                part={{ ...singlePart, cancelled: true }}
                onAnswer={fn()}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Skipped')).toBeInTheDocument()
        // SETTLED IS INK, NOT OPACITY: neither the card nor any ancestor-level control fades, and
        // the outcome line reads at full ink (--fg), not a dimmed one.
        const probe = document.createElement('span')
        probe.style.color = 'var(--fg)'
        canvasElement.appendChild(probe)
        const fg = getComputedStyle(probe).color
        probe.remove()
        const outcome = within(canvasElement).getByTestId('chat-question-outcome')
        await expect(getComputedStyle(outcome).color).toBe(fg)
        for (let el: Element | null = outcome; el && el !== canvasElement.parentElement; el = el.parentElement)
            await expect(getComputedStyle(el).opacity).toBe('1')
        for (const opt of canvasElement.querySelectorAll('button'))
            await expect(getComputedStyle(opt).opacity).toBe('1')
    },
}

/** Clicking an option on a lone single-select question calls onAnswer with just that pick. */
export const AnswerSingleSelect: Story = {
    render: args => (
        <div style={{ width: '600px' }}>
            <ChatQuestionCard part={singlePart} onAnswer={args.onAnswer} />
        </div>
    ),
    args: { onAnswer: fn() },
    play: async ({ canvasElement, args }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByText('app'))
        await expect(args.onAnswer).toHaveBeenCalledWith({
            'Which package should the fix land in?': 'app',
        })
    },
}
