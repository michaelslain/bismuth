// Visual spec for <IconButton> — the icon-only wrapper over the base <Button kind="icon">.
//
// Props: icon (icon name, required), label (required a11y label → aria-label + title),
// variant ("normal" default | "selected" | "unselected"), danger, size, iconSize, plus any
// native <button> attribute (disabled, onClick, …).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent } from 'storybook/test'
import { IconButton } from './IconButton'
import IconBar from './IconBar'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/IconButton',
    component: IconButton,
    parameters: { layout: 'centered' },
    argTypes: {
        icon: { control: 'text' },
        label: { control: 'text' },
        variant: {
            control: 'inline-radio',
            options: ['normal', 'selected', 'unselected'],
        },
        size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
        danger: { control: 'boolean' },
        disabled: { control: 'boolean' },
        iconSize: { control: 'number' },
    },
    args: {
        icon: 'Star',
        label: 'Star',
        variant: 'normal',
        danger: false,
        disabled: false,
    },
} satisfies Meta<typeof IconButton>

export default meta
type Story = StoryObj<typeof meta>

/** Fully controllable single icon button. */
export const Playground: Story = {}

/** The three selection states, plus danger + disabled. Brackets mean "on": only `selected` draws
 *  `[▣]`; `normal`/danger are bare glyphs (accent on hover); `unselected` reserves its brackets'
 *  space without painting them. */
export const States: Story = {
    render: () => (
        <Row wrap={false} gap="var(--bar-icon-gap)">
            <IconButton icon="Star" label="Star (normal)" variant="normal" />
            <IconButton
                icon="Star"
                label="Star (unselected)"
                variant="unselected"
            />
            <IconButton
                icon="Star"
                label="Star (selected)"
                variant="selected"
            />
            <IconButton icon="Trash2" label="Delete" danger />
            <IconButton icon="Star" label="Star (disabled)" disabled />
        </Row>
    ),
}

/** Sizes (shares Button's sm/md/lg scale). */
export const Sizes: Story = {
    render: () => (
        <Row wrap={false} gap="var(--bar-icon-gap)">
            <IconButton icon="Search" label="Search (sm)" size="sm" />
            <IconButton icon="Search" label="Search (md)" size="md" />
            <IconButton icon="Search" label="Search (lg)" size="lg" />
        </Row>
    ),
}

/** Custom icon pixel size (default 12 — an exact 0.5 scale of the 24×24 pixel-icon grid). */
export const IconSize: Story = {
    render: () => (
        <Row wrap={false} gap="var(--bar-icon-gap)">
            <IconButton
                icon="Settings"
                label="Settings (12px, current default)"
                iconSize={12}
            />
            <IconButton icon="Settings" label="Settings (16px)" iconSize={16} />
            <IconButton icon="Settings" label="Settings (24px)" iconSize={24} />
        </Row>
    ),
}

/** NO OUTLINE, ON ANY BUTTON, MOUSE OR KEYBOARD — not even `:focus-visible` (user request,
 *  2026-09-23; see Button.module.css's `.btn:focus, .btn:focus-visible { outline: none }`). The
 *  user's original complaint was a ring left on an icon bracket button after a CLICK, so this
 *  proves both paths: `tab()` focuses the first button via the keyboard (the one path the UA's own
 *  `:focus-visible` ring would otherwise paint) and a `click()` focuses the second via the mouse.
 *  Both assert the SAME three facts — the element actually matches `:focus-visible` (so the check
 *  is not vacuously true against an unfocused element), `outlineStyle` is `none`, and `boxShadow`
 *  is `none` (the other property a stray ring could hide behind). */
export const NoFocusRing: Story = {
    render: () => (
        <Row wrap={false} gap="var(--bar-icon-gap)">
            <IconButton icon="Star" label="Star" />
            <IconButton icon="Settings" label="Settings" />
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const buttons = [
            ...canvasElement.querySelectorAll<HTMLButtonElement>('button'),
        ]
        const [first, second] = buttons

        await userEvent.tab()
        expect(first!.matches(':focus-visible')).toBe(true)
        expect(getComputedStyle(first!).outlineStyle).toBe('none')
        expect(getComputedStyle(first!).boxShadow).toBe('none')

        await userEvent.click(second!)
        expect(getComputedStyle(second!).outlineStyle).toBe('none')
        expect(getComputedStyle(second!).boxShadow).toBe('none')
    },
}

/** A row of icon buttons as used in a view-bar / toolbar (e.g. BaseView's Source toggle). */
export const ToolbarGroup: Story = {
    render: () => (
        <Row
            label="typical toolbar group"
            wrap={false}
            gap="var(--bar-icon-gap)"
        >
            <IconButton icon="Code" label="Source" />
            <IconButton icon="Settings" label="Settings" variant="selected" />
            <IconButton icon="X" label="Close" />
        </Row>
    ),
}

/** The same states in a toolbar (an IconBar) and standalone, stacked so they compare column by
 *  column: one bracket size, one ink-to-ink gap, whatever the host. Only the invisible hit height
 *  differs (the bar's 18px box against 24px standalone). */
export const ToolbarAndStandalone: Story = {
    render: () => {
        const set = () => (
            <>
                <IconButton icon="Search" label="Search" />
                <IconButton
                    icon="Inbox"
                    label="Inbox (unselected)"
                    variant="unselected"
                />
                <IconButton
                    icon="Settings"
                    label="Settings (selected)"
                    variant="selected"
                />
                <IconButton icon="Trash2" label="Delete" danger />
                <IconButton icon="Star" label="Star (disabled)" disabled />
            </>
        )
        return (
            <Row column gap="10px">
                <IconBar label="Toolbar">{set()}</IconBar>
                <Row wrap={false} gap="var(--bar-icon-gap)">
                    {set()}
                </Row>
            </Row>
        )
    },
}

const TOOLS = ['Pencil', 'Eraser', 'Square', 'Box']

/** A toggle group (the drawing dock's shape) with the selection in two different places. Only the
 *  on member draws `[▣]`; the off members hold their brackets' space, so both rows are the SAME
 *  width — moving the selection never shifts a sibling. `play` measures it. */
export const ToggleGroupWidth: Story = {
    render: () => (
        <Row column gap="10px">
            {[0, 2].map(on => (
                <div
                    data-testid="group"
                    style={{
                        display: 'inline-flex',
                        gap: 'var(--bar-icon-gap)',
                        'align-self': 'flex-start',
                    }}
                >
                    {TOOLS.map((icon, i) => (
                        <IconButton
                            {...{ icon }}
                            label={icon}
                            variant={i === on ? 'selected' : 'unselected'}
                        />
                    ))}
                </div>
            ))}
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const groups = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="group"]',
            ),
        ]
        expect(groups.length).toBe(2)
        const [a, b] = groups.map(g => g.getBoundingClientRect().width)
        expect(Math.abs(a! - b!)).toBeLessThan(0.5)
    },
}
