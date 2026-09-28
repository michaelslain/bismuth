// Visual spec for <BaseSourcePanel> — the query builder's Base source: pick another base, and
// optionally narrow its rows with one Bases expression.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { createSignal } from 'solid-js'
import BaseSourcePanel from './BaseSourcePanel'

const meta = {
    title: 'Bases/BaseSourcePanel',
    component: BaseSourcePanel,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof BaseSourcePanel>

export default meta
type Story = StoryObj<typeof meta>

const BASES = [
    { value: '[[Books]]', label: 'Books' },
    { value: '[[Projects]]', label: 'Projects' },
]

type Value = { baseRef?: string; baseWhere?: string }

function Harness(p: { initial: Value; bases?: typeof BASES }) {
    const [value, setValue] = createSignal<Value>(p.initial)
    return (
        <div style={{ width: '560px' }}>
            <BaseSourcePanel
                baseRef={value().baseRef}
                baseWhere={value().baseWhere}
                onChange={patch => setValue({ ...value(), ...patch })}
                bases={p.bases ?? BASES}
            />
            <pre data-testid="value-out">{JSON.stringify(value())}</pre>
        </div>
    )
}

export const Empty: Story = { render: () => <Harness initial={{}} /> }

export const Filled: Story = {
    render: () => (
        <Harness
            initial={{ baseRef: '[[Books]]', baseWhere: 'rating >= 4' }}
        />
    ),
}

/** A vault with no notes to pick: the picker keeps its placeholder, no crash. */
export const NoBases: Story = {
    render: () => <Harness initial={{}} bases={[]} />,
}

/** Typing a filter and clearing it again writes `undefined`, not an empty string. */
export const EditFilter: Story = {
    render: () => <Harness initial={{ baseRef: '[[Books]]' }} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const out = () => JSON.parse(c.getByTestId('value-out').textContent!)
        const input = c.getByPlaceholderText('e.g. rating >= 4')
        await userEvent.type(input, 'rating >= 4')
        await expect(out()).toEqual({ baseRef: '[[Books]]', baseWhere: 'rating >= 4' })
        await userEvent.clear(input)
        await expect(out().baseWhere).toBeUndefined()
    },
}
