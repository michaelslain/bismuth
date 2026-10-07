// Visual spec for <MenuRow> — one popover row: [icon] label [detail]. Pure
// presentation, no positioning; the anatomy PopoverList repeats per item and the
// CodeMirror autocomplete reproduces via the same CSS classes.
//
// Props: label (required), icon?, prefix?, detail?, shortcut?, danger?, disabled?, selected?,
// hasSubmenu?, onClick?/onMouseEnter?.
//
// `shortcut` is a real keybinding (rendered by Kbd); `detail` is descriptive text. A keybinding
// passed as `detail` renders at the text size (11.5px) against Kbd's 10.5px caps — don't.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { expect } from 'storybook/test'
import MenuRow from './MenuRow'

const meta = {
    title: 'UI/Popover/MenuRow',
    component: MenuRow,
    parameters: { layout: 'centered' },
    argTypes: {
        label: { control: 'text' },
        icon: { control: 'text' },
        detail: { control: 'text' },
        danger: { control: 'boolean' },
        disabled: { control: 'boolean' },
        selected: { control: 'boolean' },
        hasSubmenu: { control: 'boolean' },
    },
    args: {
        label: 'Rename',
        icon: 'Pencil',
    },
} satisfies Meta<typeof MenuRow>

export default meta
type Story = StoryObj<typeof meta>

// A row renders full-bleed inside its popover container; give it a fixed width here
// so it doesn't collapse to text width in isolation.
function Wrap(props: { children: JSX.Element }) {
    return (
        <div
            style={{
                width: '220px',
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                padding: '4px',
            }}
        >
            {props.children}
        </div>
    )
}

/** Fully controllable single row. */
export const Playground: Story = {
    render: args => (
        <Wrap>
            <MenuRow {...args} />
        </Wrap>
    ),
}

/** Every state stacked: normal, selected (highlighted), danger, disabled, with a
 *  detail hint, and one with a submenu chevron. */
export const AllStates: Story = {
    render: () => (
        <Wrap>
            <MenuRow label="Normal" icon="Pencil" />
            <MenuRow label="Selected" icon="Copy" selected />
            <MenuRow label="Delete" icon="Trash2" danger />
            <MenuRow label="Paste" icon="Clipboard" disabled />
            <MenuRow label="Undo" icon="Undo2" shortcut="Mod+Z" />
            <MenuRow label="Move to" icon="FolderInput" detail="reading/quotes" />
            <MenuRow label="Duplicate" icon="Copy" shortcut="Mod+Shift+D" />
            <MenuRow label="Move to…" icon="FolderInput" hasSubmenu />
        </Wrap>
    ),
}

/** No icon — a bare label row (e.g. a Select option). */
export const NoIcon: Story = {
    render: () => (
        <Wrap>
            <MenuRow label="Ink" selected />
            <MenuRow label="Paper" />
        </Wrap>
    ),
}

/** What a token resolves to as a colour on this page — the probe the plays compare against, so
 *  no colour is hardcoded here. */
function resolvedColor(doc: Document, property: 'color' | 'background-color', token: string): string {
    const probe = doc.createElement('div')
    probe.style.setProperty(property, `var(${token})`)
    doc.body.appendChild(probe)
    const value = getComputedStyle(probe).getPropertyValue(property)
    probe.remove()
    return value
}

/** A `prefix` element before the label (a colour swatch dot) instead of an icon. */
export const WithPrefix: Story = {
    render: () => (
        <Wrap>
            <MenuRow
                label="Ink"
                prefix={
                    <span
                        style={{
                            display: 'inline-block',
                            width: '8px',
                            height: '8px',
                            background: 'var(--accent)',
                        }}
                    />
                }
            />
            <MenuRow
                label="Paper"
                selected
                prefix={
                    <span
                        style={{
                            display: 'inline-block',
                            width: '8px',
                            height: '8px',
                            background: 'var(--fg)',
                        }}
                    />
                }
            />
        </Wrap>
    ),
}

/** A label longer than the row truncates with an ellipsis and never pushes the trailing
 *  shortcut out of the row. */
export const LongLabel: Story = {
    render: () => (
        <Wrap>
            <MenuRow
                label="Move this note to another folder in the vault"
                icon="FolderInput"
                shortcut="Mod+Shift+M"
            />
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector('.bismuth-popover-row') as HTMLElement
        const label = row.querySelector('.bismuth-popover-label') as HTMLElement
        const shortcut = row.querySelector('.bismuth-popover-shortcut') as HTMLElement
        await expect(label.scrollWidth).toBeGreaterThan(label.clientWidth)
        await expect(getComputedStyle(label).textOverflow).toBe('ellipsis')
        await expect(shortcut.getBoundingClientRect().right).toBeLessThanOrEqual(
            row.getBoundingClientRect().right + 0.5,
        )
    },
}

