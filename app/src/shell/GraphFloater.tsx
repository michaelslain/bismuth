// app/src/shell/GraphFloater.tsx
// The single always-mounted Knowledge Graph wrapper. It floats over whichever slot is active: the
// sidebar mini-square, the full main pane (no tabs), or — when a tab shows a graph pane — that
// pane's `data-graph-host` (placed by App's `placeFloater`). Reusing one instance everywhere means
// a split/tab-switch repositions it instead of tearing down + rebuilding the WebGL renderer (which
// would reset the camera). Lifted out of App.tsx verbatim.
//
// CLASS NAMES ARE STILL BARE GLOBAL STRING LITERALS — this is the extraction half of the migration
// only (see the plan's THE RECIPE). `docked` (the sidebar clip-path) is a co-riding state class
// that becomes a module local once the CSS half lands.
//
// `placeFloater` still writes `top`/`left`/`width`/`height` directly onto the ref'd element from
// App.tsx — that is cross-boundary measurement (an overlay positioned over a host placeholder
// inside a pane leaf) and deliberately stays there, per the plan's "what must not be extracted"
// item 5. This component only owns the `ref` callback prop and the `docked` class.
import type { JSX } from 'solid-js'

export function GraphFloater(props: {
    docked: boolean
    ref: (el: HTMLDivElement) => void
    children: JSX.Element
}) {
    return (
        <div
            class="graph-floater"
            classList={{ docked: props.docked }}
            ref={props.ref}
        >
            {props.children}
        </div>
    )
}
