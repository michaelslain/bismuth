// Visual spec for <FilePicker> — the hidden native file input backing a visible trigger
// button. The component itself paints nothing (display: none); this story renders the trigger
// a real call site would build around it, so the picker is exercised the way DrawingPage.tsx
// exercises it: a visible button's onClick calls `.click()` on the ref, and `onPick` reports
// what was chosen.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect } from 'storybook/test'
import FilePicker from './FilePicker'
import TextButton from './TextButton'
import Text from './Text'

const meta = {
    title: 'UI/FilePicker',
    component: FilePicker,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof FilePicker>

export default meta
type Story = StoryObj<typeof meta>

function Demo(props: { accept?: string; multiple?: boolean }) {
    let picker!: HTMLInputElement
    const [names, setNames] = createSignal<string[]>([])
    return (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
            <TextButton
                data-testid="fp-trigger"
                onClick={() => picker.click()}
            >
                choose file
            </TextButton>
            <Text tone="muted" data-testid="fp-result">
                {names().length ? names().join(', ') : 'No file chosen'}
            </Text>
            <FilePicker
                ref={el => (picker = el)}
                accept={props.accept}
                multiple={props.multiple}
                onPick={files => setNames([...files].map(f => f.name))}
                data-testid="fp-input"
            />
        </div>
    )
}

/** The trigger button plus the hidden input it drives — the input itself renders nothing. */
export const Playground: Story = {
    render: () => <Demo accept="image/*" />,
    play: async ({ canvasElement }) => {
        const input = canvasElement.querySelector<HTMLInputElement>(
            '[data-testid="fp-input"]',
        )
        expect(input).not.toBeNull()
        expect(input!.type).toBe('file')
        expect(getComputedStyle(input!).display).toBe('none')
        expect(input!.accept).toBe('image/*')
    },
}

/** Picking a file fires `onPick` with the resulting `FileList`, and the demo's own state
 *  renders the picked name — proves the callback wiring, not just the markup. */
export const PickReportsFile: Story = {
    render: () => <Demo />,
    play: async ({ canvasElement }) => {
        const input = canvasElement.querySelector<HTMLInputElement>(
            '[data-testid="fp-input"]',
        )
        expect(input).not.toBeNull()
        const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
        const dt = new DataTransfer()
        dt.items.add(file)
        input!.files = dt.files
        input!.dispatchEvent(new Event('change', { bubbles: true }))
        const result = canvasElement.querySelector('[data-testid="fp-result"]')
        expect(result?.textContent).toBe('hello.txt')
    },
}

/** `multiple` allows selecting more than one file at once. */
export const Multiple: Story = {
    render: () => <Demo multiple />,
    play: async ({ canvasElement }) => {
        const input = canvasElement.querySelector<HTMLInputElement>(
            '[data-testid="fp-input"]',
        )
        expect(input!.multiple).toBe(true)
    },
}
