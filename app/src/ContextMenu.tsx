// app/src/ContextMenu.tsx
// A cursor-positioned action menu. It owns only what's specific to a context menu:
// cursor placement, outside-click / Escape dismiss, closing after a pick, and ONE
// level of nested submenus (a row with `submenu` flies out a second <PopoverList> to
// its side). The SURFACE (chrome + rows) is the shared <PopoverList>; keyboard nav is
// the shared createMenuNav hook (one per level, but a single document listener so the
// two levels never both react to the same key).
import {
    createEffect,
    createSignal,
    For,
    onCleanup,
    onMount,
    Show,
} from 'solid-js'
import PopoverList, { type PopoverRow } from './ui/popover/PopoverList'
import { createMenuNav } from './ui/popover/createMenuNav'
import { registerActiveMenu } from './activeMenu'
import { Icon } from './icons/Icon'

export type MenuItem = PopoverRow & {
    /** Run when the row is picked. Optional for rows that only open a `submenu`. */
    onSelect?: () => void
    /** Nested rows; a row with a non-empty submenu opens a flyout instead of selecting. */
    submenu?: MenuItem[]
}

/** A top-level action shown as an icon on the RAIL beside the menu, instead of as a row
 *  inside it — for actions that must stay visible rather than compete with a long option
 *  list (the emoji library, #67). `label` is the tooltip/aria-label; it isn't drawn. */
export type QuickAction = { icon: string; label: string; onSelect: () => void }

// Estimated flyout width, used only to decide whether to flip the submenu to the
// left when there isn't room on the right. The actual width is the popover min-width.
const SUB_WIDTH = 190

// The rail's own footprint — button (30) + .bismuth-popover padding (2×4) + border (2×1).
// Fixed, so the rail can be placed to the LEFT of the menu without measuring it first
// (its right edge is the menu's left edge, which is just props.x). Keep in sync with
// `.bismuth-popover-rail*` in ui/popover/popover.css.
const RAIL_WIDTH = 40
const RAIL_GAP = 6

// Gap kept from the viewport edge when a menu has to be clamped rather than flipped.
const EDGE_GAP = 6

/** Top edge for a surface of height `h` whose natural top is `y`.
 *  Below the cursor when it fits; ABOVE it when it does not — a menu opened near the bottom
 *  used to keep its top at the cursor and let its last rows fall off screen. Clamped as a last
 *  resort for a menu taller than the viewport (which also gets a scrollbar, via popover.css). */
const placeY = (y: number, h: number): number => {
    if (h <= 0) return y // not measured yet — first frame paints at the cursor, as before
    if (y + h <= window.innerHeight - EDGE_GAP) return y
    const above = y - h
    return above >= EDGE_GAP ? above : Math.max(EDGE_GAP, window.innerHeight - h - EDGE_GAP)
}

/** Closes on outside-click, Escape, or after a (non-disabled) leaf item is chosen.
 *  Arrow keys move selection; Right opens a submenu, Left closes it; Enter activates. */
