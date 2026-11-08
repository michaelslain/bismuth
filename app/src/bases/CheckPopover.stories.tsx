// Visual spec for <CheckPopover> — the popup a transcript check's warning glyph opens.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor } from 'storybook/test'
import CheckPopover from './CheckPopover'
import type { TranscriptCheck } from '../../../core/src/transcript'
import Text from '../ui/Text'

const meta = {
    title: 'Bases/CheckPopover',
    component: CheckPopover,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof CheckPopover>

export default meta
type Story = StoryObj<typeof meta>

/** Opens over an anchor; the buttons record what they did and close it. */
function Harness(props: { check: TranscriptCheck }) {
    let anchor!: HTMLSpanElement
    const [open, setOpen] = createSignal(true)
    const [did, setDid] = createSignal('')
    return (
        <div style={{ height: '260px', width: '420px' }} data-did={did()}>
            <span ref={anchor}>
                <Text as="span">anchor</Text>
            </span>
            <CheckPopover
                open={open()}
                anchor={() => anchor}
                check={props.check}
                onApprove={() => (setDid('approve'), setOpen(false))}
                onRetype={() => (setDid('retype'), setOpen(false))}
                onDismiss={() => setOpen(false)}
            />
        </div>
    )
}

export const Unsure: Story = {
    render: () => <Harness check={{ line: 'and see if I could not learn what it had to teech', level: 'unsure' }} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(document.querySelector('[data-check-popover]')?.textContent).toContain('not sure of this line'))
        await userEvent.click(document.querySelector<HTMLElement>('[data-check-approve]')!)
        await expect(canvasElement.querySelector('[data-did]')!.getAttribute('data-did')).toBe('approve')
    },
}

export const Garbled: Story = {
    render: () => <Harness check={{ line: 'to frnot only the esentail facts of lfie', level: 'garbled' }} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(document.querySelector('[data-check-popover]')?.textContent).toContain('this line read badly'))
        await userEvent.click(document.querySelector<HTMLElement>('[data-check-retype]')!)
        await expect(canvasElement.querySelector('[data-did]')!.getAttribute('data-did')).toBe('retype')
    },
}

export const EmptyPage: Story = {
    name: 'Empty page',
    render: () => <Harness check={{ line: '', level: 'garbled' }} />,
    play: async () => {
        await waitFor(() => expect(document.querySelector('[data-check-retype]')?.textContent).toContain('type it'))
    },
}
