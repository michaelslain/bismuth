// Visual spec for <FormControl> — the shared form-control chrome (surface fill, soft border,
// accent focus ring) behind TextInput and Select's trigger. Polymorphic: `as="input"`/
// `"textarea"` is TextInput's chrome, `as="button"` is Select's trigger chrome. TextInput.stories
// and Select.stories cover the real composed behavior; these stories are the primitive on its own.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import FormControl from './FormControl'

const meta = {
    title: 'UI/FormControl',
    component: FormControl,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof FormControl>

export default meta
type Story = StoryObj<typeof meta>

/** The chrome as an `<input>` — what TextInput's single-line branch composes. */
export const AsInput: Story = {
    render: () => (
        <div style={{ width: '260px' }}>
            <FormControl as="input" placeholder="Shared chrome…" />
        </div>
    ),
}

/** The chrome as a `<textarea>` — TextInput's multiline branch. */
export const AsTextarea: Story = {
    render: () => (
        <div style={{ width: '260px' }}>
            <FormControl as="textarea" placeholder="Shared chrome…" />
        </div>
    ),
}

/** The chrome as a `<button>`, laid out like Select's trigger — what Select composes. */
export const AsButton: Story = {
    render: () => (
        <div style={{ width: '260px' }}>
            <FormControl
                as="button"
                type="button"
                style={{
                    display: 'flex',
                    'justify-content': 'space-between',
                    width: '100%',
                }}
            >
                Shared chrome…
            </FormControl>
        </div>
    ),
}
