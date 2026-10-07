// Visual spec for <ColorChip> — a colour swatch chip that opens a palette popover (default: the
// seven theme tokens; or a caller palette plus an `auto` entry). Extracted from CategoryPanel's private ColorChip/Palette pair (see that file
// and ColorChip.tsx's header comment) so both CategoryPanel and TaskCalendarSettings compose the
// same component instead of two copies that could drift.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import ColorChip from './ColorChip'
import StatusDot from './StatusDot'

const meta = {
    title: 'UI/ColorChip',
    component: ColorChip,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof ColorChip>

export default meta
type Story = StoryObj<typeof meta>

/** Resting state — the popover closed. */
export const Closed: Story = {
    args: {
        color: 'rose',
        open: false,
        onToggle: () => {},
        onPick: () => {},
    },
    play: ({ canvasElement }) => {
        const chip = within(canvasElement).getByLabelText('Choose colour')
        expect(chip.getBoundingClientRect().width).toBeGreaterThan(0)
        expect(getComputedStyle(chip).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
        expect(document.querySelector('[data-testid="category-palette"]')).toBeNull()
    },
}

/** The popover open, downward (the default) — seven palette tokens, the stored colour's swatch
 *  highlighted. `color` is a RESOLVED `var(--token)` string, the shape `taskCategoryColors`
 *  actually hands `ColorChip` (see `app/src/calendar/taskCategory.ts`) — not the bare token
 *  `CategoryPanel` stores — so this exercises the real seam, not just the stored-token form. */
export const Open: Story = {
    args: {
        color: 'var(--green)',
        open: true,
        onToggle: () => {},
        onPick: () => {},
    },
    play: async () => {
        await waitFor(() =>
            expect(
                document.querySelector('[data-testid="category-palette"]'),
            ).not.toBeNull(),
        )
        const palette = document.querySelector(
            '[data-testid="category-palette"]',
        ) as HTMLElement
        const pressed = palette.querySelectorAll(
            'button[aria-pressed="true"]',
        )
        // Exactly one swatch is selected, and it is the one matching the resolved colour —
        // this is the assertion that fails without the ColorChip.tsx `selected` fix, since a
        // bare `props.value === tok` comparison never matches a `var(--token)` value.
        expect(pressed.length).toBe(1)
        expect(pressed[0]).toHaveAttribute('aria-label', 'green')
        // the palette sits on the shared floating surface, not a private copy of its recipe
        expect(palette.querySelector('[data-popover]')).not.toBeNull()
    },
}

/** Kanban's shape: five raw `var(--graph-N)` values plus an `auto` entry, holding real state.
 *  Picks graph-3, then auto, and asserts what the caller stored each time. */
export const GraphPaletteWithAuto: Story = {
    render: () => {
        const graph = [1, 2, 3, 4, 5].map(n => `var(--graph-${n})`)
        const [color, setColor] = createSignal<string | null>(null)
        const [open, setOpen] = createSignal(true)
        return (
            <div>
                <ColorChip
                    color={color() ?? ''}
                    open={open()}
                    palette={graph}
                    auto={{
                        label: 'auto',
                        selected: color() === null,
                        onPick: () => {
                            setColor(null)
                            setOpen(false)
                        },
                    }}
                    onToggle={() => setOpen(v => !v)}
                    onPick={v => {
                        setColor(v)
                        setOpen(false)
                    }}
                />
                <output data-testid="stored">{color() ?? 'auto'}</output>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const stored = () =>
            canvasElement.querySelector('[data-testid="stored"]')?.textContent
        const panel = () =>
            document.querySelector('[data-testid="category-palette"]')
        await waitFor(() => expect(panel()).not.toBeNull())
        expect(panel()!.querySelectorAll('button[aria-label^="graph-"]').length).toBe(5)
        await userEvent.click(
            panel()!.querySelector('button[aria-label="graph-3"]') as HTMLElement,
        )
        await waitFor(() => expect(stored()).toBe('var(--graph-3)'))
        await userEvent.click(within(canvasElement).getByLabelText('Choose colour'))
        await waitFor(() => expect(panel()).not.toBeNull())
        expect(
            panel()!.querySelector('button[aria-label="graph-3"]'),
        ).toHaveAttribute('aria-pressed', 'true')
        await userEvent.click(within(panel() as HTMLElement).getByText('auto'))
        await waitFor(() => expect(stored()).toBe('auto'))
    },
}

/** A chip at the bottom edge of the viewport: AnchoredPopover flips the palette above it. */
export const NearBottomEdge: Story = {
    parameters: { layout: 'fullscreen' },
    render: () => {
        const [open, setOpen] = createSignal(true)
        return (
            <div
                style={{
                    height: '100vh',
                    display: 'flex',
                    'align-items': 'flex-end',
                }}
            >
                <ColorChip
                    color="gold"
                    open={open()}
                    onToggle={() => setOpen(v => !v)}
                    onPick={() => {}}
                />
            </div>
        )
    },
    play: async () => {
        const wrapper = document.querySelector('[data-testid="category-chip"]')
        await waitFor(() =>
            expect(
                document.querySelector('[data-testid="category-palette"]'),
            ).not.toBeNull(),
        )
        const popover = document.querySelector(
            '[data-testid="category-palette"]',
        ) as HTMLElement
        if (!(wrapper instanceof HTMLElement)) throw new Error('chip not found')
        // No room below, so it flips: the palette's bottom edge sits above the chip's top edge.
        await waitFor(() =>
            expect(popover.getBoundingClientRect().bottom).toBeLessThanOrEqual(
                wrapper.getBoundingClientRect().top,
            ),
        )
    },
}

/** Clicking the chip toggles the popover, and picking a swatch reports the token then closes
 *  it — the caller-owned open/close + onPick round trip. */
export const Interactive: Story = {
    render: () => {
        const [color, setColor] = createSignal('accent')
        const [open, setOpen] = createSignal(false)
        return (
            <ColorChip
                color={color()}
                open={open()}
                onToggle={() => setOpen(v => !v)}
                onPick={tok => {
                    setColor(tok)
                    setOpen(false)
                }}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const chip = canvas.getByLabelText('Choose colour')
        await userEvent.click(chip)
        // The palette is portaled to <body>, outside the canvas element.
        const violet = within(document.body).getByLabelText('violet')
        await userEvent.click(violet)
        await waitFor(() =>
            expect(
                document.querySelector('[data-testid="category-palette"]'),
            ).toBeNull(),
        )
    },
}

/** No stored colour (`''`, as TaskCalendarSettings passes for an uncoloured category): the chip
 *  reads as EMPTY — a dashed, unfilled box — rather than a solid accent swatch that looks like a
 *  chosen teal. */
export const EmptyColor: Story = {
    args: {
        color: '',
        open: false,
        onToggle: () => {},
        onPick: () => {},
    },
    play: async ({ canvasElement }) => {
        const chip = within(canvasElement).getByLabelText('Choose colour')
        const cs = getComputedStyle(chip)
        expect(cs.backgroundColor).toBe('rgba(0, 0, 0, 0)')
        expect(cs.borderStyle).toBe('dashed')
        const r = chip.getBoundingClientRect()
        expect(r.width).toBeGreaterThan(0)
    },
}

/** A custom trigger (a StatusDot) in place of the swatch — the Kanban column header's shape. The
 *  dot toggles the palette; a pick repaints the dot. Real state, real round trip. */
export const CustomTrigger: Story = {
    render: () => {
        const [color, setColor] = createSignal('var(--graph-2)')
        const [open, setOpen] = createSignal(false)
        return (
            <ColorChip
                color={color()}
                open={open()}
                trigger={<StatusDot color={color()} />}
                palette={['var(--graph-1)', 'var(--graph-2)', 'var(--graph-3)']}
                onToggle={() => setOpen(v => !v)}
                onPick={v => {
                    setColor(v)
                    setOpen(false)
                }}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const trigger = within(canvasElement).getByLabelText('Choose colour')
        // One control, one hover: the custom trigger brightens like the default Swatch trigger
        // (a `filter` transition) instead of washing a 12% fill behind the dot. A synthetic
        // pointer cannot raise CSS `:hover`, so this pins the transitioned property, not the state.
        expect(getComputedStyle(trigger).transitionProperty).toBe('filter')
        expect(getComputedStyle(trigger).backgroundColor).toBe('rgba(0, 0, 0, 0)')
        await userEvent.click(trigger)
        await waitFor(() =>
            expect(
                document.querySelector('[data-testid="category-palette"]'),
            ).not.toBeNull(),
        )
        await userEvent.click(
            within(
                document.querySelector('[data-testid="category-palette"]') as HTMLElement,
            ).getByLabelText('graph-3'),
        )
        await waitFor(() =>
            expect(
                document.querySelector('[data-testid="category-palette"]'),
            ).toBeNull(),
        )
    },
}