export function ContextMenu(props: {
    x: number
    y: number
    items: MenuItem[]
    quickActions?: QuickAction[]
    onClose: () => void
}) {
    let rootEl: HTMLDivElement | undefined
    // The open submenu: which parent row, and where to place its flyout.
    const [sub, setSub] = createSignal<{
        index: number
        x: number
        y: number
    } | null>(null)
    // Measured menu width — needed ONLY for the left-edge flip below. Re-measured when the rows
    // change, since a different menu is a different width.
    const [menuW, setMenuW] = createSignal(0)
    createEffect(() => {
        props.items // track: re-measure when this menu's rows change
        setMenuW(rootEl?.getBoundingClientRect().width ?? 0)
    })
    // Measured menu height — needed for the bottom-edge flip below, the vertical twin of the
    // left-edge flip railX() already does. Re-measured when the rows change, since a different
    // menu is a different height.
    const [menuH, setMenuH] = createSignal(0)
    createEffect(() => {
        props.items // track: re-measure when this menu's rows change
        setMenuH(rootEl?.getBoundingClientRect().height ?? 0)
    })
    // The rail's own measured height — a SEPARATE measurement from the menu's, since the rail is
    // a different element with a different height (one column of icon buttons vs. the row list).
    // Reusing menuH() would flip a one-button rail as though it were a twelve-row menu.
    let railEl: HTMLDivElement | undefined
    const [railH, setRailH] = createSignal(0)
    createEffect(() => {
        props.quickActions // track: re-measure when the rail's own buttons change
        setRailH(railEl?.getBoundingClientRect().height ?? 0)
    })
    // The open submenu flyout's measured height — same reasoning as menuH(), but the flyout
    // mounts only while `sub()` is set, so the effect naturally re-measures each time it opens.
    let subEl: HTMLDivElement | undefined
    const [subH, setSubH] = createSignal(0)
    // Rail x, DERIVED (not a one-shot signal): <Show> isn't keyed, so a second right-click reuses
    // this component and only updates props — a snapshot taken at creation would strand the rail at
    // the first menu's position. The menu's left edge IS props.x, so the normal case needs no
    // measurement and paints correctly on the first frame. Right-clicking near the left viewport
    // edge leaves no room, so the rail flips to hang off the menu's RIGHT edge instead.
    const railX = () => {
        const left = props.x - RAIL_WIDTH - RAIL_GAP
        return left >= RAIL_GAP ? left : props.x + menuW() + RAIL_GAP
    }
    const subItems = (): MenuItem[] => {
        const s = sub()
        return s ? (props.items[s.index]?.submenu ?? []) : []
    }
    createEffect(() => {
        subItems() // track: re-measure whenever the flyout opens, closes, or its rows change
        setSubH(subEl?.getBoundingClientRect().height ?? 0)
    })

    const openSub = (i: number) => {
        const item = props.items[i]
        if (!item?.submenu?.length) return
        const rowEl = rootEl?.querySelectorAll('.bismuth-popover-row')[i] as
            HTMLElement | undefined
        const pr = rootEl?.getBoundingClientRect()
        const rr = rowEl?.getBoundingClientRect()
        const right = pr ? pr.right : props.x
        const left = pr ? pr.left : props.x
        // Flip to the left edge when the flyout would overflow the viewport on the right.
        const x =
            right + SUB_WIDTH > window.innerWidth
                ? Math.max(2, left - SUB_WIDTH + 2)
                : right - 2
        const y = rr ? rr.top : props.y
        setSub({ index: i, x, y })
        subNav.setActive(0)
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

    const handleDocClick = () => props.onClose()

    // Global single-menu exclusivity: registering as the active menu closes any menu that
    // was already open on ANY other surface (this is the one funnel every context menu —
    // App's pane/editor/create menus, FileTree, DaemonList, chat bubbles, task status,
    // calendar chips — passes through, since they all render this component). A right-click
    // that opens a new menu no longer leaves another surface's menu on screen.
    let disposeActive: (() => void) | undefined

    onMount(() => {
        disposeActive = registerActiveMenu(() => props.onClose())
        // Defer so the click that opened the menu doesn't immediately close it.
        setTimeout(() => document.addEventListener('click', handleDocClick), 0)
        document.addEventListener('keydown', onKeyDown)
    })
    onCleanup(() => {
        disposeActive?.()
        document.removeEventListener('click', handleDocClick)
        document.removeEventListener('keydown', onKeyDown)
    })

    // Mark rows that open a submenu so MenuRow draws the chevron.
    const parentRows = () =>
        props.items.map(it =>
            it.submenu?.length ? { ...it, hasSubmenu: true } : it,
        )

    return (
        <>
            {/* Quick-action rail: icon buttons pinned BESIDE the menu (to its left), never inside
          the option list — so they stay visible however long the list gets (#67). */}
            <Show when={props.quickActions?.length}>
                <div
                    ref={el => (railEl = el)}
                    class="bismuth-popover bismuth-popover-rail"
                    style={{
                        position: 'fixed',
                        top: `${placeY(props.y, railH())}px`,
                        left: `${railX()}px`,
                        'z-index': 1000,
                    }}
                    onClick={e => e.stopPropagation()}
                >
                    <For each={props.quickActions}>
                        {a => (
                            <button
                                type="button"
                                class="bismuth-popover-rail-btn"
                                title={a.label}
                                aria-label={a.label}
                                onClick={() => {
                                    a.onSelect()
                                    props.onClose()
                                }}
                            >
                                <Icon value={a.icon} size={14} />
                            </button>
                        )}
                    </For>
                </div>
            </Show>
            <PopoverList
                ref={el => (rootEl = el)}
                items={parentRows()}
                active={nav.active()}
                onActivate={parentActivate}
                onHover={parentHover}
                style={{
                    position: 'fixed',
                    top: `${placeY(props.y, menuH())}px`,
                    left: `${props.x}px`,
                    'z-index': 1000,
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
                            left: `${s().x}px`,
                            'z-index': 1001,
                        }}
                    />
                )}
            </Show>
        </>
    )
}
