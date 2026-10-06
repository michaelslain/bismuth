import { For, Match, Switch, type JSX } from 'solid-js'
import styles from './Sidebar.module.css'
import IconBar from '../ui/IconBar'

// The sidebar (either side) — toolbar row, file tree, and the docked graph square —
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
// stylesheet — the sidebar's collapse is done by `.layout[data-sidebar-hidden]` in shell/AppFrame.module.css, one level up, and a
// module lookup for a name the module never defines would resolve to `undefined`, landing a
// literal `class="undefined"` on the element.
//
// SECTIONS + SIDE: `sections` is order AND presence (top to bottom; an absent id is not rendered),
// each id mapping to its markup below. `side` flips the 1px border to the column's left edge.
// Both are optional so a caller that passes neither renders exactly the original left column.
// The toolbar carries its hairline on TOP when it is the last of two or more sections.
//
// `data-sidebar-toolbar="true"` on the toolbar row is passed through `IconBar`'s rest-attribute
// spread onto its root div. It exists because shell/AppFrame.module.css's
// `.layout[data-switcher-active] [data-sidebar-toolbar] { opacity: .35; pointer-events: none; … }`
// reaches this element from a wholly unrelated component (the Cmd+O switcher dims the sidebar
// toolbar while active) — a cross-file dependency this migration must not break silently, since
// no Storybook story ever sets `data-switcher-active` and the computed-style baseline never renders
// it. Attribute selectors are the repo's existing pattern for reaching an element from outside its
// own file without sharing a module (see `data-tabstrip`/`data-tab-chip` in App.tsx,
// `data-pane-leaf` in PaneTree.tsx); shell/AppFrame.module.css selects `[data-sidebar-toolbar]`, not a class.
const DEFAULT_SECTIONS: readonly ('toolbar' | 'files' | 'graph')[] = ['toolbar', 'files', 'graph']

export function Sidebar(props: {
    visible: boolean
    graphCollapsed: boolean
    graphSlotRef: (el: HTMLDivElement) => void
    toolbar: JSX.Element
    tree: JSX.Element
    /** Which window edge the column sits against. Default 'left'. */
    side?: 'left' | 'right'
    /** Already normalized (known ids, unique). Render order top to bottom; absent id = not rendered. */
    sections?: readonly ('toolbar' | 'files' | 'graph')[]
}) {
    const sections = () => props.sections ?? DEFAULT_SECTIONS
    const toolbarLast = () => sections().length >= 2 && sections()[sections().length - 1] === 'toolbar'
    // The graph's hairline faces `files` only: top when files sits above it, bottom when below.
    const graphRule = () => {
        const s = sections()
        const i = s.indexOf('graph')
        return s[i - 1] === 'files' ? 'top' : s[i + 1] === 'files' ? 'bottom' : 'none'
    }
    return (
        <aside
            class={styles['sidebar']}
            classList={{ hidden: !props.visible, [styles['right']]: props.side === 'right' }}
        >
            <For each={sections()}>
                {id => (
                    <Switch>
                        <Match when={id === 'toolbar'}>
                            <IconBar
                                band
                                bandRule={toolbarLast() ? 'top' : 'bottom'}
                                label="Sidebar toolbar"
                                data-sidebar-toolbar="true"
                            >
                                {props.toolbar}
                            </IconBar>
                        </Match>
                        <Match when={id === 'files'}>
                            {/* NO "VAULT" EYEBROW. The file tree is self-evidently the vault; a label
                                above it named the obvious and cost a full 36px band. Removed 2026-08-28
                                at the user's request. The graph section lost its "GRAPH" eyebrow too. */}
                            <div class={styles['sidebar-files']}>{props.tree}</div>
                        </Match>
                        <Match when={id === 'graph'}>
                            <div
                                class={styles['sidebar-graph-section']}
                                classList={{ [styles['collapsed']]: props.graphCollapsed }}
                            >
                                <div
                                    class={styles['sidebar-graph']}
                                    classList={{
                                        [styles['rule-top']]: graphRule() === 'top',
                                        [styles['rule-bottom']]: graphRule() === 'bottom',
                                    }}
                                    ref={props.graphSlotRef}
                                />
                            </div>
                        </Match>
                    </Switch>
                )}
            </For>
        </aside>
    )
}
