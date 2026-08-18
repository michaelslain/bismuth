import type { JSX } from "solid-js";

// The left sidebar — vault name eyebrow, toolbar row, file tree, and the docked graph square —
// lifted out of App.tsx verbatim. Slots over prop-drilling: `toolbar` and `tree` are handed
// finished JSX rather than this component re-declaring FileTree's five props or knowing what a
// command is, which is what keeps its story trivial (`<Sidebar tree={<div>stub</div>} …/>` renders
// with no transport and no vault).
//
// CLASS NAMES ARE STILL BARE GLOBAL STRING LITERALS — this is the extraction half of the migration
// only. `.asc-eyebrow` stays a bare global permanently (ui.css). `hidden` on `.sidebar` is a
// DELIBERATE bare literal, not an oversight: no `.sidebar.hidden` rule exists anywhere in the
// stylesheet today — the sidebar's collapse is done by `.layout.sidebar-hidden` one level up.
// Giving `hidden` a module lookup here would resolve to `undefined` and land a literal
// `class="undefined"` on the element the moment the CSS half lands, so it must stay bare.
export function Sidebar(props: {
  visible: boolean;
  graphCollapsed: boolean;
  graphSlotRef: (el: HTMLDivElement) => void;
  toolbar: JSX.Element;
  tree: JSX.Element;
}) {
  return (
    <aside class="sidebar" classList={{ hidden: !props.visible }}>
      <div class="sidebar-icons">{props.toolbar}</div>
      <div class="sidebar-eyebrow-row"><span class="asc-eyebrow">VAULT</span></div>
      <div class="sidebar-files">{props.tree}</div>
      <div class="sidebar-graph-section" classList={{ collapsed: props.graphCollapsed }}>
        <div class="sidebar-eyebrow-row"><span class="asc-eyebrow">GRAPH</span></div>
        <div class="sidebar-graph" ref={props.graphSlotRef} />
      </div>
    </aside>
  );
}
