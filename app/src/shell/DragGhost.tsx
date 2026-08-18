// app/src/shell/DragGhost.tsx
// The floating ghost that follows the cursor during a tab/pane drag — lifted out of App.tsx
// verbatim. `pointer-events: none` so `elementFromPoint` resolves the drop target beneath it.
//
// CLASS NAMES ARE STILL BARE GLOBAL STRING LITERALS — this is the extraction half of the migration
// only (see the plan's THE RECIPE). `.pane` is a co-riding state class (dashed border vs solid)
// that becomes a module local once the CSS half lands.
//
// GHOST_MAX_W clamp arithmetic stays in App.tsx — it reads the live drag state (grabDX/grabDY,
// the descriptor's width); this component receives already-resolved pixel numbers and only draws.
export function DragGhost(props: {
    label: string
    pane: boolean
    x: number
    y: number
    width: number
}) {
    return (
        <div
            class="drag-ghost"
            classList={{ pane: props.pane }}
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
