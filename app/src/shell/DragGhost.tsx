// app/src/shell/DragGhost.tsx
// The floating ghost that follows the cursor during a tab/pane drag — lifted out of App.tsx
// verbatim. `pointer-events: none` so `elementFromPoint` resolves the drop target beneath it.
//
// `pane` is a co-riding state class (dashed border vs solid), reached as a hashed module local via
// `classList={{ [styles['pane']]: props.pane }}` — see DragGhost.module.css's header.
//
// GHOST_MAX_W clamp arithmetic stays in App.tsx — it reads the live drag state (grabDX/grabDY,
// the descriptor's width); this component receives already-resolved pixel numbers and only draws.
import styles from './DragGhost.module.css'

export function DragGhost(props: {
    label: string
    pane: boolean
    x: number
    y: number
    width: number
}) {
    return (
        <div
            class={styles['drag-ghost']}
            classList={{ [styles['pane']]: props.pane }}
            style={{
                left: `${props.x}px`,
                top: `${props.y}px`,
                width: `${props.width}px`,
            }}
        >
            {props.label}
        </div>
    )
}
