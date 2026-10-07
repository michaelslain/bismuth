// Visual spec for <PopoverList> — the shared floating-list surface every menu-style
// popover renders (ContextMenu, Select's open dropdown, …). Pure presentation: no
// positioning/dismiss/keyboard (the parent owns those via createMenuNav + placement).
//
// Props: items (PopoverRow[]: label, icon?, prefix?, detail?, shortcut?, danger?, disabled?,
// separatorBefore?, hasSubmenu?), active? (highlighted index), onActivate, onHover?,
// style?/class?/ref?. The surface is ui/Popover, tone "menu": opaque --bg, 1px --border, radius
// 0, hard 2px 2px 0 lift, 4px inset.
//
// Rendered un-portaled here (inline, not fixed-positioned) so it shows in the normal
// document flow instead of needing a trigger + click choreography.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect } from 'storybook/test'
import PopoverList, { type PopoverRow } from './PopoverList'

const meta = {
    title: 'UI/Popover/PopoverList',
    component: PopoverList,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof PopoverList>

export default meta
type Story = StoryObj<typeof meta>

const BASIC_ITEMS: PopoverRow[] = [
    { label: 'Rename', icon: 'Pencil' },
    { label: 'Duplicate', icon: 'Copy' },
    { label: 'Move to…', icon: 'FolderInput', hasSubmenu: true },
    { label: 'Delete', icon: 'Trash2', danger: true, separatorBefore: true },
]

function Controlled(props: { items: PopoverRow[] }) {
    const [active, setActive] = createSignal<number | undefined>(undefined)
    return (
        <PopoverList
            items={props.items}
            active={active()}
            onActivate={setActive}
            onHover={setActive}
        />
    )
}

/** A typical right-click context menu shape: icons, a submenu row, a separator before
 *  the destructive action. */
export const ContextMenuShape: Story = {
    render: () => <Controlled items={BASIC_ITEMS} />,
}

/** A row highlighted (as createMenuNav would drive via keyboard/hover). */
export const WithActiveRow: Story = {
    render: () => (
        <PopoverList items={BASIC_ITEMS} active={1} onActivate={() => {}} />
    ),
}

/** A disabled row (dimmed, ignores hover/click). */
export const WithDisabledRow: Story = {
    render: () => (
        <PopoverList
            items={[
                { label: 'Cut', icon: 'Scissors' },
                { label: 'Copy', icon: 'Copy' },
                { label: 'Paste', icon: 'Clipboard', disabled: true },
            ]}
            onActivate={() => {}}
        />
    ),
}

/** Rows with a trailing shortcut (a real keybinding, rendered by Kbd at the Kbd size) and rows
 *  with descriptive `detail` text — the two are different props. */
export const WithShortcut: Story = {
    render: () => (
        <PopoverList
            items={[
                { label: 'Undo', icon: 'Undo2', shortcut: 'Mod+Z' },
                { label: 'Redo', icon: 'Redo2', shortcut: 'Mod+Shift+Z' },
            ]}
            onActivate={() => {}}
        />
    ),
}

export const WithDetail: Story = {
    render: () => (
        <PopoverList
            items={[
                { label: 'Move to', icon: 'FolderInput', detail: 'reading/quotes' },
                { label: 'Tags', icon: 'Tag', detail: '3 tags' },
            ]}
            onActivate={() => {}}
        />
    ),
}

/** Plain rows with no icons at all (e.g. a Select dropdown's option list). */
export const NoIcons: Story = {
    render: () => (
        <PopoverList
            items={[
                { label: 'Ink' },
                { label: 'Paper' },
                { label: 'Cathode' },
                { label: 'Riso' },
            ]}
            active={0}
            onActivate={() => {}}
        />
    ),
}

/** What a token resolves to as a colour on this page — the probe the plays compare against. */
function resolvedColor(doc: Document, property: 'color' | 'background-color', token: string): string {
    const probe = doc.createElement('div')
    probe.style.setProperty(property, `var(${token})`)
    doc.body.appendChild(probe)
    const value = getComputedStyle(probe).getPropertyValue(property)
    probe.remove()
    return value
}

/** A small custom element before the label (a colour swatch dot). */
export const WithPrefix: Story = {
    render: () => (
        <PopoverList
            items={['accent', 'fg', 'danger'].map(token => ({
                label: token,
                prefix: (
                    <span
                        style={{
                            display: 'inline-block',
                            width: '8px',
                            height: '8px',
                            background: `var(--${token})`,
                        }}
                    />
                ),
            }))}
            active={0}
            onActivate={() => {}}
        />
    ),
}

/** A label wider than the menu truncates with an ellipsis; the shortcut stays visible. */
export const LongLabel: Story = {
    render: () => (
        <PopoverList
            style={{ width: '220px' }}
            items={[
                { label: 'Move this note to another folder', icon: 'FolderInput', shortcut: 'Mod+Shift+M' },
                { label: 'Rename', icon: 'Pencil' },
            ]}
            onActivate={() => {}}
        />
    ),
    play: async ({ canvasElement }) => {
        const label = canvasElement.querySelector('.bismuth-popover-label') as HTMLElement
        await expect(label.scrollWidth).toBeGreaterThan(label.clientWidth)
    },
}

/** The keyboard cursor on a destructive row: selected fill, danger ink (text and icon). */
export const SelectedDanger: Story = {
    render: () => <PopoverList items={BASIC_ITEMS} active={3} onActivate={() => {}} />,
    play: async ({ canvasElement }) => {
        const doc = canvasElement.ownerDocument
        const row = canvasElement.querySelectorAll<HTMLElement>('.bismuth-popover-row')[3]
        await expect(getComputedStyle(row).backgroundColor).toBe(
            resolvedColor(doc, 'background-color', '--state-selected-bg'),
        )
        await expect(getComputedStyle(row).color).toBe(resolvedColor(doc, 'color', '--danger'))
    },
}

/** The keyboard cursor on a disabled row: selected fill, muted ink. */
export const SelectedDisabled: Story = {
    render: () => (
        <PopoverList
            items={[
                { label: 'Cut', icon: 'Scissors' },
                { label: 'Paste', icon: 'Clipboard', disabled: true },
            ]}
            active={1}
            onActivate={() => {}}
        />
    ),
    play: async ({ canvasElement }) => {
        const doc = canvasElement.ownerDocument
        const row = canvasElement.querySelectorAll<HTMLElement>('.bismuth-popover-row')[1]
        await expect(getComputedStyle(row).color).toBe(resolvedColor(doc, 'color', '--text-muted'))
    },
}

/** The menu recipe, measured: opaque --bg, 1px border, radius 0, 4px inset, 18px rows with an
 *  8px inset, a hard right+bottom lift. Fails if the surface goes translucent or the geometry
 *  drifts. */
export const Surface: Story = {
    render: () => <PopoverList items={BASIC_ITEMS} onActivate={() => {}} />,
    play: async ({ canvasElement }) => {
        const doc = canvasElement.ownerDocument
        const menu = canvasElement.querySelector('.bismuth-popover') as HTMLElement
        const row = menu.querySelector('.bismuth-popover-row') as HTMLElement
        const cs = getComputedStyle(menu)
        await expect(cs.backgroundColor).toBe(resolvedColor(doc, 'background-color', '--bg'))
        await expect(cs.backgroundColor).not.toMatch(/rgba/)
        await expect(cs.borderTopWidth).toBe('1px')
        await expect(cs.borderTopLeftRadius).toBe('0px')
        await expect(cs.paddingLeft).toBe('4px')
        await expect(cs.boxShadow).toMatch(/2px 2px 0px/)
        await expect(row.getBoundingClientRect().height).toBe(18)
        await expect(getComputedStyle(row).paddingLeft).toBe('8px')
    },
}
