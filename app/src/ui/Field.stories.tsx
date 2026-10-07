// Visual spec for <Field> — DEPRECATED, a thin alias of <SettingsField> (ds-improve-r1 Task 13).
// It keeps its props (label, class?, labelClass?, children) and its content-sized label column, but
// the label is SettingsField's real <label> bound to the control, on SettingsField's baseline.
// These stories pair it with TextInput/Select/SegmentedToggle to show it where it is still used
// (EmbeddedGraph's edit row, CustomThemePanel) and pin that the alias keeps the association.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect } from 'storybook/test'
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
 *  CardEditModal's Title field, whose caption matches the micro register every
 *  other property label uses there). The class carries no rule here — the story pins only that
 *  it is merged, not what a caller paints with it. */
export const WithLabelClass: Story = {
    render: () => {
        const [v, setV] = createSignal('untitled')
        return (
            <div style={{ width: '280px' }}>
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

/** The alias keeps the fix: the caption is a real <label> bound to the wrapped control (this is the
 *  WCAG 1.3.1 / 4.1.2 association EmbeddedGraph's edit row relies on), and the label column is
 *  content-sized, not SettingsField's 20-cell `--label-col`. */
export const KeepsLabelAssociation: Story = {
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
    play: async ({ canvasElement }) => {
        const input = canvasElement.querySelector('input')!
        await expect(input.labels).toHaveLength(1)
        await expect(input.labels![0].tagName).toBe('LABEL')
        await expect(input.labels![0].textContent).toBe('title')
        // Content-sized column: a 5-letter label leaves the control far left of 20 cells (126px).
        const field = canvasElement.querySelector<HTMLElement>(
            '[data-testid="settings-field"]',
        )!
        await expect(
            input.getBoundingClientRect().left - field.getBoundingClientRect().left,
        ).toBeLessThan(100)
    },
}
