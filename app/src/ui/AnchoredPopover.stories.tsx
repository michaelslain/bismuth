// Visual spec for <AnchoredPopover> — the shared anchor + dismiss layer Select and
// DateFieldEditor both compose: a portaled, fixed-positioned surface under (or, when there's
// no room, above) a trigger element, repositioned on scroll/resize while open, dismissed on
// Escape or an outside pointerdown.
//
// AnchoredPopover owns only positioning + the backdrop/panel stacking pair — the content is
// whatever the caller passes as children, here a plain bordered box standing in for a real
// popover surface (PopoverList, DatePicker, …).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, onMount } from 'solid-js'
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

/** The panel's own element (the `panelAttrs` testid) — what the placement plays measure. */
const PANEL_ID = 'anchored-popover-panel'
const PANEL_ATTRS = { 'data-testid': PANEL_ID }
/** computeAnchorRect's default gap between the anchor and the panel. */
const GAP = 4

/** The panel sits `side` of the anchor, flush to its left edge, one gap away — and so is
 *  provably NOT at the page origin, where it used to paint before it was measured. */
async function expectBeside(panel: HTMLElement, anchor: HTMLElement, side: 'below' | 'above') {
    const p = panel.getBoundingClientRect()
    const a = anchor.getBoundingClientRect()
    await expect(Math.abs(p.left - a.left)).toBeLessThan(1)
    await expect(
        Math.abs((side === 'below' ? p.top : p.bottom) - (side === 'below' ? a.bottom + GAP : a.top - GAP)),
    ).toBeLessThan(1)
    // Not the corner the unmeasured panel sat in.
    await expect(p.top > 8 && p.left > 8).toBe(true)
}

function Harness(props: {
    label: string
    placement?: 'below' | 'above'
    nearBottom?: boolean
    /** Treat the trigger as `toggleEl`, with a press counter instead of a dismiss. */
    anchorPress?: boolean
    /** Mounted already open — the open effect then runs before the panel exists. */
    startOpen?: boolean
    /** Opens from `onMount`, as DateFieldEditor does when a table cell enters edit mode. */
    openInMount?: boolean
}) {
    const [open, setOpen] = createSignal(props.startOpen ?? false)
    onMount(() => {
        if (props.openInMount) setOpen(true)
    })
    const [presses, setPresses] = createSignal(0)
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
            <span data-testid="anchor-presses" style={{ display: 'none' }}>{presses()}</span>
            <span data-testid="popover-state" style={{ display: 'none' }}>{open() ? 'open' : 'closed'}</span>
            <AnchoredPopover
                anchor={() => anchorRef}
                toggleEl={props.anchorPress ? () => anchorRef : undefined}
                onAnchorPress={props.anchorPress ? () => setPresses(n => n + 1) : undefined}
                open={open()}
                onDismiss={() => setOpen(false)}
                placement={props.placement}
                panelAttrs={PANEL_ATTRS}
            >
                <Content label="Popover content" />
            </AnchoredPopover>
        </div>
    )
}

/** A real pointer press at a viewport point: dispatched on whatever is actually there (the
 *  backdrop, once open) with its coordinates — the geometry `onAnchorPress` is decided by. */
function pressAt(doc: Document, x: number, y: number): void {
    const target = doc.elementFromPoint(x, y) ?? doc.body
    target.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }),
    )
}

/** Closed by default — click the trigger to open the anchored panel below it. */
export const Closed: Story = {
    render: () => <Harness label="Open" />,
}

/** Opens below the trigger, the default placement. The press and the first read are
 *  back-to-back with only a microtask between them — so this FAILS if the panel is not measured
 *  as it mounts: it used to stay at the page origin (0,0), far from its anchor. */
