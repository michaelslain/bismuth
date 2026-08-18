// app/src/shell/GraphFloater.tsx
// The single always-mounted Knowledge Graph wrapper. It floats over whichever slot is active: the
// sidebar mini-square, the full main pane (no tabs), or — when a tab shows a graph pane — that
// pane's `data-graph-host` (placed by App's `placeFloater`). Reusing one instance everywhere means
// a split/tab-switch repositions it instead of tearing down + rebuilding the WebGL renderer (which
// would reset the camera). Lifted out of App.tsx verbatim.
//
// `docked` (the sidebar clip-path) is a co-riding state class, reached as a hashed module local via
// `classList={{ [styles['docked']]: props.docked }}` — see GraphFloater.module.css's header,
// including the `:global(html.view-dragging)` split it also documents.
//
// `placeFloater` still writes `top`/`left`/`width`/`height` directly onto the ref'd element from
// App.tsx — that is cross-boundary measurement (an overlay positioned over a host placeholder
// inside a pane leaf) and deliberately stays there, per the plan's "what must not be extracted"
// item 5. This component only owns the `ref` callback prop and the `docked` class.
//
// `data-graph-floater="true"` is a NEW attribute this migration added. `palette/switcher.css` dims
// this element to an opaque `--bg` fill while the Cmd+O switcher is open, via a bare `.graph-floater`
// descendant selector — a wholly unrelated component reaching in from outside. That selector would
// silently match nothing once `.graph-floater` became a CSS-Modules local (`bench/moduleClassCheck.ts
// --verbose` caught it as a "declared by a global stylesheet too" warning; no story sets
// `.switcher-active`, so nothing in this plan's own gate would have). The attribute is the same fix
// Sidebar.tsx's `data-sidebar-toolbar` already established for the identical shape of problem — see
// its comment there and switcher.css's `.layout.switcher-active [data-graph-floater]` rule.
import type { JSX } from 'solid-js'
import styles from './GraphFloater.module.css'

export function GraphFloater(props: {
    docked: boolean
    ref: (el: HTMLDivElement) => void
    children: JSX.Element
}) {
    return (
        <div
            class={styles['graph-floater']}
            classList={{ [styles['docked']]: props.docked }}
            ref={props.ref}
            data-graph-floater="true"
        >
            {props.children}
        </div>
    )
}
