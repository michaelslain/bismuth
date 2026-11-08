// app/src/ui/popover/PopoverList.tsx
// The popover SURFACE: ui/Popover (tone "menu" — opaque --bg, hairline, hard lift, 4px inset)
// carrying the .bismuth-popover class, + a list of <MenuRow>s with separators. Pure presentation — no positioning, no dismiss, no keyboard (the
// parent owns those, e.g. ContextMenu adds cursor placement + outside-click +
// createMenuNav). This is the one Solid surface every menu-style popover renders,
// so the chrome can't drift. The autocomplete can't use it (CodeMirror owns its
// list DOM) — it matches via the shared tokens in popover.css instead.
import { For, type JSX } from 'solid-js'
import Popover from '../Popover'
import MenuRow from './MenuRow'

export type PopoverRow = {
    label: string
    icon?: string
    /** A small custom element rendered before the label (e.g. a color swatch dot). */
    prefix?: JSX.Element
    detail?: string
    /** Muted text following the label in its cell — a command's argument hint. */
    hint?: string
    /** A REAL keybinding, in the app's combo syntax ("Mod+Shift+D") — rendered right-aligned via
     *  the shared Kbd primitive (ui/ascii/Kbd.tsx). Only set this from an actual
     *  settings.keybindings entry (see CommandPalette.tsx's COMMAND_KEYBINDINGS map for the
     *  pattern) — never a fabricated hint for a row with no real binding. */
    shortcut?: string
    danger?: boolean
    disabled?: boolean
    separatorBefore?: boolean
    /** Show a right-side chevron marking this row opens a nested submenu. */
    hasSubmenu?: boolean
}

function PopoverList(props: {
    items: PopoverRow[]
    /** Index of the highlighted row (from createMenuNav). */
    active?: number
    onActivate: (index: number) => void
    onHover?: (index: number) => void
    /** Inline style for the container (ContextMenu passes fixed x/y/z-index). */
    style?: JSX.CSSProperties
    /** Extra class on the container (additive; e.g. Select's `.ui-select-list`). */
    class?: string
    /** Ref to the container element (ContextMenu uses it to position a submenu flyout). */
    ref?: (el: HTMLDivElement) => void
    /** Line the rows up as a table: every label (with its hint) in one column, every detail in
     *  the next, the detail ending in an ellipsis where the list runs out of width — a command
     *  list whose descriptions are long. Rows draw no icon, prefix, shortcut or chevron. */
    columns?: boolean
}) {
    return (
        <Popover
            tone="menu"
            ref={props.ref}
            class={`bismuth-popover ${props.columns ? 'bismuth-popover--columns' : ''} ${props.class ?? ''}`}
            style={props.style}
            onClick={e => e.stopPropagation()}
        >
            <For each={props.items}>
                {(item, i) => (
                    <>
                        {item.separatorBefore && (
                            <div class="bismuth-popover-sep" />
                        )}
                        <MenuRow
                            label={item.label}
                            icon={item.icon}
                            prefix={item.prefix}
                            detail={item.detail}
                            hint={item.hint}
                            columns={props.columns}
                            shortcut={item.shortcut}
                            danger={item.danger}
                            disabled={item.disabled}
                            hasSubmenu={item.hasSubmenu}
                            selected={props.active === i()}
                            onMouseEnter={() =>
                                !item.disabled && props.onHover?.(i())
                            }
                            onClick={() => props.onActivate(i())}
                        />
                    </>
                )}
            </For>
        </Popover>
    )
}

export default PopoverList
