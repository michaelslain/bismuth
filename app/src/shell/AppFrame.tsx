// app/src/shell/AppFrame.tsx
// The outermost shell: the top strip, the sidebar/editor/rail/graph grid, and the status bar.
// Lifted out of App.tsx verbatim — every box in the tree is presentational and posed from props
// alone (see the plan's "the single most important reason for this shape"); no new component here
// owns a signal, fetches, or reads `settings`.
//
// CLASS NAMES ARE STILL BARE GLOBAL STRING LITERALS — this is the extraction half of the migration
// only (see the plan's THE RECIPE).
//
// SLOTS OVER PROP-DRILLING: eight JSX slots rather than this component knowing what a sidebar or a
// tab rail is. `main` is the WHOLE `<EditorPane>` (its own body already includes the pane tree and
// the terminal/chat overlays as ITS children); `modals` bundles the nine already-independently-
// storied `<Show>` blocks (CommandPalette, TemplatePalette, FolderPrompt, DaemonOwnerModal,
// DaemonSetupModal, BismuthInstallModal, EditDictionaryModal, GcalConnectModal, the three
// ContextMenus) — see the plan's "what must not be extracted" item 8, they stay wired in App.tsx
// exactly as before, just handed down as one slot instead of typed inline here; `overlays` bundles
// DragGhost + ToastHost + GalleryHost, the remaining always-mounted layer that isn't the graph
// floater and isn't a gated modal. Rendering ORDER is preserved exactly as App.tsx's original JSX
// (sidebar, main, rail, floater, modals, overlays) since it is also DOM order.
//
// `hasRail` is currently hardcoded `true` by App.tsx's caller (App.tsx:2791 before this
// extraction) — kept as a REAL prop rather than simplified away, because the `--rail-w` transition
// and the `.switcher-active` override both hang off `.layout.has-rail` in App.css, and collapsing
// it to a constant inside this component would change what the cascade can see change.
//
// `railPinned` is the same story one step further: the rail's PINNED state used to live only in
// TabRail's own module (`.tab-rail.rail-pinned` → a 232px absolutely-positioned overlay), so the
// grid column behind it stayed 46px and 186px of rail covered the note. The frame has to see the
// state to reserve the width. NOTE the name collision, which is deliberate and safe: the class this
// component writes is a GLOBAL bare literal read by App.css, while TabRail.module.css's identically
// named class is HASHED and lands on a different element. They never meet.
import type { JSX } from 'solid-js'

export function AppFrame(props: {
    topStrip: JSX.Element
    sidebar: JSX.Element
    main: JSX.Element
    rail: JSX.Element
    floater: JSX.Element
    overlays: JSX.Element
    modals: JSX.Element
    statusBar: JSX.Element
    sidebarHidden: boolean
    switcherActive: boolean
    hasRail: boolean
    railPinned: boolean
}) {
    return (
        <div class="app-shell">
            {props.topStrip}
            <div
                class="layout"
                classList={{
                    'sidebar-hidden': props.sidebarHidden,
                    'switcher-active': props.switcherActive,
                    'has-rail': props.hasRail,
                    'rail-pinned': props.railPinned,
                }}
            >
                {props.sidebar}
                {props.main}
                {props.rail}
                {props.floater}
                {props.modals}
                {props.overlays}
            </div>
            {props.statusBar}
        </div>
    )
}