export const OpenBelow: Story = {
    render: () => <Harness label="Open" />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const trigger = canvas.getByTestId('anchor-trigger')
        trigger.click()
        const body = within(canvasElement.ownerDocument.body)
        const panel = body.getByTestId(PANEL_ID)
        await Promise.resolve()
        await expectBeside(panel, trigger, 'below')
    },
}

/** Mounted ALREADY open (a date editor opened from a cell, a picker restored open). The open
 *  effect runs before the panel is created, so measuring there finds nothing; the panel used to
 *  stay at the page origin for good. It must be beside the trigger. */
export const OpenOnMount: Story = {
    render: () => <Harness label="Open on mount" startOpen />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        const panel = await waitFor(() => body.getByTestId(PANEL_ID))
        await expectBeside(panel, canvas.getByTestId('anchor-trigger'), 'below')
    },
}

/** Opened from `onMount`, the way a table cell opens its date editor on entering edit mode —
 *  the case the page-origin bug was seen in (bases-tablecell--date-editor). */
export const OpenedInOnMount: Story = {
    render: () => <Harness label="Opened in onMount" openInMount />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        const panel = await waitFor(() => body.getByTestId(PANEL_ID))
        await expectBeside(panel, canvas.getByTestId('anchor-trigger'), 'below')
    },
}

/** An explicit `placement="above"` with room on both sides: the panel sits ABOVE the trigger,
 *  its bottom edge one gap over the trigger's top. */
export const PlacedAbove: Story = {
    render: () => <Harness label="Open (above)" placement="above" />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const trigger = canvas.getByTestId('anchor-trigger')
        trigger.click()
        const body = within(canvasElement.ownerDocument.body)
        const panel = body.getByTestId(PANEL_ID)
        await Promise.resolve()
        await expectBeside(panel, trigger, 'above')
    },
}

/** A pointerdown anywhere outside the panel and the trigger dismisses; one INSIDE the panel
 *  does not. */
export const OutsidePressDismisses: Story = {
    render: () => <Harness label="Open" />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const doc = canvasElement.ownerDocument
        const body = within(doc.body)
        await userEvent.click(canvas.getByTestId('anchor-trigger'))
        const panel = await waitFor(() => body.getByTestId(PANEL_ID))
        const inside = panel.getBoundingClientRect()
        pressAt(doc, inside.left + 4, inside.top + 4)
        await expect(canvas.getByTestId('popover-state')).toHaveTextContent('open')
        pressAt(doc, window.innerWidth - 4, window.innerHeight - 4)
        await waitFor(() => expect(canvas.getByTestId('popover-state')).toHaveTextContent('closed'))
        await expect(body.queryByTestId(PANEL_ID)).toBeNull()
    },
}

/** With `toggleEl` + `onAnchorPress`, a press landing on the trigger (the backdrop covers it, so
 *  it is a geometric test) calls `onAnchorPress` INSTEAD of dismissing — the popover stays open
 *  and the caller decides. A press elsewhere still dismisses. */
export const AnchorPressIsNotADismiss: Story = {
    render: () => <Harness label="Open" anchorPress />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const doc = canvasElement.ownerDocument
        const body = within(doc.body)
        const trigger = canvas.getByTestId('anchor-trigger')
        await userEvent.click(trigger)
        await waitFor(() => body.getByTestId(PANEL_ID))
        const r = trigger.getBoundingClientRect()
        pressAt(doc, r.left + r.width / 2, r.top + r.height / 2)
        await expect(canvas.getByTestId('anchor-presses')).toHaveTextContent('1')
        await expect(canvas.getByTestId('popover-state')).toHaveTextContent('open')
        pressAt(doc, window.innerWidth - 4, window.innerHeight - 4)
        await waitFor(() => expect(canvas.getByTestId('popover-state')).toHaveTextContent('closed'))
        await expect(canvas.getByTestId('anchor-presses')).toHaveTextContent('1')
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
        const panel = await waitFor(() => body.getByTestId(PANEL_ID))
        await expectBeside(panel, trigger, 'above')
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
