// app/src/shell/TabRailRow.tsx
// One row of the vertical tab rail: icon, label (or an inline rename input), and a trailing
// close-X / pin. Lifted out of App.tsx's `<Index each={tabs()}>` body verbatim. `App.tsx` keeps the
// `<Index>` itself and the per-row `createMemo` for the chat tint (`railColor`) — those read App
// state; this component only draws one already-resolved row.
//
// IMPORTS `./TabRail.module.css` — GETS NO MODULE OF ITS OWN. Eight hover/focus selectors span
// TabRail.tsx and this file (`.tab-rail:hover .tab-rail-label`, `.tab-rail:focus-within
// .tab-rail-row.pinned .tab-pin`, …); per-file hashing would break every one of them silently behind
// a green build (Trap 4). See TabRail.module.css's header for the full account.
//
// `active` AND `pinned` are hashed module locals, reached via `classList={{ [styles['active']]: …,
// [styles['pinned']]: … }}`. `dragging` stays a bare string literal DELIBERATELY — no
// `.tab-rail-row.dragging` rule exists anywhere in the stylesheet, so a module lookup would resolve
// to `undefined` and land a literal `class="undefined"` on the row (Trap 2). See the module header.
//
// THE THREE IMPERATIVE `.closest()` REFERENCES (App.tsx:3047,3058,3084 before extraction) are now
// rewritten against `styles` below. Note the third guard (dblclick → rename) tests only
// `.tab-x`/`.tab-pin`, NOT `.tab-rename` — that asymmetry is preserved verbatim, not "fixed" into
// consistency, per the plan's explicit instruction.
//
// `style={{}}` on the row is a preserved no-op: the original read `style={railStyle()}` where
// `railStyle = createMemo(() => ({}))` — a memo with no dependencies that always evaluated to an
// empty object. It carried no data and read no signal, so this extraction inlines the resolved
// constant rather than threading a vestigial no-op prop through App.tsx; the rendered output is
// identical either way (an empty style object applies nothing).
import { Show } from 'solid-js'
import { Icon } from '../icons/Icon'
import { IconButton } from '../ui/IconButton'
import Label from '../ui/Label'
import styles from './TabRail.module.css'

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
    // The row's trailing controls; a click/pointerdown/dblclick landing on any of them must not
    // also activate or drag the tab. The dblclick guard deliberately omits `.tab-rename` — see the
    // header comment; that asymmetry is preserved, not "fixed".
    const inTrailingControl = (t: EventTarget | null) =>
        !!(t as HTMLElement | null)?.closest(
            `.${styles['tab-x']}, .${styles['tab-pin']}, .${styles['tab-rename']}`,
        )
    const inCloseOrPin = (t: EventTarget | null) =>
        !!(t as HTMLElement | null)?.closest(
            `.${styles['tab-x']}, .${styles['tab-pin']}`,
        )
    return (
        <div
            class={styles['tab-rail-row']}
            classList={{
                [styles['active']]: props.active,
                [styles['pinned']]: props.pinned,
                dragging: props.dragging,
            }}
            data-tab-chip="true"
            // Native tooltip surfaces the name while the rail is collapsed to icons.
            title={props.renaming ? undefined : props.label}
            style={{}}
            onClick={e => {
                if (inTrailingControl(e.target)) return
                props.onActivate()
            }}
            onPointerDown={e => {
                if (inTrailingControl(e.target)) return
                props.onPointerDown(e)
            }}
            // Middle-click closes any tab (incl. a pinned one) — the escape hatch.
            onAuxClick={props.onAuxClick}
            onDblClick={e => {
                if (inCloseOrPin(e.target)) return
                props.onDblClick()
            }}
            onContextMenu={props.onContextMenu}
        >
            {/* Every rail row shows an icon (fall back to a generic doc) so the
        collapsed icon-column is never empty for an unnamed note. */}
            <Icon
                class={styles['tab-rail-icon']}
                value={props.icon}
                size={16}
                style={props.color ? { color: props.color } : undefined}
            />
            <Show
                when={props.renaming}
                fallback={
                    <Label fill class={styles['tab-rail-label']}>
                        {props.label}
                    </Label>
                }
            >
                <input
                    class={styles['tab-rename']}
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
                        class={styles['tab-x']}
                        icon="X"
                        label="Close tab"
                        iconSize={13}
                        onClick={props.onClose}
                    />
                }
            >
                <IconButton
                    class={styles['tab-pin']}
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