/** A plain mouse-over gets the light hover wash (`--state-hover-bg`), not the selected fill.
 *  The wash can't be SHOWN here: `:hover` is the real pointer's state and a play's simulated
 *  `userEvent.hover` never sets it, so no frame can hold a hovered row. What the play can pin is
 *  the rule itself — that a `:hover` rule on the row exists, paints `--state-hover-bg`, and skips
 *  a disabled row — so deleting or re-pointing it fails here. */
export const Hover: Story = {
    render: () => (
        <Wrap>
            <MenuRow label="Normal" icon="Pencil" />
            <MenuRow label="Disabled" icon="Clipboard" disabled />
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const rules: CSSStyleRule[] = []
        const collect = (list: CSSRuleList) => {
            for (const rule of Array.from(list)) {
                if (rule instanceof CSSStyleRule) rules.push(rule)
                else if ('cssRules' in rule) collect((rule as CSSGroupingRule).cssRules)
            }
        }
        for (const sheet of Array.from(canvasElement.ownerDocument.styleSheets)) {
            try {
                collect(sheet.cssRules)
            } catch {
                // a cross-origin sheet (a font stylesheet) is unreadable and irrelevant here
            }
        }
        const hover = rules.find(
            r => r.selectorText.includes('.bismuth-popover-row:hover') && r.style.background.includes('--state-hover-bg'),
        )
        await expect(hover).toBeDefined()
        await expect(hover?.selectorText).toContain(':not(.bismuth-popover-row--disabled)')
    },
}

/** Stacked states: the INK and the FILL are decided separately. A selected delete row keeps the
 *  selected fill (--state-selected-bg) but its text AND icon stay `--danger` — it must not turn
 *  accent and read as a harmless row. */
export const SelectedDanger: Story = {
    render: () => (
        <Wrap>
            <MenuRow label="Delete" icon="Trash2" danger selected />
            <MenuRow label="Archive" icon="Archive" selected />
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const doc = canvasElement.ownerDocument
        const [danger, plain] = Array.from(
            canvasElement.querySelectorAll<HTMLElement>('.bismuth-popover-row'),
        )
        const fill = resolvedColor(doc, 'background-color', '--state-selected-bg')
        await expect(getComputedStyle(danger).backgroundColor).toBe(fill)
        await expect(getComputedStyle(danger).color).toBe(resolvedColor(doc, 'color', '--danger'))
        await expect(
            getComputedStyle(danger.querySelector('.bismuth-popover-icon') as HTMLElement).color,
        ).toBe(resolvedColor(doc, 'color', '--danger'))
        await expect(getComputedStyle(plain).color).toBe(resolvedColor(doc, 'color', '--accent'))
    },
}

/** Stacked states: a selected disabled row (the keyboard cursor landed on it) keeps the fill but
 *  its ink stays muted — it does not light up as if it could be activated. */
export const SelectedDisabled: Story = {
    render: () => (
        <Wrap>
            <MenuRow label="Paste" icon="Clipboard" disabled selected />
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const doc = canvasElement.ownerDocument
        const row = canvasElement.querySelector('.bismuth-popover-row') as HTMLElement
        await expect(getComputedStyle(row).backgroundColor).toBe(
            resolvedColor(doc, 'background-color', '--state-selected-bg'),
        )
        await expect(getComputedStyle(row).color).toBe(resolvedColor(doc, 'color', '--text-muted'))
    },
}

/** The trailing column: the submenu chevron's glyph box protrudes past the row's inner edge by
 *  the icon's own empty padding, so its INK ends where a shortcut's or detail's does. */
export const TrailingEdge: Story = {
    render: () => (
        <Wrap>
            <MenuRow label="Duplicate" icon="Copy" shortcut="Mod+Shift+D" />
            <MenuRow label="Move to…" icon="FolderInput" hasSubmenu />
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const rows = canvasElement.querySelectorAll<HTMLElement>('.bismuth-popover-row')
        const inner = (row: HTMLElement) =>
            row.getBoundingClientRect().right - parseFloat(getComputedStyle(row).paddingRight)
        const shortcut = rows[0].querySelector('.bismuth-popover-shortcut') as HTMLElement
        const chev = rows[1].querySelector('.bismuth-popover-chev') as HTMLElement
        await expect(Math.abs(shortcut.getBoundingClientRect().right - inner(rows[0]))).toBeLessThan(0.5)
        const protrusion = chev.getBoundingClientRect().right - inner(rows[1])
        await expect(protrusion).toBeGreaterThan(2.5)
        await expect(protrusion).toBeLessThan(4.5)
    },
}
