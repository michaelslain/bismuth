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
import {
    createEffect,
    createSignal,
    onCleanup,
    onMount,
    Show,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import PopoverList, { type PopoverRow } from './popover/PopoverList'
import QuickActionRail, { type QuickAction } from './popover/QuickActionRail'
import { createMenuNav } from './popover/createMenuNav'
import { placeBelowOrAbove, placeRightOrLeft } from './popover/placeAnchored'
import { registerActiveMenu } from '../activeMenu'

export type MenuItem = PopoverRow & {
    /** Run when the row is picked. Optional for rows that only open a `submenu`. */
    onSelect?: () => void
    /** Nested rows; a row with a non-empty submenu opens a flyout instead of selecting. */
    submenu?: MenuItem[]
}

export type { QuickAction }

/** Top edge for a surface of height `h` whose natural top is `y`.
 *  Below the cursor when it fits; ABOVE it when it does not — a menu opened near the bottom
 *  used to keep its top at the cursor and let its last rows fall off screen. Clamped as a last
 *  resort for a menu taller than the viewport (which also gets a scrollbar, via popover.css). */
const placeY = (y: number, h: number, flipFrom?: number): number =>
    placeBelowOrAbove({ y, h, viewportH: window.innerHeight, flipFrom, gap: 4 })

/** Left edge for a surface of width `w` whose natural left is `x`: right of the cursor when it
 *  fits, LEFT of it when it does not — the horizontal twin of placeY. */
const placeX = (x: number, w: number, flipFrom?: number): number =>
    placeRightOrLeft({ x, w, viewportW: window.innerWidth, flipFrom })

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
    // The open submenu: which parent row, the parent's edges it hangs off, and its row's top.
    const [sub, setSub] = createSignal<{
        index: number
        left: number
        right: number
        y: number
    } | null>(null)
    // Measured menu width — for the right-edge flip and the quick-action rail. Re-measured when the
    // rows change, since a different menu is a different width.
    const [menuW, setMenuW] = createSignal(0)
    createEffect(() => {
        props.items // track: re-measure when this menu's rows change
        setMenuW(rootEl?.getBoundingClientRect().width ?? 0)
    })
    // Measured menu height — needed for the bottom-edge flip below, the vertical twin of the
    // left-edge flip the quick-action rail does. Re-measured when the rows change, since a different
    // menu is a different height.
    const [menuH, setMenuH] = createSignal(0)
    createEffect(() => {
        props.items // track: re-measure when this menu's rows change
        setMenuH(rootEl?.getBoundingClientRect().height ?? 0)
    })
    // The open submenu flyout's measured height — same reasoning as menuH(), but the flyout
    // mounts only while `sub()` is set, so the effect naturally re-measures each time it opens.
    let subEl: HTMLDivElement | undefined
    const [subH, setSubH] = createSignal(0)
    const [subW, setSubW] = createSignal(0)
    const subItems = (): MenuItem[] => {
        const s = sub()
        return s ? (props.items[s.index]?.submenu ?? []) : []
    }
    createEffect(() => {
        subItems() // track: re-measure whenever the flyout opens, closes, or its rows change
        const r = subEl?.getBoundingClientRect()
        setSubH(r?.height ?? 0)
        setSubW(r?.width ?? 0)
    })

    const openSub = (i: number) => {
        const item = props.items[i]
        if (!item?.submenu?.length) return
        // `data-popover-row` is MenuRow's runtime hook — never its class, which is a global
        // string today but exactly the kind of literal a rename leaves matching nothing.
        const rowEl = rootEl?.querySelectorAll('[data-popover-row]')[i] as
            HTMLElement | undefined
        const pr = rootEl?.getBoundingClientRect()
        const rr = rowEl?.getBoundingClientRect()
        const right = pr ? pr.right : props.x
        const left = pr ? pr.left : props.x
        const y = rr ? rr.top : props.y
        setSub({ index: i, left, right, y })
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
    // pick, and a submenu row must stay open to show its flyout.
    const handleDocClick = (e: MouseEvent) => {
        const t = e.target as Node | null
        if (t && (rootEl?.contains(t) || subEl?.contains(t))) return
        props.onClose()
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
    })
    onCleanup(() => {
        disposeActive?.()
        clearTimeout(docClickTimer)
        document.removeEventListener('click', handleDocClick)
        document.removeEventListener('keydown', onKeyDown)
    })

    // Mark rows that open a submenu so MenuRow draws the chevron.
    const parentRows = () =>
        props.items.map(it =>
            it.submenu?.length ? { ...it, hasSubmenu: true } : it,
        )

    // The menu's resolved left edge: the rail hangs off it, so it is shared, not recomputed.
    const menuLeft = () => placeX(props.x, menuW())

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
                    menuWidth={menuW()}
                    onPick={props.onClose}
                />
            </Show>
            <PopoverList
                ref={el => (rootEl = el)}
                items={parentRows()}
                active={nav.active()}
                onActivate={parentActivate}
                onHover={parentHover}
                style={{
                    position: 'fixed',
                    top: `${placeY(props.y, menuH(), props.flipFrom)}px`,
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
                        ref={el => (subEl = el)}
                        items={subItems()}
                        active={subNav.active()}
                        onActivate={subActivate}
                        onHover={j => subNav.setActive(j)}
                        style={{
                            position: 'fixed',
                            top: `${placeY(s().y, subH())}px`,
                            // Off the parent's right edge, or flipped to end at its left edge.
                            left: `${placeX(s().right - 2, subW(), s().left + 2)}px`,
                            width: 'max-content',
                            'z-index': 'var(--z-popover)', // same rung as its parent; mounted later in the fragment, so it paints above it
                        }}
                    />
                )}
            </Show>
        </Portal>
    )
}
