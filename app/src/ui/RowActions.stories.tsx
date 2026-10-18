// Visual spec for <RowActions> — controls floating over a row's trailing end. They reserve no
// column: the row's text runs full width at rest and dissolves under the backing when they show.
//
// Props: children, pinned?, class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import RowActions from './RowActions'
import CloseButton from './CloseButton'
import Text from './Text'

const meta = {
    title: 'UI/RowActions',
    component: RowActions,
    parameters: { layout: 'padded' },
    args: { children: null },
} satisfies Meta<typeof RowActions>

export default meta
type Story = StoryObj<typeof meta>

const LONG =
    'answer-emails finished failed the gmail api timed out after three retries and the run gave up'

/** One row as the logs and chat history use it: full-width text and an overlaid `[x]`. */
function Row(props: { pinned?: boolean; selected?: boolean }) {
    return (
        <div
            data-row-actions-host
            data-selected={props.selected ? '' : undefined}
            style={{
                width: '420px',
                display: 'flex',
                'white-space': 'nowrap',
                overflow: 'hidden',
                background: props.selected ? 'var(--state-selected-bg)' : undefined,
            }}
        >
            <Text as="span" size="micro" tone="muted">
                {LONG}
            </Text>
            <RowActions pinned={props.pinned}>
                <CloseButton label="delete log entry" onClick={() => {}} />
            </RowActions>
        </div>
    )
}

/** At rest: the actions are invisible and take no width — the text reaches the row's edge. */
export const Resting: Story = {
    render: () => <Row />,
    play: async ({ canvasElement }) => {
        const actions = canvasElement.querySelector<HTMLElement>('[data-row-actions]')!
        await expect(getComputedStyle(actions).opacity).toBe('0')
        await expect(getComputedStyle(actions).position).toBe('absolute')
    },
}

/** Shown (as on hover): the `[x]` sits on the row's ground, the text fading out beneath it. */
export const Shown: Story = {
    render: () => <Row pinned />,
    play: async ({ canvasElement }) => {
        const actions = canvasElement.querySelector<HTMLElement>('[data-row-actions]')!
        await expect(getComputedStyle(actions).opacity).toBe('1')
        await expect(getComputedStyle(actions).backgroundImage).toContain('linear-gradient')
    },
}

/** A selected row: the backing carries the selected tint too, so no lighter patch shows. */
export const OnSelectedRow: Story = {
    render: () => <Row selected />,
    play: async ({ canvasElement }) => {
        const actions = canvasElement.querySelector<HTMLElement>('[data-row-actions]')!
        await expect(getComputedStyle(actions).opacity).toBe('1')
    },
}
