// app/src/shell/TabRailRow.tsx
// One row of the vertical tab rail: icon, label (or an inline rename input), and a trailing
// close-X / pin. Lifted out of App.tsx's `<Index each={tabs()}>` body verbatim. `App.tsx` keeps the
// `<Index>` itself and the per-row `createMemo` for the chat tint (`railColor`) — those read App
// state; this component only draws one already-resolved row.
//
// CLASS NAMES ARE STILL BARE GLOBAL STRING LITERALS — this is the extraction half of the migration
// only (see the plan's THE RECIPE).
//
// IMPORTS `./TabRail.module.css` — IT GETS NO MODULE OF ITS OWN, once the CSS half lands. Eight
// hover/focus selectors span TabRail.tsx and this file (`.tab-rail:hover .tab-rail-label`,
// `.tab-rail:focus-within .tab-rail-row.pinned .tab-pin`, …); per-file hashing would break every
// one of them silently behind a green build (Trap 4). See TabRail.tsx's header.
//
// THE THREE IMPERATIVE `.closest()` REFERENCES (App.tsx:3047,3058,3084 before this extraction) move
// here UNCHANGED as bare literals — converting them to `styles["tab-x"]`-style lookups is CSS-half
// work, not this commit's. Note the third guard (dblclick → rename) tests only `.tab-x, .tab-pin`,
// NOT `.tab-rename` — that asymmetry is preserved verbatim, not "fixed" into consistency, per the
// plan's explicit instruction.
//
// `style={{}}` on the row is a preserved no-op: the original read `style={railStyle()}` where
// `railStyle = createMemo(() => ({}))` — a memo with no dependencies that always evaluated to an
// empty object. It carried no data and read no signal, so this extraction inlines the resolved
// constant rather than threading a vestigial no-op prop through App.tsx; the rendered output is
// identical either way (an empty style object applies nothing).
import { Show } from 'solid-js'
import { Icon } from '../icons/Icon'
import { IconButton } from '../ui/IconButton'

export function TabRailRow(props: {
    label: string
    icon: string
    color?: string
    active: boolean
    pinned: boolean
    dragging: boolean
    renaming: boolean
    onActivate: () => void
    onPointerDown: (e: PointerEvent) => void
    onAuxClick: (e: MouseEvent) => void
    onDblClick: () => void
    onContextMenu: (e: MouseEvent) => void
    onClose: (e: MouseEvent) => void
    onUnpin: () => void
    onCommitRename: (value: string) => void
    onCancelRename: () => void
}) {
    return (
        <div
            class="tab-rail-row"
            classList={{
                active: props.active,
                pinned: props.pinned,
                dragging: props.dragging,
            }}
            data-tab-chip="true"
            // Native tooltip surfaces the name while the rail is collapsed to icons.
            title={props.renaming ? undefined : props.label}
            style={{}}
            onClick={e => {
                if (
                    (e.target as HTMLElement).closest(
                        '.tab-x, .tab-pin, .tab-rename',
                    )
                )
                    return
                props.onActivate()
            }}
            onPointerDown={e => {
                if (
                    (e.target as HTMLElement).closest(
                        '.tab-x, .tab-pin, .tab-rename',
                    )
                )
                    return
                props.onPointerDown(e)
            }}
            // Middle-click closes any tab (incl. a pinned one) — the escape hatch.
            onAuxClick={props.onAuxClick}
            onDblClick={e => {
                if ((e.target as HTMLElement).closest('.tab-x, .tab-pin'))
                    return
                props.onDblClick()
            }}
            onContextMenu={props.onContextMenu}
        >
            {/* Every rail row shows an icon (fall back to a generic doc) so the
        collapsed icon-column is never empty for an unnamed note. */}
            <Icon
                class="tab-rail-icon"
                value={props.icon}
                size={16}
                style={props.color ? { color: props.color } : undefined}
            />
            <Show
                when={props.renaming}
                fallback={<span class="tab-rail-label">{props.label}</span>}
            >
                <input
                    class="tab-rename"
                    value={props.label}
                    ref={el =>
                        queueMicrotask(() => {
                            el.focus()
                            el.select()
                        })
                    }
                    onClick={e => e.stopPropagation()}
                    onBlur={e => props.onCommitRename(e.currentTarget.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                            e.preventDefault()
                            props.onCommitRename(e.currentTarget.value)
                        } else if (e.key === 'Escape') {
                            e.preventDefault()
                            props.onCancelRename()
                        }
                        e.stopPropagation()
                    }}
                />
            </Show>
            {/* Pinned rows show a pin (click → unpin) in place of the close X; the
        close X only appears on row-hover (see .tab-rail CSS). */}
            <Show
                when={props.pinned}
                fallback={
                    <IconButton
                        class="tab-x"
                        icon="X"
                        label="Close tab"
                        iconSize={13}
                        onClick={props.onClose}
                    />
                }
            >
                <IconButton
                    class="tab-pin"
                    icon="Pin"
                    label="Unpin tab"
                    iconSize={13}
                    onClick={e => {
                        e.stopPropagation()
                        props.onUnpin()
                    }}
                />
            </Show>
        </div>
    )
}
