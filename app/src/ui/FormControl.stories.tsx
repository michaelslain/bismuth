// Visual spec for <FormControl> — the shared form-control chrome (surface fill, soft border,
// accent focus ring) behind TextInput and Select's trigger. Polymorphic: `as="input"`/
// `"textarea"` is TextInput's chrome, `as="button"` is Select's trigger chrome. TextInput.stories
// and Select.stories cover the real composed behavior; these stories are the primitive on its own.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
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

/** The chrome as a `<div>` host — what TagsField mounts its single-line editor into. The same
 *  underline; focus inside it firms the rule via `:focus-within`. */
export const AsDiv: Story = {
    render: () => (
        <div style={{ width: '260px' }}>
            <FormControl as="div">
                <span contentEditable style={{ outline: 'none' }}>
                    #planning #chores
                </span>
            </FormControl>
        </div>
    ),
}

/** No native UA chrome shows through the underline-only look: a `type="number"` field has no
 *  spinner box and a textarea has no resize grip — both reset ONCE here, not per caller — and a
 *  textarea's floor is three rows of `--h-control`, not a bare pixel count. */
export const NoNativeChrome: Story = {
    render: () => (
        <div style={{ width: '260px', display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
            <FormControl as="input" type="number" value="42" data-testid="fc-number" />
            <FormControl as="textarea" placeholder="Notes…" data-testid="fc-area" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const num = canvasElement.querySelector<HTMLInputElement>('[data-testid="fc-number"]')!
        const area = canvasElement.querySelector<HTMLTextAreaElement>('[data-testid="fc-area"]')!
        await expect(getComputedStyle(num).appearance).toBe('textfield')
        await expect(getComputedStyle(area).resize).toBe('none')
        const row = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--h-control'),
        )
        await expect(parseFloat(getComputedStyle(area).minHeight)).toBe(row * 3)
    },
}
