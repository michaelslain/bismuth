// Visual spec for <ContextMenu> — the cursor-positioned action menu every right-click surface
// in the app renders (file tree, editor, DaemonList, chat bubbles, calendar chips, …). Pure
// cursor placement + dismiss + one level of submenu flyout over the shared <PopoverList>
// surface; no IO.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, onMount } from 'solid-js'
import { expect, waitFor } from 'storybook/test'
import { Modal } from './Modal'
import { ToastHost, pushToast, dismissToast, toasts } from './ToastHost'
import { ContextMenu, type MenuItem } from './ContextMenu'

const meta = {
    title: 'UI/ContextMenu',
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

/** Clicking a submenu row opens its flyout and keeps the menu open — the menu's outside-click
 *  dismiss ignores clicks that land inside the menu. */
export const ClickOpensSubmenu: Story = {
    render: () => {
        const [open, setOpen] = createSignal(true)
        return (
            <div data-menu-state={open() ? 'open' : 'closed'}>
                {open() && (
                    <ContextMenu
                        x={140}
                        y={90}
                        items={FILE_ROW_ITEMS}
                        onClose={() => setOpen(false)}
                    />
                )}
            </div>
        )
    },
    play: async () => {
        // The dismiss listener is registered a tick after mount.
        await new Promise(r => setTimeout(r, 20))
        const parent = [
            ...document.querySelectorAll<HTMLElement>('[data-popover-row]'),
        ].find(el => el.textContent?.includes('Move to'))
        await expect(parent).toBeTruthy()
        parent!.click()
        await waitFor(() =>
            expect(document.body.textContent).toContain('archive/'),
        )
        await expect(
            document.querySelector('[data-menu-state]')?.getAttribute(
                'data-menu-state',
            ),
        ).toBe('open')
    },
}

/** A press that begins on a row and is released outside the menu keeps it open: that `click`
 *  lands on a common ancestor outside the menu, and only a press that also began outside dismisses. */
export const DragOutKeepsOpen: Story = {
    render: () => {
        const [open, setOpen] = createSignal(true)
        return (
            <div
                data-menu-state={open() ? 'open' : 'closed'}
                style={{ position: 'fixed', inset: '0' }}
            >
                {open() && (
                    <ContextMenu
                        x={140}
                        y={90}
                        items={FILE_ROW_ITEMS}
                        onClose={() => setOpen(false)}
                    />
                )}
            </div>
        )
    },
    play: async () => {
        // The dismiss listener is registered a tick after mount.
        await new Promise(r => setTimeout(r, 20))
        const row = document.querySelector<HTMLElement>('[data-popover-row]')!
        const outside = document.querySelector<HTMLElement>('[data-menu-state]')!
        const fire = (type: string, target: Element) =>
            target.dispatchEvent(
                new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(
                    type,
                    { bubbles: true, cancelable: true, button: 0 },
                ),
            )
        const state = () => outside.getAttribute('data-menu-state')
        fire('pointerdown', row)
        fire('pointerup', outside)
        fire('click', outside)
        await expect(state()).toBe('open')
    },
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

/** A menu opened near the bottom edge flips ABOVE the cursor, not run off screen — a right-click
 *  low in the window keeps its last rows, such as every spellcheck suggestion below the first. */
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

/** Every visible menu surface (the parent and, when open, its flyout) sits inside the window. */
const expectOnScreen = async () => {
    const menus = [...document.querySelectorAll<HTMLElement>('.bismuth-popover')]
    await expect(menus.length).toBeGreaterThan(0)
    for (const m of menus) {
        const r = m.getBoundingClientRect()
        await expect(r.left).toBeGreaterThanOrEqual(0)
        await expect(r.top).toBeGreaterThanOrEqual(0)
        await expect(r.right).toBeLessThanOrEqual(window.innerWidth)
        await expect(r.bottom).toBeLessThanOrEqual(window.innerHeight)
    }
}

const LONG_ROWS: MenuItem[] = [
    { label: 'Open in new pane to the right', icon: 'Columns2', onSelect: noop },
    { label: 'Copy vault-relative path', icon: 'Copy', onSelect: noop },
    { label: 'Reveal in system file manager', icon: 'FolderOpen', onSelect: noop },
    {
        label: 'Move to…',
        icon: 'FolderInput',
        submenu: [
            { label: 'reading/papers/to-annotate-this-week/', onSelect: noop },
            { label: 'projects/', onSelect: noop },
        ],
    },
]

/** A right-click near the window's right edge opens the menu LEFT of the cursor, at its full
 *  width — not run off the edge, and not squeezed until its labels ellipsize. */
export const NearRightEdge: Story = {
    render: () => (
        <ContextMenu x={window.innerWidth - 30} y={90} items={LONG_ROWS} onClose={noop} />
    ),
    play: async () => {
        await expectOnScreen()
        const r = document.querySelector('.bismuth-popover')!.getBoundingClientRect()
        // Flipped: its right edge is the cursor.
        await expect(Math.abs(r.right - (window.innerWidth - 30))).toBeLessThanOrEqual(1)
        // Full width: no row label is cut short.
        for (const l of document.querySelectorAll<HTMLElement>('.bismuth-popover-label'))
            await expect(l.scrollWidth).toBeLessThanOrEqual(l.clientWidth)
    },
}

/** The bottom-right corner flips on both axes: up-and-left of the cursor. */
export const NearBottomRightCorner: Story = {
    render: () => (
        <ContextMenu
            x={window.innerWidth - 20}
            y={window.innerHeight - 20}
            items={LONG_ROWS}
            quickActions={[{ icon: 'Pin', label: 'Pin', onSelect: noop }]}
            onClose={noop}
        />
    ),
    play: async () => {
        await expectOnScreen()
    },
}

/** A submenu whose parent sits near the right edge flies out to the LEFT, sized by its own measured
 *  width — a flyout wider than a guess used to overflow anyway. */
export const SubmenuNearRightEdge: Story = {
    render: () => (
        <ContextMenu x={window.innerWidth - 300} y={90} items={LONG_ROWS} onClose={noop} />
    ),
    play: async () => {
        await new Promise(r => setTimeout(r, 20))
        const row = [...document.querySelectorAll<HTMLElement>('[data-popover-row]')].find(el =>
            el.textContent?.includes('Move to'),
        )!
        row.click()
        await waitFor(() =>
            expect(document.querySelectorAll('.bismuth-popover').length).toBe(2),
        )
        await expectOnScreen()
        const [parent, flyout] = [...document.querySelectorAll('.bismuth-popover')].map(m =>
            m.getBoundingClientRect(),
        )
        await expect(flyout.right).toBeLessThanOrEqual(parent.left + 3)
    },
}

/** A menu rendered under a `filter` ancestor (a calendar chip's hover filter) — which becomes the
 *  containing block of a `position: fixed` child — still lands at the cursor in WINDOW coordinates
 *  and is not clipped by the box's overflow: the menu portals itself to the body. */
export const InsideFilteredBox: Story = {
    render: () => (
        <div
            style={{
                position: 'absolute',
                left: '200px',
                top: '150px',
                width: '240px',
                height: '120px',
                overflow: 'hidden',
                filter: 'brightness(1.1)',
                border: 'var(--rule)',
                color: 'var(--text-muted)',
                padding: '8px',
            }}
        >
            filter + overflow: hidden
            <ContextMenu x={300} y={200} items={FILE_ROW_ITEMS} onClose={noop} />
        </div>
    ),
    play: async () => {
        await expectOnScreen()
        const menu = document.querySelector<HTMLElement>('.bismuth-popover')!
        const r = menu.getBoundingClientRect()
        await expect(Math.abs(r.left - 300)).toBeLessThanOrEqual(1)
        await expect(Math.abs(r.top - 200)).toBeLessThanOrEqual(1)
        // Painted, not clipped: the menu's last row is the hit-test winner at its own centre.
        const last = [...menu.querySelectorAll<HTMLElement>('[data-popover-row]')].pop()!
        const lr = last.getBoundingClientRect()
        await expect(
            last.contains(document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2)),
        ).toBe(true)
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

/** The z-ladder, measured: a modal, a toast and an open menu all on screen at once, with the menu
 *  and the toast deliberately overlapping. A toast must paint ABOVE the modal and BELOW the menu
 *  (DESIGN.md's Z-Ladder Rule). The play hit-tests the painted result with `elementFromPoint` — what
 *  the components actually resolve to — and does not read the tokens off `:root`. */
export const StackingOrder: Story = {
    render: () => {
        for (const t of toasts()) dismissToast(t.id)
        pushToast('Enabled dream', { ttl: 0 })
        const [at, setAt] = createSignal<{ x: number; y: number } | null>(null)
        onMount(() => {
            // Anchor the menu on the toast's own centre so the two are guaranteed to overlap.
            requestAnimationFrame(() => {
                const r = document.querySelector('[data-tone]')?.getBoundingClientRect()
                if (r) setAt({ x: r.left + r.width / 2 - 20, y: r.top + r.height / 2 })
            })
        })
        return (
            <>
                <Modal label="host" onClose={noop}>
                    <div style={{ padding: '40px', color: 'var(--fg)' }} data-modal-body="">
                        modal body
                    </div>
                </Modal>
                <ToastHost />
                {at() && (
                    <ContextMenu
                        x={at()!.x}
                        y={at()!.y}
                        flipFrom={at()!.y}
                        items={FILE_ROW_ITEMS}
                        onClose={noop}
                    />
                )}
            </>
        )
    },
    play: async () => {
        const toast = () => document.querySelector('[data-tone]')
        const menu = () => document.querySelector('.bismuth-popover')
        const scrim = () => document.querySelector('[role="dialog"]')?.parentElement
        await waitFor(() => {
            expect(toast()).not.toBeNull()
            expect(menu()).not.toBeNull()
            expect(scrim()).not.toBeNull()
        })
        // Resolved z-index of each LAYER'S positioned root (the toast pill's host, not the pill).
        const z = (el: Element | null | undefined) => Number(getComputedStyle(el as Element).zIndex)
        const toastHost = toast()!.parentElement!
        await expect(z(scrim())).toBeLessThan(z(toastHost))
        await expect(z(toastHost)).toBeLessThan(z(menu()))
        // And the painted result, by hit test, at a point inside the toast ∩ menu overlap.
        const tr = toast()!.getBoundingClientRect()
        const mr = menu()!.getBoundingClientRect()
        const px = (Math.max(tr.left, mr.left) + Math.min(tr.right, mr.right)) / 2
        const py = (Math.max(tr.top, mr.top) + Math.min(tr.bottom, mr.bottom)) / 2
        await expect(Math.min(tr.right, mr.right)).toBeGreaterThan(Math.max(tr.left, mr.left))
        await expect(Math.min(tr.bottom, mr.bottom)).toBeGreaterThan(Math.max(tr.top, mr.top))
        const top = document.elementFromPoint(px, py)
        await expect(menu()!.contains(top)).toBe(true)
        // Where only the toast and the scrim meet (just left of the menu), the toast wins.
        const lx = Math.max(tr.left + 2, Math.min(mr.left - 3, tr.right - 2))
        const ly = (tr.top + tr.bottom) / 2
        if (lx < mr.left) await expect(toast()!.contains(document.elementFromPoint(lx, ly))).toBe(true)
    },
}

/** The real path every surface takes: a right-click sets a signal and a `<Show>` mounts the menu —
 *  here on a tab-rail-like strip pinned to the window's right edge, then a second right-click lower
 *  down while the first menu is still open. Both menus land fully on screen. */
export const OpenedByRightClickAtEdge: Story = {
    render: () => {
        const [menu, setMenu] = createSignal<{ x: number; y: number } | null>(null)
        return (
            <>
                <div
                    data-testid="edge-strip"
                    style={{
                        position: 'fixed',
                        top: 0,
                        right: 0,
                        bottom: 0,
                        width: '40px',
                        background: 'var(--bg-alt)',
                    }}
                    onContextMenu={e => {
                        e.preventDefault()
                        setMenu({ x: e.clientX, y: e.clientY })
                    }}
                />
                {menu() && (
                    <ContextMenu
                        x={menu()!.x}
                        y={menu()!.y}
                        items={LONG_ROWS}
                        onClose={() => setMenu(null)}
                    />
                )}
            </>
        )
    },
    play: async () => {
        const strip = document.querySelector('[data-testid="edge-strip"]')!
        const rightClick = (x: number, y: number) =>
            strip.dispatchEvent(
                new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
            )
        rightClick(window.innerWidth - 10, 60)
        await waitFor(() => expect(document.querySelector('.bismuth-popover')).not.toBeNull())
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        await expectOnScreen()
        rightClick(window.innerWidth - 10, window.innerHeight - 10)
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        await expectOnScreen()
    },
}

/** A menu whose rows grow AFTER it opens (a label that fills in late, a font or icon that lands
 *  after the first layout) re-places itself: opened near the right edge at its small size, then
 *  widened, it still ends inside the window. */
export const GrowsAfterOpen: Story = {
    render: () => {
        const [label, setLabel] = createSignal('Open')
        const items: MenuItem[] = [
            {
                get label() {
                    return label()
                },
                icon: 'Columns2',
                onSelect: noop,
            },
            { label: 'Copy', icon: 'Copy', onSelect: noop },
        ]
        onMount(() =>
            setTimeout(() => setLabel('Open in a new pane to the right of this one'), 50),
        )
        return <ContextMenu x={window.innerWidth - 140} y={90} {...{ items }} onClose={noop} />
    },
    play: async () => {
        await waitFor(() =>
            expect(document.querySelector('.bismuth-popover')?.textContent).toContain('this one'),
        )
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        await expectOnScreen()
    },
}
