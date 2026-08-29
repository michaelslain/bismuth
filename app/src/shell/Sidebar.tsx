import type { JSX } from 'solid-js'
import styles from './Sidebar.module.css'

// The left sidebar — toolbar row, file tree, and the docked graph square —
// lifted out of App.tsx verbatim. Slots over prop-drilling: `toolbar` and `tree` are handed
// finished JSX rather than this component re-declaring FileTree's five props or knowing what a
// command is, which is what keeps its story trivial (`<Sidebar tree={<div>stub</div>} …/>` renders
// with no transport and no vault).
//
// Classes are reached through the imported `styles` object — bracket access, not `styles.sidebar`,
// since Vite only exposes camelCase aliases under css.modules.localsConvention, which
// app/vite.config.ts does not set. `collapsed` hashes too (it is a state class riding on
// `.sidebar-graph-section`), so it goes into `classList` as `[styles.collapsed]` rather than a bare
// string. `hidden` on `.sidebar` is a
// DELIBERATE bare literal, not an oversight: no `.sidebar.hidden` rule exists anywhere in the
// stylesheet — the sidebar's collapse is done by `.layout.sidebar-hidden` one level up, and a
// module lookup for a name the module never defines would resolve to `undefined`, landing a
// literal `class="undefined"` on the element.
//
// `data-sidebar-toolbar="true"` on the toolbar row is a NEW attribute, not part of the recorded
// baseline's markup. It exists because `palette/switcher.css`'s
// `.layout.switcher-active .sidebar-icons { opacity: .35; pointer-events: none; … }` reaches this
// element from a wholly unrelated component (the Cmd+O switcher dims the sidebar toolbar while
// active) — a cross-file descendant selector this migration would otherwise break silently, since
// no Storybook story ever sets `.switcher-active` and the computed-style baseline never renders
// it. `bench/moduleClassCheck.ts --verbose` is what caught it (a "declared by a global stylesheet
// too" warning on `sidebar-icons`, traced to `palette/switcher.css:102` — not a stale leftover of
// this migration, a live cross-component dependency). Attribute selectors are the repo's existing
// pattern for reaching a class-module element from outside its own file without sharing a module
// (see `data-tabstrip`/`data-tab-chip` in App.tsx, `data-pane-leaf` in PaneTree.tsx); switcher.css
// now selects `[data-sidebar-toolbar]` instead of `.sidebar-icons`.
export function Sidebar(props: {
    visible: boolean
    graphCollapsed: boolean
    graphSlotRef: (el: HTMLDivElement) => void
    toolbar: JSX.Element
    tree: JSX.Element
}) {
    return (
        <aside class={styles['sidebar']} classList={{ hidden: !props.visible }}>
            <div class={styles['sidebar-icons']} data-sidebar-toolbar="true">
                {props.toolbar}
            </div>
            {/* NO "VAULT" EYEBROW. The file tree is self-evidently the vault; a label above it
                named the obvious and cost a full 36px band at the top of the column. Removed
                2026-08-28 at the user's request. The graph section below lost its "GRAPH" eyebrow
                for the same reason. */}
            <div class={styles['sidebar-files']}>{props.tree}</div>
            <div
                class={styles['sidebar-graph-section']}
                classList={{ [styles['collapsed']]: props.graphCollapsed }}
            >
                <div class={styles['sidebar-graph']} ref={props.graphSlotRef} />
            </div>
        </aside>
    )
}
