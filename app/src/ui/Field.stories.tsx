// Visual spec for <Field> — a label wrapping its control (`label > span + control`),
// the idiom repeated across EventModal / BaseSettings / card-add forms.
//
// Props: label (JSX, usually a short caption), class? (site-specific layout hook),
// children (the wrapped control). Field owns no control styling itself — it renders
// the shared `.ui-field` label chrome and defers entirely to whatever control is
// passed in, so these stories pair it with TextInput/Select/SegmentedToggle to show
// it in the context it's actually used.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import Field from './Field'
import { TextInput } from './TextInput'
import Select, { type SelectOption } from './Select'
import { SegmentedToggle } from './SegmentedToggle'

const meta = {
    title: 'UI/Field',
    component: Field,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof Field>

export default meta
type Story = StoryObj<typeof meta>

const CATEGORY_OPTIONS: SelectOption[] = [
    { value: 'work', label: 'work' },
    { value: 'personal', label: 'personal' },
    { value: 'health', label: 'health' },
]

/** A single field wrapping a TextInput (the most common shape). */
export const WithTextInput: Story = {
    render: () => {
        const [v, setV] = createSignal('team sync')
        return (
            <div style={{ width: '280px' }}>
                <Field label="title">
                    <TextInput value={v()} onInput={setV} />
                </Field>
            </div>
        )
    },
}

/** A field whose label carries an extra class, merged onto the caption span (e.g.
 *  CardEditModal's Title field, whose caption matches the micro-caps register every
 *  other property label uses there). */
export const WithLabelClass: Story = {
    render: () => {
        const [v, setV] = createSignal('untitled')
        return (
            <div style={{ width: '280px' }}>
                <style>
                    {
                        '.storyMicroLabel { font-size: var(--fs-micro); font-weight: var(--fw-bold); letter-spacing: 0.06em; text-transform: uppercase; }'
                    }
                </style>
                <Field label="title" labelClass="storyMicroLabel">
                    <TextInput value={v()} onInput={setV} />
                </Field>
            </div>
        )
    },
}

/** A field wrapping a Select (e.g. EventModal's category picker). */
export const WithSelect: Story = {
    render: () => {
        const [v, setV] = createSignal('work')
        return (
            <div style={{ width: '280px' }}>
                <Field label="category">
                    <Select
                        value={v()}
                        options={CATEGORY_OPTIONS}
                        onChange={setV}
                    />
                </Field>
            </div>
        )
    },
}

/** A field wrapping a SegmentedToggle (e.g. a repeat/frequency chooser). */
export const WithSegmentedToggle: Story = {
    render: () => {
        const [v, setV] = createSignal('week')
        return (
            <div style={{ width: '280px' }}>
                <Field label="repeats">
                    <SegmentedToggle
                        value={v()}
                        onChange={setV}
                        options={[
                            { id: 'day', label: 'day' },
                            { id: 'week', label: 'week' },
                            { id: 'month', label: 'month' },
                        ]}
                    />
                </Field>
            </div>
        )
    },
}

/** Several fields stacked, the way a modal form composes them. */
export const StackedForm: Story = {
    render: () => {
        const [title, setTitle] = createSignal('team sync')
        const [category, setCategory] = createSignal('work')
        return (
            <div
                style={{
                    width: '300px',
                    display: 'flex',
                    'flex-direction': 'column',
                    gap: '14px',
                }}
            >
                <Field label="title">
                    <TextInput value={title()} onInput={setTitle} />
                </Field>
                <Field label="category">
                    <Select
                        value={category()}
                        options={CATEGORY_OPTIONS}
                        onChange={setCategory}
                    />
                </Field>
                <Field label="notes">
                    <TextInput
                        value=""
                        onInput={() => {}}
                        multiline
                        placeholder="optional details…"
                    />
                </Field>
            </div>
        )
    },
}
