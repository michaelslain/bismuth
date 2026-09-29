// Visual spec for <ContextMenu> — the cursor-positioned action menu every right-click surface
// in the app renders (file tree, editor, DaemonList, chat bubbles, calendar chips, …). Pure
// cursor placement + dismiss + one level of submenu flyout over the shared <PopoverList>
// surface; no IO.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, waitFor } from 'storybook/test'
import { Modal } from './ui/Modal'
import { ContextMenu, type MenuItem } from './ContextMenu'

const meta = {
    title: 'App/ContextMenu',
    component: ContextMenu,
    // position:fixed at arbitrary x/y — let the story canvas fill the viewport.
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ContextMenu>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

const FILE_ROW_ITEMS: MenuItem[] = [
    { label: 'Rename', icon: 'Pencil', onSelect: noop },
    { label: 'Duplicate', icon: 'Copy', onSelect: noop },
    {
        label: 'Move to…',
        icon: 'FolderInput',
        submenu: [
            { label: 'reading/', onSelect: noop },
            { label: 'projects/', onSelect: noop },
            { label: 'archive/', onSelect: noop },
        ],
    },
    {
        label: 'Delete',
        icon: 'Trash2',
        danger: true,
        separatorBefore: true,
        onSelect: noop,
    },
]

/** A typical file-row menu: plain rows, a nested submenu (hover/Right-arrow opens the
 *  flyout), and a danger row below a separator. */
export const Default: Story = {
    render: () => (
        <ContextMenu x={140} y={90} items={FILE_ROW_ITEMS} onClose={noop} />
    ),
}

/** A disabled row (DaemonList's "Run now" while already running) plus a quick-action rail —
 *  icon buttons pinned BESIDE the menu rather than competing with a long row list (#67). */
export const WithQuickActionsAndDisabledRow: Story = {
    render: () => (
        <ContextMenu
            x={260}
            y={160}
            items={[
                {
                    label: 'Run now (already running)',
                    icon: 'Play',
                    disabled: true,
                    onSelect: noop,
                },
                {
                    label: 'Disable',
                    icon: 'PowerOff',
                    separatorBefore: true,
                    onSelect: noop,
                },
            ]}
            quickActions={[{ icon: 'Pin', label: 'Pin', onSelect: noop }]}
            onClose={noop}
        />
    ),
}

/** A menu opened near the bottom edge must flip ABOVE the cursor, not run off screen. The
 *  component already flips horizontally (the rail, and submenus near the right edge); the
 *  vertical case was never written, so a right-click low in the window lost its last rows —
 *  including, in the reported case, every spellcheck suggestion below the first. */
export const NearBottomEdge: Story = {
    render: () => (
        <ContextMenu
            x={120}
            y={window.innerHeight - 40}
            items={Array.from({ length: 8 }, (_, i) => ({
                label: `Item ${i + 1}`,
                onSelect: () => {},
            }))}
            onClose={() => {}}
        />
    ),
    play: async () => {
        const menu = document.querySelector('.bismuth-popover') as HTMLElement
        await expect(menu).not.toBeNull()
        const r = menu.getBoundingClientRect()
        // The whole menu is on screen…
        await expect(r.bottom).toBeLessThanOrEqual(window.innerHeight)
        await expect(r.top).toBeGreaterThanOrEqual(0)
        // …and it got there by flipping ABOVE the cursor, not by being clamped on top of it.
        await expect(r.bottom).toBeLessThanOrEqual(window.innerHeight - 40 + 1)
    },
}

/** A ContextMenu opened from inside a Modal: Escape closes the menu ONLY. The menu's Escape is
 *  defaultPrevented (createMenuNav), which the Modal's window listener checks before closing. */
export const InsideModalEscape: Story = {
    render: () => {
        const [menu, setMenu] = createSignal(true)
        const [modal, setModal] = createSignal(true)
        return (
            <>
                {modal() && (
                    <Modal label="host" onClose={() => setModal(false)}>
                        <div
                            style={{ padding: '40px', color: 'var(--fg)' }}
                            data-modal-body=""
                        >
                            right-click target
                            {menu() && (
                                <ContextMenu
                                    x={200}
                                    y={200}
                                    items={FILE_ROW_ITEMS}
                                    onClose={() => setMenu(false)}
                                />
                            )}
                        </div>
                    </Modal>
                )}
            </>
        )
    },
    play: async () => {
        const menus = () => document.querySelectorAll('.bismuth-popover')
        await waitFor(() => expect(menus().length).toBeGreaterThan(0))
        document.body.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Escape',
                code: 'Escape',
                bubbles: true,
                cancelable: true,
            }),
        )
        await waitFor(() => expect(menus().length).toBe(0))
        await expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    },
}
