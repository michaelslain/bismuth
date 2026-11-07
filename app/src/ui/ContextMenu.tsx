// app/src/ui/ContextMenu.tsx
// A cursor-positioned action menu. It owns only what's specific to a context menu:
// cursor placement, outside-click / Escape dismiss, closing after a pick, and ONE
// level of nested submenus (a row with `submenu` flies out a second <PopoverList> to
// its side). The SURFACE (chrome + rows) is the shared <PopoverList>; keyboard nav is
// the shared createMenuNav hook (one per level, but a single document listener so the
// two levels never both react to the same key).
//
// It portals itself to <body>: a menu rendered in place under a `filter` or `transform` ancestor (a
// chip's hover filter) would take that box as its `position: fixed` containing block, and be placed
// against it and clipped by its overflow instead of the window's.
import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import PopoverList, { type PopoverRow } from './popover/PopoverList'
import QuickActionRail, { type QuickAction } from './popover/QuickActionRail'
import { createMenuNav } from './popover/createMenuNav'
import { placeBelowOrAbove, placeRightOrLeft } from './popover/placeAnchored'
import { createBoxSize, createViewportSize } from './popover/createBoxSize'
import { registerActiveMenu } from '../activeMenu'
import { createOutsidePress } from './outsidePress'

export type MenuItem = PopoverRow & {
    /** Run when the row is picked. Optional for rows that only open a `submenu`. */
    onSelect?: () => void
    /** Nested rows; a row with a non-empty submenu opens a flyout instead of selecting. */
    submenu?: MenuItem[]
}

export type { QuickAction }

/** Closes on outside-click, Escape, or after a (non-disabled) leaf item is chosen.
 *  Arrow keys move selection; Right opens a submenu, Left closes it; Enter activates. */
