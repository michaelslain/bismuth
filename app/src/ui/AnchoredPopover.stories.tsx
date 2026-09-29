// Visual spec for <AnchoredPopover> — the shared anchor + dismiss layer Select and
// DateFieldEditor both compose: a portaled, fixed-positioned surface under (or, when there's
// no room, above) a trigger element, repositioned on scroll/resize while open, dismissed on
// Escape or an outside pointerdown.
//
// AnchoredPopover owns only positioning + the backdrop/panel stacking pair — the content is
// whatever the caller passes as children, here a plain bordered box standing in for a real
// popover surface (PopoverList, DatePicker, …).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import AnchoredPopover from './AnchoredPopover'
import Button from './Button'
import { Modal } from './Modal'

const meta = {
    title: 'UI/AnchoredPopover',
    component: AnchoredPopover,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof AnchoredPopover>

export default meta
type Story = StoryObj<typeof meta>

function Content(props: { label: string }) {
    return (
        <div
            data-testid="anchored-popover-content"
            style={{
                padding: '12px 16px',
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                'min-width': '160px',
            }}
        >
            {props.label}
        </div>
    )
}

function Harness(props: { label: string; placement?: 'below' | 'above'; nearBottom?: boolean }) {
    const [open, setOpen] = createSignal(false)
    let anchorRef: HTMLButtonElement | undefined
    return (
        <div
            style={
                props.nearBottom
                    ? {
                          height: '100vh',
                          display: 'flex',
                          'align-items': 'flex-end',
                          'justify-content': 'center',
                          'padding-bottom': '8px',
                      }
                    : undefined
            }
        >
            <Button ref={anchorRef} onClick={() => setOpen(v => !v)} data-testid="anchor-trigger">
                {props.label}
            </Button>
            <AnchoredPopover
                anchor={() => anchorRef}
                open={open()}
                onDismiss={() => setOpen(false)}
                placement={props.placement}
            >
                <Content label="Popover content" />
            </AnchoredPopover>
        </div>
    )
}

/** Closed by default — click the trigger to open the anchored panel below it. */
export const Closed: Story = {
    render: () => <Harness label="Open" />,
}

/** Opens below the trigger, the default placement. */
export const OpenBelow: Story = {
    render: () => <Harness label="Open" />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByTestId('anchor-trigger'))
        const body = within(canvasElement.ownerDocument.body)
        await waitFor(() => body.getByTestId('anchored-popover-content'))
    },
}

/** The trigger sits near the bottom of the viewport, so the panel has no room below and
 *  flips above it instead. */
export const FlippedAbove: Story = {
    parameters: { layout: 'fullscreen' },
    render: () => <Harness label="Open (near bottom)" nearBottom />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const trigger = canvas.getByTestId('anchor-trigger')
        await userEvent.click(trigger)
        const body = within(canvasElement.ownerDocument.body)
        const panel = await waitFor(() => body.getByTestId('anchored-popover-content'))
        const triggerTop = trigger.getBoundingClientRect().top
        const panelTop = panel.getBoundingClientRect().top
        await expect(panelTop).toBeLessThan(triggerTop)
    },
}

/** A popover inside a Modal: Escape closes the popover only. AnchoredPopover consumes the key
 *  (`preventDefault`, capture phase) and Modal ignores a `defaultPrevented` dismiss, so the
 *  Modal stays open; a second Escape then closes the Modal. */
export const EscapeInsideModal: Story = {
    parameters: { layout: 'fullscreen' },
    render: () => {
        const [modalOpen, setModalOpen] = createSignal(true)
        const [open, setOpen] = createSignal(false)
        let anchorRef: HTMLButtonElement | undefined
        return (
            <>
                <span data-testid="modal-state">{modalOpen() ? 'open' : 'closed'}</span>
                {modalOpen() && (
                    <Modal label="Popover host" onClose={() => setModalOpen(false)}>
                        <div style={{ padding: '24px', background: 'var(--surface-1)' }}>
                            <Button
                                ref={anchorRef}
                                onClick={() => setOpen(v => !v)}
                                data-testid="anchor-trigger"
                            >
                                Open
                            </Button>
                            <AnchoredPopover
                                anchor={() => anchorRef}
                                open={open()}
                                onDismiss={() => setOpen(false)}
                            >
                                <Content label="Popover content" />
                            </AnchoredPopover>
                        </div>
                    </Modal>
                )}
            </>
        )
    },
    play: async ({ canvasElement }) => {
        const body = within(canvasElement.ownerDocument.body)
        const state = () => body.getByTestId('modal-state')
        await userEvent.click(await waitFor(() => body.getByTestId('anchor-trigger')))
        await waitFor(() => body.getByTestId('anchored-popover-content'))
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(body.queryByTestId('anchored-popover-content')).toBeNull())
        await expect(state()).toHaveTextContent('open')
        await expect(body.queryByTestId('anchor-trigger')).not.toBeNull()
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(state()).toHaveTextContent('closed'))
    },
}
