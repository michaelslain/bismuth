// app/src/shell/AppFrame.tsx
// The outermost shell: the top strip, the sidebar/editor/rail grid, and the status bar.
//
// The frame OWNS the grid: three cells (`data-shell-cell="sidebar|main|rail"`) placed by a computed
// `grid-template-areas` (shellColumns.ts), so which side the sidebar and the tab rail sit on is a
// pair of props and the slot elements never move in the DOM (DOM order stays sidebar, main, rail).
// Its rules live in AppFrame.module.css; the shell is reached from outside only via
// `data-app-shell`.
//
// SLOTS OVER PROP-DRILLING: JSX slots rather than this component knowing what a sidebar or a tab
// rail is. `main` is the WHOLE `<EditorPane>`; `modals` bundles the independently-storied `<Show>`
// blocks (palettes, modals, context menus) wired in App.tsx; `overlays` bundles DragGhost +
// ToastHost + GalleryHost. `floater` is the always-mounted graph floater.
//
// `sidebarEdge` is the sidebar's `<EdgeHandle>`, placed on the sidebar's own inner line (the line
// moves with `sidebarSide`, and with the rail sitting between sidebar and editor).
//
// `hasRail` stays a REAL prop (App.tsx passes `true` today) because the `--rail-w` transition and
// the switcher override hang off the `data-has-rail` state. `railPinned` lets the frame reserve the
// full pinned width in the grid, not just widen the overlay.
//
// The side/status props are optional with defaults (left / right / visible) so callers that do not
// yet pass them render exactly as before.
import { Show, type JSX } from 'solid-js'
import styles from './AppFrame.module.css'
import {
    gridTemplateAreas,
    gridTemplateColumns,
    shellColumns,
} from './shellColumns'

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
    /** Which window edge the sidebar sits against. Default 'left'. */
    sidebarSide?: 'left' | 'right'
    /** Which window edge the tab rail sits against. Default 'right'. */
    tabRailSide?: 'left' | 'right'
    /** Render the bottom status bar slot. Default true. */
    statusBarVisible?: boolean
    /** The sidebar's <EdgeHandle>, placed on the sidebar's inner line. */
    sidebarEdge?: JSX.Element
    /** An edge drag is live — the grid's column transitions switch off. */
    resizing?: boolean
}) {
    const sidebarSide = () => props.sidebarSide ?? 'left'
    const tabRailSide = () => props.tabRailSide ?? 'right'
    const cells = () => shellColumns(sidebarSide(), tabRailSide())
    const flag = (on: boolean) => (on ? 'true' : undefined)
    return (
        <div class={styles['app-shell']} data-app-shell="true">
            {props.topStrip}
            <div
                class={styles.layout}
                data-switcher-active={flag(props.switcherActive)}
                data-sidebar-hidden={flag(props.sidebarHidden)}
                data-rail-pinned={flag(props.railPinned)}
                data-has-rail={flag(props.hasRail)}
                data-sidebar-side={sidebarSide()}
                data-rail-side={tabRailSide()}
                // A live edge drag (shell/EdgeHandle): the columns must follow the pointer, not
                // ease 0.26s behind it.
                style={{
                    'grid-template-columns': gridTemplateColumns(cells()),
                    'grid-template-areas': gridTemplateAreas(cells()),
                    ...(props.resizing ? { transition: 'none' } : {}),
                }}
            >
                <div
                    class={styles.cell}
                    data-shell-cell="sidebar"
                    style={{ 'grid-area': 'sidebar' }}
                >
                    {props.sidebar}
                </div>
                <div
                    class={styles.cell}
                    data-shell-cell="main"
                    style={{ 'grid-area': 'main' }}
                >
                    {props.main}
                </div>
                <div
                    class={styles.cell}
                    data-shell-cell="rail"
                    style={{ 'grid-area': 'rail' }}
                >
                    {props.rail}
                </div>
                <Show when={props.sidebarEdge}>
                    <div
                        class={styles['sidebar-edge']}
                        data-side={sidebarSide()}
                    >
                        {props.sidebarEdge}
                    </div>
                </Show>
                {props.floater}
                {props.modals}
                {props.overlays}
            </div>
            <Show when={props.statusBarVisible ?? true}>{props.statusBar}</Show>
        </div>
    )
}
