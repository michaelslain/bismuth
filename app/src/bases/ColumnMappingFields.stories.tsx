// Visual spec for <ColumnMappingFields> — which column means what, per view kind.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import ColumnMappingFields from './ColumnMappingFields'
import { fieldsFor } from './baseSettingsPlan'
import type { ViewType } from '../../../core/src/bases/types'

const meta = {
    title: 'Bases/ColumnMappingFields',
    component: ColumnMappingFields,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof ColumnMappingFields>

export default meta
type Story = StoryObj<typeof meta>

const COLUMNS = ['file.name', 'status', 'priority', 'due', 'front', 'back']

function Harness(p: {
    kind: ViewType
    initial: Record<string, string>
    bidi?: boolean
}) {
    const [v, setV] = createSignal(p.initial)
    const [bidi, setBidi] = createSignal(!!p.bidi)
    return (
        <div style={{ width: '460px' }}>
            <ColumnMappingFields
                fields={fieldsFor(p.kind)}
                value={v()}
                columns={COLUMNS}
                onChange={(k, c) => setV({ ...v(), [k]: c })}
                bidirectional={bidi()}
                onBidirectional={p.kind === 'flashcards' ? setBidi : undefined}
            />
        </div>
    )
}

export const Flashcards: Story = {
    render: () => (
        <Harness
            kind="flashcards"
            initial={{
                frontField: 'front',
                backField: 'back',
                dueField: 'due',
                easeField: 'ease',
                intervalField: 'interval',
            }}
        />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const toggle = c.getByRole('switch')
        await expect(toggle.getAttribute('aria-checked')).toBe('false')
        await userEvent.click(toggle)
        await expect(toggle.getAttribute('aria-checked')).toBe('true')
        // the reverse-state hint appears once bidirectional is on
        await expect(c.getByText('dueBack')).toBeVisible()
    },
}

export const Map: Story = {
    render: () => (
        <Harness kind="map" initial={{ lat: 'lat', lng: 'lng' }} />
    ),
}

/** The cards image binding is optional: it offers "text cover" for no column. */
export const CardsOptionalImage: Story = {
    render: () => <Harness kind="cards" initial={{ image: '' }} />,
}

export const ChartAxes: Story = {
    render: () => <Harness kind="bar" initial={{ x: 'due', y: '' }} />,
}
