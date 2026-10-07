// Visual spec for <Modal> — the shared overlay shell.
//
// Portal-mounted `.ui-overlay` backdrop (scrim) that centers an inner panel, closes on
// Escape, and (unless closeOnBackdrop={false}) on backdrop click. The panel's own look is
// the CALLER's `class` — Modal owns only the overlay + dismiss behavior — so these stories
// supply a representative dialog panel (styled from theme tokens) to show it in context.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, type JSX } from 'solid-js'
import { expect, waitFor } from 'storybook/test'
import { Modal } from './Modal'
import { Button } from './Button'
import { settings, setSettings } from '../settings'

const meta = {
    title: 'UI/Modal',
    component: Modal,
    // The overlay is fixed inset:0, so let it fill the preview frame.
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Modal>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** Alpha channel of a computed `rgb()`/`rgba()`/`color(srgb …)` colour — 1 when it has no alpha. */
function alphaOf(color: string): number {
    const m = color.match(/\/\s*([\d.]+%?)\s*\)|rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/)
    const raw = m?.[1] ?? m?.[2]
    if (raw === undefined) return 1
    return raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw)
}

/** A representative dialog panel (the app passes classes like `.event-modal`; here we
 *  inline the equivalent chrome from theme tokens so the shell shows in context). */
function DialogPanel(props: { onClose?: () => void; children?: JSX.Element }) {
    return (
        <div
            style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                'border-radius': 'var(--r-0)',
                padding: '24px',
                width: 'min(440px, 92vw)',
                display: 'flex',
                'flex-direction': 'column',
                gap: '14px',
            }}
        >
            <div
                style={{
                    'font-family': 'var(--ui-font-stack)',
                    'font-size': 'var(--fs-title)',
                    color: 'var(--fg)',
                }}
            >
                delete note?
            </div>
            <div
                style={{
                    'font-size': 'var(--fs-body)',
                    'line-height': 1.6,
                    color: 'var(--text-muted)',
                }}
            >
                {props.children ??
                    'this moves “meeting notes 2026-07-07” to the trash. you can undo this from the file tree with cmd+z.'}
            </div>
            <div
                style={{
                    display: 'flex',
                    'justify-content': 'flex-end',
                    gap: '8px',
                    'margin-top': '4px',
                }}
            >
                <Button
                    kind="text"
                    state="unselected"
                    onClick={() => props.onClose?.()}
                >
                    cancel
                </Button>
                <Button kind="text" danger onClick={() => props.onClose?.()}>
                    delete
                </Button>
            </div>
        </div>
    )
}

/** The modal shown open (onClose is a no-op so it stays visible for the spec). Bare <Modal> (the
 *  palette's shape) keeps `.asc-modal`'s plain, full border on every side — only FormModal
 *  neutralises it in favour of its own top-rule-aware frame. */
export const Default: Story = {
    render: () => (
        <Modal onClose={noop}>
            <DialogPanel />
        </Modal>
    ),
    play: async () => {
        const panel = document.querySelector('[role="dialog"]') as HTMLElement
        expect(panel).not.toBeNull()
        const border = getComputedStyle(panel)
        expect(border.borderTopStyle).toBe('solid')
        expect(border.borderTopWidth).not.toBe('0px')
        // Same width on every side — a plain full border, not a frame with a gap for a header.
        expect(border.borderBottomWidth).toBe(border.borderTopWidth)
        expect(border.borderLeftWidth).toBe(border.borderTopWidth)
        expect(border.borderRightWidth).toBe(border.borderTopWidth)
        // OPAQUE: the panel's own fill is a solid colour (the 94% tint is a layer over it), so
        // nothing behind the dialog ghosts through.
        expect(alphaOf(border.backgroundColor)).toBe(1)
        // The panel is a tabindex=-1 focus target; it must not paint the browser's default ring.
        expect(border.outlineStyle === 'none' || border.outlineWidth === '0px').toBe(true)
    },
}

/** Loud content behind the dialog — a block of high-contrast text under the panel. The panel must
 *  read opaque in the frame: none of this text may show through its fill. (Regression: at 94%
 *  alpha it ghosted through app-chatview--model-picker and the kanban card's edit dialog.) */
export const OpaqueOverContent: Story = {
    render: () => (
        <>
            <div
                style={{
                    position: 'fixed',
                    inset: 0,
                    'font-family': 'var(--ui-font-stack)',
                    'font-size': 'var(--fs-h1)',
                    'line-height': 1.2,
                    color: 'var(--accent)',
                    'font-weight': 700,
                    overflow: 'hidden',
                    'z-index': 0,
                }}
            >
                {Array.from({ length: 24 }, () => (
                    <div>
                        GHOST GHOST GHOST GHOST GHOST GHOST GHOST GHOST GHOST
                    </div>
                ))}
            </div>
            <Modal onClose={noop} label="opaque dialog">
                <DialogPanel />
            </Modal>
        </>
    ),
    play: async () => {
        const panel = document.querySelector('[role="dialog"]') as HTMLElement
        expect(panel).not.toBeNull()
        expect(alphaOf(getComputedStyle(panel).backgroundColor)).toBe(1)
    },
}