export function ContextMenu(props: {
    x: number
    y: number
    flipFrom?: number
    items: MenuItem[]
    quickActions?: QuickAction[]
    onClose: () => void
}) {
    let rootEl: HTMLDivElement | undefined
    // The open submenu: which parent row, and that row's top as an offset inside the parent. The
    // flyout hangs off the parent's LIVE edges (menuLeft / menuSize), so it follows the parent when
    // the parent re-places itself.
    const [sub, setSub] = createSignal<{ index: number; rowOffset: number } | null>(null)
    // Live sizes: the menu's and the flyout's own boxes (ResizeObserver) and the window's (resize).
    // Placement derives from all three, so a menu whose rows grow after it opens, or a window that
    // shrinks while it is open, re-runs the edge flip instead of keeping a stale position.
    const viewport = createViewportSize()
    const [menuSize, measureMenu] = createBoxSize()
    const [subSize, measureSub] = createBoxSize()
    let subEl: HTMLDivElement | undefined
    const subItems = (): MenuItem[] => {
        const s = sub()
        return s ? (props.items[s.index]?.submenu ?? []) : []
    }

    /** Top edge for a surface of height `h` whose natural top is `y`: below the cursor when it
     *  fits, ABOVE it when it does not, clamped as a last resort for a surface taller than the
     *  window (which also gets a scrollbar, via popover.css). */
    const placeY = (y: number, h: number, flipFrom?: number): number =>
        placeBelowOrAbove({ y, h, viewportH: viewport().h, flipFrom, gap: 4 })

    /** Left edge for a surface of width `w` whose natural left is `x`: right of the cursor when it
     *  fits, LEFT of it when it does not — the horizontal twin of placeY. */
    const placeX = (x: number, w: number, flipFrom?: number): number =>
        placeRightOrLeft({ x, w, viewportW: viewport().w, flipFrom })

    const openSub = (i: number) => {
        const item = props.items[i]
        if (!item?.submenu?.length) return
        // `data-popover-row` is MenuRow's runtime hook — never its class, which is a global
        // string today but exactly the kind of literal a rename leaves matching nothing.
        const rowEl = rootEl?.querySelectorAll('[data-popover-row]')[i] as
            HTMLElement | undefined
        const pr = rootEl?.getBoundingClientRect()
        const rr = rowEl?.getBoundingClientRect()
        setSub({ index: i, rowOffset: pr && rr ? rr.top - pr.top : 0 })
        // Start on the first row that can be picked: a disabled lead row (an `Effective:` note) is
        // information, not a choice.
        subNav.setActive(Math.max(0, item.submenu.findIndex(it => !it.disabled)))
    }

    const parentActivate = (i: number) => {
        const it = props.items[i]
        if (!it || it.disabled) return
        if (it.submenu?.length) {
            openSub(i)
            return
        }
        it.onSelect?.()
        props.onClose()
    }

    const parentHover = (i: number) => {
        nav.setActive(i)
        const it = props.items[i]
        // Hover a submenu row → open its flyout; hover any other row → close an open one.
        if (it?.submenu?.length) openSub(i)
        else setSub(null)
    }

    const subActivate = (j: number) => {
        const it = subItems()[j]
        if (!it || it.disabled) return
        it.onSelect?.()
        props.onClose()
    }

    const nav = createMenuNav({
        count: () => props.items.length,
        isDisabled: i => props.items[i]?.disabled === true,
        onSelect: parentActivate,
        onEscape: () => props.onClose(),
    })
    const subNav = createMenuNav({
        count: () => subItems().length,
        isDisabled: j => subItems()[j]?.disabled === true,
        onSelect: subActivate,
        onEscape: () => setSub(null),
    })

    // Single document keydown owner. When a submenu is open it takes Up/Down/Enter/Escape
    // and Left closes it; otherwise the parent nav drives and Right opens a submenu.
    const onKeyDown = (e: KeyboardEvent) => {
        if (sub()) {
            if (e.key === 'ArrowLeft') {
                e.preventDefault()
                setSub(null)
                return
            }
            subNav.onKeyDown(e)
            return
        }
        if (e.key === 'ArrowRight') {
            const i = nav.active()
            if (props.items[i]?.submenu?.length) {
                e.preventDefault()
                openSub(i)
            }
            return
        }
        nav.onKeyDown(e)
    }

    // A click inside the menu or its flyout is the menu's own: a leaf row closes it through its
    // pick, and a submenu row must stay open to show its flyout. A press that began inside and
    // was released outside (a drag) is the menu's own too: its `click` lands on a common ancestor.
    const outside = createOutsidePress(t => {
        const n = t instanceof Node ? t : null
        return !!n && (!!rootEl?.contains(n) || !!subEl?.contains(n))
    })
    const onDocPointerDown = (e: PointerEvent) => outside.down(e.target)
    const handleDocClick = (e: MouseEvent) => {
        if (outside.isOutsideClick(e.target)) props.onClose()
    }

    // Global single-menu exclusivity: registering as the active menu closes any menu that
    // was already open on ANY other surface (this is the one funnel every context menu —
    // App's pane/editor/create menus, FileTree, DaemonList, chat bubbles, task status,
    // calendar chips — passes through, since they all render this component). A right-click
    // that opens a new menu no longer leaves another surface's menu on screen.
    let disposeActive: (() => void) | undefined
    // The deferred click-listener registration. A menu that closes before it fires (opened and
    // picked in the same tick) must cancel it — otherwise the listener is added AFTER cleanup ran,
    // is never removed, and closes every menu opened afterwards on the first click.
    let docClickTimer: ReturnType<typeof setTimeout> | undefined

    onMount(() => {
        disposeActive = registerActiveMenu(() => props.onClose())
        // Defer so the click that opened the menu doesn't immediately close it.
        docClickTimer = setTimeout(() => {
            docClickTimer = undefined
            document.addEventListener('click', handleDocClick)
        }, 0)
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('pointerdown', onDocPointerDown, true)
    })
    onCleanup(() => {
        disposeActive?.()
        clearTimeout(docClickTimer)
        document.removeEventListener('click', handleDocClick)
        document.removeEventListener('keydown', onKeyDown)
        document.removeEventListener('pointerdown', onDocPointerDown, true)
    })

    // Mark rows that open a submenu so MenuRow draws the chevron.
    const parentRows = () =>
        props.items.map(it =>
            it.submenu?.length ? { ...it, hasSubmenu: true } : it,
        )

    // The menu's resolved left edge: the rail hangs off it, so it is shared, not recomputed.
    const menuLeft = () => placeX(props.x, menuSize().w)
    const menuTop = () => placeY(props.y, menuSize().h, props.flipFrom)

    return (
        <Portal>
            {/* Quick-action rail: icon buttons pinned BESIDE the menu (to its left), never inside
          the option list — so they stay visible however long the list gets (#67). */}
            <Show when={props.quickActions?.length}>
                <QuickActionRail
                    actions={props.quickActions!}
                    x={menuLeft()}
                    y={props.y}
                    flipFrom={props.flipFrom}
                    menuWidth={menuSize().w}
                    onPick={props.onClose}
                />
            </Show>
            <PopoverList
                ref={el => {
                    rootEl = el
                    measureMenu(el)
                }}
                items={parentRows()}
                active={nav.active()}
                onActivate={parentActivate}
                onHover={parentHover}
                style={{
                    position: 'fixed',
                    top: `${menuTop()}px`,
                    left: `${menuLeft()}px`,
                    // Its own width wherever it opens: near the right edge a fixed box shrinks to
                    // the room left, ellipsizing its rows and under-measuring the width the flip
                    // needs.
                    width: 'max-content',
                    'z-index': 'var(--z-popover)',
                }}
            />
            <Show when={sub()}>
                {s => (
                    <PopoverList
                        ref={el => {
                            subEl = el
                            measureSub(el)
                        }}
                        items={subItems()}
                        active={subNav.active()}
                        onActivate={subActivate}
                        onHover={j => subNav.setActive(j)}
                        style={{
                            position: 'fixed',
                            top: `${placeY(menuTop() + s().rowOffset, subSize().h)}px`,
                            // Off the parent's right edge, or flipped to end at its left edge.
                            left: `${placeX(
                                menuLeft() + menuSize().w - 2,
                                subSize().w,
                                menuLeft() + 2,
                            )}px`,
                            width: 'max-content',
                            'z-index': 'var(--z-popover)', // same rung as its parent; mounted later in the fragment, so it paints above it
                        }}
                    />
                )}
            </Show>
        </Portal>
    )
}
