// app/src/shell/EditorPane.tsx
// The main editor column: an optional update banner, the Cmd+O switcher bar (absolutely positioned
// over the body while active), and the scrollable body that hosts the active tab's pane tree plus
// the always-mounted terminal/chat overlays. Lifted out of App.tsx verbatim.
//
// CLASS NAMES ARE SCOPED via EditorPane.module.css (2026-08 CSS modularization, Task 11) — the
// `data-editor-pane` attribute alongside the module class is palette/switcher.css's cross-boundary
// reach for the switcher bar's positioning context; see that module's header.
//
// `.graph-slot-main` (the no-active-tab fallback placeholder) is NOT rendered by this file — it
// stays inline in App.tsx as part of the `children` slot, exactly like the PaneTree/overlay `<For>`
// loops, and stays a global App.css page-frame class (App.tsx's own layout slot, not this
// component's or GraphView's — see graph/Graph.module.css's header for that decision).
//
// `bodyRef` is the callback-ref prop for `editorBodyEl`, which App.tsx's `measureOverlayHosts` and
// `placeFloater` read via a `ResizeObserver` — that measurement stays in App.tsx (cross-boundary,
// per the plan's "what must not be extracted" item 5); this component only forwards the element.
import type { JSX } from 'solid-js'
import styles from './EditorPane.module.css'

export function EditorPane(props: {
    banner: JSX.Element
    switcher: JSX.Element
    bodyRef: (el: HTMLDivElement) => void
    children: JSX.Element
}) {
    return (
        <main class={styles['editor-pane']} data-editor-pane="true">
            {props.banner}
            {/* Cmd+O switcher: a big search bar absolutely positioned over the tab strip while
            switcher mode is on. The graph floater (below) fills the body behind it. */}
            {props.switcher}
            {/* Tabs are the right-edge vertical RAIL only — see the .tab-rail block below. The classic
            horizontal top strip (and its ui.verticalTabs opt-out) was removed: two full tab
            presentations meant every tab feature had to be built, styled and drag-tested twice, and
            the rail is the one that fits the redesign. */}
            <div class={styles['editor-body']} ref={props.bodyRef}>
                {props.children}
            </div>
        </main>
    )
}