/** Backdrop click does NOT dismiss (closeOnBackdrop={false}); only Escape / an explicit
 *  action closes it. */
export const NonDismissableBackdrop: Story = {
    render: () => (
        <Modal onClose={noop} closeOnBackdrop={false}>
            <DialogPanel>
                This dialog ignores backdrop clicks (closeOnBackdrop=false).
                Press Escape or use a button to close it.
            </DialogPanel>
        </Modal>
    ),
}

/** `ui-dismiss` (settings.keybindings) is rebindable — proves the overlay reads through
 *  widgetKeys.ts's isDismissKey rather than a hardcoded `e.key === 'Escape'` check. Once rebound
 *  away from Escape, a plain Escape press no longer closes it, and only the new combo does. */
export const RebindableDismissKey: Story = {
    parameters: { layout: 'fullscreen' },
    render: () => {
        const [open, setOpen] = createSignal(true)
        return (
            <>
                {open() && (
                    <Modal onClose={() => setOpen(false)}>
                        <DialogPanel />
                    </Modal>
                )}
            </>
        )
    },
    play: async () => {
        const saved = settings.keybindings['ui-dismiss']
        try {
            setSettings('keybindings', 'ui-dismiss', 'Mod+.')
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Escape',
                    code: 'Escape',
                    bubbles: true,
                }),
            )
            // Still present — plain Escape no longer dismisses once rebound.
            await expect(
                document.querySelector('[role="dialog"]'),
            ).not.toBeNull()
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: '.',
                    code: 'Period',
                    metaKey: true,
                    bubbles: true,
                }),
            )
            await waitFor(() =>
                expect(document.querySelector('[role="dialog"]')).toBeNull(),
            )
        } finally {
            setSettings('keybindings', 'ui-dismiss', saved)
        }
    },
}

/** Interactive: a trigger opens the modal; Escape / backdrop / a button closes it. */
export const Interactive: Story = {
    render: () => {
        const [open, setOpen] = createSignal(true)
        return (
            <div style={{ padding: '40px' }}>
                <Button
                    kind="text"
                    state="selected"
                    onClick={() => setOpen(true)}
                >
                    open modal
                </Button>
                {open() && (
                    <Modal onClose={() => setOpen(false)}>
                        <DialogPanel onClose={() => setOpen(false)} />
                    </Modal>
                )}
            </div>
        )
    },
}

const pressKey = (key: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', {
        key,
        code: key,
        bubbles: true,
        cancelable: true,
        ...init,
    })
    document.body.dispatchEvent(e)
    return e
}
const dialogs = () => document.querySelectorAll('[role="dialog"]')

/** Two modals portaled as SIBLINGS (the second is opened from the first's body, but Portal mounts
 *  both under <body>). Only the topmost owns Escape and the Tab trap: Escape closes the second and
 *  leaves the first, a second Escape closes the first, and Tab wraps inside the top modal. */
export const StackedEscape: Story = {
    render: () => {
        const [outer, setOuter] = createSignal(true)
        const [inner, setInner] = createSignal(false)
        return (
            <>
                {outer() && (
                    <Modal label="outer" onClose={() => setOuter(false)}>
                        <DialogPanel>
                            <Button
                                kind="text"
                                data-testid="open-inner"
                                onClick={() => setInner(true)}
                            >
                                open second
                            </Button>
                        </DialogPanel>
                    </Modal>
                )}
                {inner() && (
                    <Modal label="inner" onClose={() => setInner(false)}>
                        <DialogPanel>
                            <Button kind="text" data-testid="inner-a">
                                first
                            </Button>
                            <Button kind="text" data-testid="inner-b">
                                last
                            </Button>
                        </DialogPanel>
                    </Modal>
                )}
            </>
        )
    },
    play: async () => {
        await waitFor(() => expect(dialogs().length).toBe(1))
        const open = document.querySelector(
            '[data-testid="open-inner"]',
        ) as HTMLElement
        open.click()
        await waitFor(() => expect(dialogs().length).toBe(2))
        // Tab trap belongs to the TOP modal: from its last stop, Tab wraps to its first stop.
        const stops = [
            ...dialogs()[1]!.querySelectorAll('button'),
        ] as HTMLElement[]
        const first = stops[0]!
        stops[stops.length - 1]!.focus()
        pressKey('Tab')
        await waitFor(() => expect(document.activeElement).toBe(first))
        await expect(dialogs()[1]!.contains(document.activeElement)).toBe(true)
        // Escape closes only the top modal.
        pressKey('Escape')
        await waitFor(() => expect(dialogs().length).toBe(1))
        await expect(
            document.querySelector('[data-testid="open-inner"]'),
        ).not.toBeNull()
        // A second Escape closes the one underneath.
        pressKey('Escape')
        await waitFor(() => expect(dialogs().length).toBe(0))
    },
}
